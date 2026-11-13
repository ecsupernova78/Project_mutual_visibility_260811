"""Public BURSTT station geometry and antenna-layout metadata.

The nominal FoV widths are planning footprints, not measured sensitivity
contours or synthesized beam widths. Antenna layouts alone do not determine a
beam without an observing frequency, element pattern, weighting and steering.
Positive rotation means counter-clockwise in the east-west (east-positive),
north-south (north-positive) projection-plane coordinates.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BursttStation:
    code: str
    latitude_deg: float
    longitude_deg: float
    elevation_m: float
    antenna_count: int
    antenna_rows: int
    antennas_per_row: int
    spacing_ew_m: float
    spacing_ns_m: float
    frequency_min_mhz: float
    frequency_max_mhz: float
    ew_width_deg: float
    ns_width_deg: float
    rotation_deg: float
    center_east_west_deg: float = 0.0
    center_north_south_deg: float = 0.0


# Position, layout, frequency limits and array rotation transcribed from the
# user's BURSTTStations.json. Operational IP addresses, server names and paths
# are intentionally excluded. PYC/OGW pointing offsets came from the user.
BURSTT_STATIONS: dict[str, BursttStation] = {
    "FUS": BursttStation(
        code="FUS",
        latitude_deg=24.75649349722,
        longitude_deg=121.58164468611,
        elevation_m=642.341,
        antenna_count=256,
        antenna_rows=16,
        antennas_per_row=16,
        spacing_ew_m=1.0,
        spacing_ns_m=0.5,
        frequency_min_mhz=400,
        frequency_max_mhz=800,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=-3.0,
    ),
    "LTN": BursttStation(
        code="LTN",
        latitude_deg=23.71457841944,
        longitude_deg=120.82440456389,
        elevation_m=882.641,
        antenna_count=64,
        antenna_rows=4,
        antennas_per_row=16,
        spacing_ew_m=1.0,
        spacing_ns_m=2.0,
        frequency_min_mhz=300,
        frequency_max_mhz=700,
        ew_width_deg=70,
        ns_width_deg=80,
        rotation_deg=0.5,
    ),
    "GRN": BursttStation(
        code="GRN",
        latitude_deg=22.67561324167,
        longitude_deg=121.50121980833,
        elevation_m=32.677,
        antenna_count=64,
        antenna_rows=4,
        antennas_per_row=16,
        spacing_ew_m=1.0,
        spacing_ns_m=1.0,
        frequency_min_mhz=400,
        frequency_max_mhz=800,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=1.7,
    ),
    "KMN": BursttStation(
        code="KMN",
        latitude_deg=24.43977323333,
        longitude_deg=118.34267574167,
        elevation_m=48.568,
        antenna_count=16,
        antenna_rows=1,
        antennas_per_row=16,
        spacing_ew_m=1.0,
        spacing_ns_m=1.0,
        frequency_min_mhz=300,
        frequency_max_mhz=700,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=0.0715,
    ),
    "OGW": BursttStation(
        code="OGW",
        latitude_deg=27.0919857,
        longitude_deg=142.21690964167,
        elevation_m=261.534,
        antenna_count=16,
        antenna_rows=2,
        antennas_per_row=8,
        spacing_ew_m=1.0,
        spacing_ns_m=1.0,
        frequency_min_mhz=400,
        frequency_max_mhz=800,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=-5.5,
        center_east_west_deg=-18.0,
    ),
    "PYC": BursttStation(
        code="PYC",
        latitude_deg=37.53410008889,
        longitude_deg=128.44857061389,
        elevation_m=545.067,
        antenna_count=16,
        antenna_rows=1,
        antennas_per_row=16,
        spacing_ew_m=1.0,
        spacing_ns_m=1.0,
        frequency_min_mhz=300,
        frequency_max_mhz=700,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=-0.23,
        center_north_south_deg=-16.0,
    ),
}
