import { useEffect, useRef, useState, type FormEvent } from 'react'

import { searchLofarSources } from '../api'
import type {
  LofarQueryMode,
  LofarSearchParams,
  LofarSearchResponse,
  LofarSortField,
  LofarSource,
  SortDirection,
} from '../types'

type SearchStatus = 'idle' | 'loading' | 'success' | 'error'

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

export function LofarCatalogPanel({
  hidden,
  selectedSourceIds,
  selectedTargetCount,
  maximumTargetCount,
  onToggleSource,
  onGoToVisibility,
}: LofarCatalogPanelProps) {
  const [mode, setMode] = useState<LofarQueryMode>('name')
  const [nameQuery, setNameQuery] = useState('')
  const [raDeg, setRaDeg] = useState(180)
  const [decDeg, setDecDeg] = useState(45)
  const [radiusArcmin, setRadiusArcmin] = useState(30)
  const [sortBy, setSortBy] = useState<LofarSortField>('total_flux')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [pageSize, setPageSize] = useState(20)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [response, setResponse] = useState<LofarSearchResponse | null>(null)
  const [appliedSort, setAppliedSort] = useState<{
    field: LofarSortField
    direction: SortDirection
  }>({ field: 'total_flux', direction: 'desc' })
  const lastSearch = useRef<LofarSearchParams | null>(null)
  const activeRequest = useRef<AbortController | null>(null)

  useEffect(() => () => activeRequest.current?.abort(), [])

  const executeSearch = async (params: LofarSearchParams) => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    lastSearch.current = params
    setStatus('loading')
    setError(null)
    setCanRetry(false)

    try {
      const nextResponse = await searchLofarSources(params, controller.signal)
      if (controller.signal.aborted) return
      setResponse(nextResponse)
      setAppliedSort({ field: params.sort_by, direction: params.sort_direction })
      setStatus('success')
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : 'LOFAR DR3 검색 중 오류가 발생했습니다.')
      setCanRetry(true)
      setStatus('error')
    }
  }

  const buildCurrentSearch = (page = 1): LofarSearchParams => ({
    mode,
    ...(mode === 'name'
      ? { query: nameQuery.trim() }
      : { ra_deg: raDeg, dec_deg: decDeg, radius_arcmin: radiusArcmin }),
    sort_by: sortBy,
    sort_direction: sortDirection,
    page,
    page_size: pageSize,
  })

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (mode === 'name' && !/^[A-Za-z0-9+.-]{8,80}$/.test(nameQuery.trim())) {
      setError('Source ID 앞부분을 허용된 문자로 8자 이상 입력해 주세요.')
      setCanRetry(false)
      setStatus('error')
      return
    }
    void executeSearch(buildCurrentSearch())
  }

  const changePage = (page: number) => {
    const previous = lastSearch.current
    if (!previous || page < 1) return
    void executeSearch({ ...previous, page })
  }

  const atTargetLimit = selectedTargetCount >= maximumTargetCount

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
            LoTSS Source ID 앞부분 또는 ICRS 좌표로 전파원을 찾고 밝기 순으로 정렬한 뒤, 시간–고도 계산 대상에
            추가하세요.
          </p>
          <p className="catalog-provenance">
            Data: <a href="https://lofar-surveys.org/dr3.html">LoTSS DR3 v1.0</a>
            <span aria-hidden="true"> · </span>
            <a href="https://vo.astron.nl/tableinfo/lotss_dr3.main_sources">ASTRON source table</a>
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
        <form onSubmit={handleSubmit} aria-busy={status === 'loading'}>
          <div className="catalog-search-heading">
            <div>
              <p className="eyebrow">Catalog query</p>
              <h2 id="lofar-search-title">천체 검색</h2>
            </div>
            <span>밝기 기준: 144 MHz</span>
          </div>

          <fieldset className="query-mode-fieldset" disabled={status === 'loading'}>
              <legend>검색 방식</legend>
              <div className="segmented-control">
                <label>
                  <input type="radio" name="lofar-query-mode" value="name" checked={mode === 'name'} onChange={() => setMode('name')} />
                  <span>Source ID 앞부분</span>
                </label>
                <label>
                  <input type="radio" name="lofar-query-mode" value="cone" checked={mode === 'cone'} onChange={() => setMode('cone')} />
                  <span>좌표 반경</span>
                </label>
              </div>
          </fieldset>

          <fieldset className="catalog-query-fieldset" disabled={status === 'loading'}>
            <legend className="sr-only">LOFAR DR3 검색 상세 조건</legend>
            <div className="catalog-query-grid">
            {mode === 'name' ? (
              <label className="catalog-field catalog-name-query">
                <span>Source ID 앞 8자 이상</span>
                <input
                  type="search"
                  value={nameQuery}
                  minLength={8}
                  maxLength={80}
                  pattern="[A-Za-z0-9+.-]+"
                  title="영문자, 숫자, +, 마침표, 하이픈만 입력할 수 있습니다."
                  placeholder="예: ILTJ1234"
                  required
                  onChange={(event) => setNameQuery(event.currentTarget.value)}
                />
              </label>
            ) : (
              <>
                <CatalogNumberInput label="적경 RA" value={raDeg} min={0} max={359.999999} suffix="deg" onChange={setRaDeg} />
                <CatalogNumberInput label="적위 Dec" value={decDeg} min={-90} max={90} suffix="deg" onChange={setDecDeg} />
                <CatalogNumberInput label="검색 반경" value={radiusArcmin} min={0.1} max={60} suffix="arcmin" onChange={setRadiusArcmin} />
              </>
            )}

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
            <label className="catalog-field">
              <span>페이지당 결과</span>
              <select value={pageSize} onChange={(event) => setPageSize(Number(event.currentTarget.value))}>
                <option value={20}>20개</option>
                <option value={50}>50개</option>
              </select>
            </label>
            <button className="catalog-search-button" type="submit" disabled={status === 'loading'}>
              {status === 'loading' ? '검색 중…' : 'LOFAR DR3 검색'}
            </button>
            </div>
          </fieldset>
        </form>
      </section>

      <CatalogResults
        status={status}
        error={error}
        response={response}
        selectedSourceIds={selectedSourceIds}
        atTargetLimit={atTargetLimit}
        maximumTargetCount={maximumTargetCount}
        sortBy={appliedSort.field}
        sortDirection={appliedSort.direction}
        onToggleSource={onToggleSource}
        onRetry={canRetry
          ? () => {
              const previous = lastSearch.current
              if (previous) void executeSearch(previous)
            }
          : null}
        onChangePage={changePage}
      />
    </main>
  )
}

