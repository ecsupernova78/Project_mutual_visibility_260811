"""Provisional FUS digital-beam assignment cells supplied by the user.

The CSV polygons partition local direction-cosine space; they are not measured
beam-power contours. No additional array rotation is applied because the sign
of the published 3-degree misalignment is not established for these CSVs.
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
_POINTS_PER_CELL = 16


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
        ix = np.searchsorted(self.l_edges, l_east, side="right") - 1
        iy = np.searchsorted(self.m_edges, m_north, side="right") - 1
        inside = (altitude >= 0) & (ix >= 0) & (ix < _BEAMS_PER_AXIS) & (iy >= 0) & (iy < _BEAMS_PER_AXIS)
        return np.where(inside, _BEAMS_PER_AXIS * iy + ix, -1).astype(int)


@lru_cache(maxsize=1)
def get_fus_beam_grid() -> FusBeamGrid:
    centers_path = _DATA_DIRECTORY / "FUS_beam_centers_model.csv"
    cells_path = _DATA_DIRECTORY / "FUS_beam_cells_model.csv"
    with centers_path.open(newline="", encoding="utf-8-sig") as handle:
        centers = list(csv.DictReader(handle))
    with cells_path.open(newline="", encoding="utf-8-sig") as handle:
        cells = list(csv.DictReader(handle))
    if len(centers) != _BEAM_COUNT or len(cells) != _BEAM_COUNT * _POINTS_PER_CELL:
        raise ValueError("FUS beam CSVs must contain 256 centers and 4096 boundary points")

    cell_vertices: list[list[tuple[float, float]]] = [[] for _ in range(_BEAM_COUNT)]
    for row_number, row in enumerate(cells):
        beam_id = int(row["beam"])
        point_number = int(row["pt_order"])
        if (
            row["site"] != "FUS"
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
        ix, iy = int(row["ix_EW"]), int(row["iy_NS"])
        if row["site"] != "FUS" or row["status"] != "MODEL" or int(row["beam"]) != beam_id:
            raise ValueError("FUS beam-center rows must be ordered and marked MODEL")
        if beam_id != _BEAMS_PER_AXIS * iy + ix:
            raise ValueError("FUS beam numbering does not match the supplied 16-by-16 model")
        azimuth, altitude = float(row["az_deg"]), float(row["el_deg"])
        if not (0 <= azimuth <= 360 and 0 <= altitude <= 90):
            raise ValueError("FUS beam-center coordinates must be above the horizon")
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

    l_centers = [float(centers[ix]["l_dircos_E"]) for ix in range(_BEAMS_PER_AXIS)]
    m_centers = [float(centers[iy * _BEAMS_PER_AXIS]["m_dircos_N"]) for iy in range(_BEAMS_PER_AXIS)]
    for row in centers:
        ix, iy = int(row["ix_EW"]), int(row["iy_NS"])
        if abs(float(row["l_dircos_E"]) - l_centers[ix]) > 1e-6 or abs(float(row["m_dircos_N"]) - m_centers[iy]) > 1e-6:
            raise ValueError("FUS model centers must form a regular direction-cosine grid")

    return FusBeamGrid(
        model=FovBeamModel(beams=beams),
        l_edges=_axis_edges(l_centers),
        m_edges=_axis_edges(m_centers),
    )
