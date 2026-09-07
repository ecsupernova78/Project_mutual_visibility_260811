from __future__ import annotations

import asyncio
from copy import deepcopy
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from app.models import VlassConeSearchResponse, VlassSearchResponse, VlassSource
from app.vlass import (
    TAP_ASYNC_URL,
    VlassCatalogBusy,
    VlassCatalogError,
    VlassCatalogTimeout,
    VlassSearch,
    _adql_string,
    _build_adql,
    _parse_csv,
    _stable_id,
    _validated_job_url,
    _validated_result_url,
    filter_simbad_type_categories,
    search_sources,
)

JOB_URL = f"{TAP_ASYNC_URL}/job-123"
CSV_BODY = (
    "CompName,RAJ2000,DEJ2000,Total_mJy,Peak_mJy,SCode,DupFlag,QualFlag,MainSample\n"
    "VLASS1QLCIR J123400.00+450000.0,188.5,45.0,210.5,0.815,S,1,0,true\n"
    "VLASS1QLCIR J123401.00+450100.0,188.5041667,45.0166667,101.25,0.090,C,0,4,0\n"
)


def _search(**overrides: object) -> VlassSearch:
    values = {
        "source_prefix": None,
        "sort_by": "total_flux",
        "sort_direction": "desc",
        "limit": 100,
    }
    values.update(overrides)
    return VlassSearch(**values)  # type: ignore[arg-type]


def _run_search(search: VlassSearch, transport: httpx.MockTransport) -> VlassSearchResponse:
    async def execute() -> VlassSearchResponse:
        async with httpx.AsyncClient(transport=transport, follow_redirects=False) as client:
            response = await search_sources(search, client=client)
            assert isinstance(response, VlassSearchResponse)
            return response

    return asyncio.run(execute())


def _form(request: httpx.Request) -> dict[str, list[str]]:
    return parse_qs(request.content.decode("utf-8"), keep_blank_values=True)


def _source(**overrides: object) -> VlassSource:
    values = {
        "id": "vlass-0123456789abcdef0123",
        "source_id": "VLASS1QLCIR J123400.00+450000.0",
        "name": "VLASS1QLCIR J123400.00+450000.0",
        "ra_deg": 188.5,
        "dec_deg": 45.0,
        "ra_hms": "12:34:00.00",
        "dec_dms": "+45:00:00.00",
        "total_flux_mjy": 210.5,
        "peak_flux_mjy": 0.815,
        "morphology_code": "S",
        "duplicate_flag": 1,
        "quality_flag": 0,
        "main_sample": True,
    }
    values.update(overrides)
    return VlassSource(**values)  # type: ignore[arg-type]


def test_brightness_adql_uses_published_vizier_table_units_and_quality_predicate() -> None:
    adql = _build_adql(_search())

    assert adql == (
        "SELECT TOP 100 CompName, RAJ2000, DEJ2000, Ftot AS Total_mJy, "
        "Fpeak/1000.0 AS Peak_mJy, SCode, DupFlag, QualFlag, MainSample "
        'FROM "J/ApJS/255/30/comp" '
        "WHERE DupFlag<2 AND QualFlag IN (0,4) AND SCode<>'E' AND Ftot IS NOT NULL "
        "AND SCode IN ('S', 'C', 'M', 'E') ORDER BY Ftot DESC, CompName ASC"
    )
    assert "v3.1" not in adql


def test_adql_string_escaping_is_defensive_even_though_prefix_validation_blocks_quotes() -> None:
    assert _adql_string("O'Brien") == "'O''Brien'"


def test_brightness_adql_supports_safe_prefix_morphology_sort_and_quality_opt_out() -> None:
    adql = _build_adql(
        _search(
            source_prefix="vlass1qlcir J12",
            sort_by="peak_flux",
            sort_direction="asc",
            limit=25,
            morphology_codes=frozenset({"S", "C"}),
            recommended_only=False,
        )
    )

    assert "Fpeak/1000.0 AS Peak_mJy" in adql
    assert "Fpeak IS NOT NULL" in adql
    assert "SCode IN ('S', 'C')" in adql
    assert "CompName LIKE 'VLASS1QLCIR J12%'" in adql
    assert "UPPER(" not in adql
    assert "DupFlag" in adql.split(" WHERE ", maxsplit=1)[0]
    assert "DupFlag<2" not in adql
    assert adql.endswith("ORDER BY Fpeak ASC, CompName ASC")


