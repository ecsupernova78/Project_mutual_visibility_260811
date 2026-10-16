import { useId, useRef } from 'react'

import type { VisibilityTarget } from '../types'
import { PlotExportControls } from './PlotExportControls'
import './FovSiteChart.css'

export interface FovTargetSeries {
  target_id: string
  east_west_deg: number[]
  north_south_deg: number[]
  in_fov: boolean[]
}

export interface FovSite {
  location_id: string
  location_name: string
  ew_width_deg: number
  ns_width_deg: number
  target_series: FovTargetSeries[]
}

interface FovSiteChartProps {
  site: FovSite
  targets: VisibilityTarget[]
  timeIndex: number
  timeUtc: string
  horizonRadiusDeg?: number
}

const VIEW_WIDTH = 520
const PLOT_LEFT = 78
const PLOT_TOP = 70
const PLOT_SIZE = 360
const PLOT_CENTER_X = PLOT_LEFT + PLOT_SIZE / 2
const PLOT_CENTER_Y = PLOT_TOP + PLOT_SIZE / 2
const DEGREES_PER_HALF_PLOT = 90
const PIXELS_PER_DEGREE = PLOT_SIZE / (2 * DEGREES_PER_HALF_PLOT)
const TICKS = [-90, -60, -30, 0, 30, 60, 90]
const LEGEND_TOP = 505
const LEGEND_ROW_HEIGHT = 25
const LEGEND_COLUMNS = 2
const LEGEND_MAX_CHARACTERS = 19
const EDGE_MARKER_INSET_DEG = 6

// Use a golden-angle sequence so every source in a result has a distinct,
// deterministic color in every site chart. The source name remains in the
// legend because color alone cannot reliably identify 25 different objects.
function sourceColor(index: number) {
  const hue = Math.round((index * 137.508) % 360)
  const lightness = [29, 37, 33][index % 3]
  return `hsl(${hue} 76% ${lightness}%)`
}

function legendLabel(name: string, insidePlot: boolean, hasCoordinates: boolean) {
  const suffix = !hasCoordinates ? ' (no data)' : insidePlot ? '' : ' (off plot)'
  const availableNameLength = LEGEND_MAX_CHARACTERS - suffix.length
  const shortenedName = name.length > availableNameLength
    ? `${name.slice(0, availableNameLength - 1)}…`
    : name
  return `${shortenedName}${suffix}`
}

function plotX(eastWestDegrees: number) {
  return PLOT_CENTER_X + eastWestDegrees * PIXELS_PER_DEGREE
}

function plotY(northSouthDegrees: number) {
  return PLOT_CENTER_Y - northSouthDegrees * PIXELS_PER_DEGREE
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), maximum)
}

