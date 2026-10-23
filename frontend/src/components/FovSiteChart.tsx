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
  station_code?: string | null
  center_east_west_deg?: number
  center_north_south_deg?: number
  rotation_deg?: number
  antenna_count?: number | null
  antenna_rows?: number | null
  antennas_per_row?: number | null
  spacing_ew_m?: number | null
  spacing_ns_m?: number | null
  frequency_min_mhz?: number | null
  frequency_max_mhz?: number | null
  target_series: FovTargetSeries[]
}

interface FovSiteChartProps {
  site: FovSite
  targets: VisibilityTarget[]
  timeIndex: number
  timeUtc: string
  horizonRadiusDeg?: number
}

type MarkerStatus = 'inside' | 'outside' | 'below' | 'unavailable'

const VIEW_WIDTH = 520
const PLOT_LEFT = 78
const PLOT_TOP = 70
const PLOT_SIZE = 360
const PLOT_CENTER_X = PLOT_LEFT + PLOT_SIZE / 2
const PLOT_CENTER_Y = PLOT_TOP + PLOT_SIZE / 2
const DEGREES_PER_HALF_PLOT = 60
const PIXELS_PER_DEGREE = PLOT_SIZE / (2 * DEGREES_PER_HALF_PLOT)
const TICKS = [-60, -40, -20, 0, 20, 40, 60]
const LEGEND_TOP = 624
const LEGEND_ROW_HEIGHT = 25
const LEGEND_COLUMNS = 2
const LEGEND_MAX_CHARACTERS = 19

// Keep source colors stable across all site charts, even if their series order differs.
function sourceColor(index: number) {
  const hue = Math.round((index * 137.508) % 360)
  const lightness = [29, 37, 33][index % 3]
  return `hsl(${hue} 76% ${lightness}%)`
}

function legendLabel(name: string, insidePlot: boolean, hasCoordinates: boolean) {
  const suffix = !hasCoordinates ? ' (no data)' : insidePlot ? '' : ' (off plot)'
  const availableNameLength = LEGEND_MAX_CHARACTERS - suffix.length
  const shortenedName = name.length > availableNameLength
    ? `${name.slice(0, Math.max(0, availableNameLength - 3))}...`
    : name
  return `${shortenedName}${suffix}`
}

function plotX(eastWestDegrees: number) {
  return PLOT_CENTER_X + eastWestDegrees * PIXELS_PER_DEGREE
}

function plotY(northSouthDegrees: number) {
  return PLOT_CENTER_Y - northSouthDegrees * PIXELS_PER_DEGREE
}

