import { describe, expect, it } from 'vitest'

import type { VisibleInterval } from './types'
import {
  formatKoreanDuration,
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

describe('공통 가시 구간 길이', () => {
  it('분과 시·분 조합을 한국어로 표시한다', () => {
    expect(formatKoreanDuration(45)).toBe('45분')
    expect(formatKoreanDuration(135)).toBe('2시간 15분')
    expect(formatKoreanDuration(120)).toBe('2시간')
  })

  it('인덱스 차이와 계산 간격으로 가장 긴 경과 길이를 선택한다', () => {
    const result = getLongestCommonVisibility(
      [
        interval({ start_index: 0, end_index: 2, sample_count: 3 }),
        interval({ start_index: 4, end_index: 13, sample_count: 10 }),
      ],
      15,
      20,
    )

    expect(result?.elapsedMinutes).toBe(135)
    expect(result?.label).toBe('2시간 15분')
    expect(result?.interval.start_index).toBe(4)
  })

  it('길이가 같은 구간은 입력 순서상 첫 구간을 안정적으로 유지한다', () => {
    const first = interval({ start_index: 1, end_index: 3, sample_count: 3 })
    const second = interval({ start_index: 7, end_index: 9, sample_count: 3 })

    expect(getLongestCommonVisibility([first, second], 15, 12)?.interval).toBe(first)
  })

  it('가시 샘플 하나를 0분으로 과장하지 않고 단일 샘플로 표시한다', () => {
    const result = getLongestCommonVisibility(
      [interval({ start_index: 3, end_index: 3, sample_count: 1 })],
      15,
    )

    expect(result?.elapsedMinutes).toBe(0)
    expect(result?.label).toBe('단일 샘플')
  })

  it('가장 긴 구간이 계산 시간창 경계에 닿는지 구분한다', () => {
    expect(
      getVisibilityWindowBoundaryLabel(
        interval({ start_index: 0, end_index: 4, sample_count: 5 }),
        5,
      ),
    ).toBe('창 경계 도달 · 창 밖은 미계산')
    expect(
      getVisibilityWindowBoundaryLabel(
        interval({ start_index: 2, end_index: 4, sample_count: 3 }),
        5,
      ),
    ).toBe('창 경계 도달 · 창 밖은 미계산')
    expect(
      getVisibilityWindowBoundaryLabel(
        interval({ start_index: 1, end_index: 3, sample_count: 3 }),
        5,
      ),
    ).toBeNull()
  })

  it('최장 길이 동률 중 하나가 창 경계에 닿으면 경고를 유지한다', () => {
    const first = interval({ start_index: 2, end_index: 4, sample_count: 3 })
    const tiedAtBoundary = interval({ start_index: 8, end_index: 10, sample_count: 3 })
    const result = getLongestCommonVisibility([first, tiedAtBoundary], 15, 11)

    expect(result?.interval).toBe(first)
    expect(result?.boundaryLabel).toBe('창 경계 도달 · 창 밖은 미계산')
  })
})
