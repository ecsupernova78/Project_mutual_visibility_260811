"""Independent reference directions and recorded Crab event from the server package."""

import numpy as np
import pytest

from app.fus_beams import get_fus_beam_grid


def test_verified_reference_directions_and_crab_event():
    grid = get_fus_beam_grid()
    # Package validation/reference_directions.csv and fus_crab_20260319_event.csv.
    # East/west outside-grid nearest trigger IDs must NOT count as coverage.
    assert grid.beam_ids(
        np.array([90, 60, 60, 60, 60, 45, 45, -1, 83.56]),
        np.array([0, 0, 90, 180, 270, 0, 180, 0, 113.725]),
    ).tolist() == [136, 215, -1, 40, -1, 247, 8, -1, 122]


@pytest.mark.parametrize("beam_id,azimuth", [(0, 209.5651), (15, 156.4349), (240, 336.4349), (255, 29.5651)])
def test_corner_sky_coordinates_are_not_rotated_twice(beam_id, azimuth):
    beam = get_fus_beam_grid().model.beams[beam_id]
    actual_az = np.rad2deg(np.arctan2(beam.center_east_west_deg, beam.center_north_south_deg)) % 360
    actual_el = 90 - np.hypot(beam.center_east_west_deg, beam.center_north_south_deg)
    assert actual_az == pytest.approx(azimuth, abs=0.001)
    assert actual_el == pytest.approx(38.2262, abs=0.001)


def test_closed_outer_edges_internal_ties_and_outside_coverage():
    grid = get_fus_beam_grid()
    # Four outer corners and the internal zenith tie; tiny outward moves excluded.
    l_array = np.array(
        [
            grid.l_edges[0],
            grid.l_edges[-1],
            grid.l_edges[0],
            grid.l_edges[-1],
            0,
            grid.l_edges[-1] + 1e-7,
            grid.l_edges[0] - 1e-7,
        ]
    )
    m_array = np.array([grid.m_edges[0], grid.m_edges[0], grid.m_edges[-1], grid.m_edges[-1], 0, 0, 0])
    r = np.deg2rad(-3)
    east, north = l_array * np.cos(r) - m_array * np.sin(r), l_array * np.sin(r) + m_array * np.cos(r)
    azimuth = np.rad2deg(np.arctan2(east, north)) % 360
    altitude = np.rad2deg(np.arccos(np.hypot(east, north)))
    assert grid.beam_ids(altitude, azimuth).tolist() == [0, 15, 240, 255, 136, -1, -1]


def test_contours_are_closed_and_counterclockwise():
    for beam in get_fus_beam_grid().model.beams:
        polygon = np.array(beam.polygon_ew_ns_deg)
        assert len(polygon) == 49
        assert polygon[0].tolist() == polygon[-1].tolist()
        area = np.sum(polygon[:-1, 0] * polygon[1:, 1] - polygon[1:, 0] * polygon[:-1, 1]) / 2
        assert area > 0
