import { useId, useRef } from 'react'

import type { VisibilityTarget } from '../types'
import { PlotExportControls } from './PlotExportControls'
import './FovSiteChart.css'

export interface FovTargetSeries {
  target_id: string
  east_west_deg: number[]
  north_south_deg: number[]
  in_fov: boolean[]
  beam_ids?: (number | null)[] | null
}

export interface FovBeam {
  beam_id: number
  ix_ew: number
  iy_ns: number
  center_east_west_deg: number
  center_north_south_deg: number
  polygon_ew_ns_deg: [number, number][]
}

export interface FovBeamModel {
  model_type: 'modeled_assignment_cells'
  reference_frequency_mhz: number
  note: string
  beams: FovBeam[]
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
  beam_model?: FovBeamModel | null
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
const LEGEND_TOP = 512
const LEGEND_ROW_HEIGHT = 25
const LEGEND_COLUMNS = 2
const LEGEND_MAX_CHARACTERS = 15
// Antenna counts supplied by the user; these are not digital-beam counts.
const DISPLAY_ANTENNA_COUNTS: Record<string, number> = { FUS: 256, PYC: 16, LTN: 64, OGW: 32 }

// Keep source colors stable across all site charts, even if their series order differs.
function sourceColor(index: number) {
  const hue = Math.round((index * 137.508) % 360)
  const lightness = [29, 37, 33][index % 3]
  return `hsl(${hue} 76% ${lightness}%)`
}

function legendLabel(name: string) {
  return name.length > LEGEND_MAX_CHARACTERS
    ? `${name.slice(0, LEGEND_MAX_CHARACTERS - 3)}...`
    : name
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

function beamPolygonPath(vertices: [number, number][]) {
  return vertices.map(([eastWest, northSouth], index) => (
    `${index === 0 ? 'M' : 'L'} ${plotX(eastWest).toFixed(2)} ${plotY(northSouth).toFixed(2)}`
  )).join(' ') + ' Z'
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
  const beamModel = site.beam_model
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
      const beamId = beamModel ? series.beam_ids?.[timeIndex] ?? null : null
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
        beamId,
      }
    })
  const activeBeamIds = new Set(markers.flatMap((marker) => marker.beamId == null ? [] : [marker.beamId]))
  const legendRows = Math.ceil(targets.length / LEGEND_COLUMNS)
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
  const siteLabel = site.station_code ?? site.location_name
  const antennaCount = DISPLAY_ANTENNA_COUNTS[siteLabel] ?? site.antenna_count

  return (
    <section className={`fov-site-chart${beamModel ? ' fov-site-chart--beam-model' : ''}`} aria-label={`${site.location_name} field of view`}>
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
            East-West and North-South coordinates range from -60 to 60 degrees.
            The spherical sky grid shows constant-altitude circles and azimuth spokes every 30 degrees. Axis values are projected zenith-distance components: EW = (90° − altitude) sin(azimuth), NS = (90° − altitude) cos(azimuth). Radii 20°, 40°, 60° and 80° correspond to altitudes 70°, 50°, 30° and 10°; azimuth is measured clockwise from North.
            {beamModel
              ? 'The 256 FUS regions are provisional digital-beam assignment cells from the supplied model, not measured sensitivity contours. Only corner beams 0, 15, 240 and 255 are labeled outside the footprint. Highlighted cells contain a selected source at this UTC time.'
              : `The shaded ellipse marks the geometric ${site.ew_width_deg} by ${site.ns_width_deg} degree nominal field of view, centered ${pointingLabel(centerEastWest, centerNorthSouth)} with rotation ${rotation} degrees counterclockwise from East toward North. This is not a measured beam sensitivity response.`}
            O means inside the field of view,
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
            {siteLabel}{antennaCount == null ? '' : ` (${antennaCount})`}
          </text>
          <text className="fov-svg-subtitle" x={PLOT_CENTER_X} y="52">{formatUtc(timeUtc)}</text>

          <g className="fov-grid">
            {TICKS.map((tick) => (
              <g key={`ew-${tick}`}>
                <text x={plotX(tick)} y={PLOT_TOP + PLOT_SIZE + 22} textAnchor="middle">{tick}</text>
              </g>
            ))}
            {TICKS.map((tick) => (
              <g key={`ns-${tick}`}>
                <text x={PLOT_LEFT - 11} y={plotY(tick) + 5} textAnchor="end">{tick}</text>
              </g>
            ))}
          </g>

          <g clipPath={`url(#${clipId})`}>
            {beamModel ? (
              <g className="fov-beam-model" aria-label="FUS modeled digital beam cells 0 through 255">
                {beamModel.beams.map((beam) => (
                  <g key={beam.beam_id}>
                    <path
                      className={`fov-beam-cell${activeBeamIds.has(beam.beam_id) ? ' fov-beam-cell--active' : ''}`}
                      d={beamPolygonPath(beam.polygon_ew_ns_deg)}
                      data-beam-id={beam.beam_id}
                    >
                      <title>Modeled beam {beam.beam_id} (EW {beam.ix_ew}, NS {beam.iy_ns})</title>
                    </path>
                  </g>
                ))}
              </g>
            ) : (
              <ellipse
                className="fov-region"
                cx={beamCenterX}
                cy={beamCenterY}
                rx={fovRadiusX}
                ry={fovRadiusY}
                transform={`rotate(${-rotation} ${beamCenterX} ${beamCenterY})`}
              />
            )}
            <g className="fov-sky-grid" clipPath={`url(#${clipId})`}>
              {[20, 40, 60, 80].map((zenithDistance) => (
                <circle key={zenithDistance} cx={PLOT_CENTER_X} cy={PLOT_CENTER_Y} r={zenithDistance * PIXELS_PER_DEGREE}>
                  <title>Altitude {90 - zenithDistance}°</title>
                </circle>
              ))}
              {Array.from({ length: 12 }, (_, index) => index * 30).map((azimuth) => (
                <line key={azimuth} x1={PLOT_CENTER_X} y1={PLOT_CENTER_Y}
                  x2={plotX(90 * Math.sin(azimuth * Math.PI / 180))}
                  y2={plotY(90 * Math.cos(azimuth * Math.PI / 180))}
                >
                  <title>Azimuth {azimuth}°</title>
                </line>
              ))}
            </g>
            <circle
              className="fov-horizon"
              cx={PLOT_CENTER_X}
              cy={PLOT_CENTER_Y}
              r={horizonRadiusDeg * PIXELS_PER_DEGREE}
            />
            <line className="fov-zenith-cross" x1={PLOT_CENTER_X - 8} x2={PLOT_CENTER_X + 8} y1={PLOT_CENTER_Y} y2={PLOT_CENTER_Y} />
            <line className="fov-zenith-cross" x1={PLOT_CENTER_X} x2={PLOT_CENTER_X} y1={PLOT_CENTER_Y - 8} y2={PLOT_CENTER_Y + 8} />
            {!beamModel && tilted && (
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
              const details = `${marker.name}: ${marker.coordinateSummary}; ${statusDescription(marker.status)}${marker.beamId == null ? '' : `; modeled beam ${marker.beamId}`}${marker.positionNote ? `; ${marker.positionNote}` : ''}`
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

          {beamModel && (
            <g className="fov-beam-corner-labels" aria-label="Corner beam numbers">
              {beamModel.beams.filter((beam) => [0, 15, 240, 255].includes(beam.beam_id)).map((beam) => {
                const northernCorner = beam.beam_id >= 240
                const northSouthEdges = beam.polygon_ew_ns_deg.map(([, northSouth]) => northSouth)
                const edge = northernCorner ? Math.max(...northSouthEdges) : Math.min(...northSouthEdges)
                return (
                  <text key={beam.beam_id} className="fov-beam-number"
                    x={plotX(beam.center_east_west_deg)}
                    y={plotY(edge) + (northernCorner ? -14 : 14)}
                    textAnchor={beam.beam_id % 16 === 0 ? 'start' : 'end'} dominantBaseline="central"
                  >
                    {beam.beam_id}
                  </text>
                )
              })}
            </g>
          )}
          <rect className="fov-plot-border" x={PLOT_LEFT} y={PLOT_TOP} width={PLOT_SIZE} height={PLOT_SIZE} />
          <text className="fov-zenith-label" x={PLOT_CENTER_X + 13} y={PLOT_CENTER_Y - 15}>Zenith</text>
          <text className="fov-axis-title" x={PLOT_CENTER_X} y="482" textAnchor="middle">EW [°] (East +)<title>Projected zenith-distance component: (90° − altitude) sin(azimuth)</title></text>
          <text
            className="fov-axis-title"
            x="18"
            y={PLOT_CENTER_Y}
            textAnchor="middle"
            transform={`rotate(-90 18 ${PLOT_CENTER_Y})`}
          >
            NS [°] (North +)<title>Projected zenith-distance component: (90° − altitude) cos(azimuth)</title>
          </text>

          <g className="fov-symbol-key" aria-label="Marker meanings" transform={`translate(${PLOT_LEFT + 4} ${PLOT_TOP + 8})`}>
            <rect width="104" height="80" rx="4" />
            <text x="8" y="22">O  Inside</text>
            <text x="8" y="46">X  Outside</text>
            <text x="8" y="70">{'\u25bc  Below'}</text>
          </g>

          <g className="fov-target-legend" role="table" aria-label="Source and beam position">
            <rect className="fov-table-border" x={PLOT_LEFT} y={LEGEND_TOP - 18} width={PLOT_SIZE} height={Math.max(legendRows, 1) * LEGEND_ROW_HEIGHT} />
            <line className="fov-table-rule" x1={PLOT_CENTER_X} x2={PLOT_CENTER_X} y1={LEGEND_TOP - 18} y2={LEGEND_TOP - 18 + Math.max(legendRows, 1) * LEGEND_ROW_HEIGHT} />
            {Array.from({ length: Math.max(0, legendRows - 1) }, (_, index) => (
              <line key={index} className="fov-table-rule" x1={PLOT_LEFT} x2={PLOT_LEFT + PLOT_SIZE}
                y1={LEGEND_TOP - 18 + (index + 1) * LEGEND_ROW_HEIGHT} y2={LEGEND_TOP - 18 + (index + 1) * LEGEND_ROW_HEIGHT} />
            ))}
            {markers.map((marker, index) => {
              const column = index % LEGEND_COLUMNS
              const row = Math.floor(index / LEGEND_COLUMNS)
              const x = PLOT_LEFT + column * PLOT_SIZE / LEGEND_COLUMNS + 8
              const y = LEGEND_TOP + row * LEGEND_ROW_HEIGHT
              return (
                <g key={marker.id} role="row">
                  <text x={x} y={y} fill={marker.color} className="fov-legend-status" role="cell" aria-label={statusDescription(marker.status)}>
                    {statusSymbol(marker.status)}
                  </text>
                  <text x={x + 19} y={y} className="fov-legend-label" role="cell">
                    <title>{marker.name}: {marker.coordinateSummary}; {statusDescription(marker.status)}{marker.beamId == null ? '' : `; modeled beam ${marker.beamId}`}{marker.positionNote ? `; ${marker.positionNote}` : ''}</title>
                    {legendLabel(marker.name)}
                  </text>
                  <text x={x + 164} y={y} className="fov-legend-beam" textAnchor="end" role="cell" aria-label={`${marker.name} beam position`}>
                    {marker.beamId == null ? '—' : `#${marker.beamId}`}
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
