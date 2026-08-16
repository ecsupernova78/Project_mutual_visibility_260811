import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

import { calculateVisibility } from './api'
import { AltitudeChart } from './components/AltitudeChart'
import { getTargetColor } from './components/chartStyles'
import { LofarCatalogPanel } from './components/LofarCatalogPanel'
import { VisibilityOverviewChart } from './components/VisibilityOverviewChart'
import type {
  CustomTargetSnapshot,
  LofarSource,
  ObserverLocation,
  VisibilityRequest,
  VisibilityResponse,
  VisibilityTarget,
} from './types'
import {
  getLongestCommonVisibility,
  VISIBILITY_DURATION_NOTE,
} from './visibilityDuration'

interface CatalogTarget {
  id: string
  name: string
  coordinate: string
}

type AppTab = 'visibility' | 'lofar'

const MAXIMUM_TARGET_COUNT = 25
const HANGUL_PATTERN = new RegExp('[\\u3131-\\u318e\\uac00-\\ud7a3]')

const CATALOG_TARGETS: CatalogTarget[] = [
  { id: '3c123', name: '3C123', coordinate: '04h 37m · +29° 40′' },
  { id: '3c273', name: '3C273', coordinate: '12h 29m · +02° 03′' },
  { id: '3c433', name: '3C433', coordinate: '21h 23m · +25° 04′' },
  { id: '3c295', name: '3C295', coordinate: '14h 11m · +52° 12′' },
  { id: '3c134', name: '3C134', coordinate: '05h 04m · +38° 06′' },
]

const INITIAL_LOCATIONS: ObserverLocation[] = [
  {
    id: 'narrabri',
    name: 'Aus - Narrabri',
    latitude_deg: -30.31667,
    longitude_deg: 149.76667,
    elevation_m: 237,
  },
  {
    id: 'pyeongchang',
    name: 'Kor - Pyeongchang',
    latitude_deg: 37.36889,
    longitude_deg: 128.39028,
    elevation_m: 700,
  },
  {
    id: 'fushan',
    name: 'Taiwan - Fushan',
    latitude_deg: 24.7564722222,
    longitude_deg: 121.5816388889,
    elevation_m: 0,
  },
]

function initialUtcInput() {
  const date = new Date()
  date.setUTCMinutes(0, 0, 0)
  return date.toISOString().slice(0, 16)
}

function toUtcIso(value: string) {
  return new Date(`${value}:00Z`).toISOString()
}

function formatUtcDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hour = String(date.getUTCHours()).padStart(2, '0')
  const minute = String(date.getUTCMinutes()).padStart(2, '0')
  return `${year}.${month}.${day} ${hour}:${minute} UTC`
}

function formatCoordinate(value: number, type: 'ra' | 'dec') {
  if (type === 'ra') {
    const totalHours = ((value / 15) % 24 + 24) % 24
    const hours = Math.floor(totalHours)
    const minutes = Math.floor((totalHours - hours) * 60)
    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m`
  }
  return `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}°`
}

function formatRadioFlux(value: number | null | undefined, unit: string) {
  if (value == null || !Number.isFinite(value)) return `— ${unit}`
  return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value)} ${unit}`
}

function englishCatalogText(value: string | null | undefined) {
  return value && !HANGUL_PATTERN.test(value) ? value : null
}

function snapshotLofarSource(source: LofarSource): CustomTargetSnapshot {
  const morphologyLabel = englishCatalogText(source.morphology_label)
  const morphologyDescription = englishCatalogText(source.morphology_description)
  const objectTypeLabel = englishCatalogText(source.object_type_label)
  const objectTypeDescription = englishCatalogText(source.object_type_description)
  const aliases = [...new Set([
    ...(source.aliases ?? []),
    ...(source.source_id === source.name ? [] : [source.source_id]),
  ])].slice(0, 5)

  return {
    id: source.id,
    name: source.name,
    aliases,
    ra_deg: source.ra_deg,
    dec_deg: source.dec_deg,
    catalog: source.catalog,
    catalog_source_id: source.source_id,
    ...(source.total_flux_mjy === null ? {} : { total_flux_mjy: source.total_flux_mjy }),
    ...(source.peak_flux_mjy === null ? {} : { peak_flux_mjy: source.peak_flux_mjy }),
    ...(source.morphology_code == null ? {} : { morphology_code: source.morphology_code }),
    ...(morphologyLabel == null ? {} : { morphology_label: morphologyLabel }),
    ...(morphologyDescription == null ? {} : { morphology_description: morphologyDescription }),
    ...(source.counterpart_name == null ? {} : { counterpart_name: source.counterpart_name }),
    ...((source.counterpart_aliases?.length ?? 0) === 0 ? {} : { counterpart_aliases: source.counterpart_aliases }),
    ...(source.object_type_code == null ? {} : { object_type_code: source.object_type_code }),
    ...(objectTypeLabel == null ? {} : { object_type_label: objectTypeLabel }),
    ...(objectTypeDescription == null ? {} : { object_type_description: objectTypeDescription }),
    ...(source.crossmatch_separation_arcsec == null ? {} : { crossmatch_separation_arcsec: source.crossmatch_separation_arcsec }),
    ...(source.crossmatch_confidence == null ? {} : { crossmatch_confidence: source.crossmatch_confidence }),
    ...(source.crossmatch_catalog == null ? {} : { crossmatch_catalog: source.crossmatch_catalog }),
  }
}