function formatUtc(iso: string) {
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return iso
  return `${time.toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

function statusSymbol(status: MarkerStatus) {
  switch (status) {
    case 'inside': return 'O'
    case 'outside': return 'X'
    case 'below': return '\u25bc'
    case 'unavailable': return '?'
  }
}

function statusDescription(status: MarkerStatus) {
  switch (status) {
    case 'inside': return 'inside the field of view'
    case 'outside': return 'above the horizon, outside the field of view'
    case 'below': return 'at or below the horizon'
    case 'unavailable': return 'coordinates unavailable'
  }
}

function plotName(name: string) {
  return name.length > 18 ? `${name.slice(0, 15)}...` : name
}

function pointingLabel(eastWest: number, northSouth: number) {
  if (eastWest === 0 && northSouth === 0) return 'Zenith'
  const parts = []
  if (eastWest !== 0) parts.push(`${Math.abs(eastWest)}° ${eastWest > 0 ? 'E' : 'W'}`)
  if (northSouth !== 0) parts.push(`${Math.abs(northSouth)}° ${northSouth > 0 ? 'N' : 'S'}`)
  return parts.join(', ')
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
      const belowHorizon = hasCoordinates && Math.hypot(eastWest, northSouth) >= horizonRadiusDeg
      const status: MarkerStatus = !hasCoordinates
        ? 'unavailable'
        : belowHorizon ? 'below' : series.in_fov[timeIndex] === true ? 'inside' : 'outside'
      const coordinateSummary = hasCoordinates
        ? `EW ${eastWest.toFixed(1)} deg, NS ${northSouth.toFixed(1)} deg`
        : 'Coordinates unavailable'
      const positionNote = !hasCoordinates
        ? 'no position to plot'
        : insidePlot ? '' : 'outside the displayed -60 to 60 degree range'
      return {
        id: series.target_id,
        name: targetById.get(series.target_id)?.name ?? series.target_id,
        color: colorByTargetId.get(series.target_id) ?? '#111827',
        status,
        inFov: status === 'inside',
        hasCoordinates,
        insidePlot,
        coordinateSummary,
        positionNote,
        eastWest,
        northSouth,
      }
    })
  const legendRows = Math.ceil(markers.length / LEGEND_COLUMNS)
  const viewHeight = LEGEND_TOP + Math.max(legendRows, 1) * LEGEND_ROW_HEIGHT + 20
  const fovRadiusX = Math.max(0, Math.min(site.ew_width_deg, 180)) * PIXELS_PER_DEGREE / 2
  const fovRadiusY = Math.max(0, Math.min(site.ns_width_deg, 180)) * PIXELS_PER_DEGREE / 2
  const centerEastWest = site.center_east_west_deg ?? 0
  const centerNorthSouth = site.center_north_south_deg ?? 0
  const rotation = site.rotation_deg ?? 0
  const beamCenterX = plotX(centerEastWest)
  const beamCenterY = plotY(centerNorthSouth)
  const tilted = centerEastWest !== 0 || centerNorthSouth !== 0
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
            Azimuthal equidistant sky projection at {formatUtc(timeUtc)}.
            East-West and North-South offsets range from -60 to 60 degrees. The horizon
            lies outside this cropped view; the shaded ellipse marks the geometric
            {site.ew_width_deg} by {site.ns_width_deg} degree nominal field of view,
            centered {pointingLabel(centerEastWest, centerNorthSouth)} with rotation {rotation}
            degrees counterclockwise from East toward North. This is not a measured beam
            sensitivity response. O means inside the field of view,
            X means above the horizon but outside, and the downward triangle means at
            or below the horizon. Sources outside the plotted square have no plotted
            marker or name, but remain listed in the status legend.
          </desc>
          <rect width={VIEW_WIDTH} height={viewHeight} fill="#fff" />
          <defs>
            <clipPath id={clipId}>
              <rect x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_SIZE} height={PLOT_SIZE} />
            </clipPath>
          </defs>

          <text className="fov-svg-title" x={PLOT_CENTER_X} y="31">
            {`${site.station_code ?? site.location_name}: ${site.ew_width_deg}\u00b0 EW \u00d7 ${site.ns_width_deg}\u00b0 NS`}
          </text>
          <text className="fov-svg-subtitle" x={PLOT_CENTER_X} y="52">{formatUtc(timeUtc)}</text>

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
            <ellipse
              className="fov-region"
              cx={beamCenterX}
              cy={beamCenterY}
              rx={fovRadiusX}
              ry={fovRadiusY}
              transform={`rotate(${-rotation} ${beamCenterX} ${beamCenterY})`}
            />
            <circle
              className="fov-horizon"
              cx={PLOT_CENTER_X}
              cy={PLOT_CENTER_Y}
              r={horizonRadiusDeg * PIXELS_PER_DEGREE}
            />
            <line className="fov-zenith-cross" x1={PLOT_CENTER_X - 8} x2={PLOT_CENTER_X + 8} y1={PLOT_CENTER_Y} y2={PLOT_CENTER_Y} />
            <line className="fov-zenith-cross" x1={PLOT_CENTER_X} x2={PLOT_CENTER_X} y1={PLOT_CENTER_Y - 8} y2={PLOT_CENTER_Y + 8} />
            {tilted && (
              <g aria-label={`Boresight ${pointingLabel(centerEastWest, centerNorthSouth)}`}>
                <line className="fov-boresight-cross" x1={beamCenterX - 7} x2={beamCenterX + 7} y1={beamCenterY} y2={beamCenterY} />
                <line className="fov-boresight-cross" x1={beamCenterX} x2={beamCenterX} y1={beamCenterY - 7} y2={beamCenterY + 7} />
                <text className="fov-boresight-label" x={beamCenterX + 12} y={beamCenterY - 12}>Boresight</text>
              </g>
            )}
            {markers.filter((marker) => marker.insidePlot).map((marker) => {
              const markerX = plotX(marker.eastWest)
              const markerY = plotY(marker.northSouth)
              const labelOnLeft = marker.eastWest >= 40
              const labelY = marker.northSouth >= 50 ? markerY + 20 : markerY - 10
              const details = `${marker.name}: ${marker.coordinateSummary}; ${statusDescription(marker.status)}${marker.positionNote ? `; ${marker.positionNote}` : ''}`
              return (
                <g key={marker.id}>
                  <text
                    className="fov-target-marker"
                    x={markerX}
                    y={markerY}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fill={marker.color}
                    data-target-id={marker.id}
                    data-in-fov={marker.inFov}
                    data-fov-status={marker.status}
                    aria-label={details}
                  >
                    <title>{details}</title>
                    {statusSymbol(marker.status)}
                  </text>
                  <text
                    className="fov-target-name"
                    x={markerX + (labelOnLeft ? -12 : 12)}
                    y={labelY}
                    textAnchor={labelOnLeft ? 'end' : 'start'}
                    fill={marker.color}
                    data-target-label={marker.id}
                    aria-label={marker.name}
                  >
                    <title>{marker.name}</title>
                    {plotName(marker.name)}
                  </text>
                </g>
              )
            })}
          </g>

          <rect className="fov-plot-border" x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_SIZE} height={PLOT_SIZE} />
          <text className="fov-zenith-label" x={PLOT_CENTER_X + 13} y={PLOT_CENTER_Y - 15}>Zenith</text>
          <text className="fov-axis-title" x={PLOT_CENTER_X} y="489" textAnchor="middle">EW offset [deg] (East +)</text>
          <text
            className="fov-axis-title"
            x="18"
            y={PLOT_CENTER_Y}
            textAnchor="middle"
            transform={`rotate(-90 18 ${PLOT_CENTER_Y})`}
          >
            NS offset [deg] (North +)
          </text>

          <g className="fov-symbol-key" aria-label="Marker meanings">
            <text x={PLOT_LEFT} y="518">O  Inside FoV</text>
            <text x={PLOT_LEFT + 139} y="518">X  Outside FoV</text>
            <text x={PLOT_LEFT + 283} y="518">{'\u25bc  Below horizon'}</text>
          </g>
          <text className="fov-method-note" x={PLOT_CENTER_X} y="548" textAnchor="middle">
            Azimuthal equidistant · nominal geometric FoV, not beam response
          </text>
          <text className="fov-method-note" x={PLOT_CENTER_X} y="568" textAnchor="middle">
            Boresight {pointingLabel(centerEastWest, centerNorthSouth)} · rotation {rotation}° CCW
          </text>
          {site.antenna_count != null && (
            <text className="fov-method-note" x={PLOT_CENTER_X} y="588" textAnchor="middle">
              {site.antenna_count} antennas ({site.antenna_rows} × {site.antennas_per_row}) ·
              spacing {site.spacing_ew_m}/{site.spacing_ns_m} m EW/NS ·
              {site.frequency_min_mhz}–{site.frequency_max_mhz} MHz
            </text>
          )}

          <g className="fov-target-legend" aria-label="Target field of view status">
            {markers.map((marker, index) => {
              const column = index % LEGEND_COLUMNS
              const row = Math.floor(index / LEGEND_COLUMNS)
              const x = PLOT_LEFT + column * 205
              const y = LEGEND_TOP + row * LEGEND_ROW_HEIGHT
              return (
                <g key={marker.id}>
                  <text x={x} y={y} fill={marker.color} className="fov-legend-status">
                    {statusSymbol(marker.status)}
                  </text>
                  <text x={x + 20} y={y} className="fov-legend-label">
                    <title>{marker.name}: {marker.coordinateSummary}; {statusDescription(marker.status)}{marker.positionNote ? `; ${marker.positionNote}` : ''}</title>
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
