from __future__ import annotations

from copy import deepcopy
from itertools import permutations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.burstt_stations import BURSTT_STATIONS
from app.fus_beams import get_fus_beam_grid
from app.visibility import _inside_elliptical_fov


def test_health(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_target_catalog(client: TestClient) -> None:
    response = client.get("/api/v1/targets")

    assert response.status_code == 200
    targets = response.json()["targets"]
    assert [target["id"] for target in targets] == [
        "3c123",
        "3c273",
        "3c433",
        "3c295",
        "3c134",
        "b0329_54",
        "crab_pulsar",
        "3c147",
        "3c48",
    ]
    assert targets[0] == {
        "id": "3c123",
        "name": "3C123",
        "aliases": ["3C 123"],
        "ra_hms": "04:37:04.38",
        "dec_dms": "+29:40:13.86",
        "ra_deg": 69.26825,
        "dec_deg": 29.670516667,
        "frame": "icrs",
    }
    assert [(target["name"], target["ra_hms"], target["dec_dms"]) for target in targets[5:]] == [
        ("B0329+54 pulsar", "03:32:59.3862", "+54:34:43.505"),
        ("Crab pulsar", "05:34:31.973", "+22:00:52.06"),
        ("3C147", "05:42:36.137916", "+49:51:07.23356"),
        ("3C48", "01:37:41.299431", "+33:09:35.13299"),
    ]


def test_new_example_targets_can_be_calculated(client: TestClient, visibility_payload: dict) -> None:
    payload = deepcopy(visibility_payload)
    payload["target_ids"] = ["b0329_54", "crab_pulsar", "3c147", "3c48"]

    response = client.post("/api/v1/visibility/altitude-series", json=payload)

    assert response.status_code == 200
    assert [target["id"] for target in response.json()["targets"]] == payload["target_ids"]


def test_altitude_series_success(client: TestClient, visibility_payload: dict) -> None:
    response = client.post("/api/v1/visibility/altitude-series", json=visibility_payload)

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["sample_count"] == 49
    assert body["metadata"]["location_count"] == 2
    assert body["metadata"]["coordinate_frame"] == "icrs"
    assert body["metadata"]["altitude_frame"] == "altaz"
    assert body["metadata"]["atmospheric_refraction"] is False
    assert "consecutive visible samples" in body["metadata"]["interval_definition"]
    assert "every selected location" in body["metadata"]["visibility_definition"]
    assert len(body["times_utc"]) == 49
    assert body["times_utc"][24] == "2026-03-18T09:00:00Z"
    assert len(body["targets"]) == 5
    assert 0 <= body["visible_target_count"] <= 5

    for target in body["targets"]:
        assert len(target["location_series"]) == 2
        assert len(target["simultaneous_mask"]) == 49
        assert "aliases" in target
        assert target["simultaneous_visible"] == any(target["simultaneous_mask"])
        for series in target["location_series"]:
            assert len(series["altitudes_deg"]) == 49
            assert all(-90 <= altitude <= 90 for altitude in series["altitudes_deg"])
        for interval in target["visible_intervals"]:
            assert interval["start_time_utc"] <= interval["end_time_utc"]
            assert interval["sample_count"] == interval["end_index"] - interval["start_index"] + 1
            assert interval["peak_common_altitude_deg"] >= visibility_payload["minimum_altitude_deg"]


@pytest.mark.parametrize("location_count", [1, 2, 3])
def test_one_to_three_locations_use_all_selected_sites(
    client: TestClient,
    visibility_payload: dict,
    observing_locations: list[dict],
    location_count: int,
) -> None:
    payload = deepcopy(visibility_payload)
    payload["locations"] = deepcopy(observing_locations[:location_count])
    payload["target_ids"] = ["3c123", "3c273"]

    response = client.post("/api/v1/visibility/altitude-series", json=payload)

    assert response.status_code == 200
    body = response.json()
    assert body["metadata"]["location_count"] == location_count
    assert len(body["locations"]) == location_count
    assert body["visible_target_count"] == sum(target["simultaneous_visible"] for target in body["targets"])

    for target in body["targets"]:
        assert len(target["location_series"]) == location_count
        altitude_rows = [series["altitudes_deg"] for series in target["location_series"]]
        expected_mask = [
            all(altitude >= payload["minimum_altitude_deg"] for altitude in sample_altitudes)
            for sample_altitudes in zip(*altitude_rows, strict=True)
        ]
        expected_common_altitudes = [min(sample_altitudes) for sample_altitudes in zip(*altitude_rows, strict=True)]
        assert target["simultaneous_mask"] == expected_mask
        assert target["max_common_altitude_deg"] == pytest.approx(max(expected_common_altitudes), abs=1e-5)


def test_ten_locations_are_accepted_and_eleven_rejected(client: TestClient, visibility_payload: dict) -> None:
    payload = deepcopy(visibility_payload)
    payload["locations"] = [
        {
            "id": f"site-{index}",
            "name": f"Site {index}",
            "latitude_deg": -30.0 + index,
            "longitude_deg": 120.0 + index,
            "elevation_m": 0,
        }
        for index in range(10)
    ]
    payload["target_ids"] = ["3c123"]
    payload["hours_before"] = 1
    payload["hours_after"] = 1
    payload["step_minutes"] = 60

    accepted = client.post("/api/v1/visibility/altitude-series", json=payload)
    assert accepted.status_code == 200
    assert accepted.json()["metadata"]["location_count"] == 10
    assert len(accepted.json()["targets"][0]["location_series"]) == 10

    payload["locations"].append({**payload["locations"][0], "id": "site-10", "name": "Site 10"})
    rejected = client.post("/api/v1/visibility/altitude-series", json=payload)
    assert rejected.status_code == 422


def test_elliptical_fov_excludes_rectangle_corners_and_below_horizon() -> None:
    inside = _inside_elliptical_fov(
        np.array([90.0, 60.0, 45.0, 90.0 - np.hypot(30.0, 45.0), -1.0]),
        np.array([0.0, 30.0, 0.0, 30.0, 0.0]),
        np.array([0.0, 0.0, 45.0, 45.0, 0.0]),
        60.0,
        90.0,
    )

    assert inside.tolist() == [True, True, True, False, False]


def test_elliptical_fov_pointing_offset_and_counterclockwise_rotation() -> None:
    # A +90 degree rotation swaps the 30-degree EW and 45-degree NS semi-axes.
    # The centre is 16 degrees south of the zenith, as for PYC's pointing.
    inside = _inside_elliptical_fov(
        np.array([80.0, 50.0, 50.0, -1.0]),
        np.array([0.0, 40.0, 0.0, 0.0]),
        np.array([-16.0, -16.0, 24.0, -16.0]),
        60.0,
        90.0,
        center_east_west_deg=0.0,
        center_north_south_deg=-16.0,
        rotation_deg=90.0,
    )
    assert inside.tolist() == [True, True, False, False]


def test_fus_model_assigns_all_256_center_directions_to_their_numbered_cells() -> None:
    grid = get_fus_beam_grid()
    centers = grid.model.beams
    azimuth = np.array(
        [np.rad2deg(np.arctan2(beam.center_east_west_deg, beam.center_north_south_deg)) % 360 for beam in centers]
    )
    altitude = np.array([90 - np.hypot(beam.center_east_west_deg, beam.center_north_south_deg) for beam in centers])
    assert grid.beam_ids(altitude, azimuth).tolist() == list(range(256))
    assert grid.beam_ids(np.array([-1.0, 20.0]), np.array([0.0, 90.0])).tolist() == [-1, -1]


def test_nine_burstt_station_profiles_and_fov_masks(client: TestClient, visibility_payload: dict) -> None:
    surveyed_positions = {
        "FUS": (24.75649349722, 121.58164468611, 642.341),
        "LTN": (23.71457841944, 120.82440456389, 882.641),
        "GRN": (22.67561324167, 121.50121980833, 32.677),
        "KMN": (24.43977323333, 118.34267574167, 48.568),
        "OGW": (27.0919857, 142.21690964167, 261.534),
        "PYC": (37.53410008889, 128.44857061389, 545.067),
        "GBD": (13.60091666667, 77.42641666667, 750),
        "PHL": (19.25011111111, -155.46827777778, 1760),
        "FUG": (25.29752777778, 121.53788888889, 20),
    }
    expected = {
        "FUS": (256, 16, 16, 1.0, 0.5, 300, 700, 60, 90, -3.0, 0, 0),
        "LTN": (64, 4, 16, 1.0, 2.0, 300, 700, 70, 80, 0.5, 0, 0),
        "GRN": (64, 4, 16, 1.0, 1.0, 400, 800, 60, 90, 1.7, 0, 0),
        "KMN": (32, None, None, None, None, 300, 700, 60, 90, 0.0715, 0, 0),
        "OGW": (32, 2, 16, 0.833333, 1.0, 300, 700, 60, 90, -5.5, 0, 0),
        "PYC": (16, 1, 16, 1.0, 1.0, 300, 700, 60, 90, -0.23, 0, -12),
        "GBD": (16, None, None, None, None, None, None, 60, 90, 0, 0, 0),
        "PHL": (8, None, None, None, None, None, None, 60, 90, 0, 0, 0),
        "FUG": (16, None, None, None, None, None, None, 60, 90, 0, 0, 0),
    }
    payload = deepcopy(visibility_payload)
    payload.update(
        {
            "locations": [
                {
                    "id": code.lower(),
                    "name": code,
                    "latitude_deg": station.latitude_deg,
                    "longitude_deg": station.longitude_deg,
                    "elevation_m": station.elevation_m,
                    "burstt_station_code": code,
                }
                for code, station in BURSTT_STATIONS.items()
            ],
            "target_ids": ["3c123"],
            "hours_before": 1,
            "hours_after": 1,
            "step_minutes": 30,
            "include_fov": True,
        }
    )

    response = client.post("/api/v1/visibility/altitude-series", json=payload)
    assert response.status_code == 200
    body = response.json()
    fov_sites = body["fov"]["sites"]
    assert [site["station_code"] for site in fov_sites] == list(expected)
    for site in fov_sites:
        code = site["station_code"]
        station = BURSTT_STATIONS[code]
        assert (station.latitude_deg, station.longitude_deg, station.elevation_m) == surveyed_positions[code]
        if station.antenna_rows is not None and station.antennas_per_row is not None:
            assert station.antenna_count == station.antenna_rows * station.antennas_per_row
        assert (
            site["antenna_count"],
            site["antenna_rows"],
            site["antennas_per_row"],
            site["spacing_ew_m"],
            site["spacing_ns_m"],
            site["frequency_min_mhz"],
            site["frequency_max_mhz"],
            site["ew_width_deg"],
            site["ns_width_deg"],
            site["rotation_deg"],
            site["center_east_west_deg"],
            site["center_north_south_deg"],
        ) == expected[code]

        altitude_series = next(
            series["altitudes_deg"]
            for series in body["targets"][0]["location_series"]
            if series["location_id"] == site["location_id"]
        )
        target_series = site["target_series"][0]
        if code == "FUS":
            model = site["beam_model"]
            assert model["model_type"] == "modeled_assignment_cells"
            assert model["reference_frequency_mhz"] == 400
            assert len(model["beams"]) == 256
            assert model["beams"][224]["iy_ns"] == 14
            assert all(len(beam["polygon_ew_ns_deg"]) == 49 for beam in model["beams"])
            assert all(
                (beam_id is not None) == inside
                for beam_id, inside in zip(target_series["beam_ids"], target_series["in_fov"], strict=True)
            )
            continue
        if code == "PYC":
            model = site["beam_model"]
            assert model["geometry_type"] == "fan_strips"
            assert model["evidence_status"] == "hypothesis"
            assert model["validated_from_utc"] is None
            assert model["validated_through_utc"] is None
            assert model["rotation_applied_deg"] == -0.23
            assert len(model["beams"]) == 16
            assert all(
                beam["center_east_west_deg"] is None and beam["center_north_south_deg"] is None
                for beam in model["beams"]
            )
            assert all(len(beam["polygon_ew_ns_deg"]) == 121 for beam in model["beams"])
            # Check the API routes PYC through EW-only assignment, not the FUS grid.
            east = np.array(target_series["east_west_deg"])
            north = np.array(target_series["north_south_deg"])
            azimuth = np.arctan2(east, north)
            rotation = np.deg2rad(-0.23)
            lp = np.cos(np.deg2rad(altitude_series)) * np.sin(azimuth + rotation)
            indices = lp / (299792458.0 / 400e6 / 16) + 8
            expected_ids = [
                min(15, int(np.floor(index))) if alt >= 0 and 0 <= index <= 16 else None
                for index, alt in zip(indices, altitude_series, strict=True)
            ]
            assert target_series["beam_ids"] == expected_ids
            assert target_series["in_fov"] == [value is not None for value in expected_ids]
            continue
        if code in {"LTN", "OGW"}:
            model = site["beam_model"]
            assert model["geometry_type"] == "cells"
            assert model["source_package"] == "BeamViz_SiteBeams_261113_new"
            assert model["evidence_status"] == ("partially_validated" if code == "LTN" else "hypothesis")
            assert model["rotation_applied_deg"] == station.rotation_deg
            assert len(model["beams"]) == (64 if code == "LTN" else 32)
            assert [beam["beam_id"] for beam in model["beams"]] == list(range(len(model["beams"])))
            assert all(
                (beam_id is not None) == inside
                for beam_id, inside in zip(target_series["beam_ids"], target_series["in_fov"], strict=True)
            )
            continue
        assert site["beam_model"] is None
        assert target_series["beam_ids"] is None
        angle = np.deg2rad(site["rotation_deg"])
        for altitude, east, north, actual in zip(
            altitude_series,
            target_series["east_west_deg"],
            target_series["north_south_deg"],
            target_series["in_fov"],
            strict=True,
        ):
            dx = east - site["center_east_west_deg"]
            dy = north - site["center_north_south_deg"]
            major = dx * np.cos(angle) + dy * np.sin(angle)
            minor = -dx * np.sin(angle) + dy * np.cos(angle)
            expected_inside = altitude >= 0 and (
                (major / (site["ew_width_deg"] / 2)) ** 2 + (minor / (site["ns_width_deg"] / 2)) ** 2 <= 1
            )
            assert actual == expected_inside


def test_unknown_burstt_station_code_is_rejected(client: TestClient, visibility_payload: dict) -> None:
    payload = deepcopy(visibility_payload)
    payload["locations"][0]["burstt_station_code"] = "NOT_A_STATION"
    response = client.post("/api/v1/visibility/altitude-series", json=payload)
    assert response.status_code == 422


def test_fov_projection_and_common_mask(
    client: TestClient, visibility_payload: dict, observing_locations: list[dict]
) -> None:
    payload = deepcopy(visibility_payload)
    payload.update(
        {
            "locations": [
                deepcopy(observing_locations[2]),
                {**deepcopy(observing_locations[2]), "id": "ltn", "name": "LTN (Taiwan)"},
            ],
            "hours_before": 1,
            "hours_after": 1,
            "step_minutes": 60,
            "target_ids": ["3c123", "3c273"],
        }
    )

    ordinary = client.post("/api/v1/visibility/altitude-series", json=payload)
    assert ordinary.status_code == 200
    assert ordinary.json()["fov"] is None

    payload["include_fov"] = True
    response = client.post("/api/v1/visibility/altitude-series", json=payload)
    assert response.status_code == 200
    body = response.json()
    fov = body["fov"]
    assert fov["projection"] == "zenithal_equidistant"
    assert fov["horizon_radius_deg"] == 90
    assert [(site["ew_width_deg"], site["ns_width_deg"]) for site in fov["sites"]] == [(60, 90), (70, 80)]
    assert [site["station_code"] for site in fov["sites"]] == [None, None]
    assert all(site["center_east_west_deg"] == 0 and site["center_north_south_deg"] == 0 for site in fov["sites"])

    for site, location in zip(fov["sites"], body["locations"], strict=True):
        assert site["location_id"] == location["id"]
        assert len(site["target_series"]) == 2
        for target_series in site["target_series"]:
            target = next(target for target in body["targets"] if target["id"] == target_series["target_id"])
            altitude_series = next(
                series["altitudes_deg"]
                for series in target["location_series"]
                if series["location_id"] == site["location_id"]
            )
            assert len(target_series["east_west_deg"]) == len(body["times_utc"])
            for east, north, altitude, in_fov in zip(
                target_series["east_west_deg"],
                target_series["north_south_deg"],
                altitude_series,
                target_series["in_fov"],
                strict=True,
            ):
                assert np.hypot(east, north) == pytest.approx(90 - altitude, abs=2e-6)
                normalized_radius_squared = (east / (site["ew_width_deg"] / 2)) ** 2 + (
                    north / (site["ns_width_deg"] / 2)
                ) ** 2
                assert in_fov == (altitude >= 0 and normalized_radius_squared <= 1)

    for common in fov["common_masks"]:
        site_masks = [
            next(series["in_fov"] for series in site["target_series"] if series["target_id"] == common["target_id"])
            for site in fov["sites"]
        ]
        assert common["in_fov"] == [all(values) for values in zip(*site_masks, strict=True)]


def test_location_permutations_preserve_common_result(
    client: TestClient,
    visibility_payload: dict,
    observing_locations: list[dict],
) -> None:
    payload = deepcopy(visibility_payload)
    payload.update(
        {
            "locations": deepcopy(observing_locations),
            "hours_before": 2,
            "hours_after": 2,
            "step_minutes": 60,
            "target_ids": ["3c123", "3c273", "3c134"],
        }
    )
    original = client.post("/api/v1/visibility/altitude-series", json=payload).json()

    for location_order in permutations(observing_locations):
        permuted_payload = deepcopy(payload)
        permuted_payload["locations"] = deepcopy(location_order)
        response = client.post("/api/v1/visibility/altitude-series", json=permuted_payload)

        assert response.status_code == 200
        permuted = response.json()
        assert permuted["times_utc"] == original["times_utc"]
        assert permuted["visible_target_count"] == original["visible_target_count"]
        for original_target, permuted_target in zip(original["targets"], permuted["targets"], strict=True):
            assert permuted_target["id"] == original_target["id"]
            assert permuted_target["simultaneous_mask"] == original_target["simultaneous_mask"]
            assert permuted_target["visible_intervals"] == original_target["visible_intervals"]
            assert permuted_target["max_common_altitude_deg"] == original_target["max_common_altitude_deg"]
            original_series = {
                series["location_id"]: series["altitudes_deg"] for series in original_target["location_series"]
            }
            permuted_series = {
                series["location_id"]: series["altitudes_deg"] for series in permuted_target["location_series"]
            }
            assert permuted_series == original_series


def test_adding_locations_can_only_reduce_common_visibility(
    client: TestClient,
    visibility_payload: dict,
    observing_locations: list[dict],
) -> None:
    masks_by_count: dict[int, dict[str, list[bool]]] = {}
    for location_count in (1, 2, 3):
        payload = deepcopy(visibility_payload)
        payload["locations"] = deepcopy(observing_locations[:location_count])
        response = client.post("/api/v1/visibility/altitude-series", json=payload)

        assert response.status_code == 200
        masks_by_count[location_count] = {
            target["id"]: target["simultaneous_mask"] for target in response.json()["targets"]
        }

    for target_id in visibility_payload["target_ids"]:
        for visible_at_one, visible_at_two, visible_at_three in zip(
            masks_by_count[1][target_id],
            masks_by_count[2][target_id],
            masks_by_count[3][target_id],
            strict=True,
        ):
            assert not visible_at_two or visible_at_one
            assert not visible_at_three or visible_at_two


def test_golden_altitudes_at_reference_time(
    client: TestClient,
    visibility_payload: dict,
    observing_locations: list[dict],
) -> None:
    payload = deepcopy(visibility_payload)
    payload.update(
        {
            "locations": deepcopy(observing_locations),
            "hours_before": 1,
            "hours_after": 1,
            "step_minutes": 60,
            "minimum_altitude_deg": 0,
        }
    )

    body = client.post("/api/v1/visibility/altitude-series", json=payload).json()

    assert body["times_utc"][1] == "2026-03-18T09:00:00Z"
    by_target = {target["id"]: target for target in body["targets"]}
    expected = {
        "3c123": ({"narrabri": 23.086296, "pyeongchang": 78.916493, "fushan": 84.426860}, True),
        "3c273": ({"narrabri": 1.702304, "pyeongchang": -13.242879, "fushan": -21.779639}, False),
        "3c433": ({"narrabri": -53.967062, "pyeongchang": -4.621386, "fushan": -6.909874}, False),
        "3c295": ({"narrabri": -36.878680, "pyeongchang": 8.104718, "fushan": -5.780177}, False),
        "3c134": ({"narrabri": 17.896582, "pyeongchang": 87.605465, "fushan": 76.202590}, True),
    }
    for target_id, (expected_altitudes, expected_visible) in expected.items():
        by_location = {
            series["location_id"]: series["altitudes_deg"][1] for series in by_target[target_id]["location_series"]
        }
        for location_id, altitude in expected_altitudes.items():
            assert by_location[location_id] == pytest.approx(altitude, abs=1e-3)
        assert by_target[target_id]["simultaneous_mask"][1] is expected_visible


def test_antimeridian_is_canonicalized(client: TestClient, visibility_payload: dict) -> None:
    payload = deepcopy(visibility_payload)
    payload["locations"][0]["longitude_deg"] = 180
    payload["target_ids"] = ["3c123"]

    body = client.post("/api/v1/visibility/altitude-series", json=payload).json()

    assert body["locations"][0]["longitude_deg"] == -180


def test_validation_rejects_bad_inputs(
    client: TestClient,
    visibility_payload: dict,
    observing_locations: list[dict],
) -> None:
    invalid_payloads = []

    no_locations = deepcopy(visibility_payload)
    no_locations["locations"] = []
    invalid_payloads.append(no_locations)

    too_many_locations = deepcopy(visibility_payload)
    too_many_locations["locations"] = [
        {**deepcopy(observing_locations[0]), "id": f"site-{index}", "name": f"Site {index}"} for index in range(11)
    ]
    invalid_payloads.append(too_many_locations)

    invalid_latitude = deepcopy(visibility_payload)
    invalid_latitude["locations"][0]["latitude_deg"] = 91
    invalid_payloads.append(invalid_latitude)

    naive_time = deepcopy(visibility_payload)
    naive_time["center_time_utc"] = "2026-03-18T09:00:00"
    invalid_payloads.append(naive_time)

    invalid_step = deepcopy(visibility_payload)
    invalid_step["step_minutes"] = 0
    invalid_payloads.append(invalid_step)

    one_sample = deepcopy(visibility_payload)
    one_sample["hours_before"] = 0.25
    one_sample["hours_after"] = 0.25
    one_sample["step_minutes"] = 180
    invalid_payloads.append(one_sample)

    too_many_samples = deepcopy(visibility_payload)
    too_many_samples["hours_before"] = 72
    too_many_samples["hours_after"] = 72
    too_many_samples["step_minutes"] = 1
    invalid_payloads.append(too_many_samples)

    duplicate_location_id = deepcopy(visibility_payload)
    duplicate_location_id["locations"][1]["id"] = duplicate_location_id["locations"][0]["id"]
    invalid_payloads.append(duplicate_location_id)

    duplicate_target_id = deepcopy(visibility_payload)
    duplicate_target_id["target_ids"] = ["3c123", "3c123"]
    invalid_payloads.append(duplicate_target_id)

    unknown_target = deepcopy(visibility_payload)
    unknown_target["target_ids"] = ["not-in-catalog"]
    invalid_payloads.append(unknown_target)

    for payload in invalid_payloads:
        response = client.post("/api/v1/visibility/altitude-series", json=payload)
        assert response.status_code == 422


def test_cors_allows_local_frontend(client: TestClient) -> None:
    response = client.options(
        "/api/v1/targets",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