function NumericInput({
  id,
  label,
  ariaLabel,
  value,
  min,
  max,
  step,
  suffix,
  help,
  required = true,
  disabled = false,
  onChange,
}: {
  id: string
  label: string
  ariaLabel?: string
  value: number
  min: number
  max: number
  step: number | 'any'
  suffix?: string
  help?: string
  required?: boolean
  disabled?: boolean
  onChange: (value: number) => void
}) {
  const helpId = help ? `${id}-help` : undefined
  return (
    <label className="field" htmlFor={id}>
      <span className="field-label">
        {label}
        {help && <small id={helpId}>{help}</small>}
      </span>
      <span className="input-shell">
        <input
          id={id}
          type="number"
          value={Number.isFinite(value) ? value : ''}
          min={min}
          max={max}
          step={step}
          aria-label={ariaLabel}
          aria-describedby={helpId}
          required={required}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.valueAsNumber)}
        />
        {suffix && <span className="input-suffix">{suffix}</span>}
      </span>
    </label>
  )
}

function LocationEditor({
  location,
  index,
  selected,
  onToggle,
  onChange,
}: {
  location: ObserverLocation
  index: number
  selected: boolean
  onToggle: () => void
  onChange: (next: ObserverLocation) => void
}) {
  const prefix = `location-${index}`
  return (
    <section
      className={`location-card ${selected ? 'is-selected' : 'is-unselected'}`}
      aria-labelledby={`${prefix}-title`}
    >
      <div className="location-heading">
        <span className={`site-marker marker-${index + 1}`} aria-hidden="true">
          {index + 1}
        </span>
        <div>
          <label id={`${prefix}-title`} className="location-name-label">
            <span className="sr-only">Observation site {index + 1} name</span>
            <input
              type="text"
              value={location.name}
              maxLength={80}
              required={selected}
              disabled={!selected}
              onChange={(event) => onChange({ ...location, name: event.currentTarget.value })}
            />
          </label>
        </div>
        <label className="location-toggle">
          <input
            type="checkbox"
            checked={selected}
            aria-label={`Include ${location.name} in the observation`}
            onChange={onToggle}
          />
          <span aria-hidden="true">{selected ? 'Included' : 'Excluded'}</span>
        </label>
      </div>
      <div className="coordinate-grid">
        <NumericInput
          id={`${prefix}-latitude`}
          label="Latitude (N: + / S: −)"
          ariaLabel={`${location.name} latitude (N: + / S: −)`}
          value={location.latitude_deg}
          min={-90}
          max={90}
          step="any"
          suffix="°"
          required={selected}
          disabled={!selected}
          onChange={(latitude_deg) => onChange({ ...location, latitude_deg })}
        />
        <NumericInput
          id={`${prefix}-longitude`}
          label="Longitude (E: + / W: −)"
          ariaLabel={`${location.name} longitude (E: + / W: −)`}
          value={location.longitude_deg}
          min={-180}
          max={180}
          step="any"
          suffix="°"
          required={selected}
          disabled={!selected}
          onChange={(longitude_deg) => onChange({ ...location, longitude_deg })}
        />
        <NumericInput
          id={`${prefix}-elevation`}
          label="Elevation"
          ariaLabel={`${location.name} elevation`}
          value={location.elevation_m}
          min={-500}
          max={10000}
          step={1}
          suffix="m"
          required={selected}
          disabled={!selected}
          onChange={(elevation_m) => onChange({ ...location, elevation_m })}
        />
      </div>
      {location.id === 'fushan' && (
        <p className="location-note">Provided coordinates applied · Elevation defaults to 0 m because no value was specified</p>
      )}
    </section>
  )
}

