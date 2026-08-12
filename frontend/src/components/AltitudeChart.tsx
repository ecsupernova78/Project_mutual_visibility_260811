import { useId, useState, type PointerEvent } from 'react'

import type { VisibilityTarget } from '../types'
import { getSiteChartStyle } from './chartStyles'

interface AltitudeChartProps {
  target: VisibilityTarget
  times: string[]
  minimumAltitude: number
}

const WIDTH = 920
const HEIGHT = 382
const MARGIN = { top: 24, right: 24, bottom: 54, left: 58 }
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom
const Y_MIN = -90
const Y_MAX = 90
const Y_TICKS = [-90, -60, -30, 0, 30, 60, 90]
function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function formatUtcTick(iso: string, includeDate = false) {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  return includeDate ? `${month}.${day} ${hour}:${minute}` : `${hour}:${minute}`
}

function getTickIndexes(length: number, targetCount = 6) {
  if (length <= 1) return [0]
  const count = Math.min(targetCount, length)
  return Array.from(
    new Set(
      Array.from({ length: count }, (_, index) =>
        Math.round((index * (length - 1)) / (count - 1)),
      ),
    ),
  )
}

function getVisibleRuns(mask: boolean[]) {
  const runs: Array<[number, number]> = []
  let start: number | null = null

  mask.forEach((isVisible, index) => {
    if (isVisible && start === null) start = index
    if (start !== null && (!isVisible || index === mask.length - 1)) {
      runs.push([start, isVisible && index === mask.length - 1 ? index : index - 1])
      start = null
    }
  })

  return runs
}

