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

from app.models import LofarSearchResponse, LofarSource

TAP_ASYNC_URL = "https://vo.astron.nl/__system__/tap/run/tap/async"
TABLE_NAME = "lotss_dr3.main_sources"
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

_ASTRON_HOST = "vo.astron.nl"
_ASYNC_PATH = "/__system__/tap/run/tap/async"
_JOB_PATH_PATTERN = re.compile(rf"^{re.escape(_ASYNC_PATH)}/([A-Za-z0-9][A-Za-z0-9._~-]{{0,255}})/?$")
_SOURCE_PREFIX_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9+.-]{0,79}")

SortField = Literal["total_flux", "peak_flux"]
SortDirection = Literal["asc", "desc"]

logger = logging.getLogger(__name__)


class LofarCatalogError(RuntimeError):
    """Base error exposed as a controlled upstream failure by the API layer."""


class LofarCatalogTimeout(LofarCatalogError):
    """The upstream TAP service did not finish within the configured limit."""


class LofarCatalogBusy(LofarCatalogError):
    """This process is already running the configured number of unique TAP jobs."""


@dataclass(frozen=True, slots=True)
class LofarSearch:
    source_prefix: str | None
    sort_by: SortField
    sort_direction: SortDirection
    limit: int


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
    if search.sort_by not in {"total_flux", "peak_flux"}:
        raise ValueError("unsupported catalog sort field")
    if search.sort_direction not in {"asc", "desc"}:
        raise ValueError("unsupported catalog sort direction")
    if search.limit not in ALLOWED_LIMITS:
        raise ValueError("unsupported catalog result limit")
    if search.source_prefix is not None and _SOURCE_PREFIX_PATTERN.fullmatch(search.source_prefix) is None:
        raise ValueError("source_prefix must contain 1-80 safe Source_Name characters")

    order_column = {"total_flux": "Total_flux", "peak_flux": "Peak_flux"}[search.sort_by]
    predicates = [f"{order_column} IS NOT NULL"]
    if search.source_prefix is not None:
        predicates.append(f"1=ivo_nocasematch(Source_Name, '{search.source_prefix}%')")

    return (
        f"SELECT TOP {search.limit} Source_Name, RA, DEC, Total_flux, Peak_flux "
        f"FROM {TABLE_NAME} WHERE {' AND '.join(predicates)} "
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


def _parse_csv(payload: str, maximum_rows: int) -> list[LofarSource]:
    reader = csv.DictReader(io.StringIO(payload))
    if reader.fieldnames is None:
        raise LofarCatalogError("upstream returned a CSV response without columns")

    normalized_fields = {field.strip().lstrip("\ufeff").lower() for field in reader.fieldnames}
    required = {"source_name", "ra", "dec", "total_flux", "peak_flux"}
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
) -> LofarSearchResponse:
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

        sources = _parse_csv(await _result_csv(client, job_url, deadline), search.limit)
        return LofarSearchResponse(
            sort_by=search.sort_by,
            sort_direction=search.sort_direction,
            limit=search.limit,
            source_prefix=search.source_prefix,
            result_count=len(sources),
            sources=sources,
        )
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
) -> LofarSearchResponse:
    """Execute one bounded ASTRON TAP/UWS job and validate all returned rows."""

    if client is not None:
        return await _search_with_client(search, client)

    async with httpx.AsyncClient(
        headers={"User-Agent": "MutualSky/0.0 LoTSS-DR3 catalog client"},
        follow_redirects=False,
    ) as owned_client:
        return await _search_with_client(search, owned_client)


SearchRunner = Callable[[LofarSearch], Awaitable[LofarSearchResponse]]


class CatalogQueryCoordinator:
    """Coalesce, cache, and bound unique upstream catalogue jobs per process."""

    def __init__(self, runner: SearchRunner = search_sources) -> None:
        self._runner = runner
        self._lock = asyncio.Lock()
        self._inflight: dict[LofarSearch, asyncio.Task[LofarSearchResponse]] = {}
        self._cache: dict[LofarSearch, tuple[float, LofarSearchResponse]] = {}
        self._active_jobs = 0

    async def search(self, search: LofarSearch) -> LofarSearchResponse:
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

    async def _run_shared(self, search: LofarSearch) -> LofarSearchResponse:
        try:
            response = await self._runner(search)
            ttl = _configured_cache_ttl()
            if ttl > 0:
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
    def _observe_task(task: asyncio.Task[LofarSearchResponse]) -> None:
        """Retrieve orphaned failures when every shielded waiter has gone away."""

        if not task.cancelled():
            task.exception()


catalog_query_coordinator = CatalogQueryCoordinator()
