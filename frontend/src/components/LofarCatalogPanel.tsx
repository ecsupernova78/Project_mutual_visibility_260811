import { useEffect, useRef, useState, type FormEvent } from 'react'

import { coneSearchLofarSources, searchLofarSources } from '../api'
import type {
  LofarConeSearchParams,
  LofarConeSortField,
  LofarSearchParams,
  LofarSearchResponse,
  LofarSortField,
  LofarSource,
  SortDirection,
} from '../types'

type SearchMode = 'brightness' | 'cone'
type SearchStatus = 'idle' | 'loading' | 'success' | 'error'
type SearchRequest =
  | { mode: 'brightness'; params: LofarSearchParams }
  | { mode: 'cone'; params: LofarConeSearchParams }

interface ModeState {
  status: SearchStatus
  error: string | null
  notice: string | null
  canRetry: boolean
  response: LofarSearchResponse | null
  currentPage: number
}

const LOCAL_PAGE_SIZE = 25
const RESULT_LIMIT_OPTIONS = [10, 25, 50, 100, 250, 500, 1000] as const
const SOURCE_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+.-]{0,79}$/

function emptyModeState(): ModeState {
  return {
    status: 'idle',
    error: null,
    notice: null,
    canRetry: false,
    response: null,
    currentPage: 1,
  }
}

function buildBrightnessAdqlPreview(
  sourcePrefix: string,
  sortBy: LofarSortField,
  sortDirection: SortDirection,
  limit: number,
) {
  const normalizedPrefix = sourcePrefix.trim()
  const sortColumn = sortBy === 'total_flux' ? 'Total_flux' : 'Peak_flux'
  const direction = sortDirection === 'desc' ? 'DESC' : 'ASC'
  const escapedPrefix = normalizedPrefix.replaceAll("'", "''")
  const predicates = [
    `${sortColumn} IS NOT NULL`,
    ...(normalizedPrefix ? [`1=ivo_nocasematch(Source_Name, '${escapedPrefix}%')`] : []),
  ]
  return [
    `SELECT TOP ${limit}`,
    '  Source_Name, RA, DEC, Total_flux, Peak_flux, S_Code',
    'FROM lotss_dr3.main_sources',
    `WHERE ${predicates.join('\n  AND ')}`,
    `ORDER BY ${sortColumn} ${direction}, Source_Name ASC`,
  ].join('\n')
}

function validNumber(value: string, minimum: number, maximum: number, includeMaximum = true) {
  if (!value.trim()) return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && (includeMaximum ? parsed <= maximum : parsed < maximum)
}

function buildConeAdqlPreview(
  ra: string,
  dec: string,
  radiusArcmin: string,
  sortBy: LofarConeSortField,
  sortDirection: SortDirection,
  limit: number,
) {
  const safeRa = validNumber(ra, 0, 360, false) ? Number(ra) : '<RA_DEG>'
  const safeDec = validNumber(dec, -90, 90) ? Number(dec) : '<DEC_DEG>'
  const safeRadius = validNumber(radiusArcmin, 0.1, 60) ? Number(radiusArcmin) : '<RADIUS_ARCMIN>'
  const sortColumn = sortBy === 'distance'
    ? 'Separation_deg'
    : sortBy === 'total_flux' ? 'Total_flux' : 'Peak_flux'
  const direction = sortDirection === 'desc' ? 'DESC' : 'ASC'
  return [
    `SELECT TOP ${limit}`,
    '  Source_Name, RA, DEC, Total_flux, Peak_flux, S_Code,',
    `  DISTANCE(POINT('ICRS', RA, DEC), POINT('ICRS', ${safeRa}, ${safeDec})) AS Separation_deg`,
    'FROM lotss_dr3.main_sources',
    `WHERE 1=CONTAINS(POINT('ICRS', RA, DEC), CIRCLE('ICRS', ${safeRa}, ${safeDec}, ${safeRadius}/60.0))`,
    `ORDER BY ${sortColumn} ${direction}, Source_Name ASC`,
  ].join('\n')
}