export function AltitudeChart({
  target,
  times,
  minimumAltitude,
}: AltitudeChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const rawId = useId()
  const patternId = `visible-${rawId.replace(/:/g, '')}`
  const pointCount = times.length
  const x = (index: number) =>
    MARGIN.left + (pointCount <= 1 ? 0 : (index / (pointCount - 1)) * PLOT_WIDTH)
  const y = (altitude: number) =>
    MARGIN.top + ((Y_MAX - clamp(altitude, Y_MIN, Y_MAX)) / (Y_MAX - Y_MIN)) * PLOT_HEIGHT

  const paths = target.location_series.map((series) => {
    let drawing = false
    return series.altitudes_deg
      .slice(0, pointCount)
      .map((altitude, index) => {
        if (!Number.isFinite(altitude)) {
          drawing = false
          return ''
        }
        const command = drawing ? 'L' : 'M'
        drawing = true
        return `${command}${x(index).toFixed(2)},${y(altitude).toFixed(2)}`
      })
      .join(' ')
  })

  const visibleRuns = getVisibleRuns(target.simultaneous_mask.slice(0, pointCount))
  const xTickIndexes = getTickIndexes(pointCount)
  const thresholdY = y(minimumAltitude)

  const moveToIndex = (clientX: number, element: SVGRectElement) => {
    const bounds = element.getBoundingClientRect()
    if (!bounds.width || pointCount === 0) return
    const svgX = ((clientX - bounds.left) / bounds.width) * WIDTH
    const ratio = clamp((svgX - MARGIN.left) / PLOT_WIDTH, 0, 1)
    setActiveIndex(Math.round(ratio * Math.max(pointCount - 1, 0)))
  }

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    moveToIndex(event.clientX, event.currentTarget)
  }

  if (pointCount === 0 || target.location_series.length === 0) {
    return (
      <div className="chart-empty" role="status">
        그래프로 표시할 고도 데이터가 없습니다.
      </div>
    )
  }

  const safeActiveIndex = activeIndex === null ? null : clamp(activeIndex, 0, pointCount - 1)
  const activeX = safeActiveIndex === null ? null : x(safeActiveIndex)
  const tooltipX = activeX !== null && activeX > WIDTH - 245 ? activeX - 214 : (activeX ?? 0) + 12
  const tooltipVisible = safeActiveIndex !== null

  return (
    <div className="altitude-chart">
      <div className="chart-legend" aria-label="그래프 범례">
        {target.location_series.map((series, index) => (
          <span className="legend-item" key={series.location_id}>
            <span
              className="legend-line"
              style={{ '--legend-color': getSiteChartStyle(series.location_id, index).color } as React.CSSProperties}
              data-dash={getSiteChartStyle(series.location_id, index).kind}
              aria-hidden="true"
            />
            {series.location_name}
          </span>
        ))}
        <span className="legend-item">
          <span className="legend-threshold" aria-hidden="true" />
          최소 고도 {minimumAltitude}°
        </span>
        <span className="legend-item">
          <span className="legend-window" aria-hidden="true" />
          동시 가시 샘플 구간
        </span>
      </div>

      <div className="chart-frame">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`${patternId}-title ${patternId}-description`}
        >
          <title id={`${patternId}-title`}>{target.name} 시간–고도 그래프</title>
          <desc id={`${patternId}-description`}>
            UTC 시각에 따른 {target.location_series.length}개 관측지의 기하학적 고도와 최소 고도 {minimumAltitude}도를
            비교합니다. 음수 고도는 지평선 아래를 뜻합니다.
          </desc>
          <defs>
            <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M0 8 8 0" stroke="#7de1ca" strokeOpacity=".13" strokeWidth="2" />
            </pattern>
            <clipPath id={`${patternId}-clip`}>
              <rect
                x={MARGIN.left}
                y={MARGIN.top}
                width={PLOT_WIDTH}
                height={PLOT_HEIGHT}
              />
            </clipPath>
          </defs>

          <g className="chart-grid">
            {Y_TICKS.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? 'horizon-line' : 'grid-line'}
                />
                <text x={MARGIN.left - 12} y={y(tick) + 4} textAnchor="end">
                  {tick}°
                </text>
              </g>
            ))}
            {xTickIndexes.map((index) => (
              <g key={index}>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={MARGIN.top}
                  y2={HEIGHT - MARGIN.bottom}
                  className="grid-line vertical"
                />
                <text x={x(index)} y={HEIGHT - MARGIN.bottom + 24} textAnchor="middle">
                  {formatUtcTick(times[index], index === 0 || index === pointCount - 1)}
                </text>
              </g>
            ))}
          </g>

          <g clipPath={`url(#${patternId}-clip)`}>
            {visibleRuns.map(([start, end]) => {
              const halfStep = pointCount > 1 ? PLOT_WIDTH / (pointCount - 1) / 2 : 0
              const startX = Math.max(MARGIN.left, x(start) - halfStep)
              const endX = Math.min(WIDTH - MARGIN.right, x(end) + halfStep)
              return (
                <rect
                  key={`${start}-${end}`}
                  x={startX}
                  y={MARGIN.top}
                  width={Math.max(endX - startX, 2)}
                  height={PLOT_HEIGHT}
                  fill={`url(#${patternId})`}
                  className="visibility-window"
                />
              )
            })}

            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={thresholdY}
              y2={thresholdY}
              className="threshold-line"
            />

            {paths.map((path, index) => (
              <path
                key={target.location_series[index].location_id}
                d={path}
                fill="none"
                stroke={getSiteChartStyle(target.location_series[index].location_id, index).color}
                strokeWidth="2.8"
                strokeDasharray={getSiteChartStyle(target.location_series[index].location_id, index).dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="altitude-line"
              />
            ))}

            {activeX !== null && (
              <line
                x1={activeX}
                x2={activeX}
                y1={MARGIN.top}
                y2={HEIGHT - MARGIN.bottom}
                className="cursor-line"
              />
            )}
          </g>

          <text
            x={17}
            y={MARGIN.top + PLOT_HEIGHT / 2}
            textAnchor="middle"
            transform={`rotate(-90 17 ${MARGIN.top + PLOT_HEIGHT / 2})`}
            className="axis-title"
          >
            기하학적 고도
          </text>
          <text
            x={MARGIN.left + PLOT_WIDTH / 2}
            y={HEIGHT - 6}
            textAnchor="middle"
            className="axis-title"
          >
            시각 (UTC)
          </text>

          {tooltipVisible && safeActiveIndex !== null && activeX !== null && (
            <g className="chart-tooltip" pointerEvents="none">
              {target.location_series.map((series, index) => {
                const altitude = series.altitudes_deg[safeActiveIndex]
                return Number.isFinite(altitude) ? (
                  <circle
                    key={series.location_id}
                    cx={activeX}
                    cy={y(altitude)}
                    r="5"
                    fill={getSiteChartStyle(series.location_id, index).color}
                    stroke="#07111f"
                    strokeWidth="2"
                  />
                ) : null
              })}
              <rect
                x={tooltipX}
                y={32}
                width="202"
                height={46 + target.location_series.length * 21}
                rx="10"
              />
              <text x={tooltipX + 13} y={54} className="tooltip-time">
                {formatUtcTick(times[safeActiveIndex], true)} UTC
              </text>
              {target.location_series.map((series, index) => (
                <text
                  key={series.location_id}
                  x={tooltipX + 13}
                  y={78 + index * 21}
                  fill={getSiteChartStyle(series.location_id, index).color}
                  className="tooltip-value"
                >
                  {series.location_name}: {series.altitudes_deg[safeActiveIndex]?.toFixed(1) ?? '—'}°
                </text>
              ))}
            </g>
          )}

          <rect
            x={MARGIN.left}
            y={MARGIN.top}
            width={PLOT_WIDTH}
            height={PLOT_HEIGHT}
            fill="transparent"
            aria-hidden="true"
            onPointerMove={handlePointerMove}
            onPointerLeave={() => setActiveIndex(null)}
            className="chart-hit-area"
          />
        </svg>
      </div>

      <label className="chart-scrubber">
        <span>시간 샘플 탐색</span>
        <input
          type="range"
          min={0}
          max={pointCount - 1}
          step={1}
          value={safeActiveIndex ?? 0}
          aria-label="시간 샘플 탐색"
          aria-valuetext={`${formatUtcTick(times[safeActiveIndex ?? 0], true)} UTC`}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onChange={(event) => setActiveIndex(Number(event.currentTarget.value))}
        />
        <output>{formatUtcTick(times[safeActiveIndex ?? 0], true)} UTC</output>
      </label>

      <p className="chart-hint">그래프를 가리키거나 시간 탐색 슬라이더로 샘플 값을 확인하세요.</p>

      <table className="sr-only">
        <caption>{target.name} 시간별 고도 데이터, UTC 기준</caption>
        <thead>
          <tr>
            <th>UTC 시각</th>
            {target.location_series.map((series) => (
              <th key={series.location_id}>{series.location_name} 고도</th>
            ))}
            <th>동시 가시 샘플</th>
          </tr>
        </thead>
        <tbody>
          {times.map((time, index) => (
            <tr key={time}>
              <td>{time}</td>
              {target.location_series.map((series) => (
                <td key={series.location_id}>{series.altitudes_deg[index]}도</td>
              ))}
              <td>{target.simultaneous_mask[index] ? '예' : '아니요'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
