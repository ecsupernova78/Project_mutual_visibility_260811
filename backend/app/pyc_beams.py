"""Unconfirmed PYC EW fan strips supplied in BeamViz_SiteBeams_261113.

These horizon-to-horizon assignment strips are not primary-beam or power
contours. There is no point centre or NS digital beamforming stage.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.models import FovBeam, FovBeamModel

_DATA_DIRECTORY = Path(__file__).resolve().parent / "data" / "burstt_fov"
_MODE = "PYC_bf16_HYPOTHESIS_b0-7.5_ref400MHz_p0west"
_STEP_EW = 299792458.0 / 400e6 / 16
_ROTATION_DEG = -0.23
_POINTS_PER_STRIP = 121


@dataclass(frozen=True, slots=True)
class PycFanBeams:
    model: FovBeamModel

    def beam_ids(self, altitude_deg: np.ndarray, azimuth_deg: np.ndarray) -> np.ndarray:
        """Assign only array-frame EW; return -1 outside strips or below horizon."""
        altitude = np.asarray(altitude_deg, dtype=float)
        azimuth = np.deg2rad(np.asarray(azimuth_deg, dtype=float))
        east = np.cos(np.deg2rad(altitude)) * np.sin(azimuth)
        north = np.cos(np.deg2rad(altitude)) * np.cos(azimuth)
        rotation = np.deg2rad(_ROTATION_DEG)
        l_array = east * np.cos(rotation) + north * np.sin(rotation)
        index = l_array / _STEP_EW + 8
        # Internal ties go east; both outer boundaries are included.
        index = np.where(np.abs(index - np.rint(index)) <= 1e-9, np.rint(index), index)
        inside = (altitude >= 0) & (altitude <= 90) & (index >= 0) & (index <= 16)
        beam_id = np.clip(np.floor(np.where(np.isfinite(index), index, 0)), 0, 15).astype(int)
        return np.where(inside, beam_id, -1).astype(int)


@lru_cache(maxsize=1)
def get_pyc_fan_beams() -> PycFanBeams:
    with (_DATA_DIRECTORY / "PYC_beam_centers_hypothesis.csv").open(newline="", encoding="utf-8-sig") as handle:
        centers = list(csv.DictReader(handle))
    with (_DATA_DIRECTORY / "PYC_beam_strips_hypothesis.csv").open(newline="", encoding="utf-8-sig") as handle:
        strips = list(csv.DictReader(handle))
    if len(centers) != 16 or len(strips) != 16 * _POINTS_PER_STRIP:
        raise ValueError("PYC requires 16 fan beams and 121 vertices per closed strip")

    polygons: list[list[tuple[float, float]]] = [[] for _ in range(16)]
    for row_number, row in enumerate(strips):
        beam_id = int(row["beam_id"])
        if (
            row["site"] != "PYC"
            or row["mode"] != _MODE
            or row["evidence_type"] != "hypothesis_unconfirmed"
            or row["boundary_type"] != "assignment_cell"
            or row["level_db"] != ""
            or beam_id != row_number // _POINTS_PER_STRIP
            or int(row["vertex_order"]) != row_number % _POINTS_PER_STRIP
        ):
            raise ValueError("PYC strip metadata or vertex order disagrees with the supplied hypothesis")
        azimuth, altitude = float(row["az_deg"]), float(row["el_deg"])
        if not (0 <= azimuth <= 360 and 0 <= altitude <= 90):
            raise ValueError("PYC strip coordinates must be above the horizon")
        # Supplied Az/El already includes rotation; project it only once.
        radius = 90 - altitude
        polygons[beam_id].append(
            (
                round(float(radius * np.sin(np.deg2rad(azimuth))), 4),
                round(float(radius * np.cos(np.deg2rad(azimuth))), 4),
            )
        )

    beams: list[FovBeam] = []
    for beam_id, row in enumerate(centers):
        if (
            row["site"] != "PYC"
            or row["mode"] != _MODE
            or row["evidence_type"] != "hypothesis_unconfirmed"
            or int(row["beam_id"]) != beam_id
            or int(row["ix"]) != beam_id
            or int(row["iy"]) != 0
            or any(row[key] for key in ("az_deg", "el_deg", "m_array"))
            or abs(float(row["l_array"]) - _STEP_EW * (beam_id - 7.5)) > 1e-6
        ):
            raise ValueError("PYC must retain its EW-only hypothesis, p=0 west, and undefined point centres")
        if polygons[beam_id][0] != polygons[beam_id][-1]:
            raise ValueError("PYC fan strips must be closed")
        beams.append(
            FovBeam(
                beam_id=beam_id,
                ix_ew=beam_id,
                iy_ns=0,
                center_east_west_deg=None,
                center_north_south_deg=None,
                polygon_ew_ns_deg=polygons[beam_id],
            )
        )
    return PycFanBeams(
        model=FovBeamModel(
            geometry_type="fan_strips",
            evidence_status="hypothesis",
            reference_frequency_mhz=400,
            rotation_applied_deg=_ROTATION_DEG,
            validated_from_utc=None,
            validated_through_utc=None,
            note=(
                "PYC hypothesis: 16 EW fan beams, p=0 west, b0=-7.5 at reference 400 MHz. "
                "FPGA b0 and operational numbering are unconfirmed; five Crab matches may be circular. "
                "Sky contours already include -0.23 degree rotation. No point centres or NS digital stage. "
                "Inside means geometric strip membership above the horizon, not sensitivity or FWHM coverage. "
                "Strips are not clipped by the primary beam (approximately 90 degree NS FWHM, tilted 12 degrees south). "
                "Active-beam masks and effective search band are unknown."
            ),
            beams=beams,
        )
    )
