import type { VisibleInterval } from './types'

export const VISIBILITY_DURATION_NOTE =
  '연속 계산 샘플의 첫 시각과 마지막 시각 사이 경과 시간입니다. 샘플 사이 모든 순간과 시간창 밖의 가시성을 보장하지 않습니다.'

export interface LongestCommonVisibility {
  interval: VisibleInterval
  elapsedMinutes: number
  label: string
  boundaryLabel: string | null
}

export function getVisibilityWindowBoundaryLabel(
  interval: VisibleInterval,
  sampleCount: number,
) {
  const touchesStart = interval.start_index === 0
  const touchesEnd = interval.end_index === sampleCount - 1

  if (touchesStart || touchesEnd) return '창 경계 도달 · 창 밖은 미계산'
  return null
}

export function formatKoreanDuration(totalMinutes: number) {
  const safeMinutes = Math.max(0, totalMinutes)
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes - hours * 60
  const minuteLabel = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)

  if (hours === 0) return `${minuteLabel}분`
  if (minutes === 0) return `${hours}시간`
  return `${hours}시간 ${minuteLabel}분`
}

export function getLongestCommonVisibility(
  intervals: VisibleInterval[],
  stepMinutes: number,
  sampleCount?: number,
): LongestCommonVisibility | null {
  if (intervals.length === 0) return null

  const safeStepMinutes = Number.isFinite(stepMinutes) && stepMinutes > 0 ? stepMinutes : 0
  let longestInterval = intervals[0]
  let longestMinutes =
    Math.max(0, longestInterval.end_index - longestInterval.start_index) * safeStepMinutes

  for (let index = 1; index < intervals.length; index += 1) {
    const interval = intervals[index]
    const elapsedMinutes =
      Math.max(0, interval.end_index - interval.start_index) * safeStepMinutes

    // Strict comparison keeps the first interval when multiple spans tie.
    if (elapsedMinutes > longestMinutes) {
      longestInterval = interval
      longestMinutes = elapsedMinutes
    }
  }

  const isSingleSample =
    longestInterval.sample_count <= 1 || longestInterval.start_index === longestInterval.end_index
  const boundaryLabel = Number.isInteger(sampleCount)
    ? intervals.reduce<string | null>((warning, interval) => {
        if (warning) return warning
        const elapsedMinutes =
          Math.max(0, interval.end_index - interval.start_index) * safeStepMinutes
        if (elapsedMinutes !== longestMinutes) return null
        return getVisibilityWindowBoundaryLabel(interval, sampleCount as number)
      }, null)
    : null

  return {
    interval: longestInterval,
    elapsedMinutes: longestMinutes,
    label: isSingleSample ? '단일 샘플' : formatKoreanDuration(longestMinutes),
    boundaryLabel,
  }
}
