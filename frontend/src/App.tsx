import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'

import { calculateVisibility } from './api'
import { AltitudeChart } from './components/AltitudeChart'
import { getTargetColor } from './components/chartStyles'
import { VisibilityOverviewChart } from './components/VisibilityOverviewChart'
import type {
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
    name: 'Narrabri',
    latitude_deg: -30.31667,
    longitude_deg: 149.76667,
    elevation_m: 237,
  },
  {
    id: 'pyeongchang',
    name: '평창',
    latitude_deg: 37.36889,
    longitude_deg: 128.39028,
    elevation_m: 700,
  },
  {
    id: 'fushan',
    name: 'Fushan',
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

function NumericInput({
  id,
  label,
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
  const label = String.fromCharCode(65 + index)
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
          <p className="eyebrow">관측지 {label}</p>
          <label id={`${prefix}-title`} className="location-name-label">
            <span className="sr-only">관측지 {label} 이름</span>
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
            aria-label={`${location.name} 관측에 포함`}
            onChange={onToggle}
          />
          <span aria-hidden="true">{selected ? '포함' : '제외'}</span>
        </label>
      </div>
      <div className="coordinate-grid">
        <NumericInput
          id={`${prefix}-latitude`}
          label="위도"
          help="북위 + · 남위 −"
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
          label="경도"
          help="동경 + · 서경 −"
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
          label="해발고도"
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
        <p className="location-note">제공된 좌표 적용 · 해발고도 미지정으로 기본 0 m</p>
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
      <h2>선택한 하늘을 겹쳐 보는 중</h2>
      <p>각 관측지의 좌표를 변환하고 공통 가시 샘플을 계산하고 있습니다.</p>
      <div className="skeleton-chart" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <span className="sr-only">가시성 계산 중</span>
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
      <p className="eyebrow">첫 번째 관측 계획</p>
      <h2>원하는 관측지를 골라<br />하나의 공통 하늘로</h2>
      <p>
        한 곳부터 세 곳까지 선택하면, 선택한 모든 관측지에서 동시에 최소 고도 이상인
        천체를 시간축에서 비교합니다.
      </p>
      <div className="intro-key">
        <span><b>A</b> Narrabri</span>
        <i aria-hidden="true" />
        <span><b>B</b> 평창</span>
        <i aria-hidden="true" />
        <span><b>C</b> Fushan</span>
      </div>
    </div>
  )
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="result-state error-state" role="alert">
      <span className="state-symbol" aria-hidden="true">!</span>
      <p className="eyebrow">계산을 완료하지 못했습니다</p>
      <h2>연결 또는 입력을 확인해 주세요</h2>
      <p>{message}</p>
      <button className="secondary-button" type="button" onClick={onRetry}>
        다시 계산
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
      <p className="eyebrow">동시 가시 천체 0개</p>
      <h2>이 시간창에는 공통 천체가 없습니다</h2>
      <p>
        선택한 천체 중 {locationCount}개 관측지 모두에서 {minimumAltitude}° 이상인 샘플이 없습니다.
        시간 범위를 넓히거나 최소 고도를 낮춰 보세요.
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
        longestVisibility.label === '단일 샘플' ? '지속시간 미확정' : null,
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
        동시 관측 가능
      </span>
      <strong>{target.name}</strong>
      <span className="target-card-meta">
        {target.visible_intervals.length}개 샘플 묶음
        <i aria-hidden="true" />
        최고 공통 고도 {target.max_common_altitude_deg?.toFixed(1) ?? '—'}°
      </span>
      <span
        className="target-duration-metric"
        title={VISIBILITY_DURATION_NOTE}
        aria-describedby="target-duration-note"
      >
        <span>시간창 내 최장 공통 가시 구간</span>
        <strong>{durationLabel}</strong>
        <small>샘플 기준{durationQualifier ? ` · ${durationQualifier}` : ''}</small>
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
        longestVisibility.label === '단일 샘플' ? '지속시간 미확정' : null,
        longestVisibility.boundaryLabel,
      ].filter(Boolean).join(' · ')
    : null

  return (
    <div className="results-content">
      <header className="results-header">
        <div>
          <p className="eyebrow">계산 결과 · 샘플 기준</p>
          <h2>
            동시 관측 가능 <span>{visibleTargets.length}</span>
            <small>/ {response.targets.length}개</small>
          </h2>
        </div>
        <div className="result-window">
          <span>{formatUtcDateTime(response.times_utc[0])}</span>
          <i aria-hidden="true">→</i>
          <span>{formatUtcDateTime(response.times_utc.at(-1) ?? '')}</span>
        </div>
        <a className="overview-jump" href="#common-visibility-overview">
          전체 개요로 이동 <span aria-hidden="true">↓</span>
        </a>
      </header>

      <div className="target-results" role="tablist" aria-label="동시 가시 천체 선택">
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
        샘플 기준: 관측 가능 시간은 연속 계산 샘플의 첫·마지막 시각 사이 경과 길이입니다.
        샘플 사이 모든 순간의 연속 가시성을 보장하지 않습니다.
      </p>

      <section className="chart-panel" role="tabpanel" aria-label={`${target.name} 고도 그래프`}>
        <header className="chart-heading">
          <div>
            <span className="object-type">ICRS 고정 천체</span>
            <h3>{target.name}</h3>
            {target.aliases.length > 0 && (
              <p className="alias-list">{target.aliases.join(' · ')}</p>
            )}
          </div>
          <dl className="object-coordinates">
            <div>
              <dt>적경</dt>
              <dd>{formatCoordinate(target.ra_deg, 'ra')}</dd>
            </div>
            <div>
              <dt>적위</dt>
              <dd>{formatCoordinate(target.dec_deg, 'dec')}</dd>
            </div>
            <div>
              <dt>최고 공통 고도</dt>
              <dd>{target.max_common_altitude_deg?.toFixed(1) ?? '—'}°</dd>
            </div>
            <div
              className="duration-metric"
              title={VISIBILITY_DURATION_NOTE}
              aria-describedby="duration-method-note"
            >
              <dt>시간창 내 최장 공통 가시 구간</dt>
              <dd>
                {durationLabel}
                <small>
                  샘플 기준{durationQualifier ? ` · ${durationQualifier}` : ''}
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
            <strong>판정 기준</strong> 선택한 {target.location_series.length}개 관측지의 기하학적 고도가 모두 {minimumAltitude}° 이상인
            샘플과 연속 샘플 묶음을 강조합니다. 시간창 내 최장 구간은 가장 긴 묶음의 첫·마지막 샘플
            사이 경과 길이이며, 단일 가시 샘플은 지속시간 미확정으로 표시합니다. 샘플 사이 모든
            순간의 연속 가시성을 보장하지 않으며, 대기 굴절(pressure=0), 지형, 날씨와 일광은
            반영하지 않습니다.
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
            <h3 id="overview-title">시간창 공통 가시 천체 전체 개요</h3>
            <p>
              선택한 카탈로그 천체 중, 전체 시간창의 하나 이상의 계산 샘플에서 모든 선택
              관측지의 고도가 동시에 {minimumAltitude}° 이상인 천체를 골라 전체 시간–고도 궤적을
              비교합니다.
            </p>
          </div>
          <span className="overview-count" aria-live="polite">
            {plottedTargets.length} / {visibleTargets.length}개 표시
          </span>
        </header>

        <fieldset className="overview-target-selector">
          <legend>개요 그래프에 표시할 천체</legend>
          <div className="overview-selector-actions">
            <span>관측 가능 시간대가 존재하는 천체만 선택할 수 있습니다.</span>
            <div>
              <button
                type="button"
                onClick={() => onOverviewSelectionChange(
                  new Set(visibleTargets.map((candidate) => candidate.id)),
                )}
                disabled={plottedTargets.length === visibleTargets.length}
              >
                관측 가능 천체 모두 표시
              </button>
              <button
                type="button"
                onClick={() => onOverviewSelectionChange(new Set())}
                disabled={plottedTargets.length === 0}
              >
                모두 숨기기
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
                    aria-label={`개요 그래프에 ${candidate.name} 표시`}
                    onChange={() => toggleOverviewTarget(candidate.id)}
                  />
                  <span className="overview-option-check" aria-hidden="true">✓</span>
                  <span className="overview-option-dot" aria-hidden="true" />
                  <span>
                    <strong>{candidate.name}</strong>
                    <small>최장 공통 가시 {longest?.label ?? '—'}</small>
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
            <strong>읽는 법</strong> 선택 목록의 천체는 계산 시간창 안의 하나 이상의 계산 샘플에서
            선택한 모든 관측지의 고도가 동시에 {minimumAltitude}° 이상입니다. 그중 체크한 천체만
            그래프·범례·수치 표에 표시합니다. 시간창의 모든 시각에 관측 가능하다는 뜻은 아니며,
            세로 참조선은 입력한 중심 UTC에 가장 가까운 샘플입니다.
          </p>
        </div>
      </section>
    </div>
  )
}

