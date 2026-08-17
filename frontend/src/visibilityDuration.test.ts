import { describe, expect, it } from 'vitest'

import type { VisibleInterval } from './types'
import {
  formatDuration,
  getLongestCommonVisibility,
  getVisibilityWindowBoundaryLabel,
} from './visibilityDuration'

function interval(overrides: Partial<VisibleInterval> = {}): VisibleInterval {
  return {
    start_time_utc: '2026-08-11T00:00:00Z',
    end_time_utc: '2026-08-11T00:15:00Z',
    peak_common_altitude_deg: 30,
    start_index: 0,
    end_index: 1,
    sample_count: 2,
    ...overrides,
  }
}

describe('common visibility duration', () => {
  it('formats minutes and hour-minute combinations in English', () => {
    expect(formatDuration(45)).toBe('45 min')
    expect(formatDuration(135)).toBe('2 hr 15 min')
    expect(formatDuration(120)).toBe('2 hr')
  })

  it('selects the longest elapsed span from the index difference and sample interval', () => {
    const result = getLongestCommonVisibility(
      [
        interval({ start_index: 0, end_index: 2, sample_count: 3 }),
        interval({ start_index: 4, end_index: 13, sample_count: 10 }),
      ],
      15,
      20,
    )

    expect(result?.elapsedMinutes).toBe(135)
    expect(result?.label).toBe('2 hr 15 min')
    expect(result?.interval.start_index).toBe(4)
  })

  it('keeps the first interval when multiple spans have equal duration', () => {
    const first = interval({ start_index: 1, end_index: 3, sample_count: 3 })
    const second = interval({ start_index: 7, end_index: 9, sample_count: 3 })

    expect(getLongestCommonVisibility([first, second], 15, 12)?.interval).toBe(first)
  })

  it('formats a single-point span as zero elapsed minutes', () => {
    const result = getLongestCommonVisibility(
      [interval({ start_index: 3, end_index: 3, sample_count: 1 })],
      15,
    )

    expect(result?.elapsedMinutes).toBe(0)
    expect(result?.label).toBe('0 min')
  })

  it('identifies when the longest interval reaches a calculation-window boundary', () => {
    expect(
      getVisibilityWindowBoundaryLabel(
        interval({ start_index: 0, end_index: 4, sample_count: 5 }),
        5,
      ),
    ).toBe('Reaches window boundary · outside window not calculated')
    expect(
      getVisibilityWindowBoundaryLabel(
        interval({ start_index: 2, end_index: 4, sample_count: 3 }),
        5,
      ),
    ).toBe('Reaches window boundary · outside window not calculated')
    expect(
      getVisibilityWindowBoundaryLabel(
        interval({ start_index: 1, end_index: 3, sample_count: 3 }),
        5,
      ),
    ).toBeNull()
  })

  it('keeps the boundary warning when one of the tied longest spans reaches it', () => {
    const first = interval({ start_index: 2, end_index: 4, sample_count: 3 })
    const tiedAtBoundary = interval({ start_index: 8, end_index: 10, sample_count: 3 })
    const result = getLongestCommonVisibility([first, tiedAtBoundary], 15, 11)

    expect(result?.interval).toBe(first)
    expect(result?.boundaryLabel).toBe('Reaches window boundary · outside window not calculated')
  })
})
