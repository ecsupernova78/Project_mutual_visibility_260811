from __future__ import annotations

import asyncio
import logging
from copy import deepcopy
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from app.lotss_dr3 import (
    TAP_ASYNC_URL,
    LofarCatalogBusy,
    LofarCatalogError,
    LofarCatalogTimeout,
    LofarSearch,
    _build_adql,
    _configured_job_timeout,
    _configured_request_timeout,
    _request,
    _validated_job_url,
    search_sources,
)
from app.models import LofarSearchResponse

JOB_URL = f"{TAP_ASYNC_URL}/job-123"
CSV_BODY = (
    "Source_Name,RA,DEC,Total_flux,Peak_flux\n"
    "ILTJ123400.00+450000.0,188.5,45.0,210.5,180.2\n"
    "ILTJ123401.00+450100.0,188.5041667,45.0166667,101.25,90.0\n"
)


def _search(**overrides: object) -> LofarSearch:
    values = {
        "source_prefix": None,
        "sort_by": "total_flux",
        "sort_direction": "desc",
        "limit": 100,
    }
    values.update(overrides)
    return LofarSearch(**values)  # type: ignore[arg-type]


def _run_search(search: LofarSearch, handler: httpx.MockTransport) -> LofarSearchResponse:
    async def execute() -> LofarSearchResponse:
        async with httpx.AsyncClient(transport=handler, follow_redirects=False) as client:
            return await search_sources(search, client=client)

    return asyncio.run(execute())


def _form(request: httpx.Request) -> dict[str, list[str]]:
    return parse_qs(request.content.decode("utf-8"), keep_blank_values=True)


def test_invalid_timeout_configuration_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CATALOG_REQUEST_TIMEOUT_SECONDS", "NaN")
    monkeypatch.setenv("CATALOG_JOB_TIMEOUT_SECONDS", "not-a-number")
    assert _configured_request_timeout() == 20.0
    assert _configured_job_timeout() == 90.0


def test_global_and_prefix_adql_are_bounded_and_whitelisted() -> None:
    global_adql = _build_adql(_search())
    assert global_adql == (
        "SELECT TOP 100 Source_Name, RA, DEC, Total_flux, Peak_flux "
        "FROM lotss_dr3.main_sources WHERE Total_flux IS NOT NULL "
        "ORDER BY Total_flux DESC, Source_Name ASC"
    )

    prefix_adql = _build_adql(_search(source_prefix="ILTJ1234", sort_by="peak_flux", sort_direction="asc", limit=25))
    assert "SELECT TOP 25" in prefix_adql
    assert "Peak_flux IS NOT NULL" in prefix_adql
    assert "1=ivo_nocasematch(Source_Name, 'ILTJ1234%')" in prefix_adql
    assert prefix_adql.endswith("ORDER BY Peak_flux ASC, Source_Name ASC")


