"""Real ATNF v2.9.0 acceptance checks for search and visibility import."""

from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.atnf import get_atnf_catalog


def test_pinned_real_catalogue_and_flux_guard(client: TestClient) -> None:
    catalog = get_atnf_catalog()
    assert catalog.meta["catalogue_version"] == "2.9.0"
    assert catalog.meta["n_pulsars"] == 4503
    assert catalog.meta["n_position_from_ecliptic"] == 241
    assert catalog.meta["n_duplicate_jname"] == 0
    assert catalog.meta["source_sha256"] == "00310698cf681413273e92232d97cdb8f8a8b1cd2edcdcbafcc433cb89d45ccc"
    assert catalog.meta["flux_extrapolation_guard"]["changed_estimate_counts_by_mhz"] == {
        "400": 88,
        "600": 119,
        "800": 118,
    }

    response = client.get("/api/v1/catalogs/atnf/sources")
    assert response.status_code == 200
    body = response.json()
    assert body["catalog"] == "atnf"
    assert body["catalogue_version"] == "2.9.0"
    assert body["citation"] == catalog.meta["citation"]
    assert body["sources"][0]["catalogue_version"] == body["catalogue_version"]
    assert body["sources"][0]["catalogue_citation"] == body["citation"]
    assert body["candidate_count"] == 4503
    assert body["result_count"] == 100
    assert body["reference_frequency_mhz"] == 600
    assert body["sources"][0]["source_id"] == "J0835-4510"  # Vela; no unbounded extrapolation dominates
    assert body["sources"][0]["total_flux_mjy"] < 10_000


@pytest.mark.parametrize("name", ["B0329+54", "PSR B0329+54", "J0332+5434", "0329+54"])
def test_b_and_j_names_resolve_to_one_pulsar(client: TestClient, name: str) -> None:
    response = client.get("/api/v1/catalogs/atnf/sources", params={"name": name, "limit": 8})
    assert response.status_code == 200
    body = response.json()
    assert body["sources"][0]["source_id"] == "J0332+5434"
    assert body["sources"][0]["name"] == "B0329+54"
    assert body["sources"][0]["dm"] == pytest.approx(26.7641)
    assert body["sources"][0]["p0_s"] == pytest.approx(0.7145197, rel=1e-5)
    assert body["sources"][0]["s_est_600_mjy"] == 1300
    assert body["sources"][0]["s_est_600_method"] == "measured"


def test_partial_and_provisional_name_lookup(client: TestClient) -> None:
    partial = client.get("/api/v1/catalogs/atnf/sources", params={"name": "0332", "limit": 8}).json()
    assert any(source["source_id"] == "J0332+5434" for source in partial["sources"])

    for name in ("J0104+6029_P", "J0104+6029", "0104+6029"):
        body = client.get("/api/v1/catalogs/atnf/sources", params={"name": name, "limit": 8}).json()
        assert body["sources"][0]["source_id"] == "J0104+6029_P"
        assert body["sources"][0]["provisional"] is True

    excluded = client.get(
        "/api/v1/catalogs/atnf/sources",
        params={"name": "J0104+6029", "include_provisional": "false"},
    ).json()
    assert excluded["result_count"] == 0


def test_cone_search_crab_and_ecliptic_position(client: TestClient) -> None:
    crab = client.get(
        "/api/v1/catalogs/atnf/cone",
        params={"ra_deg": 83.633, "dec_deg": 22.014, "radius_arcmin": 60},
    )
    assert crab.status_code == 200
    first = crab.json()["sources"][0]
    assert first["source_id"] == "J0534+2200"
    assert first["separation_arcmin"] < 0.1
    assert first["dm"] == pytest.approx(56.7712)
    assert first["p0_s"] == pytest.approx(0.0333924, rel=1e-5)

    ecliptic = client.get(
        "/api/v1/catalogs/atnf/cone",
        params={"ra_deg": 7.61428142, "dec_deg": 4.86103078, "radius_arcmin": 0.1},
    )
    assert ecliptic.status_code == 200
    matches = [source for source in ecliptic.json()["sources"] if source["source_id"] == "J0030+0451"]
    assert len(matches) == 1
    assert matches[0]["pos_source"] == "ecliptic"
    assert matches[0]["is_msp"] is True


