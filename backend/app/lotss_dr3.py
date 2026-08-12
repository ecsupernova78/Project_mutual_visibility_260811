"""Restricted LoTSS DR3 TAP adapter.

The browser never supplies an endpoint or arbitrary ADQL.  This module owns the
upstream URL, selected columns, filters, ordering, timeout, and result limits.
"""

from __future__ import annotations

import csv
import hashlib
import io
import math
import os
import re
from dataclasses import dataclass
from typing import Literal

import httpx
from astropy import units as u
from astropy.coordinates import SkyCoord

from app.models import LofarSearchResponse, LofarSource

TAP_SYNC_URL = "https://vo.astron.nl/tap/sync"
TABLE_NAME = "lotss_dr3.main_sources"
MAX_PAGE_SIZE = 50
DEFAULT_MAX_ROWS = 1_000
DEFAULT_TIMEOUT_SECONDS = 20.0

SortField = Literal["total_flux", "peak_flux"]
SortDirection = Literal["asc", "desc"]
QueryMode = Literal["name", "cone"]


class LofarCatalogError(RuntimeError):
    """Base error exposed as a controlled upstream failure by the API layer."""


class LofarCatalogTimeout(LofarCatalogError):
    """The upstream TAP service did not answer within the configured limit."""


@dataclass(frozen=True, slots=True)
class LofarSearch:
    mode: QueryMode
    query: str | None
    ra_deg: float | None
    dec_deg: float | None
    radius_arcmin: float | None
    sort_by: SortField
    sort_direction: SortDirection
    page: int
    page_size: int


def _configured_timeout() -> float:
    try:
        value = float(os.getenv("CATALOG_REQUEST_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS))
    except ValueError:
        return DEFAULT_TIMEOUT_SECONDS
    if not math.isfinite(value):
        return DEFAULT_TIMEOUT_SECONDS
    return min(max(value, 1.0), 60.0)


def _configured_max_rows() -> int:
    try:
        value = int(os.getenv("CATALOG_MAX_ROWS", DEFAULT_MAX_ROWS))
    except ValueError:
        return DEFAULT_MAX_ROWS
    return min(max(value, MAX_PAGE_SIZE), 10_000)


def _build_adql(search: LofarSearch) -> str:
    if search.mode not in {"name", "cone"}:
        raise ValueError("unsupported catalog query mode")
    if search.sort_by not in {"total_flux", "peak_flux"}:
        raise ValueError("unsupported catalog sort field")
    if search.sort_direction not in {"asc", "desc"}:
        raise ValueError("unsupported catalog sort direction")
    if search.page < 1 or not 1 <= search.page_size <= MAX_PAGE_SIZE:
        raise ValueError("invalid catalog page")

    offset = (search.page - 1) * search.page_size
    max_rows = _configured_max_rows()
    if offset + search.page_size > max_rows:
        raise ValueError("requested page exceeds the configured catalog row limit")

    order_column = {"total_flux": "Total_flux", "peak_flux": "Peak_flux"}[search.sort_by]

    if search.mode == "name":
        if search.query is None:
            raise ValueError("query is required for name search")
        if re.fullmatch(r"[A-Za-z0-9+.-]{8,80}", search.query) is None:
            raise ValueError("query must be an 8-80 character LoTSS source ID prefix")
        # The HTTP model only permits a conservative source-ID character set.
        # Prefix matching prevents a short leading-wildcard scan across the
        # 13.7-million-row release while still supporting partial source IDs.
        where = f"1=ivo_nocasematch(Source_Name, '{search.query}%')"
    else:
        if search.ra_deg is None or search.dec_deg is None or search.radius_arcmin is None:
            raise ValueError("ra_deg, dec_deg, and radius_arcmin are required for cone search")
        if (
            not all(math.isfinite(value) for value in (search.ra_deg, search.dec_deg, search.radius_arcmin))
            or not 0 <= search.ra_deg < 360
            or not -90 <= search.dec_deg <= 90
            or not 0.1 <= search.radius_arcmin <= 60
        ):
            raise ValueError("cone search coordinates or radius are outside the supported range")
        radius_deg = search.radius_arcmin / 60.0
        where = (
            "1=CONTAINS(POINT('ICRS', RA, DEC), "
            f"CIRCLE('ICRS', {search.ra_deg:.10f}, {search.dec_deg:.10f}, {radius_deg:.10f}))"
        )

    where = f"({where}) AND {order_column} IS NOT NULL"
    direction = search.sort_direction.upper()
    next_full_page_allowed = offset + 2 * search.page_size <= max_rows
    fetch_count = search.page_size + int(next_full_page_allowed)
    return (
        f"SELECT TOP {fetch_count} Source_Name, RA, DEC, Total_flux, Peak_flux "
        f"FROM {TABLE_NAME} WHERE {where} "
        f"ORDER BY {order_column} {direction}, Source_Name ASC OFFSET {offset}"
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


def _parse_csv(payload: str) -> list[LofarSource]:
    reader = csv.DictReader(io.StringIO(payload))
    if reader.fieldnames is None:
        raise LofarCatalogError("upstream returned a CSV response without columns")

    normalized_fields = {field.strip().lstrip("\ufeff").lower() for field in reader.fieldnames}
    required = {"source_name", "ra", "dec", "total_flux", "peak_flux"}
    if not required.issubset(normalized_fields):
        raise LofarCatalogError("upstream CSV columns do not match the LoTSS DR3 contract")

    sources: list[LofarSource] = []
    for raw_row in reader:
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
            )
        )
    return sources


def search_sources(search: LofarSearch) -> LofarSearchResponse:
    """Execute one bounded synchronous TAP query and validate every returned row."""

    adql = _build_adql(search)
    offset = (search.page - 1) * search.page_size
    max_rows = _configured_max_rows()
    next_full_page_allowed = offset + 2 * search.page_size <= max_rows
    fetch_count = search.page_size + int(next_full_page_allowed)
    try:
        response = httpx.post(
            TAP_SYNC_URL,
            data={
                "REQUEST": "doQuery",
                "LANG": "ADQL",
                "FORMAT": "csv",
                "MAXREC": str(fetch_count),
                "QUERY": adql,
            },
            headers={"Accept": "text/csv", "User-Agent": "MutualSky/0.0 LoTSS-DR3 catalog client"},
            timeout=_configured_timeout(),
            follow_redirects=False,
        )
        response.raise_for_status()
    except httpx.TimeoutException as error:
        raise LofarCatalogTimeout("LoTSS DR3 TAP request timed out") from error
    except httpx.HTTPError as error:
        raise LofarCatalogError("LoTSS DR3 TAP request failed") from error

    sources = _parse_csv(response.text)
    has_more = len(sources) > search.page_size and next_full_page_allowed
    return LofarSearchResponse(
        query_mode=search.mode,
        page=search.page,
        page_size=search.page_size,
        has_more=has_more,
        sources=sources[: search.page_size],
    )
