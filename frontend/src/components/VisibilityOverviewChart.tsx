import { useId, useState, type CSSProperties, type PointerEvent } from 'react'

import type { VisibilityTarget } from '../types'
import { getSiteChartStyle, getTargetColor } from './chartStyles'

interface VisibilityOverviewChartProps {
  targets: VisibilityTarget[]
  times: string[]
  centerTime: string
  minimumAltitude: number
}

const WIDTH = 920
const HEIGHT = 430
const MARGIN = { top: 28, right: 24, bottom: 58, left: 58 }
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

function nearestTimeIndex(times: string[], targetTime: string) {
  const target = new Date(targetTime).getTime()
  if (!Number.isFinite(target) || times.length === 0) return 0
  return times.reduce((nearest, time, index) => {
    const distance = Math.abs(new Date(time).getTime() - target)
    const nearestDistance = Math.abs(new Date(times[nearest]).getTime() - target)
    return distance < nearestDistance ? index : nearest
  }, 0)
}

function commonAltitude(target: VisibilityTarget, index: number) {
  const values = target.location_series
    .map((series) => series.altitudes_deg[index])
    .filter(Number.isFinite)
  return values.length === target.location_series.length ? Math.min(...values) : null
}

export function VisibilityOverviewChart({
  targets,
  times,
  centerTime,
  minimumAltitude,
}: VisibilityOverviewChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [isTableOpen, setIsTableOpen] = useState(false)
  const rawId = useId()
  const chartId = `overview-${rawId.replace(/:/g, '')}`
  const pointCount = times.length
  const centerIndex = nearestTimeIndex(times, centerTime)
  const x = (index: number) =>
    MARGIN.left + (pointCount <= 1 ? 0 : (index / (pointCount - 1)) * PLOT_WIDTH)
  const y = (altitude: number) =>
    MARGIN.top + ((Y_MAX - clamp(altitude, Y_MIN, Y_MAX)) / (Y_MAX - Y_MIN)) * PLOT_HEIGHT

  const paths = targets.flatMap((target) =>
    target.location_series.map((series, siteIndex) => {
      let drawing = false
      const path = series.altitudes_deg
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
      return { target, series, siteIndex, path }
    }),
  )

  const xTickIndexes = getTickIndexes(pointCount)
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

  if (pointCount === 0 || targets.length === 0) {
    return <div className="chart-empty">플롯할 천체를 하나 이상 선택하세요.</div>
  }

  const safeActiveIndex = activeIndex === null ? null : clamp(activeIndex, 0, pointCount - 1)
  const activeX = safeActiveIndex === null ? null : x(safeActiveIndex)
  const tooltipWidth = 220
  const tooltipX = activeX !== null && activeX > WIDTH - 265 ? activeX - tooltipWidth - 12 : (activeX ?? 0) + 12
  const tooltipHeight = 45 + targets.length * 20
  const activeSummary = safeActiveIndex === null
    ? `${formatUtcTick(times[centerIndex], true)} UTC 중심 샘플`
    : `${formatUtcTick(times[safeActiveIndex], true)} UTC, ${targets
        .map((target) => {
          const altitude = commonAltitude(target, safeActiveIndex)
          return `${target.name} 공통 고도 ${altitude?.toFixed(1) ?? '자료 없음'}도`
        })
        .join(', ')}`

  return (
    <div className="overview-chart">
      <div className="overview-legends">
        <div className="chart-legend target-color-legend" aria-label="천체 색상 범례">
          <span className="legend-label">천체</span>
          {targets.map((target, index) => (
            <span className="legend-item" key={target.id}>
              <span
                className="legend-color-dot"
                style={{ '--legend-color': getTargetColor(target.id, index) } as CSSProperties}
                aria-hidden="true"
              />
              {target.name}
            </span>
          ))}
        </div>
        <div className="chart-legend site-pattern-legend" aria-label="관측지 선 모양 범례">
          <span className="legend-label">관측지</span>
          {targets[0]?.location_series.map((series, index) => (
            <span className="legend-item" key={series.location_id}>
              <span
                className="legend-site-line"
                data-dash={getSiteChartStyle(series.location_id, index).kind}
                aria-hidden="true"
              />
              {series.location_name}
            </span>
          ))}
          <span className="legend-item">
            <span className="legend-center-line" aria-hidden="true" />
            중심 UTC 참조선
          </span>
          <span className="legend-item">
            <span className="legend-threshold" aria-hidden="true" />
            최소 고도 {minimumAltitude}°
          </span>
        </div>
      </div>

      <div className="chart-frame overview-chart-frame">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`${chartId}-title`}
          aria-describedby={`${chartId}-description`}
        >
          <title id={`${chartId}-title`}>공통 가시 천체 전체 시간–고도 개요</title>
          <desc id={`${chartId}-description`}>
            선택한 전체 시간창의 하나 이상의 계산 샘플에서 모든 선택 관측지의 고도가 동시에
            최소 고도 {minimumAltitude}도 이상인 천체 {targets.length}개의 기하학적 고도를 비교합니다.
            색은 천체, 선 모양은 관측지를 구분하며 세로 참조선은 중심 UTC, 붉은 점선은 최소 고도입니다.
          </desc>
          <clipPath id={`${chartId}-clip`}>
            <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_WIDTH} height={PLOT_HEIGHT} />
          </clipPath>

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
                <text x={MARGIN.left - 12} y={y(tick) + 4} textAnchor="end">{tick}°</text>
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

          <g clipPath={`url(#${chartId}-clip)`}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={y(minimumAltitude)}
              y2={y(minimumAltitude)}
              className="threshold-line"
            />
            {paths.map(({ target, series, siteIndex, path }) => (
              <path
                key={`${target.id}-${series.location_id}`}
                d={path}
                fill="none"
                stroke={getTargetColor(target.id)}
                strokeWidth="2.15"
                strokeDasharray={getSiteChartStyle(series.location_id, siteIndex).dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="overview-altitude-line"
              />
            ))}
            <line
              x1={x(centerIndex)}
              x2={x(centerIndex)}
              y1={MARGIN.top}
              y2={HEIGHT - MARGIN.bottom}
              className="center-time-line"
            />
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
          <text x={MARGIN.left + PLOT_WIDTH / 2} y={HEIGHT - 7} textAnchor="middle" className="axis-title">
            시각 (UTC)
          </text>

          {safeActiveIndex !== null && activeX !== null && (
            <g className="chart-tooltip overview-tooltip" pointerEvents="none">
              <rect x={tooltipX} y={35} width={tooltipWidth} height={tooltipHeight} rx="10" />
              <text x={tooltipX + 13} y={57} className="tooltip-time">
                {formatUtcTick(times[safeActiveIndex], true)} UTC
              </text>
              {targets.map((target, index) => {
                const altitude = commonAltitude(target, safeActiveIndex)
                return (
                  <text
                    key={target.id}
                    x={tooltipX + 13}
                    y={80 + index * 20}
                    fill={getTargetColor(target.id, index)}
                    className="tooltip-value"
                  >
                    {target.name}: 공통 {altitude?.toFixed(1) ?? '—'}°
                  </text>
                )
              })}
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
        <span>전체 천체 시간 샘플 탐색</span>
        <input
          type="range"
          min={0}
          max={pointCount - 1}
          step={1}
          value={safeActiveIndex ?? centerIndex}
          aria-label="전체 천체 시간 샘플 탐색"
          aria-valuetext={activeSummary}
          onFocus={() => setActiveIndex((current) => current ?? centerIndex)}
          onChange={(event) => setActiveIndex(Number(event.currentTarget.value))}
        />
        <output>{formatUtcTick(times[safeActiveIndex ?? centerIndex], true)} UTC</output>
      </label>

      <p className="chart-hint">
        색은 천체, 선 모양은 관측지를 뜻합니다. 시간 탐색 슬라이더로 공통 고도를 확인하세요.
      </p>

      <details
        className="overview-data-table"
        onToggle={(event) => setIsTableOpen(event.currentTarget.open)}
      >
        <summary>전체 수치 데이터 표</summary>
        {isTableOpen && <div>
          <table>
            <caption>공통 가시 천체의 관측지별 시간–고도 데이터, UTC 기준</caption>
            <thead>
              <tr>
                <th scope="col">UTC 시각</th>
                {targets.flatMap((target) =>
                  target.location_series.map((series) => (
                    <th scope="col" key={`${target.id}-${series.location_id}`}>
                      {target.name} · {series.location_name}
                    </th>
                  )),
                )}
                {targets.map((target) => (
                  <th scope="col" key={`${target.id}-common`}>{target.name} 공통 가시</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {times.map((time, timeIndex) => (
                <tr key={time}>
                  <th scope="row">{time}</th>
                  {targets.flatMap((target) =>
                    target.location_series.map((series) => (
                      <td key={`${target.id}-${series.location_id}`}>
                        {series.altitudes_deg[timeIndex]?.toFixed(2) ?? '—'}°
                      </td>
                    )),
                  )}
                  {targets.map((target) => (
                    <td key={`${target.id}-common`}>
                      {target.simultaneous_mask[timeIndex] ? '예' : '아니요'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>}
      </details>
    </div>
  )
}
