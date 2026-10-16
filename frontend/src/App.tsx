import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react'

import { calculateVisibility } from './api'
import { AltitudeChart } from './components/AltitudeChart'
import { CatalogPanel } from './components/CatalogPanel'
import { FovSiteChart } from './components/FovSiteChart'
import { getTargetColor } from './components/chartStyles'
import { ObservingSitePanel } from './components/ObservingSitePanel'
import { VisibilityOverviewChart } from './components/VisibilityOverviewChart'
import {
  isDefaultObservingSite,
  loadObservingSiteState,
  MAXIMUM_SAVED_SITES,
  MAXIMUM_SELECTED_SITES,
  saveObservingSiteState,
} from './observingSiteStorage'
import { orderedSelectedSites } from './observingSiteGeometry'
import type {
  CustomTargetSnapshot,
  ExternalCatalogSource,
  ObserverLocation,
  VisibilityRequest,
  VisibilityResponse,
  VisibilityTarget,
} from './types'
import { getLongestCommonVisibility } from './visibilityDuration'

interface CatalogTarget {
  id: string
  name: string
  coordinate: string
}

type AppTab = 'visibility' | 'burstt' | 'sites' | 'catalog'

const TAB_IDS: Record<AppTab, string> = {
  visibility: 'visibility-tab',
  burstt: 'burstt-tab',
  sites: 'observing-sites-tab',
  catalog: 'catalog-tab',
}

const MAXIMUM_TARGET_COUNT = 25
const HANGUL_PATTERN = new RegExp('[\\u3131-\\u318e\\uac00-\\ud7a3]')