def test_coarse_flag_and_pulsar_filters(client: TestClient) -> None:
    coarse = client.get("/api/v1/catalogs/atnf/sources", params={"name": "J0011+08"}).json()
    assert coarse["sources"][0]["pos_coarse"] is True
    assert coarse["sources"][0]["pos_unc_arcsec"] == 480
    excluded = client.get(
        "/api/v1/catalogs/atnf/sources",
        params={"name": "J0011+08", "include_coarse": "false"},
    ).json()
    assert excluded["result_count"] == 0

    match = client.get(
        "/api/v1/catalogs/atnf/sources",
        params={
            "name": "B0329+54",
            "dm_min": 26,
            "dm_max": 27,
            "p0_min": 0.7,
            "p0_max": 0.8,
            "min_flux_mjy": 1000,
            "flux_frequency_mhz": 600,
        },
    ).json()
    assert match["sources"][0]["source_id"] == "J0332+5434"
    no_match = client.get(
        "/api/v1/catalogs/atnf/sources",
        params={"name": "B0329+54", "min_flux_mjy": 1000, "flux_frequency_mhz": 800},
    ).json()
    assert no_match["result_count"] == 0


@pytest.mark.parametrize(
    "path, params",
    [
        ("/api/v1/catalogs/atnf/sources", {"dm_min": -1}),
        ("/api/v1/catalogs/atnf/sources", {"dm_min": 50, "dm_max": 10}),
        ("/api/v1/catalogs/atnf/sources", {"p0_min": 1, "p0_max": 0.1}),
        ("/api/v1/catalogs/atnf/sources", {"flux_frequency_mhz": 1400}),
        ("/api/v1/catalogs/atnf/sources", {"limit": 20}),
        ("/api/v1/catalogs/atnf/sources", {"untrusted": "extra"}),
        ("/api/v1/catalogs/atnf/cone", {"ra_deg": 360, "dec_deg": 0, "radius_arcmin": 1}),
        ("/api/v1/catalogs/atnf/cone", {"ra_deg": 0, "dec_deg": 0, "radius_arcmin": 61}),
    ],
)
def test_invalid_atnf_queries_are_rejected(client: TestClient, path: str, params: dict[str, object]) -> None:
    assert client.get(path, params=params).status_code == 422


def test_visibility_preserves_selected_pulsar_metadata(client: TestClient, visibility_payload: dict) -> None:
    source = client.get("/api/v1/catalogs/atnf/sources", params={"name": "B0531+21"}).json()["sources"][0]
    payload = deepcopy(visibility_payload)
    payload["target_ids"] = []
    payload["custom_targets"] = [
        {
            "id": source["id"],
            "name": source["name"],
            "aliases": source["aliases"],
            "ra_deg": source["ra_deg"],
            "dec_deg": source["dec_deg"],
            "catalog": "atnf",
            "catalog_source_id": source["source_id"],
            "catalogue_version": source["catalogue_version"],
            "catalogue_citation": source["catalogue_citation"],
            "total_flux_mjy": source["total_flux_mjy"],
            "flux_frequency_mhz": source["flux_frequency_mhz"],
            "flux_method": source["flux_method"],
            "dm": source["dm"],
            "p0_s": source["p0_s"],
            "pos_unc_arcsec": source["pos_unc_arcsec"],
            "pos_coarse": source["pos_coarse"],
            "provisional": source["provisional"],
            "type_codes": source["type_codes"],
            "is_binary": source["is_binary"],
            "is_msp": source["is_msp"],
        }
    ]
    response = client.post("/api/v1/visibility/altitude-series", json=payload)
    assert response.status_code == 200
    target = response.json()["targets"][0]
    assert target["catalog"] == "atnf"
    assert target["catalog_source_id"] == "J0534+2200"
    assert target["catalogue_version"] == source["catalogue_version"]
    assert target["catalogue_citation"] == source["catalogue_citation"]
    assert target["dm"] == pytest.approx(56.7712)
    assert target["p0_s"] == pytest.approx(0.0333924, rel=1e-5)
    assert target["flux_frequency_mhz"] == 600
    assert target["flux_method"] == "measured"
    assert target["type_codes"] == source["type_codes"]

    bad_payload = deepcopy(payload)
    bad_payload["custom_targets"][0]["id"] = "vlass-wrong"
    assert client.post("/api/v1/visibility/altitude-series", json=bad_payload).status_code == 422

    for version, citation in (
        ("2.8.0", source["catalogue_citation"]),
        ("2.9.0", "Unverified catalogue"),
        (None, source["catalogue_citation"]),
    ):
        bad_payload = deepcopy(payload)
        bad_payload["custom_targets"][0]["catalogue_version"] = version
        bad_payload["custom_targets"][0]["catalogue_citation"] = citation
        assert client.post("/api/v1/visibility/altitude-series", json=bad_payload).status_code == 422