interface LofarCatalogPanelProps {
  hidden: boolean
  selectedSourceIds: ReadonlySet<string>
  selectedTargetCount: number
  maximumTargetCount: number
  onToggleSource: (source: LofarSource) => void
  onGoToVisibility: () => void
}

function formatFlux(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(value)
}

function formatAngularDistance(value: number | null | undefined, unit: 'arcmin' | 'arcsec') {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  const digits = value < 10 ? 2 : 1
  return `${value.toFixed(digits)}${unit === 'arcmin' ? '′' : '″'}`
}

export function LofarCatalogPanel({
  hidden,
  selectedSourceIds,
  selectedTargetCount,
  maximumTargetCount,
  onToggleSource,
  onGoToVisibility,
}: LofarCatalogPanelProps) {
  const [mode, setMode] = useState<SearchMode>('brightness')
  const [sourcePrefix, setSourcePrefix] = useState('')
  const [sortBy, setSortBy] = useState<LofarSortField>('total_flux')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [limit, setLimit] = useState(100)
  const [coneRa, setConeRa] = useState('')
  const [coneDec, setConeDec] = useState('')
  const [coneRadius, setConeRadius] = useState('5')
  const [coneSortBy, setConeSortBy] = useState<LofarConeSortField>('distance')
  const [coneSortDirection, setConeSortDirection] = useState<SortDirection>('asc')
  const [coneLimit, setConeLimit] = useState(100)
  const [modeStates, setModeStates] = useState<Record<SearchMode, ModeState>>(() => ({
    brightness: emptyModeState(),
    cone: emptyModeState(),
  }))
  const lastSearch = useRef<Partial<Record<SearchMode, SearchRequest>>>({})
  const activeRequest = useRef<{ controller: AbortController; mode: SearchMode } | null>(null)
  const activeState = modeStates[mode]
  const anyLoading = modeStates.brightness.status === 'loading' || modeStates.cone.status === 'loading'
  const normalizedPrefix = sourcePrefix.trim()
  const sourcePrefixInvalid = Boolean(normalizedPrefix && !SOURCE_PREFIX_PATTERN.test(normalizedPrefix))
  const coneRaInvalid = Boolean(coneRa && !validNumber(coneRa, 0, 360, false))
  const coneDecInvalid = Boolean(coneDec && !validNumber(coneDec, -90, 90))
  const coneRadiusInvalid = !validNumber(coneRadius, 0.1, 60)
  const adqlPreview = mode === 'brightness'
    ? buildBrightnessAdqlPreview(sourcePrefix, sortBy, sortDirection, limit)
    : buildConeAdqlPreview(coneRa, coneDec, coneRadius, coneSortBy, coneSortDirection, coneLimit)

  useEffect(() => () => activeRequest.current?.controller.abort(), [])

  const patchModeState = (targetMode: SearchMode, patch: Partial<ModeState>) => {
    setModeStates((current) => ({
      ...current,
      [targetMode]: { ...current[targetMode], ...patch },
    }))
  }

  const executeSearch = async (request: SearchRequest) => {
    activeRequest.current?.controller.abort()
    const controller = new AbortController()
    activeRequest.current = { controller, mode: request.mode }
    lastSearch.current[request.mode] = request
    patchModeState(request.mode, {
      status: 'loading',
      error: null,
      notice: null,
      canRetry: false,
    })

    try {
      const nextResponse = request.mode === 'brightness'
        ? await searchLofarSources(request.params, controller.signal)
        : await coneSearchLofarSources(request.params, controller.signal)
      if (controller.signal.aborted) return
      patchModeState(request.mode, {
        response: nextResponse,
        currentPage: 1,
        status: 'success',
      })
    } catch (caught) {
      if (controller.signal.aborted) return
      patchModeState(request.mode, {
        error: caught instanceof Error ? caught.message : 'LOFAR DR3 검색 중 오류가 발생했습니다.',
        canRetry: true,
        status: 'error',
      })
    } finally {
      if (activeRequest.current?.controller === controller) activeRequest.current = null
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mode === 'brightness') {
      if (sourcePrefixInvalid) {
        patchModeState(mode, {
          error: 'Source ID 앞부분은 영문자나 숫자로 시작하고, 이후에는 영문자, 숫자, +, 마침표, 하이픈만 입력해 주세요.',
          notice: null,
          canRetry: false,
          status: 'error',
        })
        return
      }
      void executeSearch({
        mode,
        params: {
          ...(normalizedPrefix ? { source_prefix: normalizedPrefix } : {}),
          sort_by: sortBy,
          sort_direction: sortDirection,
          limit,
        },
      })
      return
    }

    if (!validNumber(coneRa, 0, 360, false) || !validNumber(coneDec, -90, 90) || coneRadiusInvalid) {
      patchModeState(mode, {
        error: '중심 좌표는 RA 0° 이상 360° 미만, Dec −90° 이상 90° 이하로 입력하고 반경은 0.1–60 arcmin으로 지정해 주세요.',
        notice: null,
        canRetry: false,
        status: 'error',
      })
      return
    }
    void executeSearch({
      mode,
      params: {
        ra_deg: Number(coneRa),
        dec_deg: Number(coneDec),
        radius_arcmin: Number(coneRadius),
        sort_by: coneSortBy,
        sort_direction: coneSortDirection,
        limit: coneLimit,
      },
    })
  }

  const cancelSearch = () => {
    const active = activeRequest.current
    if (!active) return
    active.controller.abort()
    activeRequest.current = null
    const previousResponse = modeStates[active.mode].response
    patchModeState(active.mode, {
      status: previousResponse ? 'success' : 'idle',
      error: null,
      canRetry: false,
      notice: previousResponse
        ? '화면 대기를 중단했습니다. 이전 결과를 계속 표시합니다. 서버 작업은 계속될 수 있으며, 완료되거나 제한시간에 도달하면 정리됩니다.'
        : '화면 대기를 중단했습니다. 서버 작업은 계속될 수 있으며, 완료되거나 제한시간에 도달하면 정리됩니다.',
    })
  }

  const atTargetLimit = selectedTargetCount >= maximumTargetCount
  const submitLabel = mode === 'brightness' ? 'LOFAR DR3 목록 불러오기' : '좌표 주변 천체 검색'

  return (
    <main
      id="lofar-catalog-panel"
      className="catalog-workspace"
      role="tabpanel"
      aria-labelledby="lofar-catalog-tab"
      hidden={hidden}
    >
      <header className="catalog-hero">
        <div>
          <p className="eyebrow">LOFAR TWO-METRE SKY SURVEY · DATA RELEASE 3</p>
          <h1>LOFAR DR3 카탈로그</h1>
          <p>
            144 MHz 전파원을 밝기 순으로 살펴보거나 좌표 주변에서 찾은 뒤, 원하는 천체를 시간–고도 계산 대상에
            추가하세요. 알려진 이름과 물리 유형은 SIMBAD 위치 대응 결과를 함께 보여줍니다.
          </p>
          <p className="catalog-provenance">
            Data: <a href="https://lofar-surveys.org/dr3.html">LoTSS DR3 v1.0</a>
            <span aria-hidden="true"> · </span>
            <a href="https://vo.astron.nl/tableinfo/lotss_dr3.main_sources">ASTRON source table</a>
            <span aria-hidden="true"> · </span>
            <a href="https://simbad.cds.unistra.fr/simbad/">SIMBAD</a>
            <span aria-hidden="true"> · </span>
            <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>
          </p>
        </div>
        <div className="catalog-selection-summary" aria-live="polite">
          <span>계산 대상</span>
          <strong>{selectedTargetCount} / {maximumTargetCount}</strong>
          <button type="button" onClick={onGoToVisibility}>관측 설정으로 이동</button>
        </div>
      </header>

      <section className="catalog-search-card" aria-labelledby="lofar-search-title">
        <form onSubmit={handleSubmit} aria-busy={activeState.status === 'loading'} noValidate>
          <fieldset className="catalog-mode-switch" disabled={anyLoading}>
            <legend>검색 방식</legend>
            <label className={mode === 'brightness' ? 'is-active' : ''}>
              <input
                type="radio"
                name="catalog-search-mode"
                value="brightness"
                checked={mode === 'brightness'}
                onChange={() => setMode('brightness')}
              />
              <span><strong>밝기 순 목록</strong><small>카탈로그 전체의 밝은 전파원</small></span>
            </label>
            <label className={mode === 'cone' ? 'is-active' : ''}>
              <input
                type="radio"
                name="catalog-search-mode"
                value="cone"
                checked={mode === 'cone'}
                onChange={() => setMode('cone')}
              />
              <span><strong>좌표 주변 검색</strong><small>지정한 중심과 반경의 전파원</small></span>
            </label>
          </fieldset>

          <div className="catalog-search-heading">
            <div>
              <p className="eyebrow">TAP catalog query</p>
              <h2 id="lofar-search-title">{mode === 'brightness' ? '밝기 순 목록 불러오기' : 'Source cone search'}</h2>
            </div>
            <span>lotss_dr3.main_sources · 144 MHz</span>
          </div>

          {mode === 'brightness' ? (
            <fieldset className="catalog-query-fieldset" disabled={activeState.status === 'loading'}>
              <legend className="sr-only">LOFAR DR3 밝기 목록 조건</legend>
              <div className="catalog-query-grid">
                <label className="catalog-field catalog-name-query">
                  <span>Source ID 앞부분 (선택)</span>
                  <input
                    type="search"
                    value={sourcePrefix}
                    maxLength={80}
                    pattern="[A-Za-z0-9][A-Za-z0-9+.-]{0,79}"
                    title="영문자나 숫자로 시작하고, 이후에는 영문자, 숫자, +, 마침표, 하이픈만 입력할 수 있습니다."
                    placeholder="비워 두면 전체 카탈로그"
                    aria-describedby="lofar-search-help"
                    aria-invalid={sourcePrefixInvalid}
                    onChange={(event) => setSourcePrefix(event.currentTarget.value)}
                  />
                </label>
                <label className="catalog-field">
                  <span>밝기 기준</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.currentTarget.value as LofarSortField)}>
                    <option value="total_flux">총 플럭스</option>
                    <option value="peak_flux">피크 플럭스</option>
                  </select>
                </label>
                <label className="catalog-field">
                  <span>정렬 방향</span>
                  <select value={sortDirection} onChange={(event) => setSortDirection(event.currentTarget.value as SortDirection)}>
                    <option value="desc">밝은 순</option>
                    <option value="asc">어두운 순</option>
                  </select>
                </label>
                <ResultLimitField value={limit} onChange={setLimit} />
              </div>
            </fieldset>
          ) : (
            <fieldset className="catalog-query-fieldset" disabled={activeState.status === 'loading'}>
              <legend className="sr-only">LOFAR DR3 좌표 주변 검색 조건</legend>
              <div className="catalog-query-grid catalog-cone-grid">
                <label className="catalog-field">
                  <span>중심 RA (deg)</span>
                  <input
                    type="number"
                    min="0"
                    max="359.999999"
                    step="any"
                    required
                    value={coneRa}
                    placeholder="예: 69.26825"
                    aria-describedby="lofar-search-help"
                    aria-invalid={coneRaInvalid}
                    onChange={(event) => setConeRa(event.currentTarget.value)}
                  />
                </label>
                <label className="catalog-field">
                  <span>중심 Dec (deg)</span>
                  <input
                    type="number"
                    min="-90"
                    max="90"
                    step="any"
                    required
                    value={coneDec}
                    placeholder="예: 29.67052"
                    aria-describedby="lofar-search-help"
                    aria-invalid={coneDecInvalid}
                    onChange={(event) => setConeDec(event.currentTarget.value)}
                  />
                </label>
                <label className="catalog-field">
                  <span>검색 반경 (arcmin)</span>
                  <input
                    type="number"
                    min="0.1"
                    max="60"
                    step="0.1"
                    required
                    value={coneRadius}
                    aria-describedby="lofar-search-help"
                    aria-invalid={coneRadiusInvalid}
                    onChange={(event) => setConeRadius(event.currentTarget.value)}
                  />
                </label>
                <label className="catalog-field">
                  <span>정렬 기준</span>
                  <select value={coneSortBy} onChange={(event) => setConeSortBy(event.currentTarget.value as LofarConeSortField)}>
                    <option value="distance">중심 거리</option>
                    <option value="total_flux">총 플럭스</option>
                    <option value="peak_flux">피크 플럭스</option>
                  </select>
                </label>
                <label className="catalog-field">
                  <span>정렬 방향</span>
                  <select value={coneSortDirection} onChange={(event) => setConeSortDirection(event.currentTarget.value as SortDirection)}>
                    <option value="asc">가까운/낮은 값 순</option>
                    <option value="desc">먼/높은 값 순</option>
                  </select>
                </label>
                <ResultLimitField value={coneLimit} onChange={setConeLimit} />
              </div>
            </fieldset>
          )}

          <p id="lofar-search-help" className="catalog-form-help">
            {mode === 'brightness'
              ? 'Source ID를 비워 두면 선택한 밝기 기준의 전체 상위 목록을 가져옵니다.'
              : 'ICRS 십진도 좌표를 사용합니다. 반경은 0.1–60 arcmin이며 기본 정렬은 중심에서 가까운 순입니다.'}
            {' '}결과는 화면에서 25개씩 나누어 표시합니다.
          </p>
          <details className="catalog-query-preview">
            <summary>실행할 TAP 쿼리 보기</summary>
            <pre><code>{adqlPreview}</code></pre>
            <p>알려진 이름과 물리 유형은 이 LoTSS 결과에 SIMBAD 위치 대응을 추가한 정보입니다.</p>
          </details>
          <div className="catalog-search-actions">
            <button className="catalog-search-button" type="submit" disabled={activeState.status === 'loading'}>
              {activeState.status === 'loading' ? 'TAP 작업 실행 중…' : submitLabel}
            </button>
            {activeState.status === 'loading' && (
              <button className="catalog-cancel-button" type="button" onClick={cancelSearch}>
                화면 대기 중단
              </button>
            )}
          </div>
          {activeState.status === 'loading' && (
            <p className="catalog-cancel-help">
              화면 대기만 중단합니다. 서버 작업은 계속될 수 있으며, 완료되거나 제한시간에 도달하면 정리됩니다.
            </p>
          )}
          {activeState.notice && <p className="catalog-request-notice" role="status">{activeState.notice}</p>}
        </form>
      </section>

      <CatalogResults
        mode={mode}
        state={activeState}
        selectedSourceIds={selectedSourceIds}
        atTargetLimit={atTargetLimit}
        maximumTargetCount={maximumTargetCount}
        onToggleSource={onToggleSource}
        onRetry={activeState.canRetry
          ? () => {
              const previous = lastSearch.current[mode]
              if (previous) void executeSearch(previous)
            }
          : null}
        onChangePage={(page) => patchModeState(mode, { currentPage: page })}
      />
    </main>
  )
}