const CATALOG_TARGETS: CatalogTarget[] = [
  { id: '3c123', name: '3C123', coordinate: '04h 37m · +29° 40′' },
  { id: '3c273', name: '3C273', coordinate: '12h 29m · +02° 03′' },
  { id: '3c433', name: '3C433', coordinate: '21h 23m · +25° 04′' },
  { id: '3c295', name: '3C295', coordinate: '14h 11m · +52° 12′' },
  { id: '3c134', name: '3C134', coordinate: '05h 04m · +38° 06′' },
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

function formatFovUtc(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString().replace(/Z$/, '')
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

function snapshotCatalogSource(source: ExternalCatalogSource): CustomTargetSnapshot {
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
    ...(source.catalog !== 'vlass' ? {} : {
      duplicate_flag: source.duplicate_flag,
      quality_flag: source.quality_flag,
      main_sample: source.main_sample,
    }),
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
  selectionOrder,
  selected,
  selectionDisabled,
  onToggle,
  onChange,
}: {
  location: ObserverLocation
  index: number
  selectionOrder: number | null
  selected: boolean
  selectionDisabled: boolean
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
        <span
          className={`site-marker ${selectionOrder === null ? 'marker-unselected' : `marker-${selectionOrder}`}`}
          aria-hidden="true"
        >
          {selectionOrder ?? '—'}
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
            disabled={selectionDisabled}
            aria-label={`Include ${location.name} in the observation`}
            aria-describedby={selectionDisabled ? 'main-site-selection-limit' : undefined}
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

function EmptyState() {
  return (
    <div className="result-state empty-state" role="status">
      <span className="state-symbol" aria-hidden="true">0</span>
      <p className="eyebrow">0 simultaneously visible targets</p>
      <h2>No targets are shared within this time window</h2>
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
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      className={`target-result-card ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
    >
      <strong>{target.name}</strong>
      <span className="target-card-meta">
        Maximum Altitude {target.max_common_altitude_deg?.toFixed(1) ?? '—'}°
      </span>
      <span className="target-duration-metric">
        <span>Longest Common Window</span>
        <strong>{durationLabel}</strong>
      </span>
      {alias && <span className="target-alias">{alias}</span>}
    </button>
  )
}

function Results({
  response,
  mode,
  selectedId,
  onSelect,
  overviewTargetIds,
  onOverviewSelectionChange,
}: {
  response: VisibilityResponse
  mode: 'visibility' | 'burstt'
  selectedId: string | null
  onSelect: (id: string) => void
  overviewTargetIds: ReadonlySet<string>
  onOverviewSelectionChange: (targetIds: Set<string>) => void
}) {
  const [fovTimeIndex, setFovTimeIndex] = useState(() => {
    const center = new Date(response.metadata.center_time_utc).getTime()
    return response.times_utc.reduce((best, time, index) => (
      Math.abs(new Date(time).getTime() - center)
        < Math.abs(new Date(response.times_utc[best]).getTime() - center) ? index : best
    ), 0)
  })
  const safeFovTimeIndex = Math.min(Math.max(fovTimeIndex, 0), Math.max(response.times_utc.length - 1, 0))
  const activeFovTimeUtc = response.times_utc[safeFovTimeIndex] ?? response.metadata.center_time_utc
  const commonFovSourceNames = response.targets
    .filter((candidate) => response.fov?.common_masks.some((mask) => (
      mask.target_id === candidate.id && mask.in_fov[safeFovTimeIndex]
    )))
    .map((candidate) => candidate.name)
  const visibleTargets = response.targets.filter((target) => target.simultaneous_visible)
  const selectableTargets = mode === 'burstt' ? response.targets : visibleTargets
  const target = selectableTargets.find((candidate) => candidate.id === selectedId) ?? selectableTargets[0]
  const plottedTargets = visibleTargets.filter((candidate) => overviewTargetIds.has(candidate.id))

  const toggleOverviewTarget = (id: string) => {
    const next = new Set(overviewTargetIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onOverviewSelectionChange(next)
  }

  if (!target) {
    return <EmptyState />
  }

  const longestVisibility = getLongestCommonVisibility(
    target.visible_intervals,
    response.metadata.step_minutes,
    response.times_utc.length,
  )
  const durationLabel = longestVisibility?.label ?? '—'

  return (
    <div className="results-content">
      <header className="results-header">
        <div>
          <h2>
            {mode === 'burstt' ? 'Targets' : 'Simultaneously Visible Targets'}
            {' '}<span>{selectableTargets.length}</span>
            <small>{mode === 'burstt'
              ? ` / ${visibleTargets.length} simultaneously visible`
              : ` / ${response.targets.length}`}</small>
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

      <div className="target-results" role="tablist" aria-label={mode === 'burstt' ? 'Select a target' : 'Select a simultaneously visible target'}>
        {selectableTargets.map((candidate) => (
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

      <section className="chart-panel" role="tabpanel" aria-label={`${target.name} altitude chart`}>
        <header className="chart-heading">
          <div>
            <h3>Target: {target.name}</h3>
            {target.aliases.length > 0 && (
              <p className="alias-list">{target.aliases.join(' · ')}</p>
            )}
            {(target.catalog === 'lofar_dr3' || target.catalog === 'vlass') && (
              <div className="catalog-source-details">
                <p className="catalog-source-meta">
                  {target.catalog === 'lofar_dr3' ? 'LoTSS' : 'VLASS'} ID {target.catalog_source_id}
                  <span aria-hidden="true"> · </span>
                  Total flux {formatRadioFlux(target.total_flux_mjy, 'mJy')}
                  <span aria-hidden="true"> · </span>
                  Peak flux {formatRadioFlux(target.peak_flux_mjy, 'mJy/beam')}
                </p>
                <p className="catalog-source-meta">
                  {target.catalog === 'lofar_dr3' ? 'LoTSS radio morphology' : 'VLASS component type'} {target.morphology_code
                    ? `${target.morphology_code} — ${target.morphology_label ?? 'No description'}`
                    : 'Unclassified'}
                  <span aria-hidden="true"> · </span>
                  SIMBAD physical type {target.object_type_label
                    ? `${target.object_type_label}${target.object_type_code ? ` (${target.object_type_code})` : ''}`
                    : 'None or unconfirmed'}
                </p>
                {target.catalog === 'vlass' && (
                  <p className="catalog-source-meta">
                    Quality flag {target.quality_flag ?? '—'}
                    <span aria-hidden="true"> · </span>
                    Duplicate flag {target.duplicate_flag ?? '—'}
                    <span aria-hidden="true"> · </span>
                    {target.main_sample ? 'Main sample' : 'Outside main sample'}
                  </p>
                )}
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
              <dt>Maximum Altitude</dt>
              <dd>{target.max_common_altitude_deg?.toFixed(1) ?? '—'}°</dd>
            </div>
            <div className="duration-metric">
              <dt>Longest Common Window</dt>
              <dd>{durationLabel}</dd>
            </div>
          </dl>
        </header>

        {mode === 'burstt' && response.fov ? (
          <div className="burstt-analysis">
            <div
              className="burstt-fov-summary"
              role="status"
              aria-label="Common FoV targets at the active UTC time"
            >
              <strong>UTC {formatFovUtc(activeFovTimeUtc)}</strong>
              <span>In all selected station FoVs: {commonFovSourceNames.join(', ') || 'None'}</span>
            </div>
            <div className="burstt-plot-layout">
              <div className="burstt-altitude-plot">
                <AltitudeChart
                  key={target.id}
                  target={target}
                  times={response.times_utc}
                  centerTime={response.metadata.center_time_utc}
                  activeIndex={safeFovTimeIndex}
                  onActiveIndexChange={(index) => setFovTimeIndex(index ?? 0)}
                  retainCursorOnLeave
                  siteFovMasks={response.fov.sites.map((site) => ({
                    locationId: site.location_id,
                    mask: site.target_series.find((series) => series.target_id === target.id)?.in_fov ?? [],
                  }))}
                  commonFovMask={response.fov.common_masks.find((mask) => mask.target_id === target.id)?.in_fov}
                />
              </div>
              <div className="burstt-fov-plots" aria-label="Observing site fields of view">
                {response.fov.sites.map((site) => (
                  <FovSiteChart
                    key={site.location_id}
                    site={site}
                    targets={response.targets}
                    timeIndex={safeFovTimeIndex}
                    timeUtc={activeFovTimeUtc}
                    horizonRadiusDeg={response.fov?.horizon_radius_deg ?? 90}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <AltitudeChart
            key={target.id}
            target={target}
            times={response.times_utc}
            centerTime={response.metadata.center_time_utc}
          />
        )}
      </section>

      <section
        id="common-visibility-overview"
        className="chart-panel overview-panel"
        aria-labelledby="overview-title"
      >
        <header className="chart-heading overview-heading">
          <div>
            <h3 id="overview-title">Altitude–Time Overview</h3>
          </div>
          <span className="overview-count" aria-live="polite">
            {plottedTargets.length} / {visibleTargets.length} plotted
          </span>
        </header>

        <fieldset className="overview-target-selector">
          <legend>Targets to Plot in the Overview</legend>
          <div className="overview-selector-actions">
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
                    <small>Longest Common Window {longest?.label ?? '—'}</small>
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
        />
      </section>
    </div>
  )
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('visibility')
  const [analysisTab, setAnalysisTab] = useState<'visibility' | 'burstt'>('visibility')
  const [initialSiteState] = useState(loadObservingSiteState)
  const [locations, setLocations] = useState<ObserverLocation[]>(initialSiteState.locations)
  const [selectedLocationIds, setSelectedLocationIds] = useState(
    initialSiteState.selectedLocationIds,
  )
  const [siteStateRevision, setSiteStateRevision] = useState(0)
  const [siteStorageWarning, setSiteStorageWarning] = useState<string | null>(() => {
    if (initialSiteState.storageStatus === 'invalid') {
      return 'Saved site data could not be loaded and was left unchanged. Saving a new change will replace it.'
    }
    if (initialSiteState.storageStatus === 'unavailable') {
      return 'Browser storage is unavailable. Changes will be kept only until this page is closed.'
    }
    return null
  })
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
  const [resultRevision, setResultRevision] = useState(0)
  const [selectedResultId, setSelectedResultId] = useState<string | null>(null)
  const [overviewTargetIds, setOverviewTargetIds] = useState<Set<string>>(() => new Set())
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState(false)
  const [locationSelectionError, setLocationSelectionError] = useState(false)
  const activeRequest = useRef<AbortController | null>(null)
  const selectedLocations = orderedSelectedSites(locations, selectedLocationIds)

  useEffect(() => () => activeRequest.current?.abort(), [])

  useEffect(() => {
    if (
      siteStateRevision === 0
      && (initialSiteState.storageStatus === 'invalid'
        || initialSiteState.storageStatus === 'unavailable')
    ) return

    const saveResult = saveObservingSiteState(locations, selectedLocationIds)
    const updateWarning = window.setTimeout(() => {
      if (saveResult === 'unavailable') {
        setSiteStorageWarning(
          'Browser storage is unavailable. Changes will be kept only until this page is closed.',
        )
      } else if (saveResult === 'invalid') {
        setSiteStorageWarning('Site changes contain invalid values and have not been saved.')
      } else {
        setSiteStorageWarning(null)
      }
    }, 0)
    return () => window.clearTimeout(updateWarning)
  }, [initialSiteState.storageStatus, locations, selectedLocationIds, siteStateRevision])

  const invalidateResults = () => {
    activeRequest.current?.abort()
    setResponse(null)
    setSelectedResultId(null)
    setOverviewTargetIds(new Set())
    setStatus('idle')
    setError(null)
  }

  const updateLocation = (next: ObserverLocation) => {
    invalidateResults()
    setSiteStateRevision((current) => current + 1)
    setLocations((current) => current.map((location) => (
      location.id === next.id ? next : location
    )))
  }

  const toggleLocation = (id: string) => {
    const selected = selectedLocationIds.has(id)
    if (!selected && selectedLocationIds.size >= MAXIMUM_SELECTED_SITES) return
    invalidateResults()
    setSiteStateRevision((current) => current + 1)
    setSelectedLocationIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else {
        if (next.size >= MAXIMUM_SELECTED_SITES) return current
        next.add(id)
      }
      if (next.size > 0) setLocationSelectionError(false)
      return next
    })
  }

  const createLocation = (location: ObserverLocation) => {
    if (locations.length >= MAXIMUM_SAVED_SITES) return
    if (locations.some((savedLocation) => savedLocation.id === location.id)) return
    invalidateResults()
    setSiteStateRevision((current) => current + 1)
    setLocations((current) => [...current, location])
  }

  const deleteLocation = (id: string) => {
    if (isDefaultObservingSite(id)) return
    invalidateResults()
    setSiteStateRevision((current) => current + 1)
    setLocations((current) => current.filter((location) => location.id !== id))
    setSelectedLocationIds((current) => {
      const next = new Set(current)
      next.delete(id)
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

  const toggleImportedSource = (source: ExternalCatalogSource) => {
    const isSelected = selectedImportedTargetIds.has(source.id)
    if (
      !isSelected
      && selectedTargetIds.size + selectedImportedTargetIds.size >= MAXIMUM_TARGET_COUNT
    ) return
    invalidateResults()
    setImportedTargets((current) => {
      const next = new Map(current)
      next.set(source.id, snapshotCatalogSource(source))
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
      setError('This time range and calculation interval produce fewer than two time points. Adjust either value.')
      setStatus('error')
      return
    }

    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    setStatus('loading')
    setError(null)

    const payload: VisibilityRequest = {
      locations: selectedLocations
        .slice(0, MAXIMUM_SELECTED_SITES)
        .map((location) => ({
          id: location.id,
          name: location.name,
          latitude_deg: location.latitude_deg,
          longitude_deg: location.longitude_deg,
          elevation_m: location.elevation_m,
        })),
      center_time_utc: toUtcIso(centerTime),
      hours_before: hoursBefore,
      hours_after: hoursAfter,
      step_minutes: stepMinutes,
      minimum_altitude_deg: minimumAltitude,
      include_fov: analysisTab === 'burstt',
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
      setResultRevision((revision) => revision + 1)
      const firstVisible = nextResponse.targets.find((target) => target.simultaneous_visible)
      setSelectedResultId(firstVisible?.id ?? (analysisTab === 'burstt' ? nextResponse.targets[0]?.id ?? null : null))
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

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const tabs: AppTab[] = ['visibility', 'burstt', 'sites', 'catalog']
    const currentIndex = tabs.indexOf(activeTab)
    let nextIndex: number | null = null
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = tabs.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    const nextTab = tabs[nextIndex]
    activateTab(nextTab)
    document.getElementById(TAB_IDS[nextTab])?.focus()
  }

  const activateTab = (nextTab: AppTab, moveFocus = false) => {
    if ((nextTab === 'visibility' || nextTab === 'burstt') && nextTab !== analysisTab) {
      invalidateResults()
      setAnalysisTab(nextTab)
    }
    setActiveTab(nextTab)
    if (moveFocus) {
      window.setTimeout(() => document.getElementById(TAB_IDS[nextTab])?.focus(), 0)
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#visibility-panel" aria-label="Mutual Sky home" onClick={() => activateTab('visibility')}>
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
          tabIndex={activeTab === 'visibility' ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => activateTab('visibility')}
        >
          Observation Visibility
        </button>
        <button
          id="burstt-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'burstt'}
          aria-controls="burstt-panel"
          tabIndex={activeTab === 'burstt' ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => activateTab('burstt')}
        >
          BURSTT FoV
        </button>
        <button
          id="observing-sites-tab"
          type="button"
          role="tab"
          aria-selected={activeTab === 'sites'}
          aria-controls="observing-sites-panel"
          tabIndex={activeTab === 'sites' ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => activateTab('sites')}
        >
          Observing Sites
          <span>{selectedLocationIds.size} / {MAXIMUM_SELECTED_SITES}</span>
        </button>
        <button
          id="catalog-tab"
          type="button"
          role="tab"
          aria-label="Catalog Search"
          aria-selected={activeTab === 'catalog'}
          aria-controls="catalog-panel"
          tabIndex={activeTab === 'catalog' ? 0 : -1}
          onKeyDown={handleTabKeyDown}
          onClick={() => activateTab('catalog')}
        >
          Catalog Search
          {selectedImportedTargetIds.size > 0 && <span>{selectedImportedTargetIds.size}</span>}
        </button>
      </nav>

      <div
        id={analysisTab === 'visibility' ? 'burstt-panel' : 'visibility-panel'}
        role="tabpanel"
        aria-labelledby={analysisTab === 'visibility' ? 'burstt-tab' : 'visibility-tab'}
        hidden
      />
      <main
        id={`${analysisTab}-panel`}
        className={`workspace ${analysisTab === 'burstt' ? 'burstt-workspace' : ''}`}
        role="tabpanel"
        aria-labelledby={TAB_IDS[analysisTab]}
        hidden={activeTab !== analysisTab}
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
              <div className="location-section-heading">
                <p>{selectedLocationIds.size} / {MAXIMUM_SELECTED_SITES} selected</p>
                <button type="button" className="text-button" onClick={() => activateTab('sites', true)}>
                  Manage Sites
                </button>
              </div>
              <div className="locations-stack">
                {locations.map((location, index) => (
                  <LocationEditor
                    key={location.id}
                    location={location}
                    index={index}
                    selectionOrder={selectedLocationIds.has(location.id)
                      ? selectedLocations.findIndex((site) => site.id === location.id) + 1
                      : null}
                    selected={selectedLocationIds.has(location.id)}
                    selectionDisabled={
                      !selectedLocationIds.has(location.id)
                      && selectedLocationIds.size >= MAXIMUM_SELECTED_SITES
                    }
                    onToggle={() => toggleLocation(location.id)}
                    onChange={updateLocation}
                  />
                ))}
              </div>
              {selectedLocationIds.size >= MAXIMUM_SELECTED_SITES && (
                <p id="main-site-selection-limit" className="site-limit-note">
                  {MAXIMUM_SELECTED_SITES} sites are selected. Deselect one before choosing another.
                </p>
              )}
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
                  Targets Imported from Catalogs
                  <strong>{selectedImportedTargetIds.size} Selected / {importedTargets.size} Imported</strong>
                </p>
                <button type="button" className="text-button" onClick={() => activateTab('catalog', true)}>
                  Search Catalog
                </button>
              </div>
              {importedTargets.size > 0 ? (
                <div className="imported-target-list" aria-label="Imported catalog target list">
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
                        <small>
                          {target.catalog === 'lofar_dr3' ? 'LoTSS' : 'VLASS'} · {target.catalog_source_id}
                          {' · '}{target.ra_deg.toFixed(4)}°, {target.dec_deg.toFixed(4)}°
                        </small>
                        <small>
                          {target.catalog === 'lofar_dr3' ? 'LoTSS morphology' : 'VLASS component type'} {target.morphology_code
                            ? `${target.morphology_code} — ${target.morphology_label ?? 'No description'}`
                            : 'Unclassified'}
                          {' · '}SIMBAD type {target.object_type_label
                            ? `${target.object_type_label}${target.object_type_code ? ` (${target.object_type_code})` : ''}`
                            : 'None or unconfirmed'}
                        </small>
                        {target.catalog === 'vlass' && (
                          <small>
                            Quality {target.quality_flag ?? '—'} · Duplicate {target.duplicate_flag ?? '—'} ·{' '}
                            {target.main_sample ? 'Main sample' : 'Outside main sample'}
                          </small>
                        )}
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
                <p className="imported-target-empty">Search the Catalog tab to add targets to the calculation.</p>
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
              key={resultRevision}
              response={response}
              mode={analysisTab}
              selectedId={selectedResultId}
              onSelect={setSelectedResultId}
              overviewTargetIds={overviewTargetIds}
              onOverviewSelectionChange={setOverviewTargetIds}
            />
          )}
        </section>
      </main>

      <ObservingSitePanel
        hidden={activeTab !== 'sites'}
        locations={locations}
        selectedLocationIds={selectedLocationIds}
        maximumSelected={MAXIMUM_SELECTED_SITES}
        maximumSaved={MAXIMUM_SAVED_SITES}
        storageWarning={siteStorageWarning}
        onCreate={createLocation}
        onUpdate={updateLocation}
        onDelete={deleteLocation}
        onToggle={toggleLocation}
        onGoToVisibility={() => activateTab(analysisTab, true)}
      />

      <CatalogPanel
        hidden={activeTab !== 'catalog'}
        selectedSourceIds={selectedImportedTargetIds}
        selectedTargetCount={selectedTargetIds.size + selectedImportedTargetIds.size}
        maximumTargetCount={MAXIMUM_TARGET_COUNT}
        onToggleSource={toggleImportedSource}
        onGoToVisibility={() => activateTab(analysisTab, true)}
      />

    </div>
  )
}
