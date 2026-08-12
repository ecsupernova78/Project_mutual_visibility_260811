from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np
import pytest

from app.visibility import _visible_intervals


def test_visible_intervals_preserve_sampled_run_boundaries_and_spans() -> None:
    step_minutes = 15
    start_time = datetime(2026, 8, 11, tzinfo=UTC)
    times = [start_time + timedelta(minutes=index * step_minutes) for index in range(7)]
    simultaneous_mask = np.array([True, False, True, True, True, False, True])
    common_altitudes = np.array([20.0, 1.0, 21.0, 25.0, 24.0, 2.0, 30.0])

    intervals = _visible_intervals(times, simultaneous_mask, common_altitudes)

    expected_runs = [
        (0, 0, 20.0),
        (2, 4, 25.0),
        (6, 6, 30.0),
    ]
    assert len(intervals) == len(expected_runs)

    for interval, (start_index, end_index, peak_altitude) in zip(
        intervals,
        expected_runs,
        strict=True,
    ):
        assert interval.start_index == start_index
        assert interval.end_index == end_index
        assert interval.start_time_utc == times[start_index]
        assert interval.end_time_utc == times[end_index]
        assert interval.sample_count == end_index - start_index + 1
        assert interval.peak_common_altitude_deg == peak_altitude
        assert (interval.end_time_utc - interval.start_time_utc).total_seconds() / 60 == pytest.approx(
            (interval.sample_count - 1) * step_minutes
        )


def test_visible_intervals_returns_empty_list_when_no_sample_is_visible() -> None:
    times = [
        datetime(2026, 8, 11, tzinfo=UTC),
        datetime(2026, 8, 11, 0, 15, tzinfo=UTC),
    ]

    intervals = _visible_intervals(
        times,
        np.array([False, False]),
        np.array([1.0, 2.0]),
    )

    assert intervals == []
