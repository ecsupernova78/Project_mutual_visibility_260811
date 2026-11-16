"""LTN and OGW assignment-cell models from BeamViz_SiteBeams_261113_new.

The supplied sky coordinates already include each station's array rotation.
These polygons assign directions to model beams; they are not measured power,
FWHM, or sensitivity contours. OGW-32 beamforming remains unverified.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.models import FovBeam, FovBeamModel

_DATA_DIRECTORY = Path(__file__).resolve().parent / "data" / "burstt_fov"
_N_EW = 16
_C_M_S = 299792458.0


@dataclass(frozen=True, slots=True)
class _SiteMode:
    site: str
    mode: str
    evidence_type: str
    rotation_deg: float
    n_ns: int
    ew_step: float
    ew_offset: float
    ns_centers: tuple[float, ...]
    ns_open_to_horizon: bool
    evidence_status: str
    note: str


_LTN = _SiteMode(
    site="LTN",
    mode="LTN_bf64_MODEL_b0ew-6.8_ref400MHz_theta_-11.3_-1.68_9.57_30.95",
    evidence_type="model_EW_validated_by_one_pulse_NS_from_operator_command",
    rotation_deg=0.5,
    n_ns=4,
    ew_step=_C_M_S / 400e6 / 16,
    ew_offset=-6.8,
    ns_centers=tuple(float(np.sin(np.deg2rad(value))) for value in (-11.3, -1.68, 9.57, 30.95)),
    ns_open_to_horizon=False,
    evidence_status="partially_validated",
    note=(
        "LTN 64-beam assignment model: EW numbering and 400 MHz grid agree with one "
        "PSR B0329+54 pulse on 2026-06-17; NS centres use the last documented "
        "four-angle operator command after 2026-07-18. The Sun-steered first NS "
        "beam changes with date, so this snapshot may not match another epoch. "
        "Cells are nearest-centre regions, not measured sensitivity or FWHM. "
        "Active-beam masks and the effective search band are unknown."
    ),
)

_OGW = _SiteMode(
    site="OGW",
    mode="OGW32_MODEL_b0ew-7.5_ref400MHz_ns2_BFM2default",
    evidence_type="model_from_config_and_code_defaults_unvalidated",
    rotation_deg=-26.9,
    n_ns=2,
    ew_step=_C_M_S / 400e6 / (16 * 0.833333),
    ew_offset=-7.5,
    ns_centers=(-_C_M_S / 300e6 / 8, _C_M_S / 300e6 / 8),
    ns_open_to_horizon=True,
    evidence_status="hypothesis",
    note=(
        "OGW-32 16-by-2 assignment model from array configuration and beamformer "
        "defaults only; operational beam count, steering, antenna positions, "
        "and trigger IDs are unverified. The documented 18 degree west tilt "
        "belongs to the older OGW-16 mode and is not applied here. NS cells "
        "extend to the horizon. Polygons are not measured sensitivity or FWHM."
    ),
)


def _project_az_el(az_deg: float, el_deg: float) -> tuple[float, float]:
    radius = 90.0 - el_deg
    azimuth = np.deg2rad(az_deg)
    return round(float(radius * np.sin(azimuth)), 4), round(float(radius * np.cos(azimuth)), 4)


def _edges(centers: np.ndarray, *, open_to_horizon: bool = False) -> np.ndarray:
    if len(centers) < 2 or not np.all(np.diff(centers) > 0):
        raise ValueError("beam centres must increase along each array axis")
    midpoints = (centers[:-1] + centers[1:]) / 2
    if open_to_horizon:
        return np.concatenate(([-np.inf], midpoints, [np.inf]))
    return np.concatenate(
        ([centers[0] - (centers[1] - centers[0]) / 2], midpoints, [centers[-1] + (centers[-1] - centers[-2]) / 2])
    )


@dataclass(frozen=True, slots=True)
class SiteBeamGrid:
    model: FovBeamModel
    l_edges: np.ndarray
    m_edges: np.ndarray
    rotation_deg: float
    n_ns: int

    def beam_ids(self, altitude_deg: np.ndarray, azimuth_deg: np.ndarray) -> np.ndarray:
        """Return model IDs or -1 outside cells/below the geometric horizon."""
        altitude = np.asarray(altitude_deg, dtype=float)
        azimuth = np.deg2rad(np.asarray(azimuth_deg, dtype=float))
        east = np.cos(np.deg2rad(altitude)) * np.sin(azimuth)
        north = np.cos(np.deg2rad(altitude)) * np.cos(azimuth)
        rotation = np.deg2rad(self.rotation_deg)
        l_array = east * np.cos(rotation) + north * np.sin(rotation)
        m_array = -east * np.sin(rotation) + north * np.cos(rotation)
        # searchsorted(right) assigns an exact shared edge to the east/north
        # cell, while the final outer edge remains in the last cell.
        ix = np.searchsorted(self.l_edges, l_array, side="right") - 1
        iy = np.searchsorted(self.m_edges, m_array, side="right") - 1
        inside = (
            np.isfinite(altitude)
            & np.isfinite(azimuth)
            & (altitude >= 0)
            & (altitude <= 90)
            & (l_array >= self.l_edges[0] - 1e-9)
            & (l_array <= self.l_edges[-1] + 1e-9)
            & (m_array >= self.m_edges[0] - 1e-9)
            & (m_array <= self.m_edges[-1] + 1e-9)
        )
        return np.where(inside, _N_EW * np.clip(iy, 0, self.n_ns - 1) + np.clip(ix, 0, 15), -1).astype(int)


def _load_grid(config: _SiteMode) -> SiteBeamGrid:
    with (_DATA_DIRECTORY / f"{config.site}_beam_centers_model.csv").open(newline="", encoding="utf-8-sig") as handle:
        centers = list(csv.DictReader(handle))
    with (_DATA_DIRECTORY / f"{config.site}_beam_cells_model.csv").open(newline="", encoding="utf-8-sig") as handle:
        vertices = list(csv.DictReader(handle))
    beam_count = _N_EW * config.n_ns
    if len(centers) != beam_count or not vertices:
        raise ValueError(f"{config.site} requires {beam_count} centers and nonempty cell polygons")

    polygons: list[list[tuple[float, float]]] = [[] for _ in range(beam_count)]
    for row in vertices:
        beam_id = int(row["beam_id"])
        if (
            row["site"] != config.site
            or row["mode"] != config.mode
            or row["evidence_type"] != config.evidence_type
            or row["boundary_type"] != "assignment_cell"
            or row["level_db"]
            or not 0 <= beam_id < beam_count
            or int(row["vertex_order"]) != len(polygons[beam_id])
        ):
            raise ValueError(f"{config.site} cell metadata or vertex order differs from the source model")
        azimuth, altitude = float(row["az_deg"]), float(row["el_deg"])
        if not (0 <= azimuth <= 360 and 0 <= altitude <= 90):
            raise ValueError(f"{config.site} cell vertex is outside the geometric sky")
        polygons[beam_id].append(_project_az_el(azimuth, altitude))

    beams: list[FovBeam] = []
    l_centers: list[float] = []
    m_centers: list[float] = []
    for beam_id, row in enumerate(centers):
        ix, iy = int(row["ix"]), int(row["iy"])
        if (
            row["site"] != config.site
            or row["mode"] != config.mode
            or row["evidence_type"] != config.evidence_type
            or row["enabled"] != ""
            or int(row["beam_id"]) != beam_id
            or beam_id != _N_EW * iy + ix
            or float(row["rotation_applied_deg"]) != config.rotation_deg
            or not 0 <= ix < _N_EW
            or not 0 <= iy < config.n_ns
        ):
            raise ValueError(f"{config.site} center metadata, rotation, or numbering changed")
        lp, mp = float(row["l_array"]), float(row["m_array"])
        if not np.allclose(
            [lp, mp],
            [config.ew_step * (ix + config.ew_offset), config.ns_centers[iy]],
            atol=2e-6,
            rtol=0,
        ):
            raise ValueError(f"{config.site} array coordinates differ from the documented model")
        azimuth, altitude = float(row["az_deg"]), float(row["el_deg"])
        rotation = np.deg2rad(config.rotation_deg)
        expected_east = lp * np.cos(rotation) - mp * np.sin(rotation)
        expected_north = lp * np.sin(rotation) + mp * np.cos(rotation)
        sky_east = np.cos(np.deg2rad(altitude)) * np.sin(np.deg2rad(azimuth))
        sky_north = np.cos(np.deg2rad(altitude)) * np.cos(np.deg2rad(azimuth))
        if not np.allclose([sky_east, sky_north], [expected_east, expected_north], atol=2e-6, rtol=0):
            raise ValueError(f"{config.site} sky and array coordinates disagree")
        if len(polygons[beam_id]) < 4 or polygons[beam_id][0] != polygons[beam_id][-1]:
            raise ValueError(f"{config.site} cell polygon must be closed")
        if iy == 0:
            l_centers.append(lp)
        if ix == 0:
            m_centers.append(mp)
        x, y = _project_az_el(azimuth, altitude)
        beams.append(
            FovBeam(
                beam_id=beam_id,
                ix_ew=ix,
                iy_ns=iy,
                center_east_west_deg=x,
                center_north_south_deg=y,
                polygon_ew_ns_deg=polygons[beam_id],
            )
        )

    return SiteBeamGrid(
        model=FovBeamModel(
            evidence_status=config.evidence_status,
            source_package="BeamViz_SiteBeams_261113_new",
            rotation_applied_deg=config.rotation_deg,
            validated_from_utc=None,
            validated_through_utc=None,
            note=config.note,
            beams=beams,
        ),
        l_edges=_edges(np.asarray(l_centers)),
        m_edges=_edges(np.asarray(m_centers), open_to_horizon=config.ns_open_to_horizon),
        rotation_deg=config.rotation_deg,
        n_ns=config.n_ns,
    )


@lru_cache(maxsize=1)
def get_ltn_beam_grid() -> SiteBeamGrid:
    return _load_grid(_LTN)


@lru_cache(maxsize=1)
def get_ogw_beam_grid() -> SiteBeamGrid:
    return _load_grid(_OGW)