function ResultSkeleton() {
  return (
    <div className="result-state loading-state" role="status" aria-live="polite">
      <span className="loader-orbit" aria-hidden="true">
        <span />
      </span>
      <h2>Overlaying the selected skies</h2>
      <p>Transforming each site's coordinates and calculating shared visibility samples.</p>
      <div className="skeleton-chart" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span className="sr-only">Calculating visibility</span>
    </div>
  )
}

function IntroState() {
  return (
    <div className="result-state intro-state">
      <div className="orbital-mark" aria-hidden="true">
        <span className="orbit orbit-one" />
        <span className="orbit orbit-two" />
        <span className="orbit-core" />
      </div>
      <h2>Simultaneously Visible Target Search</h2>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="result-state error-state" role="alert">
      <span className="state-symbol" aria-hidden="true">!</span>
      <p className="eyebrow">Calculation could not be completed</p>
      <h2>Check the connection and input values</h2>
      <p>{message}</p>
      <button className="secondary-button" type="button" onClick={onRetry}>
        Try Again
      </button>
    </div>
  )
}

function EmptyState({
  minimumAltitude,
  locationCount,
}: {
  minimumAltitude: number
  locationCount: number
}) {
  return (
    <div className="result-state empty-state" role="status">
      <span className="state-symbol" aria-hidden="true">0</span>
      <p className="eyebrow">0 simultaneously visible targets</p>
      <h2>No targets are shared within this time window</h2>
      <p>
        None of the selected targets has a sample at or above {minimumAltitude}° at every selected site
        ({locationCount} {locationCount === 1 ? 'site' : 'sites'} selected).
        Try widening the time range or lowering the minimum altitude.
      </p>
    </div>
  )
}

