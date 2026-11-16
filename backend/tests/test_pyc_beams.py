"""PYC hypothesis: server event cross-checks and EW-only strip geometry."""

import numpy as np

from app.pyc_beams import get_pyc_fan_beams


def test_five_supplied_crab_events_match_hypothesis():
    # From validation/pyc_crab_events.csv; this does not confirm the FPGA setup.
    assert get_pyc_fan_beams().beam_ids(
        np.array([73.79, 73.08, 68.34, 74.17, 69.43]),
        np.array([198.51, 205.83, 229.26, 167.23, 225.51]),
    ).tolist() == [6, 5, 2, 9, 2]


def test_fan_assignment_has_no_ns_cutoff_and_rejects_outside_horizon():
    assert get_pyc_fan_beams().beam_ids(
        np.array([90, 60, 60, 0, 0, 60, 60, -0.01, 91, np.nan]),
        np.array([0, 0, 180, 0, 180, 90, 270, 0, 0, 0]),
    ).tolist() == [8, 7, 8, 7, 8, -1, -1, -1, -1, -1]


def test_all_strip_interiors_and_closed_boundaries():
    step = 299792458.0 / 400e6 / 16
    # Every EW interior at three NS positions, including outside the FUS grid.
    lp = np.tile((np.arange(16) - 7.5) * step, 3)
    mp = np.repeat([-0.85, 0, 0.85], 16)
    # Western/eastern outer edges, an inner tie and just-outside positions.
    lp = np.append(lp, [-8 * step, 8 * step, 0, -8 * step - 1e-7, 8 * step + 1e-7])
    mp = np.append(mp, [0, 0, 0, 0, 0])
    rotation = np.deg2rad(-0.23)
    east = lp * np.cos(rotation) - mp * np.sin(rotation)
    north = lp * np.sin(rotation) + mp * np.cos(rotation)
    altitude = np.rad2deg(np.arccos(np.hypot(east, north)))
    azimuth = np.rad2deg(np.arctan2(east, north)) % 360
    assert get_pyc_fan_beams().beam_ids(altitude, azimuth).tolist() == list(range(16)) * 3 + [0, 15, 8, -1, -1]


def test_supplied_contours_preserve_rotation_and_undefined_centres():
    model = get_pyc_fan_beams().model
    assert model.evidence_status == "hypothesis"
    assert model.validated_through_utc is None
    for beam in model.beams:
        assert beam.center_east_west_deg is None
        assert beam.center_north_south_deg is None
        polygon = np.array(beam.polygon_ew_ns_deg)
        assert len(polygon) == 121
        assert np.array_equal(polygon[0], polygon[-1])
        assert np.sum(polygon[:-1, 0] * polygon[1:, 1] - polygon[1:, 0] * polygon[:-1, 1]) > 0
        assert np.max(np.hypot(polygon[:, 0], polygon[:, 1])) > 89.999
        azimuth = np.arctan2(polygon[:, 0], polygon[:, 1])
        zenith_distance = np.deg2rad(np.hypot(polygon[:, 0], polygon[:, 1]))
        # Inverse rotation must return every contour to its own EW strip.
        lp = np.sin(zenith_distance) * np.sin(azimuth + np.deg2rad(-0.23))
        step = 299792458.0 / 400e6 / 16
        assert np.min(lp) >= (beam.beam_id - 8) * step - 2e-6
        assert np.max(lp) <= (beam.beam_id - 7) * step + 2e-6
