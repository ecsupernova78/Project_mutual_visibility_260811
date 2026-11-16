"""Trigger-validated FUS cells from BeamViz_SiteBeams_261113.

CSV sky coordinates already include the verified -3 degree array rotation.
Source directions are inverse-rotated for assignment in the array frame.
The geometric cells are not measured power/sensitivity contours.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.models import FovBeam, FovBeamModel

_DATA_DIRECTORY = Path(__file__).resolve().parent / "data" / "burstt_fov"
_BEAMS_PER_AXIS = 16
_BEAM_COUNT = _BEAMS_PER_AXIS**2
_POINTS_PER_CELL = 49
_ROTATION_DEG = -3.0
_MODE = "FUS_bf256_b0ew-7.5_b0ns-7.5_ref400MHz"
_STEP_EW = 299792458.0 / 400e6 / 16
_STEP_NS = _STEP_EW / 0.5


def _project_az_el(az_deg: float, el_deg: float) -> tuple[float, float]:
    """Project local Az/El into the existing zenithal-equidistant plot."""

    radius = 90.0 - el_deg
    azimuth = np.deg2rad(az_deg)
    return round(float(radius * np.sin(azimuth)), 4), round(float(radius * np.cos(azimuth)), 4)


def _axis_edges(values: list[float]) -> np.ndarray:
    if len(values) != _BEAMS_PER_AXIS or any(right <= left for left, right in zip(values, values[1:], strict=False)):
        raise ValueError("FUS beam centers must form 16 ordered positions on each axis")
    centers = np.asarray(values, dtype=float)
    midpoints = (centers[:-1] + centers[1:]) / 2
    return np.concatenate(
        ([centers[0] - (centers[1] - centers[0]) / 2], midpoints, [centers[-1] + (centers[-1] - centers[-2]) / 2])
    )


@dataclass(frozen=True, slots=True)
class FusBeamGrid:
    model: FovBeamModel
    l_edges: np.ndarray
    m_edges: np.ndarray

    def beam_ids(self, altitude_deg: np.ndarray, azimuth_deg: np.ndarray) -> np.ndarray:
        """Return model beam numbers, or -1 outside the 256-cell footprint."""

        altitude = np.asarray(altitude_deg, dtype=float)
        azimuth = np.deg2rad(np.asarray(azimuth_deg, dtype=float))
        l_east = np.cos(np.deg2rad(altitude)) * np.sin(azimuth)
        m_north = np.cos(np.deg2rad(altitude)) * np.cos(azimuth)
        rotation = np.deg2rad(_ROTATION_DEG)
        l_array = l_east * np.cos(rotation) + m_north * np.sin(rotation)
        m_array = -l_east * np.sin(rotation) + m_north * np.cos(rotation)
        u, v = l_array / _STEP_EW + 8, m_array / _STEP_NS + 8
        # Internal ties choose east/north; include both outer edges. The source
        # package uses a 1e-9 index tolerance for round-off at exact boundaries.
        u = np.where(np.abs(u - np.rint(u)) <= 1e-9, np.rint(u), u)
        v = np.where(np.abs(v - np.rint(v)) <= 1e-9, np.rint(v), v)
        inside = (altitude >= 0) & (altitude <= 90) & (u >= 0) & (u <= 16) & (v >= 0) & (v <= 16)
        ix = np.clip(np.floor(np.where(np.isfinite(u), u, 0)), 0, 15).astype(int)
        iy = np.clip(np.floor(np.where(np.isfinite(v), v, 0)), 0, 15).astype(int)
        return np.where(inside, _BEAMS_PER_AXIS * iy + ix, -1).astype(int)


@lru_cache(maxsize=1)
def get_fus_beam_grid() -> FusBeamGrid:
    centers_path = _DATA_DIRECTORY / "FUS_beam_centers_verified.csv"
    cells_path = _DATA_DIRECTORY / "FUS_beam_cells_verified.csv"
    with centers_path.open(newline="", encoding="utf-8-sig") as handle:
        centers = list(csv.DictReader(handle))
    with cells_path.open(newline="", encoding="utf-8-sig") as handle:
        cells = list(csv.DictReader(handle))
    if len(centers) != _BEAM_COUNT or len(cells) != _BEAM_COUNT * _POINTS_PER_CELL:
        raise ValueError("FUS beam CSVs must contain 256 centers and 49 closed-contour vertices per cell")

    cell_vertices: list[list[tuple[float, float]]] = [[] for _ in range(_BEAM_COUNT)]
    for row_number, row in enumerate(cells):
        beam_id = int(row["beam_id"])
        point_number = int(row["vertex_order"])
        if (
            row["site"] != "FUS"
            or row["mode"] != _MODE
            or row["boundary_type"] != "assignment_cell"
            or row["level_db"] != ""
            or beam_id != row_number // _POINTS_PER_CELL
            or point_number != row_number % _POINTS_PER_CELL
        ):
            raise ValueError("FUS beam-cell rows must be ordered by beam and vertex")
        azimuth, altitude = float(row["az_deg"]), float(row["el_deg"])
        if not (0 <= azimuth <= 360 and 0 <= altitude <= 90):
            raise ValueError("FUS beam-cell coordinates must be above the horizon")
        cell_vertices[beam_id].append(_project_az_el(azimuth, altitude))

    beams: list[FovBeam] = []
    for beam_id, row in enumerate(centers):
        ix, iy = int(row["ix"]), int(row["iy"])
        if (
            row["site"] != "FUS"
            or row["mode"] != _MODE
            or int(row["beam_id"]) != beam_id
            or row["evidence_type"] != "model_from_operational_code_validated_by_triggers"
            or row["enabled"] != "true"
            or float(row["rotation_applied_deg"]) != _ROTATION_DEG
        ):
            raise ValueError("FUS centers must retain the verified mode, numbering and applied rotation")
        if beam_id != _BEAMS_PER_AXIS * iy + ix or not (0 <= ix < 16 and 0 <= iy < 16):
            raise ValueError("FUS beam numbering does not match the supplied 16-by-16 model")
        azimuth, altitude = float(row["az_deg"]), float(row["el_deg"])
        if not (0 <= azimuth <= 360 and 0 <= altitude <= 90):
            raise ValueError("FUS beam-center coordinates must be above the horizon")
        lp, mp = float(row["l_array"]), float(row["m_array"])
        rotation = np.deg2rad(_ROTATION_DEG)
        expected_east = lp * np.cos(rotation) - mp * np.sin(rotation)
        expected_north = lp * np.sin(rotation) + mp * np.cos(rotation)
        sky_east = np.cos(np.deg2rad(altitude)) * np.sin(np.deg2rad(azimuth))
        sky_north = np.cos(np.deg2rad(altitude)) * np.cos(np.deg2rad(azimuth))
        if not np.allclose(
            [lp, mp, sky_east, sky_north],
            [_STEP_EW * (ix - 7.5), _STEP_NS * (iy - 7.5), expected_east, expected_north],
            atol=2e-6,
            rtol=0,
        ):
            raise ValueError("FUS sky centers and array coordinates disagree (check rotation)")
        if cell_vertices[beam_id][0] != cell_vertices[beam_id][-1]:
            raise ValueError("FUS assignment contours must be closed")
        east_west, north_south = _project_az_el(azimuth, altitude)
        beams.append(
            FovBeam(
                beam_id=beam_id,
                ix_ew=ix,
                iy_ns=iy,
                center_east_west_deg=east_west,
                center_north_south_deg=north_south,
                polygon_ew_ns_deg=cell_vertices[beam_id],
            )
        )

    l_centers = [_STEP_EW * (ix - 7.5) for ix in range(_BEAMS_PER_AXIS)]
    m_centers = [_STEP_NS * (iy - 7.5) for iy in range(_BEAMS_PER_AXIS)]
    for row in centers:
        ix, iy = int(row["ix"]), int(row["iy"])
        if abs(float(row["l_array"]) - l_centers[ix]) > 1e-6 or abs(float(row["m_array"]) - m_centers[iy]) > 1e-6:
            raise ValueError("FUS model centers must form a regular direction-cosine grid")

    return FusBeamGrid(
        model=FovBeamModel(beams=beams),
        l_edges=_axis_edges(l_centers),
        m_edges=_axis_edges(m_centers),
    )