function CatalogNumberInput({
  label,
  value,
  min,
  max,
  suffix,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  suffix: string
  onChange: (value: number) => void
}) {
  return (
    <label className="catalog-field">
      <span>{label}</span>
      <span className="catalog-input-shell">
        <input type="number" value={Number.isFinite(value) ? value : ''} min={min} max={max} step="any" required onChange={(event) => onChange(event.currentTarget.valueAsNumber)} />
        <i>{suffix}</i>
      </span>
    </label>
  )
}

function CatalogResults({
  status,
  error,
  response,
  selectedSourceIds,
  atTargetLimit,
  maximumTargetCount,
  sortBy,
  sortDirection,
  onToggleSource,
  onRetry,
  onChangePage,
}: {
  status: SearchStatus
  error: string | null
  response: LofarSearchResponse | null
  selectedSourceIds: ReadonlySet<string>
  atTargetLimit: boolean
  maximumTargetCount: number
  sortBy: LofarSortField
  sortDirection: SortDirection
  onToggleSource: (source: LofarSource) => void
  onRetry: (() => void) | null
  onChangePage: (page: number) => void
}) {
  const sources = response?.sources ?? []
  const currentPage = response?.page ?? 1

  return (
    <section className="catalog-results-card" aria-labelledby="lofar-results-title" aria-busy={status === 'loading'}>
      <header className="catalog-results-heading">
        <div>
          <p className="eyebrow">Query results</p>
          <h2 id="lofar-results-title">검색 결과</h2>
        </div>
        {status === 'success' && response && <span>{response.sources.length}개 · {response.page}페이지</span>}
      </header>

      {status === 'idle' && (
        <div className="catalog-message">
          <strong>검색 조건을 입력하세요.</strong>
          <span>결과는 서버에서 밝기 순으로 정렬해 가져옵니다.</span>
        </div>
      )}
      {status === 'loading' && (
        <p className="catalog-inline-status" role="status">
          <span className="button-spinner" aria-hidden="true" /> LOFAR DR3를 검색하고 있습니다.
        </p>
      )}
      {status === 'error' && (
        <div className="catalog-error" role="alert">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry}>다시 시도</button>}
        </div>
      )}
      {status === 'success' && sources.length === 0 && (
        <div className="catalog-message">
          <strong>일치하는 천체가 없습니다.</strong>
          <span>검색어를 줄이거나 좌표 반경을 넓혀 보세요.</span>
        </div>
      )}

      {status === 'success' && response && sources.length > 0 && (
        <>
          <div className="catalog-table-wrap">
            <table>
              <caption>LOFAR DR3 검색 결과. 체크한 천체는 관측 가시성 계산 대상으로 유지됩니다.</caption>
              <thead>
                <tr>
                  <th scope="col">계산</th>
                  <th scope="col">Source</th>
                  <th scope="col">ICRS 좌표</th>
                  <th
                    scope="col"
                    aria-sort={sortBy === 'total_flux' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none'}
                  >
                    총 플럭스 <small>mJy</small>
                  </th>
                  <th
                    scope="col"
                    aria-sort={sortBy === 'peak_flux' ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none'}
                  >
                    피크 플럭스 <small>mJy/beam</small>
                  </th>
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => {
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
                        <small>{source.source_id}</small>
                      </th>
                      <td><span className="catalog-coordinate">{source.ra_hms} · {source.dec_dms}</span></td>
                      <td>{formatFlux(source.total_flux_mjy)}</td>
                      <td>{formatFlux(source.peak_flux_mjy)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <nav className="catalog-pagination" aria-label="LOFAR 검색 결과 페이지">
            <button type="button" disabled={currentPage <= 1} onClick={() => onChangePage(currentPage - 1)}>
              이전
            </button>
            <span><strong>{currentPage}</strong> 페이지</span>
            <button type="button" disabled={!response.has_more} onClick={() => onChangePage(currentPage + 1)}>
              다음
            </button>
          </nav>
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
