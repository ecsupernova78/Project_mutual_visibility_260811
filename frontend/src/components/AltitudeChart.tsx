import { useId, useRef, useState, type PointerEvent } from 'react'

import type { VisibilityTarget } from '../types'
import { getSiteChartStyle } from './chartStyles'
import { PlotExportControls } from './PlotExportControls'
import {
  fitSvgLegendLabel,
  layoutSvgLegendGrid,
  SVG_LEGEND_FONT_SIZE,
} from './svgLegendLayout'

interface AltitudeChartProps {
  target: VisibilityTarget
  times: string[]
  minimumAltitude: number
}

const WIDTH = 1040
const PLOT_HEIGHT = 344
const MARGIN = { top: 116, right: 40, bottom: 78, left: 92 }
const HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right
const Y_MIN = 0
const Y_MAX = 90
const Y_TICKS = [0, 15, 30, 45, 60, 75, 90]

interface DetailLegendEntry {
  key: string
  label: string
  kind: 'site' | 'threshold' | 'window'
  locationId?: string
  siteIndex?: number
}
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
  const svgRef = useRef<SVGSVGElement>(null)
  const rawId = useId()
  const patternId = `visible-${rawId.replace(/:/g, '')}`
  const pointCount = times.length
  const legendEntries: DetailLegendEntry[] = [
    ...target.location_series.map((series, index) => ({
      key: `site-${series.location_id}`,
      label: series.location_name,
      kind: 'site' as const,
      locationId: series.location_id,
      siteIndex: index,
    })),
    {
      key: 'altitude-threshold',
      label: `Altitude threshold ${minimumAltitude}°`,
      kind: 'threshold',
    },
    {
      key: 'common-visibility-window',
      label: 'Common visibility window',
      kind: 'window',
    },
  ]
  const legendLayout = layoutSvgLegendGrid(legendEntries, {
    startX: MARGIN.left,
    firstBaselineY: 58,
    availableWidth: PLOT_WIDTH,
  })
  const x = (index: number) =>
    MARGIN.left + (pointCount <= 1 ? 0 : (index / (pointCount - 1)) * PLOT_WIDTH)
  const y = (altitude: number) =>
    MARGIN.top + ((Y_MAX - altitude) / (Y_MAX - Y_MIN)) * PLOT_HEIGHT

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
        No altitude data are available to plot.
      </div>
    )
  }

  const safeActiveIndex = activeIndex === null ? null : clamp(activeIndex, 0, pointCount - 1)
  const activeX = safeActiveIndex === null ? null : x(safeActiveIndex)
  const tooltipX = activeX !== null && activeX > WIDTH - 245 ? activeX - 214 : (activeX ?? 0) + 12
  const tooltipY = MARGIN.top + 12
  const tooltipVisible = safeActiveIndex !== null

  return (
    <div className="altitude-chart">
      <PlotExportControls
        svgRef={svgRef}
        filename={`${target.name}-altitude-time-${times[0]}-${times.at(-1) ?? times[0]}`}
        plotLabel={`${target.name} altitude–time plot`}
      />

      <div className="chart-frame">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          role="img"
          aria-labelledby={`${patternId}-title ${patternId}-description`}
        >
          <title id={`${patternId}-title`}>{target.name} altitude–time chart</title>
          <desc id={`${patternId}-description`}>
            Altitude from 0 to 90 degrees in UTC for {target.location_series.length} observing {target.location_series.length === 1 ? 'site' : 'sites'}.
          </desc>
          <rect width={WIDTH} height={HEIGHT} fill="#ffffff" className="plot-background" />
          <defs>
            <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse">
              <path d="M0 8 8 0" stroke="#16785f" strokeOpacity=".22" strokeWidth="2" />
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

          <g
            className="svg-chart-legend detail-svg-legend"
            role="group"
            aria-label="Chart legend"
          >
            <text
              x={MARGIN.left}
              y={28}
              className="svg-legend-title"
              fontSize={SVG_LEGEND_FONT_SIZE}
            >
              Legend
            </text>
            {legendLayout.items.map(({ entry, x: legendX, y: legendY, textMaxWidth }) => {
              const displayLabel = fitSvgLegendLabel(entry.label, textMaxWidth)
              const siteStyle = entry.kind === 'site'
                ? getSiteChartStyle(entry.locationId ?? '', entry.siteIndex ?? 0)
                : null

              return (
                <g className="svg-legend-entry" key={entry.key}>
                  {entry.kind === 'site' && siteStyle && (
                    <line
                      x1={legendX}
                      x2={legendX + 28}
                      y1={legendY - 6}
                      y2={legendY - 6}
                      stroke={siteStyle.color}
                      strokeWidth="3"
                      strokeDasharray={siteStyle.dash}
                      strokeLinecap="round"
                      className="legend-line"
                      data-dash={siteStyle.kind}
                      aria-hidden="true"
                    />
                  )}
                  {entry.kind === 'threshold' && (
                    <line
                      x1={legendX}
                      x2={legendX + 28}
                      y1={legendY - 6}
                      y2={legendY - 6}
                      stroke="#c3293a"
                      strokeWidth="2.5"
                      strokeDasharray="6 5"
                      className="legend-threshold"
                      aria-hidden="true"
                    />
                  )}
                  {entry.kind === 'window' && (
                    <rect
                      x={legendX}
                      y={legendY - 17}
                      width="28"
                      height="15"
                      fill={`url(#${patternId})`}
                      stroke="#16785f"
                      strokeWidth="1"
                      className="legend-window"
                      aria-hidden="true"
                    />
                  )}
                  <text
                    x={legendX + 38}
                    y={legendY}
                    className="legend-item svg-legend-item-label"
                    fontSize={SVG_LEGEND_FONT_SIZE}
                    aria-label={entry.label}
                  >
                    <title>{entry.label}</title>
                    {displayLabel}
                  </text>
                </g>
              )
            })}
          </g>

          <g className="chart-grid" fill="#111111">
            {Y_TICKS.map((tick) => (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={WIDTH - MARGIN.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? 'horizon-line' : 'grid-line'}
                />
                <text x={MARGIN.left - 12} y={y(tick) + 5} textAnchor="end">
                  {tick}
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
            x={20}
            y={MARGIN.top + PLOT_HEIGHT / 2}
            textAnchor="middle"
            transform={`rotate(-90 20 ${MARGIN.top + PLOT_HEIGHT / 2})`}
            className="axis-title"
            fill="#111111"
          >
            Altitude [°]
          </text>
          <text
            x={MARGIN.left + PLOT_WIDTH / 2}
            y={HEIGHT - 14}
            textAnchor="middle"
            className="axis-title"
            fill="#111111"
          >
            Time (UTC)
          </text>

          {tooltipVisible && safeActiveIndex !== null && activeX !== null && (
            <g className="chart-tooltip" pointerEvents="none" fill="#111111">
              {target.location_series.map((series, index) => {
                const altitude = series.altitudes_deg[safeActiveIndex]
                return Number.isFinite(altitude) && altitude >= Y_MIN && altitude <= Y_MAX ? (
                  <circle
                    key={series.location_id}
                    cx={activeX}
                    cy={y(altitude)}
                    r="5"
                    fill={getSiteChartStyle(series.location_id, index).color}
                    stroke="#111111"
                    strokeWidth="2"
                  />
                ) : null
              })}
              <rect
                x={tooltipX}
                y={tooltipY}
                width="202"
                height={46 + target.location_series.length * 21}
                rx="10"
              />
              <text x={tooltipX + 13} y={tooltipY + 22} className="tooltip-time">
                {formatUtcTick(times[safeActiveIndex], true)} UTC
              </text>
              {target.location_series.map((series, index) => (
                <text
                  key={series.location_id}
                  x={tooltipX + 13}
                  y={tooltipY + 46 + index * 21}
                  fill="#111111"
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
        <span>Time (UTC)</span>
        <input
          type="range"
          min={0}
          max={pointCount - 1}
          step={1}
          value={safeActiveIndex ?? 0}
          aria-label={`${target.name} time (UTC)`}
          aria-valuetext={`${formatUtcTick(times[safeActiveIndex ?? 0], true)} UTC`}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onChange={(event) => setActiveIndex(Number(event.currentTarget.value))}
        />
        <output>{formatUtcTick(times[safeActiveIndex ?? 0], true)} UTC</output>
      </label>

      <table className="sr-only">
        <caption>{target.name} altitude data by time in UTC</caption>
        <thead>
          <tr>
            <th>UTC time</th>
            {target.location_series.map((series) => (
              <th key={series.location_id}>{series.location_name} altitude</th>
            ))}
            <th>All sites meet threshold</th>
          </tr>
        </thead>
        <tbody>
          {times.map((time, index) => (
            <tr key={time}>
              <td>{time}</td>
              {target.location_series.map((series) => (
                <td key={series.location_id}>{series.altitudes_deg[index]}°</td>
              ))}
              <td>{target.simultaneous_mask[index] ? 'Yes' : 'No'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