function formatUtc(iso: string) {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return iso
  return `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

export function FovSiteChart({
  site,
  targets,
  timeIndex,
  timeUtc,
  horizonRadiusDeg = 90,
}: FovSiteChartProps) {
  const svgRef = useRef<SVGSVGElement>(null)
  const instanceId = useId().replace(/:/g, '')
  const titleId = `${instanceId}-title`
  const descriptionId = `${instanceId}-description`
  const clipId = `${instanceId}-plot-clip`
  const targetById = new Map(targets.map((target) => [target.id, target]))
  const colorByTargetId = new Map(targets.map((target, index) => [target.id, sourceColor(index)]))
  const markers = site.target_series
    .filter((series) => targetById.has(series.target_id))
    .map((series) => {
      const eastWest = series.east_west_deg[timeIndex]
      const northSouth = series.north_south_deg[timeIndex]
      const hasCoordinates = Number.isFinite(eastWest) && Number.isFinite(northSouth)
      const insidePlot = hasCoordinates
        && Math.abs(eastWest) <= DEGREES_PER_HALF_PLOT
        && Math.abs(northSouth) <= DEGREES_PER_HALF_PLOT
      const inFov = series.in_fov[timeIndex] === true
      const coordinateSummary = hasCoordinates
        ? `EW ${eastWest.toFixed(1)}°, NS ${northSouth.toFixed(1)}°`
        : 'Coordinates unavailable'
      const positionNote = !hasCoordinates
        ? 'no position to plot'
        : insidePlot ? '' : 'off plot; X is inset from the nearest plot boundary'
      return {
        id: series.target_id,
        name: targetById.get(series.target_id)?.name ?? series.target_id,
        color: colorByTargetId.get(series.target_id) ?? '#111827',
        eastWest,
        northSouth,
        inFov,
        hasCoordinates,
        insidePlot,
        coordinateSummary,
        positionNote,
        markerEastWest: insidePlot ? eastWest : clamp(eastWest, -DEGREES_PER_HALF_PLOT + EDGE_MARKER_INSET_DEG, DEGREES_PER_HALF_PLOT - EDGE_MARKER_INSET_DEG),
        markerNorthSouth: insidePlot ? northSouth : clamp(northSouth, -DEGREES_PER_HALF_PLOT + EDGE_MARKER_INSET_DEG, DEGREES_PER_HALF_PLOT - EDGE_MARKER_INSET_DEG),
        boundaryEastWest: clamp(eastWest, -DEGREES_PER_HALF_PLOT, DEGREES_PER_HALF_PLOT),
        boundaryNorthSouth: clamp(northSouth, -DEGREES_PER_HALF_PLOT, DEGREES_PER_HALF_PLOT),
      }
    })
  const legendRows = Math.ceil(markers.length / LEGEND_COLUMNS)
  const viewHeight = LEGEND_TOP + Math.max(legendRows, 1) * LEGEND_ROW_HEIGHT + 20
  const fovWidth = Math.max(0, Math.min(site.ew_width_deg, 180)) * PIXELS_PER_DEGREE
  const fovHeight = Math.max(0, Math.min(site.ns_width_deg, 180)) * PIXELS_PER_DEGREE
  const exportLabel = `${site.location_name} field of view plot`

  return (
    <section className="fov-site-chart" aria-label={`${site.location_name} field of view`}>
      <PlotExportControls
        svgRef={svgRef}
        filename={`${site.location_name}-fov-${timeUtc}`}
        plotLabel={exportLabel}
      />
      <div className="fov-chart-frame">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_WIDTH} ${viewHeight}`}
          role="img"
          aria-labelledby={`${titleId} ${descriptionId}`}
        >
          <title id={titleId}>{site.location_name} field of view</title>
          <desc id={descriptionId}>
            Zenith centered sky projection at {formatUtc(timeUtc)}. East-West and North-South
            offsets range from -90 to 90 degrees. The dashed circle marks the horizon;
            the shaded rectangle marks the {site.ew_width_deg} by {site.ns_width_deg} degree
            field of view. O means inside the field of view and X means outside.
            Sources beyond the plotted square have an outlined X inset from and connected
            to the nearest plot boundary; its plotted position is not the actual position.
          </desc>
          <rect width={VIEW_WIDTH} height={viewHeight} fill="#fff" />
          <defs>
            <clipPath id={clipId}>
              <rect x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_SIZE} height={PLOT_SIZE} />
            </clipPath>
          </defs>

          <text className="fov-svg-title" x={PLOT_LEFT} y="31">{site.location_name}</text>
          <text className="fov-svg-subtitle" x={PLOT_LEFT} y="52">{formatUtc(timeUtc)}</text>

          <g className="fov-grid">
            {TICKS.map((tick) => (
              <g key={`ew-${tick}`}>
                <line x1={plotX(tick)} x2={plotX(tick)} y1={PLOT_TOP} y2={PLOT_TOP + PLOT_SIZE} />
                <text x={plotX(tick)} y={PLOT_TOP + PLOT_SIZE + 22} textAnchor="middle">{tick}</text>
              </g>
            ))}
            {TICKS.map((tick) => (
              <g key={`ns-${tick}`}>
                <line x1={PLOT_LEFT} x2={PLOT_LEFT + PLOT_SIZE} y1={plotY(tick)} y2={plotY(tick)} />
                <text x={PLOT_LEFT - 11} y={plotY(tick) + 5} textAnchor="end">{tick}</text>
              </g>
            ))}
          </g>

          <g clipPath={`url(#${clipId})`}>
            <rect
              className="fov-region"
              x={PLOT_CENTER_X - fovWidth / 2}
              y={PLOT_CENTER_Y - fovHeight / 2}
              width={fovWidth}
              height={fovHeight}
            />
            <circle
              className="fov-horizon"
              cx={PLOT_CENTER_X}
              cy={PLOT_CENTER_Y}
              r={horizonRadiusDeg * PIXELS_PER_DEGREE}
            />
            <circle className="fov-zenith" cx={PLOT_CENTER_X} cy={PLOT_CENTER_Y} r="3" />
            {markers.filter((marker) => marker.hasCoordinates).map((marker) => (
              <g key={marker.id}>
                {!marker.insidePlot && (
                  <>
                    <line
                      className="fov-clipped-marker-leader"
                      x1={plotX(marker.markerEastWest)}
                      y1={plotY(marker.markerNorthSouth)}
                      x2={plotX(marker.boundaryEastWest)}
                      y2={plotY(marker.boundaryNorthSouth)}
                    />
                    <circle
                      className="fov-clipped-marker-ring"
                      cx={plotX(marker.markerEastWest)}
                      cy={plotY(marker.markerNorthSouth)}
                      r="10"
                    />
                  </>
                )}
                <text
                  className="fov-target-marker"
                  x={plotX(marker.markerEastWest)}
                  y={plotY(marker.markerNorthSouth)}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fill={marker.color}
                  data-target-id={marker.id}
                  data-in-fov={marker.inFov}
                  data-off-plot={!marker.insidePlot}
                  aria-label={`${marker.name}: ${marker.inFov ? 'inside' : 'outside'} field of view${marker.positionNote ? `; ${marker.positionNote}` : ''}`}
                >
                  <title>{marker.name}: {marker.coordinateSummary}; {marker.inFov ? 'inside' : 'outside'} FoV{marker.positionNote ? `; ${marker.positionNote}` : ''}</title>
                  {marker.inFov ? 'O' : 'X'}
                </text>
              </g>
            ))}
          </g>
          <rect className="fov-plot-border" x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_SIZE} height={PLOT_SIZE} />
          <text className="fov-zenith-label" x={PLOT_CENTER_X + 17} y={PLOT_CENTER_Y - 17}>Zenith</text>
          <text className="fov-axis-title" x={PLOT_CENTER_X} y="489" textAnchor="middle">EW offset [deg]</text>
          <text
            className="fov-axis-title"
            x="18"
            y={PLOT_CENTER_Y}
            textAnchor="middle"
            transform={`rotate(-90 18 ${PLOT_CENTER_Y})`}
          >
            NS offset [deg]
          </text>

          <g className="fov-target-legend" aria-label="Target field of view status">
            {markers.map((marker, index) => {
              const column = index % LEGEND_COLUMNS
              const row = Math.floor(index / LEGEND_COLUMNS)
              const x = PLOT_LEFT + column * 205
              const y = LEGEND_TOP + row * LEGEND_ROW_HEIGHT
              return (
                <g key={marker.id}>
                  <text x={x} y={y} fill={marker.color} className="fov-legend-status">
                    {marker.inFov ? 'O' : 'X'}
                  </text>
                  <text x={x + 20} y={y} className="fov-legend-label">
                    <title>{marker.name}: {marker.coordinateSummary}; {marker.inFov ? 'inside' : 'outside'} FoV{marker.positionNote ? `; ${marker.positionNote}` : ''}</title>
                    {legendLabel(marker.name, marker.insidePlot, marker.hasCoordinates)}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </section>
  )
}