export default function App() {
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
    invalidateResults()
    setSelectedTargetIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (next.size > 0) setSelectionError(false)
      return next
    })
  }

  const handleSubmit = async (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault()
    if (selectedLocationIds.size === 0) {
      setLocationSelectionError(true)
      return
    }
    if (selectedTargetIds.size === 0) {
      setSelectionError(true)
      return
    }

    const sampleCount =
      Math.floor((hoursBefore * 60) / stepMinutes) +
      Math.floor((hoursAfter * 60) / stepMinutes) +
      1
    if (sampleCount < 2) {
      setError('현재 시간 범위와 계산 간격으로는 샘플이 1개뿐입니다. 최소 2개가 되도록 조정해 주세요.')
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
      setError(caught instanceof Error ? caught.message : '알 수 없는 오류가 발생했습니다.')
      setStatus('error')
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#main-content" aria-label="공통하늘 홈">
          <span className="brand-mark" aria-hidden="true"><i /></span>
          <span><b>공통하늘</b><small>Mutual Sky</small></span>
        </a>
        <p className="topbar-description">선택한 관측지의 천체 가시성 비교</p>
        <span className="utc-badge"><i aria-hidden="true" />모든 시각은 UTC</span>
      </header>

      <main id="main-content" className="workspace">
        <aside className="control-panel" aria-labelledby="conditions-title">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Observation setup</p>
              <h1 id="conditions-title">관측 조건</h1>
            </div>
            <span className="step-chip">01</span>
          </div>

          <form onSubmit={handleSubmit} aria-busy={status === 'loading'}>
            <fieldset disabled={status === 'loading'}>
              <legend className="section-legend"><span>01</span>관측 위치</legend>
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
                <p className="field-error" role="alert">관측지를 하나 이상 선택해 주세요.</p>
              )}
            </fieldset>

            <fieldset disabled={status === 'loading'}>
              <legend className="section-legend"><span>02</span>시간과 판정</legend>
              <div className="time-grid">
                <label className="field datetime-field" htmlFor="center-time">
                  <span className="field-label">
                    기준 시각 <strong>UTC</strong>
                    <small id="center-time-help">현지 시각이 아닌 협정세계시</small>
                  </span>
                  <span className="input-shell">
                    <input
                      id="center-time"
                      type="datetime-local"
                      value={centerTime}
                      aria-describedby="center-time-help"
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
                  label="이전"
                  value={hoursBefore}
                  min={0.25}
                  max={72}
                  step={0.25}
                  suffix="시간"
                  onChange={(value) => {
                    invalidateResults()
                    setHoursBefore(value)
                  }}
                />
                <NumericInput
                  id="hours-after"
                  label="이후"
                  value={hoursAfter}
                  min={0.25}
                  max={72}
                  step={0.25}
                  suffix="시간"
                  onChange={(value) => {
                    invalidateResults()
                    setHoursAfter(value)
                  }}
                />
                <NumericInput
                  id="step-minutes"
                  label="계산 간격"
                  value={stepMinutes}
                  min={1}
                  max={180}
                  step={1}
                  suffix="분"
                  onChange={(value) => {
                    invalidateResults()
                    setStepMinutes(value)
                  }}
                />
                <NumericInput
                  id="minimum-altitude"
                  label="최소 고도"
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
              <legend className="section-legend"><span>03</span>천체 카탈로그</legend>
              <div className="target-heading-row">
                <p>3C 전파원</p>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    invalidateResults()
                    if (selectedTargetIds.size !== CATALOG_TARGETS.length) {
                      setSelectionError(false)
                    }
                    setSelectedTargetIds(
                      selectedTargetIds.size === CATALOG_TARGETS.length
                        ? new Set()
                        : new Set(CATALOG_TARGETS.map((target) => target.id)),
                    )
                  }}
                >
                  {selectedTargetIds.size === CATALOG_TARGETS.length ? '전체 해제' : '전체 선택'}
                </button>
              </div>
              <div className="target-checks">
                {CATALOG_TARGETS.map((target) => (
                  <label key={target.id} className="target-check">
                    <input
                      type="checkbox"
                      checked={selectedTargetIds.has(target.id)}
                      onChange={() => toggleTarget(target.id)}
                    />
                    <span className="custom-check" aria-hidden="true">✓</span>
                    <span>
                      <b>{target.name}</b>
                      <small>{target.coordinate}</small>
                    </span>
                  </label>
                ))}
              </div>
              {selectionError && (
                <p className="field-error" role="alert">계산할 천체를 하나 이상 선택해 주세요.</p>
              )}
            </fieldset>

            <button className="calculate-button" type="submit" disabled={status === 'loading'}>
              {status === 'loading' ? (
                <><span className="button-spinner" aria-hidden="true" />계산 중…</>
              ) : (
                <><span aria-hidden="true">✦</span>공통 가시성 계산</>
              )}
            </button>
          </form>
        </aside>

        <section className="result-panel" aria-label="가시성 계산 결과">
          {status === 'idle' && <IntroState />}
          {status === 'loading' && <ResultSkeleton />}
          {status === 'error' && (
            <ErrorState message={error ?? '오류가 발생했습니다.'} onRetry={() => void handleSubmit()} />
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

      <footer className="footer-note">
        기준 좌표계 ICRS · 고도 좌표계 AltAz · 계산 결과는 관측 계획 참고용입니다.
      </footer>
    </div>
  )
}
