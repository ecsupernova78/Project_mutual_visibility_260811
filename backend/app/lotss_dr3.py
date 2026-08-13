"""Restricted LoTSS DR3 asynchronous TAP adapter.

The browser never supplies an endpoint or arbitrary ADQL. This module owns the
ASTRON endpoint, selected columns, optional source-name prefix, ordering, result
limits, UWS lifecycle, and timeouts.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import logging
import math
import os
import re
import time
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Literal
from urllib.parse import urljoin, urlsplit

import httpx
from astropy import units as u
from astropy.coordinates import SkyCoord

from app.models import (
    LofarConeSearchResponse,
    LofarMorphologyDefinition,
    LofarSearchResponse,
    LofarSource,
)

TAP_ASYNC_URL = "https://vo.astron.nl/__system__/tap/run/tap/async"
TABLE_NAME = "lotss_dr3.main_sources"
XMATCH_URL = "https://cdsxmatch.u-strasbg.fr/xmatch/api/v1/sync"
SIMBAD_TAP_URL = "https://simbad.cds.unistra.fr/simbad/sim-tap/sync"
ALLOWED_LIMITS = frozenset({10, 25, 50, 100, 250, 500, 1000})
DEFAULT_REQUEST_TIMEOUT_SECONDS = 20.0
DEFAULT_JOB_TIMEOUT_SECONDS = 90.0
INITIAL_POLL_INTERVAL_SECONDS = 1.0
MAX_POLL_INTERVAL_SECONDS = 5.0
CLEANUP_TIMEOUT_SECONDS = 5.0
MAX_CSV_BYTES = 2_000_000
MAX_RESULT_REDIRECTS = 2
DEFAULT_CACHE_TTL_SECONDS = 300.0
DEFAULT_MAX_CONCURRENT_JOBS = 2
MAX_CACHE_ENTRIES = 32
MAX_ENRICHMENT_CSV_BYTES = 2_000_000
MAX_ALIAS_QUERY_CHARACTERS = 120_000
XMATCH_RADIUS_ARCSEC = 5.0
HIGH_CONFIDENCE_RADIUS_ARCSEC = 2.0

_ASTRON_HOST = "vo.astron.nl"
_ASYNC_PATH = "/__system__/tap/run/tap/async"
_JOB_PATH_PATTERN = re.compile(rf"^{re.escape(_ASYNC_PATH)}/([A-Za-z0-9][A-Za-z0-9._~-]{{0,255}})/?$")
_SOURCE_PREFIX_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9+.-]{0,79}")

SortField = Literal["distance", "total_flux", "peak_flux"]
SortDirection = Literal["asc", "desc"]
SearchMode = Literal["brightness", "cone"]

MORPHOLOGY = {
    "S": ("Single Gaussian", "A radio source represented by one fitted Gaussian component."),
    "M": ("Multiple Gaussian", "A radio source composed of multiple fitted Gaussian components."),
    "C": ("Shared island component", "A single-Gaussian source in an island containing other sources."),
}
MORPHOLOGY_CODEBOOK = [
    LofarMorphologyDefinition(code=code, label=label, description=description)
    for code, (label, description) in MORPHOLOGY.items()
]

logger = logging.getLogger(__name__)


class LofarCatalogError(RuntimeError):
    """Base error exposed as a controlled upstream failure by the API layer."""


class LofarCatalogTimeout(LofarCatalogError):
    """The upstream TAP service did not finish within the configured limit."""


class LofarCatalogBusy(LofarCatalogError):
    """This process is already running the configured number of unique TAP jobs."""


class LofarEnrichmentError(RuntimeError):
    """A fail-soft SIMBAD enrichment request failed."""


@dataclass(frozen=True, slots=True)
class LofarSearch:
    source_prefix: str | None
    sort_by: SortField
    sort_direction: SortDirection
    limit: int
    mode: SearchMode = "brightness"
    ra_deg: float | None = None
    dec_deg: float | None = None
    radius_arcmin: float | None = None


def _configured_seconds(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, default))
    except ValueError:
        return default
    if not math.isfinite(value):
        return default
    return min(max(value, minimum), maximum)


def _configured_request_timeout() -> float:
    return _configured_seconds(
        "CATALOG_REQUEST_TIMEOUT_SECONDS",
        DEFAULT_REQUEST_TIMEOUT_SECONDS,
        1.0,
        60.0,
    )


def _configured_job_timeout() -> float:
    return _configured_seconds(
        "CATALOG_JOB_TIMEOUT_SECONDS",
        DEFAULT_JOB_TIMEOUT_SECONDS,
        5.0,
        300.0,
    )


def _configured_cache_ttl() -> float:
    return _configured_seconds("CATALOG_CACHE_TTL_SECONDS", DEFAULT_CACHE_TTL_SECONDS, 0.0, 3600.0)


def _configured_max_concurrent_jobs() -> int:
    try:
        value = int(os.getenv("CATALOG_MAX_CONCURRENT_JOBS", DEFAULT_MAX_CONCURRENT_JOBS))
    except ValueError:
        return DEFAULT_MAX_CONCURRENT_JOBS
    return min(max(value, 1), 4)


def _monotonic() -> float:
    return time.monotonic()


def _build_adql(search: LofarSearch) -> str:
    allowed_sort_fields = (
        {"total_flux", "peak_flux"}
        if search.mode == "brightness"
        else {
            "distance",
            "total_flux",
            "peak_flux",
        }
    )
    if search.sort_by not in allowed_sort_fields:
        raise ValueError("unsupported catalog sort field")
    if search.sort_direction not in {"asc", "desc"}:
        raise ValueError("unsupported catalog sort direction")
    if search.limit not in ALLOWED_LIMITS:
        raise ValueError("unsupported catalog result limit")
    if search.source_prefix is not None and _SOURCE_PREFIX_PATTERN.fullmatch(search.source_prefix) is None:
        raise ValueError("source_prefix must contain 1-80 safe Source_Name characters")

    order_column = {"distance": "Separation_deg", "total_flux": "Total_flux", "peak_flux": "Peak_flux"}[search.sort_by]
    selected = "Source_Name, RA, DEC, Total_flux, Peak_flux, S_Code"
    predicates: list[str] = []

    if search.mode == "brightness":
        if search.ra_deg is not None or search.dec_deg is not None or search.radius_arcmin is not None:
            raise ValueError("brightness searches must not contain cone coordinates")
        predicates.append(f"{order_column} IS NOT NULL")
        if search.source_prefix is not None:
            predicates.append(f"1=ivo_nocasematch(Source_Name, '{search.source_prefix}%')")
    elif search.mode == "cone":
        if search.source_prefix is not None:
            raise ValueError("cone searches must not contain a source prefix")
        if (
            search.ra_deg is None
            or search.dec_deg is None
            or search.radius_arcmin is None
            or not math.isfinite(search.ra_deg)
            or not math.isfinite(search.dec_deg)
            or not math.isfinite(search.radius_arcmin)
            or not 0 <= search.ra_deg < 360
            or not -90 <= search.dec_deg <= 90
            or not 0 < search.radius_arcmin <= 60
        ):
            raise ValueError("cone coordinates or radius are outside the supported range")
        ra = format(search.ra_deg, ".12g")
        dec = format(search.dec_deg, ".12g")
        radius_deg = format(search.radius_arcmin / 60.0, ".12g")
        point = "POINT('ICRS', RA, DEC)"
        center = f"POINT('ICRS', {ra}, {dec})"
        selected += f", DISTANCE({point}, {center}) AS Separation_deg"
        predicates.append(f"1=CONTAINS({point}, CIRCLE('ICRS', {ra}, {dec}, {radius_deg}))")
        if search.sort_by != "distance":
            predicates.append(f"{order_column} IS NOT NULL")
    else:
        raise ValueError("unsupported catalog search mode")

    return (
        f"SELECT TOP {search.limit} {selected} FROM {TABLE_NAME} "
        f"WHERE {' AND '.join(predicates)} "
        f"ORDER BY {order_column} {search.sort_direction.upper()}, Source_Name ASC"
    )


def _optional_float(value: str | None, field: str) -> float | None:
    if value is None or not value.strip():
        return None
    try:
        parsed = float(value)
    except ValueError as error:
        raise LofarCatalogError(f"upstream returned invalid {field}") from error
    if not math.isfinite(parsed) or parsed < 0:
        raise LofarCatalogError(f"upstream returned invalid {field}")
    return parsed


def _required_float(value: str | None, field: str) -> float:
    parsed = _optional_float(value, field)
    if parsed is None:
        raise LofarCatalogError(f"upstream omitted {field}")
    return parsed


def _stable_id(source_id: str) -> str:
    digest = hashlib.blake2s(source_id.encode("utf-8"), digest_size=10).hexdigest()
    return f"lotss-dr3-{digest}"


def _parse_csv(payload: str, maximum_rows: int, *, cone: bool = False) -> list[LofarSource]:
    reader = csv.DictReader(io.StringIO(payload))
    if reader.fieldnames is None:
        raise LofarCatalogError("upstream returned a CSV response without columns")

    normalized_fields = {field.strip().lstrip("\ufeff").lower() for field in reader.fieldnames}
    required = {"source_name", "ra", "dec", "total_flux", "peak_flux", "s_code"}
    if cone:
        required.add("separation_deg")
    if not required.issubset(normalized_fields):
        raise LofarCatalogError("upstream CSV columns do not match the LoTSS DR3 contract")

    sources: list[LofarSource] = []
    for raw_row in reader:
        if len(sources) >= maximum_rows:
            raise LofarCatalogError("upstream returned more rows than requested")
        row = {(key or "").strip().lstrip("\ufeff").lower(): value for key, value in raw_row.items()}
        source_id = (row.get("source_name") or "").strip()
        if not source_id or len(source_id) > 80 or re.fullmatch(r"[A-Za-z0-9+_.-]+", source_id) is None:
            raise LofarCatalogError("upstream returned an invalid source identifier")
        ra_deg = _required_float(row.get("ra"), "RA")
        dec_value = row.get("dec")
        try:
            dec_deg = float(dec_value) if dec_value is not None else math.nan
        except ValueError as error:
            raise LofarCatalogError("upstream returned invalid DEC") from error
        if not math.isfinite(dec_deg) or not 0 <= ra_deg < 360 or not -90 <= dec_deg <= 90:
            raise LofarCatalogError("upstream returned coordinates outside ICRS bounds")

        coordinate = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
        morphology_code = (row.get("s_code") or "").strip().upper() or None
        if morphology_code is not None and morphology_code not in MORPHOLOGY:
            raise LofarCatalogError("upstream returned an unknown S_Code")
        morphology = MORPHOLOGY.get(morphology_code) if morphology_code is not None else None
        separation_deg = _optional_float(row.get("separation_deg"), "Separation_deg") if cone else None
        sources.append(
            LofarSource(
                id=_stable_id(source_id),
                source_id=source_id,
                name=source_id,
                ra_deg=round(ra_deg, 9),
                dec_deg=round(dec_deg, 9),
                ra_hms=coordinate.ra.to_string(unit=u.hourangle, sep=":", precision=2, pad=True),
                dec_dms=coordinate.dec.to_string(unit=u.deg, sep=":", precision=2, pad=True, alwayssign=True),
                total_flux_mjy=_optional_float(row.get("total_flux"), "Total_flux"),
                peak_flux_mjy=_optional_float(row.get("peak_flux"), "Peak_flux"),
                morphology_code=morphology_code,
                morphology_label=morphology[0] if morphology else None,
                morphology_description=morphology[1] if morphology else None,
                separation_arcmin=round(separation_deg * 60.0, 9) if separation_deg is not None else None,
            )
        )
    return sources


@dataclass(frozen=True, slots=True)
class _Counterpart:
    main_id: str
    object_type_code: str | None
    object_type_label: str | None
    separation_arcsec: float


def _bounded_text(value: str | None, maximum: int) -> str | None:
    if value is None:
        return None
    normalized = " ".join(value.split())
    if not normalized:
        return None
    return normalized[:maximum]


def _normalized_alias(value: str) -> str:
    normalized = " ".join(value.split())
    match = re.fullmatch(r"(M|NGC|IC|3C|3CR|4C|UGC|PGC)\s+(.+)", normalized, flags=re.IGNORECASE)
    if match is not None:
        return f"{match.group(1).upper()}{match.group(2)}"
    return normalized


def _alias_priority(value: str) -> tuple[int, bool, int, str]:
    normalized = " ".join(value.split())
    # Prefer broadly recognized names, with radio catalogues ahead of optical
    # aliases when both identify the same SIMBAD positional candidate.
    prefixes = ("M ", "3C ", "3CR ", "NGC ", "IC ", "4C ", "UGC ", "PGC ", "MCG", "NAME ")
    rank = next(
        (index for index, prefix in enumerate(prefixes) if normalized.upper().startswith(prefix)), len(prefixes)
    )
    return rank, ".0" in normalized, len(normalized), normalized.casefold()


async def _enrichment_post(
    client: httpx.AsyncClient,
    url: str,
    *,
    data: dict[str, str],
    files: dict[str, tuple[str, str, str]] | None = None,
) -> str:
    try:
        response = await client.post(
            url,
            data=data,
            files=files,
            headers={"Accept": "text/csv"},
            timeout=_configured_request_timeout(),
            follow_redirects=False,
        )
    except (httpx.HTTPError, TimeoutError) as error:
        raise LofarEnrichmentError("catalog enrichment request failed") from error
    if response.status_code != 200:
        raise LofarEnrichmentError("catalog enrichment returned an unexpected status")
    if len(response.content) > MAX_ENRICHMENT_CSV_BYTES:
        raise LofarEnrichmentError("catalog enrichment response exceeded the size limit")
    return response.text


async def _xmatch_counterparts(
    sources: list[LofarSource],
    client: httpx.AsyncClient,
) -> dict[str, _Counterpart]:
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(("source_id", "ra", "dec", "total_flux", "peak_flux", "s_code"))
    for source in sources:
        writer.writerow(
            (
                source.source_id,
                format(source.ra_deg, ".12g"),
                format(source.dec_deg, ".12g"),
                "" if source.total_flux_mjy is None else format(source.total_flux_mjy, ".12g"),
                "" if source.peak_flux_mjy is None else format(source.peak_flux_mjy, ".12g"),
                source.morphology_code or "",
            )
        )

    payload = await _enrichment_post(
        client,
        XMATCH_URL,
        data={
            "request": "xmatch",
            "cat2": "simbad",
            "colRA1": "ra",
            "colDec1": "dec",
            "distMaxArcsec": format(XMATCH_RADIUS_ARCSEC, "g"),
            "selection": "best",
            "RESPONSEFORMAT": "csv",
            "cols1": "source_id,ra,dec,total_flux,peak_flux,s_code",
            "cols2": "main_id,otype,main_type,other_types",
        },
        files={"cat1": ("lotss.csv", output.getvalue(), "text/csv")},
    )
    reader = csv.DictReader(io.StringIO(payload))
    if reader.fieldnames is None:
        raise LofarEnrichmentError("XMatch returned CSV without columns")
    fields = {field.strip().lstrip("\ufeff").lower() for field in reader.fieldnames}
    if not {"angdist", "source_id", "main_id", "otype", "main_type"}.issubset(fields):
        raise LofarEnrichmentError("XMatch columns do not match the expected contract")

    allowed_ids = {source.source_id for source in sources}
    matches: dict[str, _Counterpart] = {}
    for raw_row in reader:
        row = {(key or "").strip().lstrip("\ufeff").lower(): value for key, value in raw_row.items()}
        source_id = (row.get("source_id") or "").strip()
        main_id = _bounded_text(row.get("main_id"), 80)
        if source_id not in allowed_ids or main_id is None:
            raise LofarEnrichmentError("XMatch returned an unknown source or invalid counterpart")
        try:
            separation = float(row.get("angdist") or "nan")
        except ValueError as error:
            raise LofarEnrichmentError("XMatch returned an invalid separation") from error
        if not math.isfinite(separation) or not 0 <= separation <= XMATCH_RADIUS_ARCSEC + 1e-6:
            raise LofarEnrichmentError("XMatch returned a counterpart outside the configured radius")
        candidate = _Counterpart(
            main_id=main_id,
            object_type_code=_bounded_text(row.get("otype"), 40),
            object_type_label=_bounded_text(row.get("main_type"), 120),
            separation_arcsec=separation,
        )
        previous = matches.get(source_id)
        if previous is None or candidate.separation_arcsec < previous.separation_arcsec:
            matches[source_id] = candidate
    return matches


def _adql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


async def _simbad_csv(
    client: httpx.AsyncClient,
    query: str,
    *,
    required_columns: frozenset[str],
) -> list[dict[str, str | None]]:
    if len(query) > MAX_ALIAS_QUERY_CHARACTERS:
        raise LofarEnrichmentError("SIMBAD query exceeded the configured size limit")
    payload = await _enrichment_post(
        client,
        SIMBAD_TAP_URL,
        data={"REQUEST": "doQuery", "LANG": "ADQL", "QUERY": query, "FORMAT": "csv"},
    )
    reader = csv.DictReader(io.StringIO(payload))
    if reader.fieldnames is None:
        raise LofarEnrichmentError("SIMBAD TAP returned CSV without columns")
    normalized_fields = {field.strip().lstrip("\ufeff").lower() for field in reader.fieldnames}
    if not required_columns.issubset(normalized_fields):
        raise LofarEnrichmentError("SIMBAD TAP columns do not match the expected contract")
    return [
        {(key or "").strip().lstrip("\ufeff").lower(): value for key, value in raw_row.items()} for raw_row in reader
    ]


async def _counterpart_details(
    matches: dict[str, _Counterpart],
    client: httpx.AsyncClient,
) -> tuple[dict[str, list[str]], dict[str, str]]:
    if not matches:
        return {}, {}
    main_ids = sorted({match.main_id for match in matches.values()})
    quoted_main_ids = ", ".join(_adql_string(value) for value in main_ids)
    alias_query = (
        "SELECT b.main_id, i.id AS alias_id FROM basic AS b "
        "JOIN ident AS i ON b.oid=i.oidref "
        f"WHERE b.main_id IN ({quoted_main_ids}) AND ("
        "i.id LIKE 'M %' OR i.id LIKE 'NGC %' OR i.id LIKE 'IC %' OR "
        "i.id LIKE '3C %' OR i.id LIKE '3CR %' OR i.id LIKE '4C %' OR "
        "i.id LIKE 'UGC %' OR i.id LIKE 'PGC %' OR i.id LIKE 'MCG%' OR i.id LIKE 'NAME %')"
    )
    type_codes = sorted({match.object_type_code for match in matches.values() if match.object_type_code})
    type_query = (
        "SELECT otype, description FROM otypedef WHERE otype IN ("
        + ", ".join(_adql_string(value) for value in type_codes)
        + ")"
        if type_codes
        else None
    )

    alias_rows = await _simbad_csv(
        client,
        alias_query,
        required_columns=frozenset({"main_id", "alias_id"}),
    )
    type_rows = (
        await _simbad_csv(
            client,
            type_query,
            required_columns=frozenset({"otype", "description"}),
        )
        if type_query is not None
        else []
    )
    aliases: dict[str, list[str]] = {main_id: [] for main_id in main_ids}
    for row in alias_rows:
        main_id = _bounded_text(row.get("main_id"), 80)
        alias_id = _bounded_text(row.get("alias_id"), 80)
        if main_id in aliases and alias_id is not None:
            aliases[main_id].append(alias_id)
    for main_id, values in aliases.items():
        aliases[main_id] = sorted(set(values), key=_alias_priority)[:5]

    descriptions: dict[str, str] = {}
    for row in type_rows:
        code = _bounded_text(row.get("otype"), 40)
        description = _bounded_text(row.get("description"), 500)
        if code is not None and description is not None:
            descriptions[code] = description
    return aliases, descriptions


def _apply_counterparts(
    sources: list[LofarSource],
    matches: dict[str, _Counterpart],
    aliases_by_main_id: dict[str, list[str]] | None = None,
    descriptions: dict[str, str] | None = None,
) -> list[LofarSource]:
    enriched: list[LofarSource] = []
    for source in sources:
        match = matches.get(source.source_id)
        if match is None:
            enriched.append(source)
            continue
        raw_aliases = (
            sorted(aliases_by_main_id.get(match.main_id, []), key=_alias_priority)
            if aliases_by_main_id is not None
            else []
        )
        counterpart_aliases = []
        for alias in [*raw_aliases, match.main_id]:
            normalized = _normalized_alias(alias)
            if normalized not in counterpart_aliases:
                counterpart_aliases.append(normalized)
        counterpart_id = _normalized_alias(match.main_id)
        if counterpart_id not in counterpart_aliases:
            counterpart_aliases.append(counterpart_id)
        if len(counterpart_aliases) > 5:
            counterpart_aliases = [*counterpart_aliases[:4], counterpart_id]
        display_name = counterpart_aliases[0] if counterpart_aliases else _normalized_alias(match.main_id)
        unified_aliases = [source.source_id]
        unified_aliases.extend(alias for alias in counterpart_aliases if alias != display_name)
        enriched.append(
            source.model_copy(
                update={
                    "name": display_name,
                    "aliases": unified_aliases[:5],
                    "counterpart_name": _normalized_alias(match.main_id),
                    "counterpart_aliases": counterpart_aliases,
                    "object_type_code": match.object_type_code,
                    "object_type_label": match.object_type_label,
                    "object_type_description": (descriptions or {}).get(match.object_type_code or ""),
                    "crossmatch_separation_arcsec": round(match.separation_arcsec, 6),
                    "crossmatch_confidence": (
                        "high" if match.separation_arcsec <= HIGH_CONFIDENCE_RADIUS_ARCSEC else "caution"
                    ),
                    "crossmatch_catalog": "SIMBAD",
                }
            )
        )
    return enriched


async def _enrich_sources(
    sources: list[LofarSource],
    client: httpx.AsyncClient,
) -> tuple[list[LofarSource], Literal["complete", "partial", "unavailable"], str | None]:
    if not sources:
        return sources, "complete", None
    try:
        async with asyncio.timeout(_configured_seconds("CATALOG_ENRICHMENT_TIMEOUT_SECONDS", 30.0, 5.0, 60.0)):
            matches = await _xmatch_counterparts(sources, client)
    except (TimeoutError, LofarEnrichmentError) as error:
        logger.warning("SIMBAD positional enrichment unavailable: %s", error)
        return sources, "unavailable", "SIMBAD 위치 후보 정보를 일시적으로 불러오지 못했습니다."

    base_enriched = _apply_counterparts(sources, matches)
    try:
        async with asyncio.timeout(_configured_seconds("CATALOG_ENRICHMENT_TIMEOUT_SECONDS", 30.0, 5.0, 60.0)):
            aliases, descriptions = await _counterpart_details(matches, client)
    except (TimeoutError, LofarEnrichmentError) as error:
        logger.warning("SIMBAD alias/type enrichment partially unavailable: %s", error)
        return base_enriched, "partial", "SIMBAD 별칭 또는 유형 설명 일부를 불러오지 못했습니다."
    return _apply_counterparts(sources, matches, aliases, descriptions), "complete", None


def _validated_astron_url(location: str | None, base_url: str) -> str:
    if location is None or not location.strip() or any(character in location for character in ("\r", "\n", "\\")):
        raise LofarCatalogError("upstream omitted or returned an unsafe redirect location")

    resolved = urljoin(base_url, location.strip())
    try:
        parsed = urlsplit(resolved)
        port = parsed.port
    except ValueError as error:
        raise LofarCatalogError("upstream returned an invalid redirect location") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname != _ASTRON_HOST
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise LofarCatalogError("upstream returned an unsafe redirect location")
    return resolved


def _validated_job_url(location: str | None) -> str:
    resolved = _validated_astron_url(location, f"{TAP_ASYNC_URL}/")
    parsed = urlsplit(resolved)
    if parsed.query or "%" in parsed.path:
        raise LofarCatalogError("upstream returned an unsafe TAP job location")
    match = _JOB_PATH_PATTERN.fullmatch(parsed.path)
    if match is None:
        raise LofarCatalogError("upstream returned a TAP job outside the configured endpoint")
    return f"https://{_ASTRON_HOST}{_ASYNC_PATH}/{match.group(1)}"


def _validated_job_redirect(location: str | None, job_url: str) -> None:
    resolved = _validated_astron_url(location, job_url)
    parsed = urlsplit(resolved)
    canonical = f"https://{_ASTRON_HOST}{parsed.path.rstrip('/')}"
    if parsed.query or canonical != job_url:
        raise LofarCatalogError("upstream redirected a TAP operation outside its job")


async def _request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    deadline: float,
    **kwargs: object,
) -> httpx.Response:
    remaining = deadline - _monotonic()
    if remaining <= 0:
        raise LofarCatalogTimeout("LoTSS DR3 asynchronous TAP job timed out")
    try:
        async with asyncio.timeout(remaining):
            return await client.request(
                method,
                url,
                timeout=min(_configured_request_timeout(), remaining),
                **kwargs,
            )
    except (TimeoutError, httpx.TimeoutException) as error:
        raise LofarCatalogTimeout("LoTSS DR3 TAP request timed out") from error
    except httpx.HTTPError as error:
        raise LofarCatalogError("LoTSS DR3 TAP request failed") from error


def _require_status(response: httpx.Response, expected: int, operation: str) -> None:
    if response.status_code != expected:
        raise LofarCatalogError(f"LoTSS DR3 TAP {operation} returned an unexpected status")


async def _abort_job(client: httpx.AsyncClient, job_url: str) -> None:
    try:
        response = await client.post(
            f"{job_url}/phase",
            data={"PHASE": "ABORT"},
            timeout=min(_configured_request_timeout(), CLEANUP_TIMEOUT_SECONDS),
            follow_redirects=False,
        )
        if response.status_code not in {200, 204, 303}:
            logger.warning("LoTSS DR3 TAP job abort returned status %s", response.status_code)
    except httpx.HTTPError as error:
        logger.warning("LoTSS DR3 TAP job abort failed: %s", error)


async def _delete_job(client: httpx.AsyncClient, job_url: str) -> None:
    try:
        response = await client.delete(
            job_url,
            timeout=min(_configured_request_timeout(), CLEANUP_TIMEOUT_SECONDS),
            follow_redirects=False,
        )
        if response.status_code not in {200, 204, 303}:
            logger.warning("LoTSS DR3 TAP job deletion returned status %s", response.status_code)
    except httpx.HTTPError as error:
        logger.warning("LoTSS DR3 TAP job deletion failed: %s", error)


async def _result_csv(client: httpx.AsyncClient, job_url: str, deadline: float) -> str:
    result_url = f"{job_url}/results/result"
    for redirect_count in range(MAX_RESULT_REDIRECTS + 1):
        response = await _request(
            client,
            "GET",
            result_url,
            deadline,
            headers={"Accept": "text/csv"},
            follow_redirects=False,
        )
        if response.status_code == 200:
            if len(response.content) > MAX_CSV_BYTES:
                raise LofarCatalogError("LoTSS DR3 TAP result exceeded the response limit")
            return response.text
        if response.status_code == 303 and redirect_count < MAX_RESULT_REDIRECTS:
            result_url = _validated_astron_url(response.headers.get("Location"), result_url)
            continue
        raise LofarCatalogError("LoTSS DR3 TAP result returned an unexpected status")
    raise LofarCatalogError("LoTSS DR3 TAP result redirected too many times")


async def _search_with_client(
    search: LofarSearch,
    client: httpx.AsyncClient,
) -> LofarSearchResponse | LofarConeSearchResponse:
    adql = _build_adql(search)
    deadline = _monotonic() + _configured_job_timeout()
    job_url: str | None = None
    job_completed = False
    poll_interval = INITIAL_POLL_INTERVAL_SECONDS

    try:
        create_response = await _request(
            client,
            "POST",
            TAP_ASYNC_URL,
            deadline,
            data={
                "REQUEST": "doQuery",
                "LANG": "ADQL",
                "QUERY": adql,
                "RESPONSEFORMAT": "csv",
                "MAXREC": str(search.limit),
            },
            headers={"Accept": "application/xml, text/xml;q=0.9"},
            follow_redirects=False,
        )
        _require_status(create_response, 303, "job creation")
        job_url = _validated_job_url(create_response.headers.get("Location"))

        run_response = await _request(
            client,
            "POST",
            f"{job_url}/phase",
            deadline,
            data={"PHASE": "RUN"},
            follow_redirects=False,
        )
        _require_status(run_response, 303, "job start")
        _validated_job_redirect(run_response.headers.get("Location"), job_url)

        while True:
            phase_response = await _request(
                client,
                "GET",
                f"{job_url}/phase",
                deadline,
                headers={"Accept": "text/plain"},
                follow_redirects=False,
            )
            _require_status(phase_response, 200, "phase check")
            phase = phase_response.text.strip().upper()
            if phase == "COMPLETED":
                job_completed = True
                break
            if phase in {"ERROR", "ABORTED", "ARCHIVED", "HELD"}:
                raise LofarCatalogError("LoTSS DR3 TAP job did not complete successfully")
            if phase not in {"PENDING", "QUEUED", "EXECUTING", "SUSPENDED", "UNKNOWN"}:
                raise LofarCatalogError("LoTSS DR3 TAP job returned an unknown phase")
            remaining = deadline - _monotonic()
            if remaining <= 0:
                raise LofarCatalogTimeout("LoTSS DR3 asynchronous TAP job timed out")
            await asyncio.sleep(min(poll_interval, remaining))
            poll_interval = min(poll_interval + 1.0, MAX_POLL_INTERVAL_SECONDS)

        sources = _parse_csv(
            await _result_csv(client, job_url, deadline),
            search.limit,
            cone=search.mode == "cone",
        )
        common = {
            "sort_by": search.sort_by,
            "sort_direction": search.sort_direction,
            "limit": search.limit,
            "result_count": len(sources),
            "sources": sources,
            "enrichment_status": "unavailable",
            "enrichment_warning": "SIMBAD 보강을 아직 수행하지 않았습니다.",
            "morphology_codebook": MORPHOLOGY_CODEBOOK,
        }
        if search.mode == "cone":
            return LofarConeSearchResponse(
                center_ra_deg=search.ra_deg,
                center_dec_deg=search.dec_deg,
                radius_arcmin=search.radius_arcmin,
                **common,
            )
        return LofarSearchResponse(source_prefix=search.source_prefix, **common)
    except LofarCatalogError, asyncio.CancelledError:
        if job_url is not None and not job_completed:
            await _abort_job(client, job_url)
        raise
    finally:
        if job_url is not None:
            await _delete_job(client, job_url)


async def search_sources(
    search: LofarSearch,
    *,
    client: httpx.AsyncClient | None = None,
    enrichment_client: httpx.AsyncClient | None = None,
) -> LofarSearchResponse | LofarConeSearchResponse:
    """Execute one bounded ASTRON TAP/UWS job and validate all returned rows."""

    if client is not None:
        response = await _search_with_client(search, client)
        if enrichment_client is None:
            return response
        sources, status, warning = await _enrich_sources(response.sources, enrichment_client)
        return response.model_copy(
            update={"sources": sources, "enrichment_status": status, "enrichment_warning": warning}
        )

    async with httpx.AsyncClient(
        headers={"User-Agent": "MutualSky/0.0 LoTSS-DR3 catalog client"},
        follow_redirects=False,
    ) as owned_client:
        response = await _search_with_client(search, owned_client)
        sources, status, warning = await _enrich_sources(response.sources, owned_client)
        return response.model_copy(
            update={"sources": sources, "enrichment_status": status, "enrichment_warning": warning}
        )


LofarCatalogResponse = LofarSearchResponse | LofarConeSearchResponse
SearchRunner = Callable[[LofarSearch], Awaitable[LofarCatalogResponse]]


class CatalogQueryCoordinator:
    """Coalesce, cache, and bound unique upstream catalogue jobs per process."""

    def __init__(self, runner: SearchRunner = search_sources) -> None:
        self._runner = runner
        self._lock = asyncio.Lock()
        self._inflight: dict[LofarSearch, asyncio.Task[LofarCatalogResponse]] = {}
        self._cache: dict[LofarSearch, tuple[float, LofarCatalogResponse]] = {}
        self._active_jobs = 0

    async def search(self, search: LofarSearch) -> LofarCatalogResponse:
        now = _monotonic()
        async with self._lock:
            expired = [key for key, (expires_at, _) in self._cache.items() if expires_at <= now]
            for key in expired:
                self._cache.pop(key, None)
            cached = self._cache.get(search)
            if cached is not None:
                _, response = cached
                return deepcopy(response)

            task = self._inflight.get(search)
            if task is None:
                if self._active_jobs >= _configured_max_concurrent_jobs():
                    raise LofarCatalogBusy("maximum concurrent LoTSS DR3 TAP jobs reached")
                self._active_jobs += 1
                task = asyncio.create_task(self._run_shared(search))
                task.add_done_callback(self._observe_task)
                self._inflight[search] = task

        return deepcopy(await asyncio.shield(task))

    async def _run_shared(self, search: LofarSearch) -> LofarCatalogResponse:
        try:
            response = await self._runner(search)
            ttl = _configured_cache_ttl()
            if ttl > 0 and response.enrichment_status == "complete":
                async with self._lock:
                    now = _monotonic()
                    expired = [key for key, (expires_at, _) in self._cache.items() if expires_at <= now]
                    for key in expired:
                        self._cache.pop(key, None)
                    while len(self._cache) >= MAX_CACHE_ENTRIES:
                        self._cache.pop(next(iter(self._cache)))
                    self._cache[search] = (now + ttl, deepcopy(response))
            return response
        finally:
            async with self._lock:
                self._inflight.pop(search, None)
                self._active_jobs -= 1

    @staticmethod
    def _observe_task(task: asyncio.Task[LofarCatalogResponse]) -> None:
        """Retrieve orphaned failures when every shielded waiter has gone away."""

        if not task.cancelled():
            task.exception()


catalog_query_coordinator = CatalogQueryCoordinator()
