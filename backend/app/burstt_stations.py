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
    antenna_rows: int | None
    antennas_per_row: int | None
    spacing_ew_m: float | None
    spacing_ns_m: float | None
    frequency_min_mhz: float | None
    frequency_max_mhz: float | None
    ew_width_deg: float
    ns_width_deg: float
    rotation_deg: float | None
    center_east_west_deg: float = 0.0
    center_north_south_deg: float = 0.0
    profile_note: str | None = None


# GNSS positioning CSV is authoritative for coordinates, antenna counts and
# array orientation. Other layout/band fields retain the prior model when
# available. Operational addresses, server names and paths are excluded.
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
        frequency_min_mhz=300,
        frequency_max_mhz=700,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=-3.0,
    ),
    "LTN": BursttStation(
        code="LTN",
        profile_note=(
            "64-beam assignment model: EW grid agrees with one B0329+54 pulse; NS centres are the last documented "
            "four-angle command, including a date-dependent Sun beam. This is not a measured response map."
        ),
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
        antenna_count=32,
        antenna_rows=None,
        antennas_per_row=None,
        spacing_ew_m=None,
        spacing_ns_m=None,
        frequency_min_mhz=300,
        frequency_max_mhz=700,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=0.0715,
    ),
    "OGW": BursttStation(
        code="OGW",
        profile_note=(
            "32 antennas (2x16) confirmed since August 2026. The 32 digital cells are an unvalidated model "
            "from array configuration and beamformer defaults; operational steering and pointing are unknown. "
            "The 18 degree west tilt was documented only for the earlier OGW-16 mode and is not applied."
        ),
        latitude_deg=27.0919857,
        longitude_deg=142.21690964167,
        elevation_m=261.534,
        antenna_count=32,
        antenna_rows=2,
        antennas_per_row=16,
        spacing_ew_m=0.833333,
        spacing_ns_m=1.0,
        frequency_min_mhz=300,
        frequency_max_mhz=700,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=-5.5,
    ),
    "PYC": BursttStation(
        code="PYC",
        profile_note=(
            "16 EW fan strips enabled as a hypothesis. Approximate 12 degree south mechanical tilt "
            "and 90 degree NS primary-beam FWHM are not applied as strip cutoffs. "
            "FPGA b0 and numbering remain unconfirmed."
        ),
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
        center_north_south_deg=-12.0,
    ),
    "GBD": BursttStation(
        code="GBD",
        latitude_deg=13.60091666667,
        longitude_deg=77.42641666667,
        elevation_m=750,
        antenna_count=16,
        antenna_rows=None,
        antennas_per_row=None,
        spacing_ew_m=None,
        spacing_ns_m=None,
        frequency_min_mhz=None,
        frequency_max_mhz=None,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=None,
        profile_note="GNSS CSV lists coordinates and 16 antennas; orientation and beam pattern are unspecified. The plotted FoV is schematic.",
    ),
    "PHL": BursttStation(
        code="PHL",
        latitude_deg=19.25011111111,
        longitude_deg=-155.46827777778,
        elevation_m=1760,
        antenna_count=8,
        antenna_rows=None,
        antennas_per_row=None,
        spacing_ew_m=None,
        spacing_ns_m=None,
        frequency_min_mhz=None,
        frequency_max_mhz=None,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=None,
        profile_note="Under construction. GNSS CSV lists coordinates and 8 antennas; orientation and beam pattern are unspecified. The plotted FoV is schematic.",
    ),
    "FUG": BursttStation(
        code="FUG",
        latitude_deg=25.29752777778,
        longitude_deg=121.53788888889,
        elevation_m=20,
        antenna_count=16,
        antenna_rows=None,
        antennas_per_row=None,
        spacing_ew_m=None,
        spacing_ns_m=None,
        frequency_min_mhz=None,
        frequency_max_mhz=None,
        ew_width_deg=60,
        ns_width_deg=90,
        rotation_deg=None,
        profile_note="Inactive. GNSS CSV lists coordinates and 16 antennas; orientation and beam pattern are unspecified. The plotted FoV is schematic.",
    ),
}