function TargetResultCard({
  target,
  stepMinutes,
  sampleCount,
  selected,
  onSelect,
}: {
  target: VisibilityTarget
  stepMinutes: number
  sampleCount: number
  selected: boolean
  onSelect: () => void
}) {
  const alias = target.aliases.find((value) => value !== target.name)
  const longestVisibility = getLongestCommonVisibility(
    target.visible_intervals,
    stepMinutes,
    sampleCount,
  )
  const durationLabel = longestVisibility?.label ?? '—'
  const durationQualifier = longestVisibility
    ? [
        longestVisibility.label === 'Single sample' ? 'Duration undetermined' : null,
        longestVisibility.boundaryLabel,
      ].filter(Boolean).join(' · ')
    : null
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`target-result-card ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
    >
      <span className="target-result-topline">
        <span className="visibility-dot" aria-hidden="true" />
        Simultaneously visible
      </span>
      <strong>{target.name}</strong>
      <span className="target-card-meta">
        {target.visible_intervals.length} sample group{target.visible_intervals.length === 1 ? '' : 's'}
        <i aria-hidden="true" />
        Maximum common altitude {target.max_common_altitude_deg?.toFixed(1) ?? '—'}°
      </span>
      <span
        className="target-duration-metric"
        title={VISIBILITY_DURATION_NOTE}
        aria-describedby="target-duration-note"
      >
        <span>Longest common visibility within window</span>
        <strong>{durationLabel}</strong>
        <small>Sample-based{durationQualifier ? ` · ${durationQualifier}` : ''}</small>
      </span>
      {alias && <span className="target-alias">{alias}</span>}
    </button>
  )
}

function Results({
  response,
  selectedId,
  onSelect,
  minimumAltitude,
  overviewTargetIds,
  onOverviewSelectionChange,
}: {
  response: VisibilityResponse
  selectedId: string | null
  onSelect: (id: string) => void
  minimumAltitude: number
  overviewTargetIds: ReadonlySet<string>
  onOverviewSelectionChange: (targetIds: Set<string>) => void
}) {
  const visibleTargets = response.targets.filter((target) => target.simultaneous_visible)
  const target = visibleTargets.find((candidate) => candidate.id === selectedId) ?? visibleTargets[0]
  const plottedTargets = visibleTargets.filter((candidate) => overviewTargetIds.has(candidate.id))

  const toggleOverviewTarget = (id: string) => {
    const next = new Set(overviewTargetIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onOverviewSelectionChange(next)
  }

  if (!target) {
    return (
      <EmptyState
        minimumAltitude={minimumAltitude}
        locationCount={response.locations.length || 1}
      />
    )
  }

  const longestVisibility = getLongestCommonVisibility(
    target.visible_intervals,
    response.metadata.step_minutes,
    response.times_utc.length,
  )
  const durationLabel = longestVisibility?.label ?? '—'
  const durationQualifier = longestVisibility
    ? [
        longestVisibility.label === 'Single sample' ? 'Duration undetermined' : null,
        longestVisibility.boundaryLabel,
      ].filter(Boolean).join(' · ')
    : null

  return (
    <div className="results-content">
      <header className="results-header">
        <div>
          <p className="eyebrow">Calculation Results · Sample-based</p>
          <h2>
            Simultaneously visible <span>{visibleTargets.length}</span>
            <small>/ {response.targets.length}</small>
          </h2>
        </div>
        <div className="result-window">
          <span>{formatUtcDateTime(response.times_utc[0])}</span>
          <i aria-hidden="true">→</i>
          <span>{formatUtcDateTime(response.times_utc.at(-1) ?? '')}</span>
        </div>
        <a className="overview-jump" href="#common-visibility-overview">
          Jump to Overview <span aria-hidden="true">↓</span>
        </a>
      </header>

      <div className="target-results" role="tablist" aria-label="Select a simultaneously visible target">
        {visibleTargets.map((candidate) => (
          <TargetResultCard
            key={candidate.id}
            target={candidate}
            stepMinutes={response.metadata.step_minutes}
            sampleCount={response.times_utc.length}
            selected={candidate.id === target.id}
            onSelect={() => onSelect(candidate.id)}
          />
        ))}
      </div>
      <p id="target-duration-note" className="target-duration-note">
        Sample-based: observable time is the elapsed duration between the first and last samples in a consecutive group.
        It does not guarantee uninterrupted visibility between samples.
      </p>

      <section className="chart-panel" role="tabpanel" aria-label={`${target.name} altitude chart`}>
        <header className="chart-heading">
          <div>
            <span className="object-type">
              {target.catalog === 'lofar_dr3' ? 'LoTSS DR3 SOURCE · 144 MHz' : 'FIXED ICRS TARGET'}
            </span>
            <h3>{target.name}</h3>
            {target.aliases.length > 0 && (
              <p className="alias-list">{target.aliases.join(' · ')}</p>
            )}
            {target.catalog === 'lofar_dr3' && (
              <div className="catalog-source-details">
                <p className="catalog-source-meta">
                  LoTSS ID {target.catalog_source_id}
                  <span aria-hidden="true"> · </span>
                  Total flux {formatRadioFlux(target.total_flux_mjy, 'mJy')}
                  <span aria-hidden="true"> · </span>
                  Peak flux {formatRadioFlux(target.peak_flux_mjy, 'mJy/beam')}
                </p>
                <p className="catalog-source-meta">
                  LoTSS radio morphology {target.morphology_code
                    ? `${target.morphology_code} — ${target.morphology_label ?? 'No description'}`
                    : 'Unclassified'}
                  <span aria-hidden="true"> · </span>
                  SIMBAD physical type {target.object_type_label
                    ? `${target.object_type_label}${target.object_type_code ? ` (${target.object_type_code})` : ''}`
                    : 'None or unconfirmed'}
                </p>
              </div>
            )}
          </div>
          <dl className="object-coordinates">
            <div>
              <dt>Right Ascension</dt>
              <dd>{formatCoordinate(target.ra_deg, 'ra')}</dd>
            </div>
            <div>
              <dt>Declination</dt>
              <dd>{formatCoordinate(target.dec_deg, 'dec')}</dd>
            </div>
            <div>
              <dt>Maximum Common Altitude</dt>
              <dd>{target.max_common_altitude_deg?.toFixed(1) ?? '—'}°</dd>
            </div>
            <div
              className="duration-metric"
              title={VISIBILITY_DURATION_NOTE}
              aria-describedby="duration-method-note"
            >
              <dt>Longest Common Visibility Within Window</dt>
              <dd>
                {durationLabel}
                <small>
                  Sample-based{durationQualifier ? ` · ${durationQualifier}` : ''}
                </small>
              </dd>
            </div>
          </dl>
        </header>

        <AltitudeChart
          key={target.id}
          target={target}
          times={response.times_utc}
          minimumAltitude={minimumAltitude}
        />

        <div id="duration-method-note" className="science-note">
          <span aria-hidden="true">i</span>
          <p>
            <strong>Visibility Criteria</strong> Samples and consecutive sample groups are highlighted when every selected site has a geometric altitude of at least {minimumAltitude}° ({target.location_series.length} {target.location_series.length === 1 ? 'site' : 'sites'} selected).
            The longest interval is the elapsed time between the first and last samples in the longest group. A single visible sample has an undetermined duration.
            This does not guarantee uninterrupted visibility between samples. Atmospheric refraction (pressure=0), terrain, weather, and daylight are not included.
          </p>
        </div>
      </section>

      <section
        id="common-visibility-overview"
        className="chart-panel overview-panel"
        aria-labelledby="overview-title"
      >
        <header className="chart-heading overview-heading">
          <div>
            <span className="object-type">TARGETS VISIBLE WITHIN THE TIME WINDOW</span>
            <h3 id="overview-title">Overview of Targets Visible Within the Time Window</h3>
            <p>
              Compare full altitude–time tracks for selected catalog targets that reach at least {minimumAltitude}°
              at every selected site in one or more samples within the full time window.
            </p>
          </div>
          <span className="overview-count" aria-live="polite">
            {plottedTargets.length} / {visibleTargets.length} plotted
          </span>
        </header>

        <fieldset className="overview-target-selector">
          <legend>Targets to Plot in the Overview</legend>
          <div className="overview-selector-actions">
            <span>Only targets with an observable interval can be selected.</span>
            <div>
              <button
                type="button"
                onClick={() => onOverviewSelectionChange(
                  new Set(visibleTargets.map((candidate) => candidate.id)),
                )}
                disabled={plottedTargets.length === visibleTargets.length}
              >
                Show All Visible Targets
              </button>
              <button
                type="button"
                onClick={() => onOverviewSelectionChange(new Set())}
                disabled={plottedTargets.length === 0}
              >
                Hide All
              </button>
            </div>
          </div>
          <div className="overview-target-options">
            {visibleTargets.map((candidate, index) => {
              const longest = getLongestCommonVisibility(
                candidate.visible_intervals,
                response.metadata.step_minutes,
                response.times_utc.length,
              )
              return (
                <label
                  className="overview-target-option"
                  key={candidate.id}
                  style={{
                    '--target-color': getTargetColor(candidate.id, index),
                  } as CSSProperties}
                >
                  <input
                    type="checkbox"
                    checked={overviewTargetIds.has(candidate.id)}
                    aria-label={`Plot ${candidate.name} in the overview`}
                    onChange={() => toggleOverviewTarget(candidate.id)}
                  />
                  <span className="overview-option-check" aria-hidden="true">✓</span>
                  <span className="overview-option-dot" aria-hidden="true" />
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>Longest common visibility {longest?.label ?? '—'}</small>
                  </span>
                </label>
              )
            })}
          </div>
        </fieldset>

        <VisibilityOverviewChart
          targets={plottedTargets}
          times={response.times_utc}
          centerTime={response.metadata.center_time_utc}
          minimumAltitude={minimumAltitude}
        />

        <div className="science-note">
          <span aria-hidden="true">i</span>
          <p>
            <strong>How to Read This</strong> Listed targets reach at least {minimumAltitude}° at every selected site in one or more samples within the calculation window.
            Only checked targets appear in the chart, legend, and data table. This does not mean they are visible throughout the entire window.
            The vertical reference line marks the sample nearest the entered central UTC time.
          </p>
        </div>
      </section>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('visibility')
  const [locations, setLocations] = useState<ObserverLocation[]>(INITIAL_LOCATIONS)
  const [selectedLocationIds, setSelectedLocationIds] = useState(
    () => new Set(['narrabri', 'pyeongchang']),
  )
  const [centerTime, setCenterTime] = useState(initialUtcInput)
  const [hoursBefore, setHoursBefore] = useState(6)
  const [hoursAfter, setHoursAfter] = useState(6)
  const [stepMinutes, setStepMinutes] = useState(15)
  const [minimumAltitude, setMinimumAltitude] = useState(15)
  const [selectedTargetIds, setSelectedTargetIds] = useState(
    () => new Set(CATALOG_TARGETS.map((target) => target.id)),
  )
  const [importedTargets, setImportedTargets] = useState<Map<string, CustomTargetSnapshot>>(
    () => new Map(),
  )
  const [selectedImportedTargetIds, setSelectedImportedTargetIds] = useState<Set<string>>(
    () => new Set(),
  )
  const [response, setResponse] = useState<VisibilityResponse | null>(null)
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null)
  const [overviewTargetIds, setOverviewTargetIds] = useState<Set<string>>(() => new Set())
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState(false)
  const [locationSelectionError, setLocationSelectionError] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => activeRequest.current?.abort(), [])

  const invalidateResults = () => {
    activeRequest.current?.abort()
    setResponse(null)
    setSelectedResultId(null)
    setOverviewTargetIds(new Set())
    setStatus('idle')
    setError(null)
  }

  const updateLocation = (index: number, next: ObserverLocation) => {
    invalidateResults()
    setLocations((current) => {
      const copy = [...current]
      copy[index] = next
      return copy
    })
  }

  const toggleLocation = (id: string) => {
    invalidateResults()
    setSelectedLocationIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size > 0) setLocationSelectionError(false)
      return next
    })
  }

  const toggleTarget = (id: string) => {
    if (
      !selectedTargetIds.has(id)
      && selectedTargetIds.size + selectedImportedTargetIds.size >= MAXIMUM_TARGET_COUNT
    ) return
    invalidateResults()
    setSelectedTargetIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size > 0) setSelectionError(false)
      return next
    })
  }

  const toggleImportedSource = (source: LofarSource) => {
    const isSelected = selectedImportedTargetIds.has(source.id)
    if (
      !isSelected
      && selectedTargetIds.size + selectedImportedTargetIds.size >= MAXIMUM_TARGET_COUNT
    ) return
    invalidateResults()
    setImportedTargets((current) => {
      const next = new Map(current)
      next.set(source.id, snapshotLofarSource(source))
      return next
    })
    setSelectedImportedTargetIds((current) => {
      const next = new Set(current)
      if (next.has(source.id)) next.delete(source.id)
      else next.add(source.id)
      if (next.size + selectedTargetIds.size > 0) setSelectionError(false)
      return next
    })
  }

  const toggleImportedTarget = (id: string) => {
    if (!importedTargets.has(id)) return
    const isSelected = selectedImportedTargetIds.has(id)
    if (
      !isSelected
      && selectedTargetIds.size + selectedImportedTargetIds.size >= MAXIMUM_TARGET_COUNT
    ) return
    invalidateResults()
    setSelectedImportedTargetIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size + selectedTargetIds.size > 0) setSelectionError(false)
      return next
    })
  }

  const removeImportedTarget = (id: string) => {
    if (!importedTargets.has(id)) return
    invalidateResults()
    setImportedTargets((current) => {
      const next = new Map(current)
      next.delete(id)
      return next
    })
    setSelectedImportedTargetIds((current) => {
      const next = new Set(current)
      next.delete(id)
      return next
    })
  }

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (selectedLocationIds.size === 0) {
      setLocationSelectionError(true)
      return
    }
    if (selectedTargetIds.size + selectedImportedTargetIds.size === 0) {
      setSelectionError(true)
      return
    }

    const sampleCount =
      Math.floor((hoursBefore * 60) / stepMinutes) +
      Math.floor((hoursAfter * 60) / stepMinutes) +
      1
    if (sampleCount < 2) {
      setError('This time range and calculation interval produce only one sample. Adjust them to produce at least two samples.')
      setStatus('error')
      return
    }

    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setStatus('loading')
    setError(null)

    const payload: VisibilityRequest = {
      locations: locations.filter((location) => selectedLocationIds.has(location.id)),
      center_time_utc: toUtcIso(centerTime),
      hours_before: hoursBefore,
      hours_after: hoursAfter,
      step_minutes: stepMinutes,
      minimum_altitude_deg: minimumAltitude,
      target_ids: CATALOG_TARGETS.filter((target) => selectedTargetIds.has(target.id)).map(
        (target) => target.id,
      ),
      custom_targets: [...importedTargets.values()].filter((target) => (
        selectedImportedTargetIds.has(target.id)
      )),
    }

    try {
      const nextResponse = await calculateVisibility(payload, controller.signal)
      if (controller.signal.aborted) return
      setResponse(nextResponse)
      const firstVisible = nextResponse.targets.find((target) => target.simultaneous_visible)
      setSelectedResultId(firstVisible?.id ?? null)
      setOverviewTargetIds(new Set(
        nextResponse.targets
          .filter((target) => target.simultaneous_visible)
          .map((target) => target.id),
      ))
      setStatus('success')
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : 'An unknown error occurred.')
      setStatus('error')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#visibility-panel" aria-label="Mutual Sky home" onClick={() => setActiveTab('visibility')}>
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <span><b>Mutual Sky</b><small>Shared Visibility</small></span>
        </a>
        <p className="topbar-description">Compare target visibility across selected sites</p>
        <span className="utc-badge"><i aria-hidden="true" />All times are UTC</span>
      </header>

      <nav className="app-tabs" role="tablist" aria-label="Primary navigation">
        <button
          id="visibility-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'visibility'}
          aria-controls="visibility-panel"
          onClick={() => setActiveTab('visibility')}
        >
          Observation Visibility
        </button>
        <button
          id="lofar-catalog-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'lofar'}
          aria-controls="lofar-catalog-panel"
          onClick={() => setActiveTab('lofar')}
        >
          LOFAR DR3 Catalog
          {selectedImportedTargetIds.size > 0 && <span>{selectedImportedTargetIds.size}</span>}
        </button>
      </nav>

      <main
        id="visibility-panel"
        className="workspace"
        role="tabpanel"
        aria-labelledby="visibility-tab"
        hidden={activeTab !== 'visibility'}
      >
        <aside className="control-panel" aria-labelledby="conditions-title">
          <div className="panel-heading">
            <div>
              <h1 id="conditions-title">Observation Setup</h1>
            </div>
          </div>

          <form onSubmit={handleSubmit} aria-busy={status === 'loading'}>
            <fieldset disabled={status === 'loading'}>
              <legend className="section-legend"><span>01</span>Observation Sites</legend>
              <div className="locations-stack">
                {locations.map((location, index) => (
                  <LocationEditor
                    key={location.id}
                    location={location}
                    index={index}
                    selected={selectedLocationIds.has(location.id)}
                    onToggle={() => toggleLocation(location.id)}
                    onChange={(next) => updateLocation(index, next)}
                  />
                ))}
              </div>
              {locationSelectionError && (
                <p className="field-error" role="alert">Select at least one observation site.</p>
              )}
            </fieldset>

            <fieldset disabled={status === 'loading'}>
              <legend className="section-legend"><span>02</span>Reference Time UTC</legend>
              <div className="time-grid">
                <label className="field datetime-field" htmlFor="center-time">
                  <span className="sr-only">Reference Time UTC</span>
                  <span className="input-shell">
                    <input
                      id="center-time"
                      type="datetime-local"
                      value={centerTime}
                      required
                      onChange={(event) => {
                        invalidateResults()
                        setCenterTime(event.currentTarget.value)
                      }}
                    />
                    <span className="input-suffix">UTC</span>
                  </span>
                </label>
                <NumericInput
                  id="hours-before"
                  label="Before"
                  value={hoursBefore}
                  min={0.25}
                  max={72}
                  step={0.25}
                  suffix="hr"
                  onChange={(value) => {
                    invalidateResults()
                    setHoursBefore(value)
                  }}
                />
                <NumericInput
                  id="hours-after"
                  label="After"
                  value={hoursAfter}
                  min={0.25}
                  max={72}
                  step={0.25}
                  suffix="hr"
                  onChange={(value) => {
                    invalidateResults()
                    setHoursAfter(value)
                  }}
                />
                <NumericInput
                  id="step-minutes"
                  label="Calculation Interval"
                  value={stepMinutes}
                  min={1}
                  max={180}
                  step={1}
                  suffix="min"
                  onChange={(value) => {
                    invalidateResults()
                    setStepMinutes(value)
                  }}
                />
                <NumericInput
                  id="minimum-altitude"
                  label="Minimum Altitude"
                  value={minimumAltitude}
                  min={-90}
                  max={90}
                  step={1}
                  suffix="°"
                  onChange={(value) => {
                    invalidateResults()
                    setMinimumAltitude(value)
                  }}
                />
              </div>
            </fieldset>

            <fieldset disabled={status === 'loading'}>
              <legend className="section-legend"><span>03</span>Target Selection</legend>
              <div className="target-heading-row">
                <p>Examples of 5 Radio sources · {selectedTargetIds.size}/{CATALOG_TARGETS.length} selected</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    invalidateResults()
                    if (selectedTargetIds.size !== CATALOG_TARGETS.length) {
                      setSelectionError(false)
                    }
                    if (selectedTargetIds.size === CATALOG_TARGETS.length) {
                      setSelectedTargetIds(new Set())
                    } else {
                      const availableSlots = MAXIMUM_TARGET_COUNT - selectedImportedTargetIds.size
                      const next = new Set(selectedTargetIds)
                      for (const target of CATALOG_TARGETS) {
                        if (next.size >= availableSlots) break
                        next.add(target.id)
                      }
                      setSelectedTargetIds(next)
                    }
                  }}
                >
                  {selectedTargetIds.size === CATALOG_TARGETS.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
              <ul className="target-checks" aria-label="Examples of 5 Radio sources">
                {CATALOG_TARGETS.map((target) => (
                  <li key={target.id}>
                    <label className="target-check">
                      <input
                        type="checkbox"
                        checked={selectedTargetIds.has(target.id)}
                        disabled={
                          !selectedTargetIds.has(target.id) &&
                          selectedTargetIds.size + selectedImportedTargetIds.size >= MAXIMUM_TARGET_COUNT
                        }
                        onChange={() => toggleTarget(target.id)}
                      />
                      <span className="custom-check" aria-hidden="true">✓</span>
                      <span>
                        <b>{target.name}</b>
                        <small>{target.coordinate}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <div className="imported-targets-heading">
                <p>
                  Targets Imported from LOFAR DR3
                  <strong>{selectedImportedTargetIds.size} Selected / {importedTargets.size} Imported</strong>
                </p>
                <button type="button" className="text-button" onClick={() => setActiveTab('lofar')}>
                  Search Catalog
                </button>
              </div>
              {importedTargets.size > 0 ? (
                <div className="imported-target-list" aria-label="Imported LOFAR DR3 target list">
                  {[...importedTargets.values()].map((target) => (
                    <article
                      key={target.id}
                      className={`imported-target-card ${selectedImportedTargetIds.has(target.id) ? 'is-selected' : 'is-unselected'}`}
                    >
                      <label className="imported-target-select">
                        <input
                          type="checkbox"
                          checked={selectedImportedTargetIds.has(target.id)}
                          disabled={
                            !selectedImportedTargetIds.has(target.id)
                            && selectedTargetIds.size + selectedImportedTargetIds.size >= MAXIMUM_TARGET_COUNT
                          }
                          aria-label={`${selectedImportedTargetIds.has(target.id) ? 'Exclude' : 'Include'} ${target.name} ${selectedImportedTargetIds.has(target.id) ? 'from' : 'in'} the calculation`}
                          onChange={() => toggleImportedTarget(target.id)}
                        />
                        <span aria-hidden="true">✓</span>
                      </label>
                      <span>
                        <b>{target.name}</b>
                        <small>{target.catalog_source_id} · {target.ra_deg.toFixed(4)}°, {target.dec_deg.toFixed(4)}°</small>
                        <small>
                          LoTSS morphology {target.morphology_code
                            ? `${target.morphology_code} — ${target.morphology_label ?? 'No description'}`
                            : 'Unclassified'}
                          {' · '}SIMBAD type {target.object_type_label
                            ? `${target.object_type_label}${target.object_type_code ? ` (${target.object_type_code})` : ''}`
                            : 'None or unconfirmed'}
                        </small>
                      </span>
                      <button
                        type="button"
                        aria-label={`Remove ${target.name} from the imported list`}
                        onClick={() => removeImportedTarget(target.id)}
                      >
                        Remove
                      </button>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="imported-target-empty">Search the LOFAR DR3 tab to add targets to the calculation.</p>
              )}
              {selectionError && (
                <p className="field-error" role="alert">Select at least one target to calculate.</p>
              )}
            </fieldset>

            <button className="calculate-button" type="submit" disabled={status === 'loading'}>
              {status === 'loading' ? (
                <><span className="button-spinner" aria-hidden="true" />Calculating…</>
              ) : (
                <><span aria-hidden="true">✦</span>Plot Altitude-Time</>
              )}
            </button>
          </form>
        </aside>

        <section className="result-panel" aria-label="Visibility calculation results">
          {status === 'idle' && <IntroState />}
          {status === 'loading' && <ResultSkeleton />}
          {status === 'error' && (
            <ErrorState message={error ?? 'An error occurred.'} onRetry={() => void handleSubmit()} />
          )}
          {status === 'success' && response && (
            <Results
              response={response}
              selectedId={selectedResultId}
              onSelect={setSelectedResultId}
              minimumAltitude={minimumAltitude}
              overviewTargetIds={overviewTargetIds}
              onOverviewSelectionChange={setOverviewTargetIds}
            />
          )}
        </section>
      </main>

      <LofarCatalogPanel
        hidden={activeTab !== 'lofar'}
        selectedSourceIds={selectedImportedTargetIds}
        selectedTargetCount={selectedTargetIds.size + selectedImportedTargetIds.size}
        maximumTargetCount={MAXIMUM_TARGET_COUNT}
        onToggleSource={toggleImportedSource}
        onGoToVisibility={() => setActiveTab('visibility')}
      />

      <footer className="footer-note">
        Reference frame: ICRS · Altitude frame: AltAz · Results are intended for observation-planning reference.
      </footer>
    </div>
  )
}
