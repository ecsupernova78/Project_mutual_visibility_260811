"""Restricted VLASS Epoch 1 Quick Look asynchronous VizieR TAP adapter.

The public VizieR table used here is the component catalogue published by
Gordon et al. (2021). It must not be presented as a current VLASS release.
The browser cannot supply an endpoint, table name, arbitrary ADQL, or result
URL; this module owns and validates the complete TAP/UWS interaction.
"""

from __future__ import annotations

import asyncio
import csv
import hashlib
import io
import logging
import math
import re
from collections.abc import Awaitable, Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Literal, cast
from urllib.parse import urljoin, urlsplit

import httpx
from astropy import units as u
from astropy.coordinates import SkyCoord

from app.lotss_dr3 import (
    LofarSimbadFilterUnavailable as VlassSimbadFilterUnavailable,
)
from app.lotss_dr3 import (
    _configured_cache_ttl,
    _configured_job_timeout,
    _configured_max_concurrent_jobs,
    _configured_request_timeout,
    _enrich_sources,
    _monotonic,
)
from app.lotss_dr3 import (
    filter_simbad_type_categories as _filter_simbad_type_categories,
)
from app.models import (
    SIMBAD_TYPE_CATEGORY_ORDER,
    SimbadTypeCategory,
    VlassConeSearchResponse,
    VlassMorphologyDefinition,
    VlassSearchResponse,
    VlassSource,
)

TAP_ASYNC_URL = "https://tapvizier.cds.unistra.fr/TAPVizieR/tap/async"
TABLE_NAME = '"J/ApJS/255/30/comp"'
ALLOWED_LIMITS = frozenset({10, 25, 50, 100, 250, 500, 1000})
INITIAL_POLL_INTERVAL_SECONDS = 1.0
MAX_POLL_INTERVAL_SECONDS = 5.0
CLEANUP_TIMEOUT_SECONDS = 5.0
MAX_CSV_BYTES = 2_000_000
MAX_RESULT_REDIRECTS = 2
MAX_CACHE_ENTRIES = 32

_VIZIER_HOST = "tapvizier.cds.unistra.fr"
_ASYNC_PATH = "/TAPVizieR/tap/async"
_JOB_PATH_PATTERN = re.compile(rf"^{re.escape(_ASYNC_PATH)}/([A-Za-z0-9][A-Za-z0-9._~-]{{0,255}})/?$")
_RESULT_PATH_PATTERN = re.compile(
    rf"^{re.escape(_ASYNC_PATH)}/[A-Za-z0-9][A-Za-z0-9._~-]{{0,255}}/results/"
    r"[A-Za-z0-9][A-Za-z0-9._~-]{0,255}$"
)
_SOURCE_PREFIX_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9+ .-]{0,79}")
_SOURCE_ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9+_. -]{0,79}")

SortField = Literal["distance", "total_flux", "peak_flux"]
SortDirection = Literal["asc", "desc"]
SearchMode = Literal["brightness", "cone"]
MorphologyCode = Literal["S", "C", "M", "E"]

MORPHOLOGY = {
    "S": (
        "Single component",
        "A single fitted Gaussian component that is the only component in its island.",
    ),
    "C": (
        "Shared-island component",
        "A single fitted Gaussian component in an island that contains other components.",
    ),
    "M": (
        "Multiple components",
        "A source represented by multiple fitted Gaussian components.",
    ),
    "E": (
        "Empty island",
        "An island for which no Gaussian component was successfully fitted.",
    ),
}
MORPHOLOGY_CODEBOOK = [
    VlassMorphologyDefinition(code=code, label=label, description=description)
    for code, (label, description) in MORPHOLOGY.items()
]
ALL_MORPHOLOGY_CODES: frozenset[MorphologyCode] = frozenset(MORPHOLOGY)

logger = logging.getLogger(__name__)


class VlassCatalogError(RuntimeError):
    """Base error exposed as a controlled upstream failure by the API layer."""


class VlassCatalogTimeout(VlassCatalogError):
    """The VizieR TAP service did not finish within the configured limit."""


class VlassCatalogBusy(VlassCatalogError):
    """This process is already running the configured number of unique TAP jobs."""


@dataclass(frozen=True, slots=True)
class VlassSearch:
    source_prefix: str | None
    sort_by: SortField
    sort_direction: SortDirection
    limit: int
    mode: SearchMode = "brightness"
    ra_deg: float | None = None
    dec_deg: float | None = None
    radius_arcmin: float | None = None
    morphology_codes: frozenset[MorphologyCode] = ALL_MORPHOLOGY_CODES
    recommended_only: bool = True


