from __future__ import annotations

from copy import deepcopy
from itertools import permutations

import pytest
from fastapi.testclient import TestClient


def test_health(client: TestClient) -> None:
    response = client.get("/health")

    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_target_catalog(client: TestClient) -> None:
    response = client.get("/api/v1/targets")

    assert response.status_code == 200
    targets = response.json()["targets"]
    assert [target["id"] for target in targets] == ["3c123", "3c273", "3c433", "3c295", "3c134"]
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
    fourth_location = deepcopy(observing_locations[0])
    fourth_location.update({"id": "fourth-site", "name": "Fourth site"})
    too_many_locations["locations"] = [*deepcopy(observing_locations), fourth_location]
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