def test_cone_adql_uses_standard_distance_and_contains_without_morphology_filter() -> None:
    adql = _build_adql(
        _search(
            mode="cone",
            sort_by="distance",
            sort_direction="asc",
            ra_deg=49.950667,
            dec_deg=41.511696,
            radius_arcmin=3,
        )
    )

    assert "DISTANCE(POINT('ICRS', RAJ2000, DEJ2000), POINT('ICRS', 49.950667, 41.511696)) AS Separation_deg" in adql
    assert "CIRCLE('ICRS', 49.950667, 41.511696, 0.05)" in adql
    assert "SCode IN" not in adql
    assert "SCode<>'E'" in adql
    assert adql.endswith("ORDER BY Separation_deg ASC, CompName ASC")


@pytest.mark.parametrize(
    "overrides",
    [
        {"source_prefix": "x' OR 1=1--"},
        {"source_prefix": "VLASS_"},
        {"sort_by": "CompName DESC; DROP TABLE"},
        {"sort_direction": "desc; DROP TABLE"},
        {"limit": 20},
        {"limit": 10_000},
        {"morphology_codes": frozenset()},
        {"morphology_codes": frozenset({"X"})},
        {"mode": "brightness", "ra_deg": 1},
        {"mode": "cone", "ra_deg": 360, "dec_deg": 0, "radius_arcmin": 1},
        {"mode": "cone", "ra_deg": 0, "dec_deg": 0, "radius_arcmin": 61},
        {"mode": "cone", "ra_deg": 0, "dec_deg": 0, "radius_arcmin": 1, "source_prefix": "V"},
        {
            "mode": "cone",
            "ra_deg": 0,
            "dec_deg": 0,
            "radius_arcmin": 1,
            "morphology_codes": frozenset({"S"}),
        },
    ],
)
def test_adql_builder_defends_all_public_invariants(overrides: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        _build_adql(_search(**overrides))


def test_csv_parser_preserves_adql_scaled_peak_flux_and_required_quality_fields() -> None:
    sources = _parse_csv(CSV_BODY, 10)

    assert len(sources) == 2
    first = sources[0]
    assert first.id == _stable_id("VLASS1QLCIR J123400.00+450000.0")
    assert first.id.startswith("vlass-")
    assert first.source_id == "VLASS1QLCIR J123400.00+450000.0"
    assert first.ra_hms == "12:34:00.00"
    assert first.dec_dms == "+45:00:00.00"
    assert first.total_flux_mjy == 210.5
    assert first.peak_flux_mjy == 0.815
    assert first.duplicate_flag == 1
    assert first.quality_flag == 0
    assert first.main_sample is True
    assert sources[1].main_sample is False


@pytest.mark.parametrize(
    ("column", "value"),
    [
        ("DupFlag", ""),
        ("DupFlag", "3"),
        ("QualFlag", ""),
        ("QualFlag", "8"),
        ("MainSample", ""),
        ("MainSample", "maybe"),
    ],
)
def test_csv_parser_rejects_missing_or_invalid_required_quality_values(column: str, value: str) -> None:
    header, row, *_ = CSV_BODY.splitlines()
    columns = header.split(",")
    values = row.split(",")
    values[columns.index(column)] = value
    payload = f"{header}\n{','.join(values)}\n"

    with pytest.raises(VlassCatalogError, match=column):
        _parse_csv(payload, 10)


def test_csv_parser_requires_exact_columns_bounds_and_requested_row_limit() -> None:
    with pytest.raises(VlassCatalogError, match="columns"):
        _parse_csv("CompName,RAJ2000\nVLASS1QLCIR J1,1\n", 10)

    invalid_position = CSV_BODY.replace(",188.5,45.0,", ",360,45.0,", 1)
    with pytest.raises(VlassCatalogError, match="coordinates"):
        _parse_csv(invalid_position, 10)

    with pytest.raises(VlassCatalogError, match="more rows"):
        _parse_csv(CSV_BODY, 1)


def test_async_uws_lifecycle_uses_format_polls_parses_and_post_deletes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[str, str, dict[str, list[str]]]] = []
    phases = iter(["PENDING", "EXECUTING", "COMPLETED"])
    sleeps: list[float] = []

    async def no_sleep(delay: float) -> None:
        sleeps.append(delay)

    monkeypatch.setattr("app.vlass.asyncio.sleep", no_sleep)

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
        if request.method == "POST" and str(request.url) == JOB_URL:
            assert form == {"ACTION": ["DELETE"]}
            return httpx.Response(303, headers={"Location": TAP_ASYNC_URL})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    result = _run_search(
        _search(source_prefix="VLASS1QLCIR J12", sort_by="peak_flux", sort_direction="asc", limit=25),
        httpx.MockTransport(handler),
    )

    create_form = calls[0][2]
    assert calls[0][:2] == ("POST", TAP_ASYNC_URL)
    assert create_form["REQUEST"] == ["doQuery"]
    assert create_form["LANG"] == ["ADQL"]
    assert create_form["FORMAT"] == ["csv"]
    assert "RESPONSEFORMAT" not in create_form
    assert create_form["MAXREC"] == ["25"]
    assert 'FROM "J/ApJS/255/30/comp"' in create_form["QUERY"][0]
    assert "Ftot AS Total_mJy" in create_form["QUERY"][0]
    assert "Fpeak/1000.0 AS Peak_mJy" in create_form["QUERY"][0]
    assert sleeps == [1.0, 2.0]
    assert calls[-1] == ("POST", JOB_URL, {"ACTION": ["DELETE"]})
    assert all(method != "DELETE" for method, _, _ in calls)
    assert result.catalog_release == "VLASS Epoch 1 Quick Look (Gordon et al. 2021)"
    assert result.reference_frequency_mhz == 3000.0
    assert result.result_count == 2
    assert result.sources[0].peak_flux_mjy == 0.815