@pytest.mark.parametrize(
    "overrides",
    [
        {"source_prefix": "x' OR 1=1--"},
        {"source_prefix": "_"},
        {"sort_by": "Source_Name DESC; DROP TABLE"},
        {"sort_direction": "desc; DROP TABLE"},
        {"limit": 20},
        {"limit": 10_000},
    ],
)
def test_adql_builder_defends_its_own_invariants(overrides: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        _build_adql(_search(**overrides))


def test_async_uws_lifecycle_builds_query_polls_parses_and_deletes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str, dict[str, list[str]]]] = []
    phases = iter(["PENDING", "QUEUED", "EXECUTING", "SUSPENDED", "UNKNOWN", "COMPLETED"])

    sleeps: list[float] = []

    async def no_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr("app.lotss_dr3.asyncio.sleep", no_sleep)

    def handler(request: httpx.Request) -> httpx.Response:
        form = _form(request) if request.method == "POST" else {}
        calls.append((request.method, str(request.url), form))
        if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
            return httpx.Response(303, headers={"Location": "job-123"})
        if request.method == "POST" and str(request.url) == f"{JOB_URL}/phase":
            assert form == {"PHASE": ["RUN"]}
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "GET" and str(request.url) == f"{JOB_URL}/phase":
            return httpx.Response(200, text=next(phases))
        if request.method == "GET" and str(request.url) == f"{JOB_URL}/results/result":
            return httpx.Response(200, text=CSV_BODY, headers={"Content-Type": "text/csv"})
        if request.method == "DELETE" and str(request.url) == JOB_URL:
            return httpx.Response(303, headers={"Location": TAP_ASYNC_URL})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    result = _run_search(
        _search(source_prefix="ILTJ1234", sort_by="peak_flux", sort_direction="asc", limit=25),
        httpx.MockTransport(handler),
    )

    create_form = calls[0][2]
    assert calls[0][:2] == ("POST", TAP_ASYNC_URL)
    assert create_form["REQUEST"] == ["doQuery"]
    assert create_form["LANG"] == ["ADQL"]
    assert create_form["RESPONSEFORMAT"] == ["csv"]
    assert create_form["MAXREC"] == ["25"]
    assert "FROM lotss_dr3.main_sources" in create_form["QUERY"][0]
    assert "ORDER BY Peak_flux ASC, Source_Name ASC" in create_form["QUERY"][0]
    assert [method for method, _, _ in calls].count("GET") == 7
    assert sleeps == [1.0, 2.0, 3.0, 4.0, 5.0]
    assert calls[-1][:2] == ("DELETE", JOB_URL)
    assert result.tap_mode == "async"
    assert result.sort_by == "peak_flux"
    assert result.sort_direction == "asc"
    assert result.limit == 25
    assert result.source_prefix == "ILTJ1234"
    assert result.result_count == 2
    assert result.sources[0].id.startswith("lotss-dr3-")
    assert result.sources[0].ra_hms == "12:34:00.00"
    assert result.sources[0].dec_dms == "+45:00:00.00"
    assert result.sources[0].total_flux_mjy == 210.5
    assert result.sources[0].peak_flux_mjy == 180.2


@pytest.mark.parametrize(
    "location",
    [
        "http://vo.astron.nl/__system__/tap/run/tap/async/job",
        "https://evil.example/__system__/tap/run/tap/async/job",
        "https://user@vo.astron.nl/__system__/tap/run/tap/async/job",
        "/__system__/tap/run/tap/async/job?token=secret",
        "/__system__/tap/run/tap/async/job/child",
        "/__system__/tap/run/tap/async/%2e%2e/sync/job",
        "/__system__/tap/run/tap/sync/job",
        "//evil.example/job",
        "job#fragment",
        "job\\child",
        "",
    ],
)
def test_job_location_must_be_one_safe_astron_async_child(location: str) -> None:
    with pytest.raises(LofarCatalogError):
        _validated_job_url(location)


def test_job_location_accepts_relative_and_canonical_absolute_urls() -> None:
    assert _validated_job_url("abc-123") == f"{TAP_ASYNC_URL}/abc-123"
    assert _validated_job_url(f"{TAP_ASYNC_URL}/abc-123/") == f"{TAP_ASYNC_URL}/abc-123"
    assert (
        _validated_job_url("https://vo.astron.nl:443/__system__/tap/run/tap/async/abc-123")
        == f"{TAP_ASYNC_URL}/abc-123"
    )


