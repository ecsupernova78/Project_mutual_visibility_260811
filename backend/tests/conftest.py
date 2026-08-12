from __future__ import annotations

from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


@pytest.fixture
def observing_locations() -> list[dict]:
    return [
        {
            "id": "narrabri",
            "name": "Narrabri",
            "latitude_deg": -30.31667,
            "longitude_deg": 149.76667,
            "elevation_m": 0,
        },
        {
            "id": "pyeongchang",
            "name": "Pyeongchang",
            "latitude_deg": 37.36889,
            "longitude_deg": 128.39028,
            "elevation_m": 0,
        },
        {
            "id": "fushan",
            "name": "Fushan",
            "latitude_deg": 24.7564722222222,
            "longitude_deg": 121.581638888889,
            "elevation_m": 0,
        },
    ]


@pytest.fixture
def visibility_payload(observing_locations: list[dict]) -> dict:
    return {
        "locations": deepcopy(observing_locations[:2]),
        "center_time_utc": "2026-03-18T09:00:00Z",
        "hours_before": 12,
        "hours_after": 12,
        "step_minutes": 30,
        "minimum_altitude_deg": 10,
        "target_ids": ["3c123", "3c273", "3c433", "3c295", "3c134"],
    }
