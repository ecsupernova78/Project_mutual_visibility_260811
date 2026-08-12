import { useEffect, useRef, useState, type FormEvent } from 'react'

import { searchLofarSources } from '../api'
import type {
  LofarSearchParams,
  LofarSearchResponse,
  LofarSortField,
  LofarSource,
  SortDirection,
} from '../types'

type SearchStatus = 'idle' | 'loading' | 'success' | 'error'

const LOCAL_PAGE_SIZE = 25
const RESULT_LIMIT_OPTIONS = [10, 25, 50, 100, 250, 500, 1000] as const
const SOURCE_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9+.-]{0,79}$/

function buildAdqlPreview(
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
    '  Source_Name,',
    '  RA,',
    '  DEC,',
    '  Total_flux,',
    '  Peak_flux',
    'FROM lotss_dr3.main_sources',
    `WHERE ${predicates.join('\n  AND ')}`,
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

export function LofarCatalogPanel({
  hidden,
  selectedSourceIds,
  selectedTargetCount,
  maximumTargetCount,
  onToggleSource,
  onGoToVisibility,
}: LofarCatalogPanelProps) {
  const [sourcePrefix, setSourcePrefix] = useState('')
  const [sortBy, setSortBy] = useState<LofarSortField>('total_flux')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [limit, setLimit] = useState(100)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [canRetry, setCanRetry] = useState(false)
  const [response, setResponse] = useState<LofarSearchResponse | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const lastSearch = useRef<LofarSearchParams | null>(null)
  const activeRequest = useRef<AbortController | null>(null)
  const normalizedPrefix = sourcePrefix.trim()
  const sourcePrefixInvalid = Boolean(normalizedPrefix && !SOURCE_PREFIX_PATTERN.test(normalizedPrefix))
  const adqlPreview = buildAdqlPreview(sourcePrefix, sortBy, sortDirection, limit)

  useEffect(() => () => activeRequest.current?.abort(), [])

  const executeSearch = async (params: LofarSearchParams) => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    lastSearch.current = params
    setStatus('loading')
    setError(null)
    setNotice(null)
    setCanRetry(false)

    try {
      const nextResponse = await searchLofarSources(params, controller.signal)
      if (controller.signal.aborted) return
      setResponse(nextResponse)
      setCurrentPage(1)
      setStatus('success')
    } catch (caught) {
      if (controller.signal.aborted) return
      setError(caught instanceof Error ? caught.message : 'LOFAR DR3 검색 중 오류가 발생했습니다.')
      setCanRetry(true)
      setStatus('error')
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  const buildCurrentSearch = (): LofarSearchParams => {
    const normalizedPrefix = sourcePrefix.trim()
    return {
      ...(normalizedPrefix ? { source_prefix: normalizedPrefix } : {}),
      sort_by: sortBy,
      sort_direction: sortDirection,
      limit,
    }
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (sourcePrefixInvalid) {
      setError('Source ID 앞부분은 영문자나 숫자로 시작하고, 이후에는 영문자, 숫자, +, 마침표, 하이픈만 입력해 주세요.')
      setNotice(null)
      setCanRetry(false)
      setStatus('error')
      return
    }
    void executeSearch(buildCurrentSearch())
  }

  const cancelSearch = () => {
    const controller = activeRequest.current
    if (!controller) return
    controller.abort()
    activeRequest.current = null
    setStatus(response ? 'success' : 'idle')
    setError(null)
    setCanRetry(false)
    setNotice(
      response
        ? '화면 대기를 중단했습니다. 이전 결과를 계속 표시합니다. 서버 작업은 계속될 수 있으며, 완료되거나 제한시간에 도달하면 정리됩니다.'
        : '화면 대기를 중단했습니다. 서버 작업은 계속될 수 있으며, 완료되거나 제한시간에 도달하면 정리됩니다.',
    )
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
            ASTRON TAP 서비스에서 144 MHz 전파원을 밝기 순으로 불러온 뒤, 원하는 천체를 시간–고도 계산 대상에
            추가하세요.
          </p>
          <p className="catalog-provenance">
            Data: <a href="https://lofar-surveys.org/dr3.html">LoTSS DR3 v1.0</a>
            <span aria-hidden="true"> · </span>
            <a href="https://vo.astron.nl/tableinfo/lotss_dr3.main_sources">ASTRON source table</a>
            <span aria-hidden="true"> · </span>
            <a href="https://vo.astron.nl/__system__/tap/run/tap/async">TAP async service</a>
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
        <form onSubmit={handleSubmit} aria-busy={status === 'loading'} noValidate>
          <div className="catalog-search-heading">
            <div>
              <p className="eyebrow">TAP catalog query</p>
              <h2 id="lofar-search-title">밝기 순 목록 불러오기</h2>
            </div>
            <span>lotss_dr3.main_sources · 144 MHz</span>
          </div>

          <fieldset className="catalog-query-fieldset" disabled={status === 'loading'}>
            <legend className="sr-only">LOFAR DR3 목록 조건</legend>
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
                  aria-describedby="lofar-prefix-help"
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
              <label className="catalog-field">
                <span>불러올 천체 수 (TOP)</span>
                <select value={limit} onChange={(event) => setLimit(Number(event.currentTarget.value))}>
                  {RESULT_LIMIT_OPTIONS.map((option) => (
                    <option key={option} value={option}>{option}개</option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          <p id="lofar-prefix-help" className="catalog-form-help">
            Source ID를 비워 두면 선택한 밝기 기준의 전체 상위 목록을 가져옵니다. 결과는 화면에서 25개씩 나누어 표시합니다.
          </p>
          <details className="catalog-query-preview">
            <summary>실행할 TAP 쿼리 보기</summary>
            <pre><code>{adqlPreview}</code></pre>
          </details>
          <div className="catalog-search-actions">
            <button className="catalog-search-button" type="submit" disabled={status === 'loading'}>
              {status === 'loading' ? 'TAP 작업 실행 중…' : 'LOFAR DR3 목록 불러오기'}
            </button>
            {status === 'loading' && (
              <button className="catalog-cancel-button" type="button" onClick={cancelSearch}>
                화면 대기 중단
              </button>
            )}
          </div>
          {status === 'loading' && (
            <p className="catalog-cancel-help">
              화면 대기만 중단합니다. 서버 작업은 계속될 수 있으며, 완료되거나 제한시간에 도달하면 정리됩니다.
            </p>
          )}
          {notice && <p className="catalog-request-notice" role="status">{notice}</p>}
        </form>
      </section>

      <CatalogResults
        status={status}
        error={error}
        response={response}
        currentPage={currentPage}
        selectedSourceIds={selectedSourceIds}
        atTargetLimit={atTargetLimit}
        maximumTargetCount={maximumTargetCount}
        onToggleSource={onToggleSource}
        onRetry={canRetry
          ? () => {
              const previous = lastSearch.current
              if (previous) void executeSearch(previous)
            }
          : null}
        onChangePage={setCurrentPage}
      />
    </main>
  )
}

function CatalogResults({
  status,
  error,
  response,
  currentPage,
  selectedSourceIds,
  atTargetLimit,
  maximumTargetCount,
  onToggleSource,
  onRetry,
  onChangePage,
}: {
  status: SearchStatus
  error: string | null
  response: LofarSearchResponse | null
  currentPage: number
  selectedSourceIds: ReadonlySet<string>
  atTargetLimit: boolean
  maximumTargetCount: number
  onToggleSource: (source: LofarSource) => void
  onRetry: (() => void) | null
  onChangePage: (page: number) => void
}) {
  const sources = response?.sources ?? []
  const totalPages = Math.max(1, Math.ceil(sources.length / LOCAL_PAGE_SIZE))
  const safePage = Math.min(currentPage, totalPages)
  const rangeStart = sources.length === 0 ? 0 : (safePage - 1) * LOCAL_PAGE_SIZE + 1
  const rangeEnd = Math.min(safePage * LOCAL_PAGE_SIZE, sources.length)
  const pageSources = sources.slice(rangeStart === 0 ? 0 : rangeStart - 1, rangeEnd)

  return (
    <section className="catalog-results-card" aria-labelledby="lofar-results-title" aria-busy={status === 'loading'}>
      <header className="catalog-results-heading">
        <div>
          <p className="eyebrow">Query results</p>
          <h2 id="lofar-results-title">카탈로그 결과</h2>
        </div>
        {response && (
          <span>{response.result_count}개 반환 · TOP {response.limit}</span>
        )}
      </header>

      {status === 'idle' && !response && (
        <div className="catalog-message">
          <strong>목록 조건을 선택하세요.</strong>
          <span>Source ID를 비워 두면 카탈로그 전체에서 밝기 순 상위 천체를 가져옵니다.</span>
        </div>
      )}
      {status === 'loading' && (
        <p className={response ? 'catalog-refresh-status' : 'catalog-inline-status'} role="status">
          <span className="button-spinner" aria-hidden="true" />
          ASTRON TAP 비동기 작업을 실행 중입니다. 결과 준비에 시간이 걸릴 수 있습니다.
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
          <span>Source ID 앞부분을 줄이거나 비워서 다시 불러오세요.</span>
        </div>
      )}

      {response && sources.length > 0 && (
        <>
          <p className="catalog-result-summary" role="status">
            {response.result_count}개 결과 · {response.sort_by === 'total_flux' ? '총 플럭스' : '피크 플럭스'}{' '}
            {response.sort_direction === 'desc' ? '밝은 순' : '어두운 순'}
            {response.source_prefix ? ` · Source ID “${response.source_prefix}”` : ' · 전체 카탈로그'}
          </p>
          <div className="catalog-table-wrap">
            <table>
              <caption>LOFAR DR3 TAP 조회 결과. 체크한 천체는 관측 가시성 계산 대상으로 유지됩니다.</caption>
              <thead>
                <tr>
                  <th scope="col">계산</th>
                  <th scope="col">Source</th>
                  <th scope="col">ICRS 좌표</th>
                  <th
                    scope="col"
                    aria-sort={response.sort_by === 'total_flux' ? (response.sort_direction === 'desc' ? 'descending' : 'ascending') : 'none'}
                  >
                    총 플럭스 <small>mJy</small>
                  </th>
                  <th
                    scope="col"
                    aria-sort={response.sort_by === 'peak_flux' ? (response.sort_direction === 'desc' ? 'descending' : 'ascending') : 'none'}
                  >
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
          {totalPages > 1 && (
            <nav className="catalog-pagination" aria-label="LOFAR 결과 페이지">
              <button type="button" disabled={safePage <= 1} onClick={() => onChangePage(safePage - 1)}>
                이전
              </button>
              <span>
                <strong>{safePage}</strong> / {totalPages}페이지 · {rangeStart}–{rangeEnd} / {sources.length}
              </span>
              <button type="button" disabled={safePage >= totalPages} onClick={() => onChangePage(safePage + 1)}>
                다음
              </button>
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