function ResultLimitField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <label className="catalog-field">
      <span>불러올 천체 수 (TOP)</span>
      <select value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {RESULT_LIMIT_OPTIONS.map((option) => (
          <option key={option} value={option}>{option}개</option>
        ))}
      </select>
    </label>
  )
}

function CatalogResults({
  mode,
  state,
  selectedSourceIds,
  atTargetLimit,
  maximumTargetCount,
  onToggleSource,
  onRetry,
  onChangePage,
}: {
  mode: SearchMode
  state: ModeState
  selectedSourceIds: ReadonlySet<string>
  atTargetLimit: boolean
  maximumTargetCount: number
  onToggleSource: (source: LofarSource) => void
  onRetry: (() => void) | null
  onChangePage: (page: number) => void
}) {
  const { status, error, response, currentPage } = state
  const sources = response?.sources ?? []
  const totalPages = Math.max(1, Math.ceil(sources.length / LOCAL_PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const rangeStart = sources.length === 0 ? 0 : (safePage - 1) * LOCAL_PAGE_SIZE + 1
  const rangeEnd = Math.min(safePage * LOCAL_PAGE_SIZE, sources.length)
  const pageSources = sources.slice(rangeStart === 0 ? 0 : rangeStart - 1, rangeEnd)
  const isCone = mode === 'cone'

  return (
    <section className="catalog-results-card" aria-labelledby="lofar-results-title" aria-busy={status === 'loading'}>
      <header className="catalog-results-heading">
        <div>
          <p className="eyebrow">Query results</p>
          <h2 id="lofar-results-title">{isCone ? '좌표 주변 검색 결과' : '밝기 순 카탈로그 결과'}</h2>
        </div>
        {response && <span>{response.result_count}개 반환 · TOP {response.limit}</span>}
      </header>

      {status === 'idle' && !response && (
        <div className="catalog-message">
          <strong>{isCone ? '중심 좌표와 검색 반경을 입력하세요.' : '목록 조건을 선택하세요.'}</strong>
          <span>{isCone ? '지정한 원뿔 영역 안의 LoTSS DR3 전파원을 찾습니다.' : '카탈로그 전체에서 밝기 순 상위 천체를 가져옵니다.'}</span>
        </div>
      )}
      {status === 'loading' && (
        <p className={response ? 'catalog-refresh-status' : 'catalog-inline-status'} role="status">
          <span className="button-spinner" aria-hidden="true" />
          ASTRON TAP 비동기 작업을 실행 중입니다. 이어서 알려진 이름을 확인하므로 결과 준비에 시간이 걸릴 수 있습니다.
        </p>
      )}
      {status === 'error' && (
        <div className={response ? 'catalog-error catalog-error-inline' : 'catalog-error'} role="alert">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry}>같은 조건으로 다시 시도</button>}
        </div>
      )}
      {status === 'success' && response && sources.length === 0 && (
        <div className="catalog-message">
          <strong>일치하는 천체가 없습니다.</strong>
          <span>{isCone ? '검색 반경을 넓히거나 중심 좌표를 확인해 주세요.' : 'Source ID 앞부분을 줄이거나 비워서 다시 불러오세요.'}</span>
        </div>
      )}

      {response && sources.length > 0 && (
        <>
          <p className="catalog-result-summary" role="status">
            {response.result_count}개 결과 · {sortLabel(response.sort_by)}{' '}
            {response.sort_direction === 'desc' ? '내림차순' : '오름차순'}
            {isCone
              ? ` · 중심 ${response.center_ra_deg ?? '—'}°, ${response.center_dec_deg ?? '—'}° · 반경 ${response.radius_arcmin ?? '—'}′`
              : response.source_prefix ? ` · Source ID “${response.source_prefix}”` : ' · 전체 카탈로그'}
          </p>
          <EnrichmentNotice response={response} />
          <SourceTypeLegend sources={sources} morphologyCodebook={response.morphology_codebook} />
          <div className="catalog-table-wrap">
            <table>
              <caption>LOFAR DR3 TAP 조회 결과. 체크한 천체는 관측 가시성 계산 대상으로 유지됩니다.</caption>
              <thead>
                <tr>
                  <th scope="col">계산</th>
                  <th scope="col">천체 이름</th>
                  <th scope="col">Source 유형</th>
                  <th scope="col">ICRS 좌표</th>
                  {isCone && (
                    <th scope="col" aria-sort={response.sort_by === 'distance' ? sortAria(response.sort_direction) : 'none'}>
                      중심 거리 <small>arcmin</small>
                    </th>
                  )}
                  <th scope="col" aria-sort={response.sort_by === 'total_flux' ? sortAria(response.sort_direction) : 'none'}>
                    총 플럭스 <small>mJy</small>
                  </th>
                  <th scope="col" aria-sort={response.sort_by === 'peak_flux' ? sortAria(response.sort_direction) : 'none'}>
                    피크 플럭스 <small>mJy/beam</small>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageSources.map((source) => {
                  const selected = selectedSourceIds.has(source.id)
                  const disabled = !selected && atTargetLimit
                  return (
                    <tr key={source.id} className={selected ? 'is-selected' : ''}>
                      <td>
                        <label className="catalog-row-select">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={disabled}
                            onChange={() => onToggleSource(source)}
                            aria-label={`${source.name} ${selected ? '계산 대상에서 제거' : '계산 대상에 추가'}`}
                          />
                          <span aria-hidden="true">✓</span>
                        </label>
                      </td>
                      <th scope="row">
                        <strong>{source.name}</strong>
                        {source.counterpart_name && <small>SIMBAD · {source.counterpart_name}</small>}
                        <small>LoTSS · {source.source_id}</small>
                        {(source.aliases?.length ?? 0) > 0 && (
                          <small className="catalog-aliases">별칭 · {source.aliases.slice(0, 3).join(' · ')}</small>
                        )}
                      </th>
                      <td><SourceClassification source={source} enrichmentStatus={response.enrichment_status} /></td>
                      <td><span className="catalog-coordinate">{source.ra_hms} · {source.dec_dms}</span></td>
                      {isCone && <td>{formatAngularDistance(source.separation_arcmin, 'arcmin')}</td>}
                      <td>{formatFlux(source.total_flux_mjy)}</td>
                      <td>{formatFlux(source.peak_flux_mjy)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <nav className="catalog-pagination" aria-label="LOFAR 결과 페이지">
              <button type="button" disabled={safePage <= 1} onClick={() => onChangePage(safePage - 1)}>이전</button>
              <span><strong>{safePage}</strong> / {totalPages}페이지 · {rangeStart}–{rangeEnd} / {sources.length}</span>
              <button type="button" disabled={safePage >= totalPages} onClick={() => onChangePage(safePage + 1)}>다음</button>
            </nav>
          )}
        </>
      )}

      {atTargetLimit && (
        <p className="catalog-limit-note" role="status">
          계산 대상은 기본 3C 천체와 LOFAR 천체를 합해 최대 {maximumTargetCount}개입니다.
        </p>
      )}
    </section>
  )
}

function sortLabel(sortBy: LofarConeSortField) {
  if (sortBy === 'distance') return '중심 거리'
  return sortBy === 'total_flux' ? '총 플럭스' : '피크 플럭스'
}

function sortAria(direction: SortDirection) {
  return direction === 'desc' ? 'descending' : 'ascending'
}

function EnrichmentNotice({ response }: { response: LofarSearchResponse }) {
  if (!response.enrichment_status || response.enrichment_status === 'complete') return null
  return (
    <p className={`catalog-enrichment-notice is-${response.enrichment_status}`} role="status">
      <strong>SIMBAD 이름·유형 보강 {response.enrichment_status === 'partial' ? '일부 완료' : '사용 불가'}</strong>
      <span>{response.enrichment_warning ?? 'LoTSS 좌표와 밝기 결과는 그대로 사용할 수 있습니다.'}</span>
    </p>
  )
}

function SourceClassification({
  source,
  enrichmentStatus,
}: {
  source: LofarSource
  enrichmentStatus: LofarSearchResponse['enrichment_status'] | undefined
}) {
  const hasCounterpart = Boolean(source.crossmatch_catalog && source.counterpart_name)
  return (
    <div className="catalog-classification">
      <span title={source.morphology_description ?? undefined}>
        <small>LoTSS 전파 형태</small>
        <b>{source.morphology_code
          ? `${source.morphology_code} — ${source.morphology_label ?? '설명 없음'}`
          : '미분류'}</b>
      </span>
      <span title={source.object_type_description ?? undefined}>
        <small>SIMBAD 물리 유형</small>
        <b>{source.object_type_label
          ? `${source.object_type_label}${source.object_type_code ? ` (${source.object_type_code})` : ''}`
          : hasCounterpart ? '유형 미분류' : '—'}</b>
      </span>
      {hasCounterpart && source.crossmatch_separation_arcsec !== null ? (
        <em className={`catalog-match-confidence is-${source.crossmatch_confidence ?? 'caution'}`}>
          {formatAngularDistance(source.crossmatch_separation_arcsec, 'arcsec')} 위치 후보
        </em>
      ) : (
        <em className="catalog-no-counterpart">
          {enrichmentStatus === 'complete' ? 'SIMBAD 5″ 내 대응 없음' : 'SIMBAD 대응 확인 안 됨'}
        </em>
      )}
    </div>
  )
}

function SourceTypeLegend({
  sources,
  morphologyCodebook,
}: {
  sources: LofarSource[]
  morphologyCodebook?: LofarSearchResponse['morphology_codebook']
}) {
  const simbadTypes = new Map<string, { label: string; description: string | null }>()
  for (const source of sources) {
    if (source.object_type_code && source.object_type_label && !simbadTypes.has(source.object_type_code)) {
      simbadTypes.set(source.object_type_code, {
        label: source.object_type_label,
        description: source.object_type_description,
      })
    }
  }
  const morphologyDefinitions = morphologyCodebook?.length ? morphologyCodebook : [
    { code: 'S' as const, label: '단일 Gaussian', description: '' },
    { code: 'M' as const, label: '복수 Gaussian으로 구성된 source', description: '' },
    { code: 'C' as const, label: '다른 source와 같은 island 안의 단일 Gaussian', description: '' },
  ]
  return (
    <details className="catalog-code-legend">
      <summary>Source 유형 코드표와 위치 대응 기준</summary>
      <div className="catalog-code-legend-grid">
        <section>
          <h3>LoTSS 전파 형태 (S_Code)</h3>
          <p>물리적 천체 종류가 아니라 전파 영상에서 source를 구성한 Gaussian 형태입니다.</p>
          <dl>
            {morphologyDefinitions.map((definition) => (
              <div key={definition.code}>
                <dt>{definition.code}</dt>
                <dd>{definition.label}{definition.description ? ` — ${definition.description}` : ''}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h3>SIMBAD 물리 유형</h3>
          <p>LoTSS 좌표에서 5″ 이내의 SIMBAD 위치 후보입니다. 이름과 분류는 동일 천체임을 확정하는 판정이 아닙니다.</p>
          {simbadTypes.size > 0 ? (
            <dl>
              {[...simbadTypes].map(([code, value]) => (
                <div key={code}>
                  <dt>{code}</dt>
                  <dd>{value.label}{value.description ? ` — ${value.description}` : ''}</dd>
                </div>
              ))}
            </dl>
          ) : <p>현재 결과에 표시할 SIMBAD 유형 코드가 없습니다.</p>}
          <a href="https://simbad.cds.unistra.fr/Pages/guide/otypes_desc.htx">SIMBAD 공식 유형 코드표</a>
        </section>
      </div>
    </details>
  )
}