def _adql_string(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _quality_predicates() -> list[str]:
    return ["DupFlag<2", "QualFlag IN (0,4)", "SCode<>'E'"]


def _build_adql(search: VlassSearch) -> str:
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
        raise ValueError("source_prefix must contain 1-80 safe VLASS component-name characters")
    if not search.morphology_codes or not search.morphology_codes <= ALL_MORPHOLOGY_CODES:
        raise ValueError("morphology_codes must contain one or more of S, C, M, or E")

    order_column = {"distance": "Separation_deg", "total_flux": "Ftot", "peak_flux": "Fpeak"}[search.sort_by]
    # TAPVizieR currently serializes Fpeak 1000x larger than the catalogue's
    # published ASU mJy/beam value, so normalize it in the server-owned ADQL.
    selected = (
        "CompName, RAJ2000, DEJ2000, Ftot AS Total_mJy, Fpeak/1000.0 AS Peak_mJy, SCode, DupFlag, QualFlag, MainSample"
    )
    predicates = _quality_predicates() if search.recommended_only else []

    if search.mode == "brightness":
        if search.ra_deg is not None or search.dec_deg is not None or search.radius_arcmin is not None:
            raise ValueError("brightness searches must not contain cone coordinates")
        nonnull_column = "Ftot" if search.sort_by == "total_flux" else "Fpeak"
        predicates.append(f"{nonnull_column} IS NOT NULL")
        morphology_values = ", ".join(f"'{code}'" for code in MORPHOLOGY if code in search.morphology_codes)
        predicates.append(f"SCode IN ({morphology_values})")
        if search.source_prefix is not None:
            prefix = _adql_string(f"{search.source_prefix.upper()}%")
            predicates.append(f"CompName LIKE {prefix}")
    elif search.mode == "cone":
        if search.morphology_codes != ALL_MORPHOLOGY_CODES:
            raise ValueError("cone searches do not accept morphology filters")
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
        point = "POINT('ICRS', RAJ2000, DEJ2000)"
        center = f"POINT('ICRS', {ra}, {dec})"
        selected += f", DISTANCE({point}, {center}) AS Separation_deg"
        predicates.append(f"1=CONTAINS({point}, CIRCLE('ICRS', {ra}, {dec}, {radius_deg}))")
        if search.sort_by == "total_flux":
            predicates.append("Ftot IS NOT NULL")
        elif search.sort_by == "peak_flux":
            predicates.append("Fpeak IS NOT NULL")
    else:
        raise ValueError("unsupported catalog search mode")

    return (
        f"SELECT TOP {search.limit} {selected} FROM {TABLE_NAME} "
        f"WHERE {' AND '.join(predicates)} "
        f"ORDER BY {order_column} {search.sort_direction.upper()}, CompName ASC"
    )


def _optional_nonnegative_float(value: str | None, field: str) -> float | None:
    if value is None or not value.strip():
        return None
    try:
        parsed = float(value)
    except ValueError as error:
        raise VlassCatalogError(f"upstream returned invalid {field}") from error
    if not math.isfinite(parsed) or parsed < 0:
        raise VlassCatalogError(f"upstream returned invalid {field}")
    return parsed


def _required_float(value: str | None, field: str) -> float:
    if value is None or not value.strip():
        raise VlassCatalogError(f"upstream omitted {field}")
    try:
        parsed = float(value)
    except ValueError as error:
        raise VlassCatalogError(f"upstream returned invalid {field}") from error
    if not math.isfinite(parsed):
        raise VlassCatalogError(f"upstream returned invalid {field}")
    return parsed


def _required_int(value: str | None, field: str, *, minimum: int, maximum: int) -> int:
    parsed = _required_float(value, field)
    if not parsed.is_integer() or not minimum <= parsed <= maximum:
        raise VlassCatalogError(f"upstream returned invalid {field}")
    return int(parsed)


def _required_bool(value: str | None, field: str) -> bool:
    if value is None or not value.strip():
        raise VlassCatalogError(f"upstream omitted {field}")
    normalized = value.strip().casefold()
    if normalized in {"1", "true", "t", "yes", "y", "*"}:
        return True
    if normalized in {"0", "false", "f", "no", "n"}:
        return False
    raise VlassCatalogError(f"upstream returned invalid {field}")


def _stable_id(source_id: str) -> str:
    digest = hashlib.blake2s(source_id.encode("utf-8"), digest_size=10).hexdigest()
    return f"vlass-{digest}"


def _parse_csv(payload: str, maximum_rows: int, *, cone: bool = False) -> list[VlassSource]:
    reader = csv.DictReader(io.StringIO(payload))
    if reader.fieldnames is None:
        raise VlassCatalogError("upstream returned a CSV response without columns")

    normalized_fields = {field.strip().lstrip("\ufeff").lower() for field in reader.fieldnames}
    required = {
        "compname",
        "raj2000",
        "dej2000",
        "total_mjy",
        "peak_mjy",
        "scode",
        "dupflag",
        "qualflag",
        "mainsample",
    }
    if cone:
        required.add("separation_deg")
    if not required.issubset(normalized_fields):
        raise VlassCatalogError("upstream CSV columns do not match the VLASS catalogue contract")

    sources: list[VlassSource] = []
    for raw_row in reader:
        if len(sources) >= maximum_rows:
            raise VlassCatalogError("upstream returned more rows than requested")
        row = {(key or "").strip().lstrip("\ufeff").lower(): value for key, value in raw_row.items()}
        source_id = (row.get("compname") or "").strip()
        if _SOURCE_ID_PATTERN.fullmatch(source_id) is None:
            raise VlassCatalogError("upstream returned an invalid source identifier")

        ra_deg = _required_float(row.get("raj2000"), "RAJ2000")
        dec_deg = _required_float(row.get("dej2000"), "DEJ2000")
        if not 0 <= ra_deg < 360 or not -90 <= dec_deg <= 90:
            raise VlassCatalogError("upstream returned coordinates outside ICRS bounds")

        morphology_code = (row.get("scode") or "").strip().upper() or None
        if morphology_code is not None and morphology_code not in MORPHOLOGY:
            raise VlassCatalogError("upstream returned an unknown SCode")
        morphology = MORPHOLOGY.get(morphology_code) if morphology_code is not None else None
        separation_deg = _optional_nonnegative_float(row.get("separation_deg"), "Separation_deg") if cone else None
        coordinate = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
        sources.append(
            VlassSource(
                id=_stable_id(source_id),
                source_id=source_id,
                name=source_id,
                ra_deg=round(ra_deg, 9),
                dec_deg=round(dec_deg, 9),
                ra_hms=coordinate.ra.to_string(unit=u.hourangle, sep=":", precision=2, pad=True),
                dec_dms=coordinate.dec.to_string(unit=u.deg, sep=":", precision=2, pad=True, alwayssign=True),
                total_flux_mjy=_optional_nonnegative_float(row.get("total_mjy"), "Total_mJy"),
                peak_flux_mjy=_optional_nonnegative_float(row.get("peak_mjy"), "Peak_mJy"),
                morphology_code=morphology_code,
                morphology_label=morphology[0] if morphology else None,
                morphology_description=morphology[1] if morphology else None,
                separation_arcmin=round(separation_deg * 60.0, 9) if separation_deg is not None else None,
                duplicate_flag=_required_int(row.get("dupflag"), "DupFlag", minimum=0, maximum=2),
                quality_flag=_required_int(row.get("qualflag"), "QualFlag", minimum=0, maximum=7),
                main_sample=_required_bool(row.get("mainsample"), "MainSample"),
            )
        )
    return sources


def _validated_vizier_url(location: str | None, base_url: str) -> str:
    if location is None or not location.strip() or any(character in location for character in ("\r", "\n", "\\")):
        raise VlassCatalogError("upstream omitted or returned an unsafe redirect location")

    resolved = urljoin(base_url, location.strip())
    try:
        parsed = urlsplit(resolved)
        port = parsed.port
    except ValueError as error:
        raise VlassCatalogError("upstream returned an invalid redirect location") from error
    if (
        parsed.scheme != "https"
        or parsed.hostname != _VIZIER_HOST
        or port not in {None, 443}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        raise VlassCatalogError("upstream returned an unsafe redirect location")
    return resolved


def _validated_job_url(location: str | None) -> str:
    resolved = _validated_vizier_url(location, f"{TAP_ASYNC_URL}/")
    parsed = urlsplit(resolved)
    if parsed.query or "%" in parsed.path:
        raise VlassCatalogError("upstream returned an unsafe TAP job location")
    match = _JOB_PATH_PATTERN.fullmatch(parsed.path)
    if match is None:
        raise VlassCatalogError("upstream returned a TAP job outside the configured endpoint")
    return f"https://{_VIZIER_HOST}{_ASYNC_PATH}/{match.group(1)}"


def _validated_job_redirect(location: str | None, job_url: str) -> None:
    resolved = _validated_vizier_url(location, job_url)
    parsed = urlsplit(resolved)
    canonical = f"https://{_VIZIER_HOST}{parsed.path.rstrip('/')}"
    if parsed.query or canonical != job_url:
        raise VlassCatalogError("upstream redirected a TAP operation outside its job")


def _validated_result_url(location: str | None, current_url: str, job_url: str) -> str:
    resolved = _validated_vizier_url(location, current_url)
    parsed = urlsplit(resolved)
    canonical_job_path = urlsplit(job_url).path
    if (
        parsed.query
        or "%" in parsed.path
        or not _RESULT_PATH_PATTERN.fullmatch(parsed.path)
        or not parsed.path.startswith(f"{canonical_job_path}/results/")
    ):
        raise VlassCatalogError("upstream redirected a TAP result outside its job")
    return f"https://{_VIZIER_HOST}{parsed.path}"


async def _request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    deadline: float,
    **kwargs: object,
) -> httpx.Response:
    remaining = deadline - _monotonic()
    if remaining <= 0:
        raise VlassCatalogTimeout("VLASS asynchronous TAP job timed out")
    try:
        async with asyncio.timeout(remaining):
            return await client.request(
                method,
                url,
                timeout=min(_configured_request_timeout(), remaining),
                **kwargs,
            )
    except (TimeoutError, httpx.TimeoutException) as error:
        raise VlassCatalogTimeout("VLASS TAP request timed out") from error
    except httpx.HTTPError as error:
        raise VlassCatalogError("VLASS TAP request failed") from error


def _require_status(response: httpx.Response, expected: int, operation: str) -> None:
    if response.status_code != expected:
        raise VlassCatalogError(f"VLASS TAP {operation} returned an unexpected status")


async def _abort_job(client: httpx.AsyncClient, job_url: str) -> None:
    try:
        response = await client.post(
            f"{job_url}/phase",
            data={"PHASE": "ABORT"},
            timeout=min(_configured_request_timeout(), CLEANUP_TIMEOUT_SECONDS),
            follow_redirects=False,
        )
        if response.status_code not in {200, 204, 303}:
            logger.warning("VLASS TAP job abort returned status %s", response.status_code)
    except httpx.HTTPError as error:
        logger.warning("VLASS TAP job abort failed: %s", error)


async def _delete_job(client: httpx.AsyncClient, job_url: str) -> None:
    try:
        response = await client.post(
            job_url,
            data={"ACTION": "DELETE"},
            timeout=min(_configured_request_timeout(), CLEANUP_TIMEOUT_SECONDS),
            follow_redirects=False,
        )
        if response.status_code not in {200, 204, 303}:
            logger.warning("VLASS TAP job deletion returned status %s", response.status_code)
    except httpx.HTTPError as error:
        logger.warning("VLASS TAP job deletion failed: %s", error)


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
                raise VlassCatalogError("VLASS TAP result exceeded the response limit")
            return response.text
        if response.status_code == 303 and redirect_count < MAX_RESULT_REDIRECTS:
            result_url = _validated_result_url(response.headers.get("Location"), result_url, job_url)
            continue
        raise VlassCatalogError("VLASS TAP result returned an unexpected status")
    raise VlassCatalogError("VLASS TAP result redirected too many times")


async def _search_with_client(
    search: VlassSearch,
    client: httpx.AsyncClient,
) -> VlassSearchResponse | VlassConeSearchResponse:
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
                "FORMAT": "csv",
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
                raise VlassCatalogError("VLASS TAP job did not complete successfully")
            if phase not in {"PENDING", "QUEUED", "EXECUTING", "SUSPENDED", "UNKNOWN"}:
                raise VlassCatalogError("VLASS TAP job returned an unknown phase")
            remaining = deadline - _monotonic()
            if remaining <= 0:
                raise VlassCatalogTimeout("VLASS asynchronous TAP job timed out")
            await asyncio.sleep(min(poll_interval, remaining))
            poll_interval = min(poll_interval + 1.0, MAX_POLL_INTERVAL_SECONDS)

        sources = _parse_csv(
            await _result_csv(client, job_url, deadline),
            search.limit,
            cone=search.mode == "cone",
        )
        common: dict[str, Any] = {
            "sort_by": search.sort_by,
            "sort_direction": search.sort_direction,
            "limit": search.limit,
            "recommended_only": search.recommended_only,
            "result_count": len(sources),
            "sources": sources,
            "enrichment_status": "unavailable",
            "enrichment_warning": "SIMBAD enrichment has not been performed yet.",
            "morphology_codebook": MORPHOLOGY_CODEBOOK,
        }
        if search.mode == "cone":
            return VlassConeSearchResponse(
                center_ra_deg=search.ra_deg,
                center_dec_deg=search.dec_deg,
                radius_arcmin=search.radius_arcmin,
                **common,
            )
        return VlassSearchResponse(
            source_prefix=search.source_prefix,
            morphology_codes=[code for code in MORPHOLOGY if code in search.morphology_codes],
            simbad_type_categories=[],
            candidate_count=len(sources),
            **common,
        )
    except VlassCatalogError, asyncio.CancelledError:
        if job_url is not None and not job_completed:
            await _abort_job(client, job_url)
        raise
    finally:
        if job_url is not None:
            await _delete_job(client, job_url)


async def _enrich_vlass_sources(
    sources: list[VlassSource],
    client: httpx.AsyncClient,
) -> tuple[list[VlassSource], Literal["complete", "partial", "unavailable"], str | None]:
    enriched, status, warning = await _enrich_sources(cast(Any, sources), client)
    return cast(list[VlassSource], enriched), status, warning


async def search_sources(
    search: VlassSearch,
    *,
    client: httpx.AsyncClient | None = None,
    enrichment_client: httpx.AsyncClient | None = None,
) -> VlassSearchResponse | VlassConeSearchResponse:
    """Execute one bounded VizieR TAP/UWS job and validate all returned rows."""

    if client is not None:
        response = await _search_with_client(search, client)
        if enrichment_client is None:
            return response
        sources, status, warning = await _enrich_vlass_sources(response.sources, enrichment_client)
        return response.model_copy(
            update={"sources": sources, "enrichment_status": status, "enrichment_warning": warning}
        )
    async with httpx.AsyncClient(
        headers={"User-Agent": "MutualSky/0.0 VLASS-Epoch1-QuickLook catalog client"},
        follow_redirects=False,
    ) as owned_client:
        response = await _search_with_client(search, owned_client)
        sources, status, warning = await _enrich_vlass_sources(response.sources, owned_client)
        return response.model_copy(
            update={"sources": sources, "enrichment_status": status, "enrichment_warning": warning}
        )


def filter_simbad_type_categories(
    response: VlassSearchResponse,
    categories: list[SimbadTypeCategory],
) -> VlassSearchResponse:
    """Apply the shared, fail-closed SIMBAD primary-type filter to VLASS results."""

    canonical = [category for category in SIMBAD_TYPE_CATEGORY_ORDER if category in categories]
    if len(canonical) != len(categories) or len(set(categories)) != len(categories):
        raise ValueError("unsupported or duplicate SIMBAD physical-type category")
    return cast(
        VlassSearchResponse,
        _filter_simbad_type_categories(cast(Any, response), canonical),
    )


VlassCatalogResponse = VlassSearchResponse | VlassConeSearchResponse
SearchRunner = Callable[[VlassSearch], Awaitable[VlassCatalogResponse]]


class VlassCatalogQueryCoordinator:
    """Coalesce, cache, and bound unique upstream VLASS jobs per process."""

    def __init__(self, runner: SearchRunner = search_sources) -> None:
        self._runner = runner
        self._lock = asyncio.Lock()
        self._inflight: dict[VlassSearch, asyncio.Task[VlassCatalogResponse]] = {}
        self._cache: dict[VlassSearch, tuple[float, VlassCatalogResponse]] = {}
        self._active_jobs = 0

    async def search(self, search: VlassSearch) -> VlassCatalogResponse:
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
                    raise VlassCatalogBusy("maximum concurrent VLASS TAP jobs reached")
                self._active_jobs += 1
                task = asyncio.create_task(self._run_shared(search))
                task.add_done_callback(self._observe_task)
                self._inflight[search] = task

        return deepcopy(await asyncio.shield(task))

    async def _run_shared(self, search: VlassSearch) -> VlassCatalogResponse:
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
    def _observe_task(task: asyncio.Task[VlassCatalogResponse]) -> None:
        if not task.cancelled():
            task.exception()


vlass_catalog_query_coordinator = VlassCatalogQueryCoordinator()


__all__ = [
    "TAP_ASYNC_URL",
    "TABLE_NAME",
    "VlassCatalogBusy",
    "VlassCatalogError",
    "VlassCatalogQueryCoordinator",
    "VlassCatalogTimeout",
    "VlassSimbadFilterUnavailable",
    "VlassSearch",
    "filter_simbad_type_categories",
    "search_sources",
    "vlass_catalog_query_coordinator",
]
