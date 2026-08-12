from __future__ import annotations

from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from app.lotss_dr3 import (
    LofarCatalogError,
    LofarCatalogTimeout,
    LofarSearch,
    _build_adql,
    _configured_timeout,
    search_sources,
)
from app.models import LofarSearchResponse


def _search(**overrides: object) -> LofarSearch:
    values = {
        "mode": "name",
        "query": "ILTJ1234",
        "ra_deg": None,
        "dec_deg": None,
        "radius_arcmin": None,
        "sort_by": "total_flux",
        "sort_direction": "desc",
        "page": 1,
        "page_size": 2,
    }
    values.update(overrides)
    return LofarSearch(**values)  # type: ignore[arg-type]


def test_non_finite_timeout_configuration_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CATALOG_REQUEST_TIMEOUT_SECONDS", "NaN")
    assert _configured_timeout() == 20.0


def test_name_query_is_bounded_sorted_and_parsed(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}
    csv_body = (
        "Source_Name,RA,DEC,Total_flux,Peak_flux\n"
        "ILTJ123400.00+450000.0,188.5,45.0,210.5,180.2\n"
        "ILTJ123401.00+450100.0,188.5041667,45.0166667,101.25,90.0\n"
        "ILTJ123402.00+450200.0,188.5083333,45.0333333,70.0,60.0\n"
    )

    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        captured.update({"url": url, **kwargs})
        return httpx.Response(200, text=csv_body, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.lotss_dr3.httpx.post", fake_post)

    result = search_sources(_search())

    assert captured["url"] == "https://vo.astron.nl/tap/sync"
    data = captured["data"]
    assert isinstance(data, dict)
    assert data["FORMAT"] == "csv"
    assert data["MAXREC"] == "3"
    assert "FROM lotss_dr3.main_sources" in data["QUERY"]
    assert "ivo_nocasematch(Source_Name, 'ILTJ1234%')" in data["QUERY"]
    assert "Total_flux IS NOT NULL" in data["QUERY"]
    assert "ORDER BY Total_flux DESC, Source_Name ASC OFFSET 0" in data["QUERY"]
    assert result.has_more is True
    assert len(result.sources) == 2
    assert result.sources[0].name == "ILTJ123400.00+450000.0"
    assert result.sources[0].id.startswith("lotss-dr3-")
    assert result.sources[0].ra_hms == "12:34:00.00"
    assert result.sources[0].dec_dms == "+45:00:00.00"
    assert result.sources[0].total_flux_mjy == 210.5
    assert result.sources[0].peak_flux_mjy == 180.2


def test_cone_query_and_page_offset_are_server_generated() -> None:
    adql = _build_adql(
        _search(
            mode="cone",
            query=None,
            ra_deg=12.5,
            dec_deg=-30.25,
            radius_arcmin=30.0,
            sort_by="peak_flux",
            sort_direction="asc",
            page=2,
            page_size=20,
        )
    )

    assert "CIRCLE('ICRS', 12.5000000000, -30.2500000000, 0.5000000000)" in adql
    assert "ORDER BY Peak_flux ASC, Source_Name ASC OFFSET 20" in adql
    assert adql.startswith("SELECT TOP 21")


@pytest.mark.parametrize(
    "overrides",
    [
        {"query": "x' OR 1=1--"},
        {"sort_by": "Source_Name DESC; DROP TABLE"},
        {"sort_direction": "desc; DROP TABLE"},
        {"page": 0},
        {"page_size": 51},
        {"mode": "cone", "query": None, "ra_deg": 360.0, "dec_deg": 0.0, "radius_arcmin": 1.0},
    ],
)
def test_adql_builder_defends_its_own_invariants(overrides: dict[str, object]) -> None:
    with pytest.raises(ValueError):
        _build_adql(_search(**overrides))


def test_last_allowed_page_does_not_advertise_an_unrequestable_next_page(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CATALOG_MAX_ROWS", "1000")
    rows = [f"ILTJ{index:014d}+000000.0,{index / 100:.2f},0,10,9" for index in range(50)]
    csv_body = "Source_Name,RA,DEC,Total_flux,Peak_flux\n" + "\n".join(rows)
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        return httpx.Response(200, text=csv_body, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.lotss_dr3.httpx.post", fake_post)

    result = search_sources(_search(page=20, page_size=50))

    data = captured["data"]
    assert isinstance(data, dict)
    assert data["MAXREC"] == "50"
    assert data["QUERY"].startswith("SELECT TOP 50")
    assert result.has_more is False


def test_non_divisible_row_cap_only_advertises_full_requestable_pages(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CATALOG_MAX_ROWS", "1000")
    rows = [f"ILTJ{index:014d}+000000.0,{index / 100:.2f},0,10,9" for index in range(30)]
    csv_body = "Source_Name,RA,DEC,Total_flux,Peak_flux\n" + "\n".join(rows)
    captured: dict[str, object] = {}

    def fake_post(url: str, **kwargs: object) -> httpx.Response:
        captured.update(kwargs)
        return httpx.Response(200, text=csv_body, request=httpx.Request("POST", url))

    monkeypatch.setattr("app.lotss_dr3.httpx.post", fake_post)

    result = search_sources(_search(page=33, page_size=30))

    data = captured["data"]
    assert isinstance(data, dict)
    assert data["MAXREC"] == "30"
    assert result.has_more is False
    with pytest.raises(ValueError, match="row limit"):
        _build_adql(_search(page=34, page_size=30))


def test_catalog_adapter_maps_timeout_and_malformed_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    def timeout_post(*args: object, **kwargs: object) -> httpx.Response:
        raise httpx.ReadTimeout("slow upstream")

    monkeypatch.setattr("app.lotss_dr3.httpx.post", timeout_post)
    with pytest.raises(LofarCatalogTimeout):
        search_sources(_search())

    def malformed_post(url: str, **kwargs: object) -> httpx.Response:
        return httpx.Response(200, text="not,the,expected,columns\n1,2,3,4", request=httpx.Request("POST", url))

    monkeypatch.setattr("app.lotss_dr3.httpx.post", malformed_post)
    with pytest.raises(LofarCatalogError, match="columns"):
        search_sources(_search())


def test_catalog_endpoint_validates_query_contract(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.main.search_sources",
        lambda search: LofarSearchResponse(
            query_mode=search.mode,
            page=search.page,
            page_size=search.page_size,
            has_more=False,
            sources=[],
        ),
    )

    response = client.get(
        "/api/v1/catalogs/lotss-dr3/sources",
        params={"mode": "name", "query": "ILTJ1234", "sort_by": "total_flux", "sort_direction": "desc"},
    )
    assert response.status_code == 200
    assert response.json()["catalog"] == "lofar_dr3"

    invalid_queries = [
        {"mode": "name", "query": "x' OR 1=1 --"},
        {"mode": "name", "query": "ILTJ"},
        {"mode": "name", "query": "ILTJ_1234"},
        {"mode": "name"},
        {"mode": "cone", "ra_deg": 360, "dec_deg": 0, "radius_arcmin": 1},
        {"mode": "cone", "ra_deg": 0, "dec_deg": 0, "radius_arcmin": 61},
        {"mode": "cone", "ra_deg": 0, "dec_deg": 0, "radius_arcmin": 1, "query": "ILTJ"},
        {"mode": "name", "query": "ILTJ", "sort_by": "untrusted_column"},
    ]
    for params in invalid_queries:
        assert client.get("/api/v1/catalogs/lotss-dr3/sources", params=params).status_code == 422


def test_catalog_endpoint_maps_upstream_failures(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    params = {"mode": "name", "query": "ILTJ1234"}

    def raise_timeout(search: object) -> None:
        raise LofarCatalogTimeout

    monkeypatch.setattr("app.main.search_sources", raise_timeout)
    assert client.get("/api/v1/catalogs/lotss-dr3/sources", params=params).status_code == 504

    def raise_bad_response(search: object) -> None:
        raise LofarCatalogError

    monkeypatch.setattr("app.main.search_sources", raise_bad_response)
    assert client.get("/api/v1/catalogs/lotss-dr3/sources", params=params).status_code == 502


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
