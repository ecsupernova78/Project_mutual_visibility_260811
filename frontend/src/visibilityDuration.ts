import type { VisibleInterval } from './types'

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

  if (touchesStart || touchesEnd) return 'Reaches window boundary · outside window not calculated'
  return null
}

export function formatDuration(totalMinutes: number) {
  const safeMinutes = Math.max(0, totalMinutes)
  const hours = Math.floor(safeMinutes / 60)
  const minutes = safeMinutes - hours * 60
  const minuteLabel = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)

  if (hours === 0) return `${minuteLabel} min`
  if (minutes === 0) return `${hours} hr`
  return `${hours} hr ${minuteLabel} min`
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
    label: formatDuration(longestMinutes),
    boundaryLabel,
  }
}