def test_overall_deadline_aborts_then_deletes_job(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[str, str, dict[str, list[str]]]] = []
    monotonic_values = iter([0.0, 0.0, 0.0, 0.0, 2.0])
    monkeypatch.setattr("app.lotss_dr3._configured_job_timeout", lambda: 1.0)
    monkeypatch.setattr("app.lotss_dr3._monotonic", lambda: next(monotonic_values))

    def handler(request: httpx.Request) -> httpx.Response:
        form = _form(request) if request.method == "POST" else {}
        calls.append((request.method, str(request.url), form))
        if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "POST" and form == {"PHASE": ["RUN"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "GET" and str(request.url) == f"{JOB_URL}/phase":
            return httpx.Response(200, text="EXECUTING")
        if request.method == "POST" and form == {"PHASE": ["ABORT"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "DELETE":
            return httpx.Response(303, headers={"Location": TAP_ASYNC_URL})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    with pytest.raises(LofarCatalogTimeout):
        _run_search(_search(limit=10), httpx.MockTransport(handler))

    assert calls[-2] == ("POST", f"{JOB_URL}/phase", {"PHASE": ["ABORT"]})
    assert calls[-1][:2] == ("DELETE", JOB_URL)


def test_upstream_timeout_maps_to_catalog_timeout_and_cleans_up() -> None:
    calls: list[tuple[str, str, dict[str, list[str]]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        form = _form(request) if request.method == "POST" else {}
        calls.append((request.method, str(request.url), form))
        if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "POST" and form == {"PHASE": ["RUN"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "GET":
            raise httpx.ReadTimeout("slow upstream", request=request)
        if request.method == "POST" and form == {"PHASE": ["ABORT"]}:
            return httpx.Response(303)
        if request.method == "DELETE":
            return httpx.Response(303)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    with pytest.raises(LofarCatalogTimeout):
        _run_search(_search(limit=10), httpx.MockTransport(handler))
    assert calls[-2][2] == {"PHASE": ["ABORT"]}
    assert calls[-1][:2] == ("DELETE", JOB_URL)


def test_cancelled_search_aborts_then_deletes_created_job() -> None:
    calls: list[tuple[str, str, dict[str, list[str]]]] = []

    async def handler(request: httpx.Request) -> httpx.Response:
        form = _form(request) if request.method == "POST" else {}
        calls.append((request.method, str(request.url), form))
        if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "POST" and form == {"PHASE": ["RUN"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "GET" and str(request.url) == f"{JOB_URL}/phase":
            phase_requested.set()
            await hold_phase.wait()
            return httpx.Response(200, text="EXECUTING")
        if request.method == "POST" and form == {"PHASE": ["ABORT"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "DELETE" and str(request.url) == JOB_URL:
            return httpx.Response(303, headers={"Location": TAP_ASYNC_URL})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    async def execute() -> None:
        nonlocal phase_requested, hold_phase
        phase_requested = asyncio.Event()
        hold_phase = asyncio.Event()
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler), follow_redirects=False) as client:
            search_task = asyncio.create_task(search_sources(_search(limit=10), client=client))
            await phase_requested.wait()
            search_task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await search_task

    phase_requested: asyncio.Event
    hold_phase: asyncio.Event
    asyncio.run(execute())

    assert calls[-2] == ("POST", f"{JOB_URL}/phase", {"PHASE": ["ABORT"]})
    assert calls[-1] == ("DELETE", JOB_URL, {})


@pytest.mark.parametrize("terminal_phase", ["ERROR", "ABORTED", "HELD", "ARCHIVED", "BOGUS"])
def test_non_successful_job_phases_are_controlled_errors(terminal_phase: str) -> None:
    deleted = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal deleted
        form = _form(request) if request.method == "POST" else {}
        if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "POST" and form == {"PHASE": ["RUN"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "GET":
            return httpx.Response(200, text=terminal_phase)
        if request.method == "POST" and form == {"PHASE": ["ABORT"]}:
            return httpx.Response(303)
        if request.method == "DELETE":
            deleted = True
            return httpx.Response(303)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    with pytest.raises(LofarCatalogError):
        _run_search(_search(limit=10), httpx.MockTransport(handler))
    assert deleted is True


def test_result_redirect_is_followed_only_on_astron_and_delete_failure_is_nonfatal(
    caplog: pytest.LogCaptureFixture,
) -> None:
    result_requests = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal result_requests
        form = _form(request) if request.method == "POST" else {}
        if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "POST" and form == {"PHASE": ["RUN"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "GET" and str(request.url) == f"{JOB_URL}/phase":
            return httpx.Response(200, text="COMPLETED")
        if request.method == "GET" and str(request.url) == f"{JOB_URL}/results/result":
            result_requests += 1
            return httpx.Response(303, headers={"Location": "file.csv"})
        if request.method == "GET" and str(request.url) == f"{JOB_URL}/results/file.csv":
            result_requests += 1
            return httpx.Response(200, text=CSV_BODY)
        if request.method == "DELETE":
            raise httpx.ConnectError("cleanup failed", request=request)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    with caplog.at_level(logging.WARNING, logger="app.lotss_dr3"):
        result = _run_search(_search(limit=10), httpx.MockTransport(handler))
    assert result.result_count == 2
    assert result_requests == 2
    assert "job deletion failed" in caplog.text


def test_overall_deadline_wraps_an_indefinitely_blocked_http_operation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("app.lotss_dr3._monotonic", lambda: 0.0)

    async def handler(request: httpx.Request) -> httpx.Response:
        await asyncio.Event().wait()
        raise AssertionError("unreachable")

    async def execute() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            with pytest.raises(LofarCatalogTimeout):
                await _request(client, "GET", TAP_ASYNC_URL, 0.01)

    asyncio.run(execute())


def test_foreign_result_redirect_is_rejected_and_job_is_deleted() -> None:
    deleted = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal deleted
        if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "POST":
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "GET" and str(request.url) == f"{JOB_URL}/phase":
            return httpx.Response(200, text="COMPLETED")
        if request.method == "GET":
            return httpx.Response(303, headers={"Location": "https://evil.example/result.csv"})
        if request.method == "DELETE":
            deleted = True
            return httpx.Response(303)
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    with pytest.raises(LofarCatalogError, match="unsafe redirect"):
        _run_search(_search(limit=10), httpx.MockTransport(handler))
    assert deleted is True


def test_malformed_or_oversized_catalog_result_is_rejected() -> None:
    too_many_rows = "Source_Name,RA,DEC,Total_flux,Peak_flux\n" + "\n".join(
        f"ILTJ{index:014d}+000000.0,{index / 100:.2f},0,10,9" for index in range(11)
    )
    for result_body in (
        "not,the,expected,columns\n1,2,3,4",
        too_many_rows,
    ):

        def handler(request: httpx.Request, body: str = result_body) -> httpx.Response:
            form = _form(request) if request.method == "POST" else {}
            if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
                return httpx.Response(303, headers={"Location": JOB_URL})
            if request.method == "POST" and form == {"PHASE": ["RUN"]}:
                return httpx.Response(303, headers={"Location": JOB_URL})
            if request.method == "GET" and str(request.url) == f"{JOB_URL}/phase":
                return httpx.Response(200, text="COMPLETED")
            if request.method == "GET":
                return httpx.Response(200, text=body)
            if request.method == "DELETE":
                return httpx.Response(303)
            raise AssertionError(f"unexpected request: {request.method} {request.url}")

        with pytest.raises(LofarCatalogError):
            _run_search(_search(limit=10), httpx.MockTransport(handler))


def test_catalog_endpoint_defaults_to_global_async_browse(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    captured: list[LofarSearch] = []

    async def fake_search(search: LofarSearch) -> LofarSearchResponse:
        captured.append(search)
        return LofarSearchResponse(
            sort_by=search.sort_by,
            sort_direction=search.sort_direction,
            limit=search.limit,
            source_prefix=search.source_prefix,
            result_count=0,
            sources=[],
        )

    monkeypatch.setattr("app.main.catalog_query_coordinator.search", fake_search)

    response = client.get("/api/v1/catalogs/lotss-dr3/sources", params={"source_prefix": "   "})
    assert response.status_code == 200
    assert captured == [LofarSearch(source_prefix=None, sort_by="total_flux", sort_direction="desc", limit=100)]
    assert response.json() == {
        "catalog": "lofar_dr3",
        "catalog_release": "LoTSS DR3 v1.0",
        "coordinate_frame": "icrs",
        "reference_frequency_mhz": 144.0,
        "tap_mode": "async",
        "sort_by": "total_flux",
        "sort_direction": "desc",
        "limit": 100,
        "source_prefix": None,
        "result_count": 0,
        "sources": [],
    }


def test_catalog_endpoint_coerces_allowed_limit_query_strings(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    captured: list[LofarSearch] = []

    async def fake_search(search: LofarSearch) -> LofarSearchResponse:
        captured.append(search)
        return LofarSearchResponse(
            sort_by=search.sort_by,
            sort_direction=search.sort_direction,
            limit=search.limit,
            source_prefix=search.source_prefix,
            result_count=0,
            sources=[],
        )

    monkeypatch.setattr("app.main.catalog_query_coordinator.search", fake_search)

    for limit in (10, 25, 50, 100, 250, 500, 1000):
        response = client.get("/api/v1/catalogs/lotss-dr3/sources", params={"limit": str(limit)})
        assert response.status_code == 200
        assert response.json()["limit"] == limit

    assert [search.limit for search in captured] == [10, 25, 50, 100, 250, 500, 1000]


@pytest.mark.parametrize(
    "params",
    [
        {"source_prefix": "x' OR 1=1--"},
        {"sort_by": "untrusted_column"},
        {"sort_direction": "sideways"},
        {"limit": 20},
        {"mode": "cone", "ra_deg": 0, "dec_deg": 0, "radius_arcmin": 1},
        {"page": 1, "page_size": 50},
    ],
)
def test_catalog_endpoint_rejects_old_or_untrusted_query_contract(
    client: TestClient, params: dict[str, object]
) -> None:
    assert client.get("/api/v1/catalogs/lotss-dr3/sources", params=params).status_code == 422


def test_catalog_endpoint_maps_upstream_failures(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    async def raise_busy(search: object) -> None:
        raise LofarCatalogBusy

    monkeypatch.setattr("app.main.catalog_query_coordinator.search", raise_busy)
    busy_response = client.get("/api/v1/catalogs/lotss-dr3/sources")
    assert busy_response.status_code == 429
    assert busy_response.headers["Retry-After"] == "5"
    assert "잠시 후" in busy_response.json()["detail"]

    async def raise_timeout(search: object) -> None:
        raise LofarCatalogTimeout

    monkeypatch.setattr("app.main.catalog_query_coordinator.search", raise_timeout)
    assert client.get("/api/v1/catalogs/lotss-dr3/sources").status_code == 504

    async def raise_bad_response(search: object) -> None:
        raise LofarCatalogError

    monkeypatch.setattr("app.main.catalog_query_coordinator.search", raise_bad_response)
    assert client.get("/api/v1/catalogs/lotss-dr3/sources").status_code == 502


def test_custom_catalog_target_uses_snapshot_without_upstream_call(
    client: TestClient,
    visibility_payload: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = deepcopy(visibility_payload)
    payload.update(
        {
            "hours_before": 1,
            "hours_after": 1,
            "step_minutes": 60,
            "target_ids": ["3c123"],
            "custom_targets": [
                {
                    "id": "lotss-dr3-deadbeef1234",
                    "name": "ILTJ043704.38+294013.9",
                    "aliases": ["LoTSS DR3"],
                    "ra_deg": 69.26825,
                    "dec_deg": 29.670516667,
                    "catalog": "lofar_dr3",
                    "catalog_source_id": "ILTJ043704.38+294013.9",
                    "total_flux_mjy": 1234.5,
                    "peak_flux_mjy": 987.6,
                }
            ],
        }
    )
    monkeypatch.setattr("app.lotss_dr3.httpx.post", lambda *args, **kwargs: pytest.fail("unexpected TAP call"))

    response = client.post("/api/v1/visibility/altitude-series", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["target_count"] == 2
    built_in, imported = body["targets"]
    assert imported["catalog"] == "lofar_dr3"
    assert imported["catalog_source_id"] == "ILTJ043704.38+294013.9"
    assert imported["total_flux_mjy"] == 1234.5
    assert imported["peak_flux_mjy"] == 987.6
    assert imported["location_series"] == built_in["location_series"]
    assert imported["simultaneous_mask"] == built_in["simultaneous_mask"]


def test_custom_target_validation_and_custom_only_request(client: TestClient, visibility_payload: dict) -> None:
    custom = {
        "id": "lotss-dr3-0123456789abcdef",
        "name": "ILTJ120000.00+450000.0",
        "aliases": [],
        "ra_deg": 180,
        "dec_deg": 45,
        "catalog": "lofar_dr3",
        "catalog_source_id": "ILTJ120000.00+450000.0",
        "total_flux_mjy": 15,
        "peak_flux_mjy": 12,
    }
    custom_only = deepcopy(visibility_payload)
    custom_only["target_ids"] = []
    custom_only["custom_targets"] = [custom]
    assert client.post("/api/v1/visibility/altitude-series", json=custom_only).status_code == 200

    invalid_payloads = []
    no_targets = deepcopy(custom_only)
    no_targets["custom_targets"] = []
    invalid_payloads.append(no_targets)

    collision = deepcopy(visibility_payload)
    collision["target_ids"] = ["3c123"]
    collision["custom_targets"] = [{**custom, "id": "3c123"}]
    invalid_payloads.append(collision)

    duplicate = deepcopy(custom_only)
    duplicate["custom_targets"] = [custom, custom]
    invalid_payloads.append(duplicate)

    bad_ra = deepcopy(custom_only)
    bad_ra["custom_targets"][0]["ra_deg"] = 360
    invalid_payloads.append(bad_ra)

    bad_flux = deepcopy(custom_only)
    bad_flux["custom_targets"][0]["total_flux_mjy"] = -1
    invalid_payloads.append(bad_flux)

    too_many = deepcopy(custom_only)
    too_many["custom_targets"] = [{**custom, "id": f"lotss-dr3-{index:020d}"} for index in range(26)]
    invalid_payloads.append(too_many)

    for payload in invalid_payloads:
        assert client.post("/api/v1/visibility/altitude-series", json=payload).status_code == 422
