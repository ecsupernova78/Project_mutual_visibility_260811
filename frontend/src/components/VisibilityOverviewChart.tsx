import { useId, useRef, useState, type CSSProperties, type PointerEvent } from 'react'

import type { VisibilityTarget } from '../types'
import { getSiteChartStyle, getTargetColor } from './chartStyles'
import { PlotExportControls } from './PlotExportControls'
import {
  fitSvgLegendLabel,
  layoutSvgLegendGrid,
  SVG_LEGEND_FONT_SIZE,
  SVG_LEGEND_ROW_HEIGHT,
} from './svgLegendLayout'

interface VisibilityOverviewChartProps {
  targets: VisibilityTarget[]
  times: string[]
  centerTime: string
}

const WIDTH = 1040
const PLOT_HEIGHT = 344
const MARGIN_LEFT = 92
const MARGIN_RIGHT = 40
const MARGIN_BOTTOM = 78
const Y_MIN = 0
const Y_MAX = 90
const Y_TICKS = [0, 15, 30, 45, 60, 75, 90]
const MAX_TOOLTIP_TARGETS = 12

interface TargetLegendEntry {
  key: string
  label: string
  color: string
}

interface SiteLegendEntry {
  key: string
  label: string
  kind: 'site' | 'reference'
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
}: VisibilityOverviewChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const [isTableOpen, setIsTableOpen] = useState(false)
  const svgRef = useRef<SVGSVGElement>(null)
  const rawId = useId()
  const chartId = `overview-${rawId.replace(/:/g, '')}`
  const pointCount = times.length

  if (pointCount === 0 || targets.length === 0) {
    return <div className="chart-empty">Select at least one target to plot.</div>
  }

  const plotWidth = WIDTH - MARGIN_LEFT - MARGIN_RIGHT
  const targetLegendEntries: TargetLegendEntry[] = targets.map((target, index) => ({
    key: target.id,
    label: target.name,
    color: getTargetColor(target.id, index),
  }))
  const targetLegendFirstBaselineY = 58
  const targetLegendLayout = layoutSvgLegendGrid(targetLegendEntries, {
    startX: MARGIN_LEFT,
    firstBaselineY: targetLegendFirstBaselineY,
    availableWidth: plotWidth,
    columns: 2,
  })
  const targetLegendLastBaselineY =
    targetLegendFirstBaselineY +
    Math.max(targetLegendLayout.rowCount - 1, 0) * SVG_LEGEND_ROW_HEIGHT
  const siteLegendTitleY = targetLegendLastBaselineY + 36
  const siteLegendFirstBaselineY = siteLegendTitleY + 30
  const siteLegendEntries: SiteLegendEntry[] = [
    ...targets[0].location_series.map((series, index) => ({
      key: `site-${series.location_id}`,
      label: series.location_name,
      kind: 'site' as const,
      locationId: series.location_id,
      siteIndex: index,
    })),
    {
      key: 'reference-utc',
      label: 'Reference UTC',
      kind: 'reference',
    },
  ]
  const siteLegendLayout = layoutSvgLegendGrid(siteLegendEntries, {
    startX: MARGIN_LEFT,
    firstBaselineY: siteLegendFirstBaselineY,
    availableWidth: plotWidth,
  })
  const marginTop =
    siteLegendFirstBaselineY +
    Math.max(siteLegendLayout.rowCount - 1, 0) * SVG_LEGEND_ROW_HEIGHT +
    34
  const margin = {
    top: marginTop,
    right: MARGIN_RIGHT,
    bottom: MARGIN_BOTTOM,
    left: MARGIN_LEFT,
  }
  const height = margin.top + PLOT_HEIGHT + margin.bottom
  const centerIndex = nearestTimeIndex(times, centerTime)
  const x = (index: number) =>
    margin.left + (pointCount <= 1 ? 0 : (index / (pointCount - 1)) * plotWidth)
  const y = (altitude: number) =>
    margin.top + ((Y_MAX - altitude) / (Y_MAX - Y_MIN)) * PLOT_HEIGHT

  const paths = targets.flatMap((target, targetIndex) =>
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
      return { target, targetIndex, series, siteIndex, path }
    }),
  )

  const xTickIndexes = getTickIndexes(pointCount)
  const moveToIndex = (clientX: number, element: SVGRectElement) => {
    const bounds = element.getBoundingClientRect()
    if (!bounds.width || pointCount === 0) return
    const svgX = ((clientX - bounds.left) / bounds.width) * WIDTH
    const ratio = clamp((svgX - margin.left) / plotWidth, 0, 1)
    setActiveIndex(Math.round(ratio * Math.max(pointCount - 1, 0)))
  }

  const handlePointerMove = (event: PointerEvent<SVGRectElement>) => {
    moveToIndex(event.clientX, event.currentTarget)
  }

  const safeActiveIndex = activeIndex === null ? null : clamp(activeIndex, 0, pointCount - 1)
  const activeX = safeActiveIndex === null ? null : x(safeActiveIndex)
  const tooltipWidth = 220
  const tooltipX = activeX !== null && activeX > WIDTH - 265 ? activeX - tooltipWidth - 12 : (activeX ?? 0) + 12
  const tooltipY = margin.top + 12
  const tooltipTargets = targets.slice(0, MAX_TOOLTIP_TARGETS)
  const omittedTooltipTargets = targets.length - tooltipTargets.length
  const tooltipHeight = 45 + tooltipTargets.length * 20 + (omittedTooltipTargets > 0 ? 20 : 0)
  const activeSummary = safeActiveIndex === null
    ? `Reference UTC ${formatUtcTick(times[centerIndex], true)}`
    : `${formatUtcTick(times[safeActiveIndex], true)} UTC, ${targets
        .map((target) => {
          const altitude = commonAltitude(target, safeActiveIndex)
          return `${target.name} minimum geometric altitude across sites ${altitude?.toFixed(1) ?? 'no data'} degrees`
        })
        .join(', ')}`

  return (
    <div className="overview-chart">
      <PlotExportControls
        svgRef={svgRef}
        filename={`visibility-overview-altitude-time-${times[0]}-${times.at(-1) ?? times[0]}`}
        plotLabel="overview altitude–time plot"
      />

      <div className="chart-frame overview-chart-frame">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${height}`}
          role="img"
          aria-labelledby={`${chartId}-title`}
          aria-describedby={`${chartId}-description`}
        >
          <title id={`${chartId}-title`}>Altitude–time overview of simultaneously visible targets</title>
          <desc id={`${chartId}-description`}>
            Altitude from 0 to 90 degrees in UTC for {targets.length} simultaneously visible {targets.length === 1 ? 'target' : 'targets'} at each selected observing site.
          </desc>
          <rect width={WIDTH} height={height} fill="#ffffff" className="plot-background" />
          <clipPath id={`${chartId}-clip`}>
            <rect x={margin.left} y={margin.top} width={plotWidth} height={PLOT_HEIGHT} />
          </clipPath>

          <g
            className="svg-chart-legend target-color-legend"
            role="group"
            aria-label="Target color legend"
          >
            <text
              x={margin.left}
              y={28}
              className="svg-legend-title"
              fontSize={SVG_LEGEND_FONT_SIZE}
            >
              Target
            </text>
            {targetLegendLayout.items.map(({ entry, x: legendX, y: legendY, textMaxWidth }) => {
              const displayLabel = fitSvgLegendLabel(entry.label, textMaxWidth)
              return (
                <g className="svg-legend-entry" key={entry.key}>
                  <circle
                    cx={legendX + 10}
                    cy={legendY - 6}
                    r="7"
                    fill={entry.color}
                    style={{ '--legend-color': entry.color } as CSSProperties}
                    className="legend-color-dot"
                    aria-hidden="true"
                  />
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

          <g
            className="svg-chart-legend site-pattern-legend"
            role="group"
            aria-label="Observing-site line-style legend"
          >
            <text
              x={margin.left}
              y={siteLegendTitleY}
              className="svg-legend-title"
              fontSize={SVG_LEGEND_FONT_SIZE}
            >
              Observing site
            </text>
            {siteLegendLayout.items.map(({ entry, x: legendX, y: legendY, textMaxWidth }) => {
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
                      stroke="#4b5563"
                      strokeWidth="3"
                      strokeDasharray={siteStyle.dash}
                      strokeLinecap="round"
                      className="legend-site-line"
                      data-dash={siteStyle.kind}
                      aria-hidden="true"
                    />
                  )}
                  {entry.kind === 'reference' && (
                    <line
                      x1={legendX + 14}
                      x2={legendX + 14}
                      y1={legendY - 19}
                      y2={legendY + 2}
                      stroke="#111827"
                      strokeWidth="2.5"
                      strokeDasharray="3 4"
                      className="legend-center-line"
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
                  x1={margin.left}
                  x2={WIDTH - margin.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className={tick === 0 ? 'horizon-line' : 'grid-line'}
                />
                <text x={margin.left - 12} y={y(tick) + 5} textAnchor="end">{tick}</text>
              </g>
            ))}
            {xTickIndexes.map((index) => (
              <g key={index}>
                <line
                  x1={x(index)}
                  x2={x(index)}
                  y1={margin.top}
                  y2={height - margin.bottom}
                  className="grid-line vertical"
                />
                <text x={x(index)} y={height - margin.bottom + 24} textAnchor="middle">
                  {formatUtcTick(times[index], index === 0 || index === pointCount - 1)}
                </text>
              </g>
            ))}
          </g>

          <g clipPath={`url(#${chartId}-clip)`}>
            {paths.map(({ target, targetIndex, series, siteIndex, path }) => (
              <path
                key={`${target.id}-${series.location_id}`}
                d={path}
                fill="none"
                stroke={getTargetColor(target.id, targetIndex)}
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
              y1={margin.top}
              y2={height - margin.bottom}
              className="center-time-line"
            />
            {activeX !== null && (
              <line
                x1={activeX}
                x2={activeX}
                y1={margin.top}
                y2={height - margin.bottom}
                className="cursor-line"
              />
            )}
          </g>

          <text
            x={20}
            y={margin.top + PLOT_HEIGHT / 2}
            textAnchor="middle"
            transform={`rotate(-90 20 ${margin.top + PLOT_HEIGHT / 2})`}
            className="axis-title"
            fill="#111111"
          >
            Altitude [°]
          </text>
          <text x={margin.left + plotWidth / 2} y={height - 14} textAnchor="middle" className="axis-title" fill="#111111">
            Time (UTC)
          </text>

          {safeActiveIndex !== null && activeX !== null && (
            <g className="chart-tooltip overview-tooltip" pointerEvents="none" fill="#111111">
              <rect x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} rx="10" />
              <text x={tooltipX + 13} y={tooltipY + 22} className="tooltip-time">
                {formatUtcTick(times[safeActiveIndex], true)} UTC
              </text>
              {tooltipTargets.map((target, index) => {
                const altitude = commonAltitude(target, safeActiveIndex)
                return (
                  <text
                    key={target.id}
                    x={tooltipX + 13}
                    y={tooltipY + 45 + index * 20}
                    fill="#111111"
                    className="tooltip-value"
                  >
                    {target.name}: site minimum {altitude?.toFixed(1) ?? '—'}°
                  </text>
                )
              })}
              {omittedTooltipTargets > 0 && (
                <text
                  x={tooltipX + 13}
                  y={tooltipY + 45 + tooltipTargets.length * 20}
                  className="tooltip-value"
                >
                  +{omittedTooltipTargets} more targets · see table
                </text>
              )}
            </g>
          )}

          <rect
            x={margin.left}
            y={margin.top}
            width={plotWidth}
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
          value={safeActiveIndex ?? centerIndex}
          aria-label="Overview time (UTC)"
          aria-valuetext={activeSummary}
          onFocus={() => setActiveIndex((current) => current ?? centerIndex)}
          onChange={(event) => setActiveIndex(Number(event.currentTarget.value))}
        />
        <output>{formatUtcTick(times[safeActiveIndex ?? centerIndex], true)} UTC</output>
      </label>

      <details
        className="overview-data-table"
        onToggle={(event) => setIsTableOpen(event.currentTarget.open)}
      >
        <summary>Full numerical data table</summary>
        {isTableOpen && <div>
          <table>
            <caption>Altitude–time data in UTC by observing site for simultaneously visible targets</caption>
            <thead>
              <tr>
                <th scope="col">UTC time</th>
                {targets.flatMap((target) =>
                  target.location_series.map((series) => (
                    <th scope="col" key={`${target.id}-${series.location_id}`}>
                      {target.name} · {series.location_name}
                    </th>
                  )),
                )}
                {targets.map((target) => (
                  <th scope="col" key={`${target.id}-common`}>{target.name}: Common visibility</th>
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
                      {target.simultaneous_mask[timeIndex] ? 'Yes' : 'No'}
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
