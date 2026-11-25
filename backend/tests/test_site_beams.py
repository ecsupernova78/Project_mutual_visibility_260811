"""Supplied LTN/OGW model geometry and assignment semantics."""

import numpy as np

from app.site_beams import get_ltn_beam_grid, get_ogw_beam_grid


def test_all_supplied_centres_keep_their_numbered_cells() -> None:
    for factory, count, status, rotation in (
        (get_ltn_beam_grid, 64, "partially_validated", 0.5),
        (get_ogw_beam_grid, 32, "hypothesis", -5.5),
    ):
        grid = factory()
        model = grid.model
        assert len(model.beams) == count
        assert model.evidence_status == status
        assert model.rotation_applied_deg == rotation
        assert model.source_package == "BeamViz_SiteBeams_261113_new"
        assert all(beam.polygon_ew_ns_deg[0] == beam.polygon_ew_ns_deg[-1] for beam in model.beams)
        assert [beam.beam_id for beam in model.beams] == list(range(count))

        east = np.array([beam.center_east_west_deg for beam in model.beams])
        north = np.array([beam.center_north_south_deg for beam in model.beams])
        azimuth = np.rad2deg(np.arctan2(east, north)) % 360
        altitude = 90 - np.hypot(east, north)
        assert grid.beam_ids(altitude, azimuth).tolist() == list(range(count))


def test_ltn_outer_edges_and_ogw_open_north_south_cells() -> None:
    ltn = get_ltn_beam_grid()
    ogw = get_ogw_beam_grid()
    assert ltn.beam_ids(np.array([-1.0, 20.0, 20.0]), np.array([0.0, 0.0, 90.0])).tolist() == [-1, -1, -1]
    assert ogw.beam_ids(np.array([-1.0, 30.0, 30.0]), np.array([0.0, 5.5, 90.0])).tolist() == [-1, 24, -1]
    assert np.isneginf(ogw.m_edges[0])
    assert np.isposinf(ogw.m_edges[-1])