def test_failed_job_is_aborted_then_post_deleted() -> None:
    calls: list[tuple[str, str, dict[str, list[str]]]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        form = _form(request) if request.method == "POST" else {}
        calls.append((request.method, str(request.url), form))
        if request.method == "POST" and str(request.url) == TAP_ASYNC_URL:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "POST" and form == {"PHASE": ["RUN"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "GET":
            return httpx.Response(200, text="ERROR")
        if request.method == "POST" and form == {"PHASE": ["ABORT"]}:
            return httpx.Response(303, headers={"Location": JOB_URL})
        if request.method == "POST" and form == {"ACTION": ["DELETE"]}:
            return httpx.Response(303, headers={"Location": TAP_ASYNC_URL})
        raise AssertionError(f"unexpected request: {request.method} {request.url}")

    with pytest.raises(VlassCatalogError, match="did not complete"):
        _run_search(_search(limit=10), httpx.MockTransport(handler))

    assert calls[-2] == ("POST", f"{JOB_URL}/phase", {"PHASE": ["ABORT"]})
    assert calls[-1] == ("POST", JOB_URL, {"ACTION": ["DELETE"]})


@pytest.mark.parametrize(
    "location",
    [
        "http://tapvizier.cds.unistra.fr/TAPVizieR/tap/async/job",
        "https://evil.example/TAPVizieR/tap/async/job",
        "https://user@tapvizier.cds.unistra.fr/TAPVizieR/tap/async/job",
        "/TAPVizieR/tap/async/job?token=secret",
        "/TAPVizieR/tap/async/job/child",
        "/TAPVizieR/tap/async/%2e%2e/sync/job",
        "/tapvizier/tap/async/job",
        "//evil.example/job",
        "job#fragment",
        "job\\child",
        "",
    ],
)
def test_job_location_must_be_one_safe_vizier_async_child(location: str) -> None:
    with pytest.raises(VlassCatalogError):
        _validated_job_url(location)


def test_job_and_result_redirect_validation_accepts_only_the_same_job() -> None:
    assert _validated_job_url("abc-123") == f"{TAP_ASYNC_URL}/abc-123"
    assert _validated_job_url(f"{TAP_ASYNC_URL}/abc-123/") == f"{TAP_ASYNC_URL}/abc-123"
    assert _validated_result_url("file.csv", f"{JOB_URL}/results/result", JOB_URL) == (f"{JOB_URL}/results/file.csv")

    for location in (
        "https://evil.example/result.csv",
        f"{TAP_ASYNC_URL}/other-job/results/file.csv",
        f"{JOB_URL}/results/file.csv?token=secret",
        f"{JOB_URL}/phase",
    ):
        with pytest.raises(VlassCatalogError):
            _validated_result_url(location, f"{JOB_URL}/results/result", JOB_URL)


def test_shared_simbad_filter_keeps_vlass_model_and_quality_metadata() -> None:
    source = _source(object_type_code="QSO")
    response = VlassSearchResponse(
        sort_by="total_flux",
        sort_direction="desc",
        limit=10,
        source_prefix=None,
        candidate_count=1,
        result_count=1,
        sources=[source],
    )

    filtered = filter_simbad_type_categories(response, ["quasar"])

    assert isinstance(filtered, VlassSearchResponse)
    assert filtered.sources == [source]
    assert filtered.sources[0].duplicate_flag == 1
    assert filtered.simbad_type_categories == ["quasar"]


def test_search_sources_runs_shared_simbad_enrichment_for_vlass_models(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = _source()

    async def fake_search(search: VlassSearch, client: httpx.AsyncClient) -> VlassSearchResponse:
        return VlassSearchResponse(
            sort_by=search.sort_by,
            sort_direction=search.sort_direction,
            limit=search.limit,
            source_prefix=search.source_prefix,
            candidate_count=1,
            result_count=1,
            sources=[source],
        )

    async def fake_enrich(
        sources: list[VlassSource],
        client: httpx.AsyncClient,
    ) -> tuple[list[VlassSource], str, None]:
        assert sources == [source]
        return [source.model_copy(update={"name": "3C 273"})], "complete", None

    monkeypatch.setattr("app.vlass._search_with_client", fake_search)
    monkeypatch.setattr("app.vlass._enrich_sources", fake_enrich)

    async def execute() -> VlassSearchResponse:
        async with httpx.AsyncClient() as tap_client, httpx.AsyncClient() as enrichment_client:
            response = await search_sources(
                _search(limit=10),
                client=tap_client,
                enrichment_client=enrichment_client,
            )
            assert isinstance(response, VlassSearchResponse)
            return response

    response = asyncio.run(execute())

    assert response.enrichment_status == "complete"
    assert response.sources[0].name == "3C 273"
    assert response.sources[0].quality_flag == source.quality_flag


def test_vlass_endpoint_fails_closed_when_requested_simbad_filter_is_unavailable(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_search(search: VlassSearch) -> VlassSearchResponse:
        return VlassSearchResponse(
            sort_by=search.sort_by,
            sort_direction=search.sort_direction,
            limit=search.limit,
            source_prefix=search.source_prefix,
            candidate_count=1,
            result_count=1,
            sources=[_source()],
            enrichment_status="unavailable",
            enrichment_warning="SIMBAD is unavailable.",
        )

    monkeypatch.setattr("app.main.vlass_catalog_query_coordinator.search", fake_search)

    response = client.get(
        "/api/v1/catalogs/vlass/sources",
        params={"simbad_type_categories": "quasar"},
    )

    assert response.status_code == 502
    assert "SIMBAD physical-type filtering" in response.json()["detail"]


def test_brightness_endpoint_builds_typed_vlass_search_and_reports_honest_release(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[VlassSearch] = []

    async def fake_search(search: VlassSearch) -> VlassSearchResponse:
        captured.append(search)
        return VlassSearchResponse(
            sort_by=search.sort_by,
            sort_direction=search.sort_direction,
            limit=search.limit,
            source_prefix=search.source_prefix,
            morphology_codes=[code for code in ("S", "C", "M", "E") if code in search.morphology_codes],
            recommended_only=search.recommended_only,
            candidate_count=0,
            result_count=0,
            sources=[],
        )

    monkeypatch.setattr("app.main.vlass_catalog_query_coordinator.search", fake_search)
    response = client.get(
        "/api/v1/catalogs/vlass/sources",
        params=[
            ("source_prefix", "VLASS1QLCIR J12"),
            ("sort_by", "peak_flux"),
            ("sort_direction", "asc"),
            ("limit", "25"),
            ("morphology_codes", "M"),
            ("morphology_codes", "S"),
            ("recommended_only", "false"),
        ],
    )

    assert response.status_code == 200
    assert captured == [
        VlassSearch(
            source_prefix="VLASS1QLCIR J12",
            sort_by="peak_flux",
            sort_direction="asc",
            limit=25,
            morphology_codes=frozenset({"S", "M"}),
            recommended_only=False,
        )
    ]
    body = response.json()
    assert body["catalog"] == "vlass"
    assert body["catalog_release"] == "VLASS Epoch 1 Quick Look (Gordon et al. 2021)"
    assert "v3.1" not in body["catalog_release"].lower()
    assert body["morphology_codes"] == ["S", "M"]
    assert body["recommended_only"] is False


def test_cone_endpoint_builds_separate_search_without_morphology_filter(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[VlassSearch] = []

    async def fake_search(search: VlassSearch) -> VlassConeSearchResponse:
        captured.append(search)
        return VlassConeSearchResponse(
            center_ra_deg=search.ra_deg,
            center_dec_deg=search.dec_deg,
            radius_arcmin=search.radius_arcmin,
            sort_by=search.sort_by,
            sort_direction=search.sort_direction,
            limit=search.limit,
            recommended_only=search.recommended_only,
            result_count=0,
            sources=[],
        )

    monkeypatch.setattr("app.main.vlass_catalog_query_coordinator.search", fake_search)
    response = client.get(
        "/api/v1/catalogs/vlass/cone",
        params={
            "ra_deg": 49.950667,
            "dec_deg": 41.511696,
            "radius_arcmin": 3,
            "recommended_only": False,
        },
    )

    assert response.status_code == 200
    assert captured == [
        VlassSearch(
            source_prefix=None,
            sort_by="distance",
            sort_direction="asc",
            limit=100,
            mode="cone",
            ra_deg=49.950667,
            dec_deg=41.511696,
            radius_arcmin=3,
            recommended_only=False,
        )
    ]
    assert response.json()["search_mode"] == "cone"


@pytest.mark.parametrize(
    ("path", "params"),
    [
        ("/api/v1/catalogs/vlass/sources", {"source_prefix": "x' OR 1=1--"}),
        ("/api/v1/catalogs/vlass/sources", {"source_prefix": "VLASS_"}),
        ("/api/v1/catalogs/vlass/sources", {"sort_by": "untrusted"}),
        ("/api/v1/catalogs/vlass/sources", {"limit": 20}),
        ("/api/v1/catalogs/vlass/sources", {"morphology_codes": "X"}),
        ("/api/v1/catalogs/vlass/sources", {"mode": "cone"}),
        ("/api/v1/catalogs/vlass/cone", {"ra_deg": 360, "dec_deg": 0, "radius_arcmin": 1}),
        ("/api/v1/catalogs/vlass/cone", {"ra_deg": 0, "dec_deg": 91, "radius_arcmin": 1}),
        ("/api/v1/catalogs/vlass/cone", {"ra_deg": 0, "dec_deg": 0, "radius_arcmin": 61}),
        (
            "/api/v1/catalogs/vlass/cone",
            {"ra_deg": 0, "dec_deg": 0, "radius_arcmin": 1, "morphology_codes": "S"},
        ),
    ],
)
def test_vlass_endpoints_reject_invalid_or_untrusted_parameters(
    client: TestClient,
    path: str,
    params: dict[str, object],
) -> None:
    assert client.get(path, params=params).status_code == 422


def test_vlass_endpoint_maps_controlled_upstream_failures_to_english_errors(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def raise_busy(search: object) -> None:
        raise VlassCatalogBusy

    monkeypatch.setattr("app.main.vlass_catalog_query_coordinator.search", raise_busy)
    busy_response = client.get("/api/v1/catalogs/vlass/sources")
    assert busy_response.status_code == 429
    assert busy_response.headers["Retry-After"] == "5"
    assert "try again shortly" in busy_response.json()["detail"].lower()

    async def raise_timeout(search: object) -> None:
        raise VlassCatalogTimeout

    monkeypatch.setattr("app.main.vlass_catalog_query_coordinator.search", raise_timeout)
    timeout_response = client.get(
        "/api/v1/catalogs/vlass/cone",
        params={"ra_deg": 0, "dec_deg": 0, "radius_arcmin": 1},
    )
    assert timeout_response.status_code == 504

    async def raise_bad_response(search: object) -> None:
        raise VlassCatalogError

    monkeypatch.setattr("app.main.vlass_catalog_query_coordinator.search", raise_bad_response)
    assert client.get("/api/v1/catalogs/vlass/sources").status_code == 502


def test_visibility_accepts_mixed_catalog_snapshots_and_preserves_vlass_quality(
    client: TestClient,
    visibility_payload: dict,
) -> None:
    payload = deepcopy(visibility_payload)
    payload.update(
        {
            "target_ids": [],
            "custom_targets": [
                {
                    "id": "lotss-dr3-deadbeef1234",
                    "name": "ILTJ043704.38+294013.9",
                    "ra_deg": 69.26825,
                    "dec_deg": 29.670516667,
                    "catalog": "lofar_dr3",
                    "catalog_source_id": "ILTJ043704.38+294013.9",
                    "total_flux_mjy": 1234.5,
                    "morphology_code": "C",
                },
                {
                    "id": "vlass-0123456789abcdef0123",
                    "name": "VLASS1QLCIR J043704.46+294013.0",
                    "ra_deg": 69.268583333,
                    "dec_deg": 29.670277778,
                    "catalog": "vlass",
                    "catalog_source_id": "VLASS1QLCIR J043704.46+294013.0",
                    "total_flux_mjy": 98.7,
                    "peak_flux_mjy": 12.3,
                    "morphology_code": "E",
                    "duplicate_flag": 2,
                    "quality_flag": 7,
                    "main_sample": False,
                },
            ],
        }
    )

    response = client.post("/api/v1/visibility/altitude-series", json=payload)

    assert response.status_code == 200
    targets = response.json()["targets"]
    assert [target["catalog"] for target in targets] == ["lofar_dr3", "vlass"]
    assert targets[1]["catalog_source_id"] == "VLASS1QLCIR J043704.46+294013.0"
    assert targets[1]["morphology_code"] == "E"
    assert targets[1]["duplicate_flag"] == 2
    assert targets[1]["quality_flag"] == 7
    assert targets[1]["main_sample"] is False


@pytest.mark.parametrize(
    "catalog,id_value,morphology",
    [
        ("vlass", "lotss-dr3-deadbeef1234", "S"),
        ("lofar_dr3", "vlass-0123456789abcdef0123", "S"),
        ("lofar_dr3", "lotss-dr3-deadbeef1234", "E"),
    ],
)
def test_visibility_rejects_catalog_namespace_or_morphology_mismatches(
    client: TestClient,
    visibility_payload: dict,
    catalog: str,
    id_value: str,
    morphology: str,
) -> None:
    payload = deepcopy(visibility_payload)
    payload["target_ids"] = []
    payload["custom_targets"] = [
        {
            "id": id_value,
            "name": "Catalog source",
            "ra_deg": 69.2,
            "dec_deg": 29.6,
            "catalog": catalog,
            "catalog_source_id": "VLASS1QLCIR J043704.46+294013.0",
            "morphology_code": morphology,
        }
    ]

    assert client.post("/api/v1/visibility/altitude-series", json=payload).status_code == 422


@pytest.mark.parametrize(
    ("catalog", "quality_metadata"),
    [
        ("lofar_dr3", {"duplicate_flag": 0, "quality_flag": 0, "main_sample": True}),
        ("vlass", {}),
        ("vlass", {"duplicate_flag": 0, "quality_flag": 0}),
    ],
)
def test_visibility_enforces_catalog_specific_vlass_quality_metadata(
    client: TestClient,
    visibility_payload: dict,
    catalog: str,
    quality_metadata: dict[str, object],
) -> None:
    payload = deepcopy(visibility_payload)
    payload["target_ids"] = []
    is_vlass = catalog == "vlass"
    payload["custom_targets"] = [
        {
            "id": "vlass-0123456789abcdef0123" if is_vlass else "lotss-dr3-deadbeef1234",
            "name": "Catalog source",
            "ra_deg": 69.2,
            "dec_deg": 29.6,
            "catalog": catalog,
            "catalog_source_id": ("VLASS1QLCIR J043704.46+294013.0" if is_vlass else "ILTJ043704.38+294013.9"),
            "morphology_code": "S",
            **quality_metadata,
        }
    ]

    assert client.post("/api/v1/visibility/altitude-series", json=payload).status_code == 422
