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
const HANGUL_PATTERN = new RegExp('[\\u3131-\\u318e\\uac00-\\ud7a3]')

function englishCatalogText(value: string | null | undefined) {
  return value && !HANGUL_PATTERN.test(value) ? value : null
}

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
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 }).format(value)
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
        error: caught instanceof Error ? caught.message : 'An unexpected error occurred while searching LOFAR DR3.',
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
          error: 'The Source ID prefix must begin with a letter or number and contain only letters, numbers, +, periods, and hyphens.',
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
        error: 'Enter RA from 0° (inclusive) to 360° (exclusive), Dec from −90° to 90°, and a radius from 0.1 to 60 arcmin.',
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
        ? 'Stopped waiting in this browser. The previous results remain visible. The server job may continue until it finishes or reaches its time limit, after which it will be cleaned up.'
        : 'Stopped waiting in this browser. The server job may continue until it finishes or reaches its time limit, after which it will be cleaned up.',
    })
  }

  const atTargetLimit = selectedTargetCount >= maximumTargetCount
  const submitLabel = mode === 'brightness' ? 'Load LOFAR DR3 sources' : 'Search around coordinates'

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
          <h1>LOFAR DR3 Catalog</h1>
          <p>
            Browse 144 MHz radio sources by flux density or search around a sky position, then add sources to the
            altitude–time calculation. Familiar names and physical classifications are shown when a positional SIMBAD
            counterpart is available.
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
          <span>Selected targets</span>
          <strong>{selectedTargetCount} / {maximumTargetCount}</strong>
          <button type="button" onClick={onGoToVisibility}>Go to Observation Setup</button>
        </div>
      </header>

      <section className="catalog-search-card" aria-labelledby="lofar-search-title">
        <form onSubmit={handleSubmit} aria-busy={activeState.status === 'loading'} noValidate>
          <fieldset className="catalog-mode-switch" disabled={anyLoading}>
            <legend>Search mode</legend>
            <label className={mode === 'brightness' ? 'is-active' : ''}>
              <input
                type="radio"
                name="catalog-search-mode"
                value="brightness"
                checked={mode === 'brightness'}
                onChange={() => setMode('brightness')}
              />
              <span><strong>Brightest sources</strong><small>Bright radio sources across the catalog</small></span>
            </label>
            <label className={mode === 'cone' ? 'is-active' : ''}>
              <input
                type="radio"
                name="catalog-search-mode"
                value="cone"
                checked={mode === 'cone'}
                onChange={() => setMode('cone')}
              />
              <span><strong>Cone search</strong><small>Radio sources within a specified sky region</small></span>
            </label>
          </fieldset>

          <div className="catalog-search-heading">
            <div>
              <p className="eyebrow">TAP catalog query</p>
              <h2 id="lofar-search-title">{mode === 'brightness' ? 'Load brightest sources' : 'Source cone search'}</h2>
            </div>
            <span>lotss_dr3.main_sources · 144 MHz</span>
          </div>

          {mode === 'brightness' ? (
            <fieldset className="catalog-query-fieldset" disabled={activeState.status === 'loading'}>
              <legend className="sr-only">LOFAR DR3 brightness search parameters</legend>
              <div className="catalog-query-grid">
                <label className="catalog-field catalog-name-query">
                  <span>Source ID prefix (optional)</span>
                  <input
                    type="search"
                    value={sourcePrefix}
                    maxLength={80}
                    pattern="[A-Za-z0-9][A-Za-z0-9+.-]{0,79}"
                    title="Begin with a letter or number; subsequent characters may be letters, numbers, +, periods, or hyphens."
                    placeholder="Leave blank for the entire catalog"
                    aria-describedby="lofar-search-help"
                    aria-invalid={sourcePrefixInvalid}
                    onChange={(event) => setSourcePrefix(event.currentTarget.value)}
                  />
                </label>
                <label className="catalog-field">
                  <span>Flux measure</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.currentTarget.value as LofarSortField)}>
                    <option value="total_flux">Total flux</option>
                    <option value="peak_flux">Peak flux</option>
                  </select>
                </label>
                <label className="catalog-field">
                  <span>Sort order</span>
                  <select value={sortDirection} onChange={(event) => setSortDirection(event.currentTarget.value as SortDirection)}>
                    <option value="desc">Brightest first</option>
                    <option value="asc">Faintest first</option>
                  </select>
                </label>
                <ResultLimitField value={limit} onChange={setLimit} />
              </div>
            </fieldset>
          ) : (
            <fieldset className="catalog-query-fieldset" disabled={activeState.status === 'loading'}>
              <legend className="sr-only">LOFAR DR3 cone search parameters</legend>
              <div className="catalog-query-grid catalog-cone-grid">
                <label className="catalog-field">
                  <span>Center RA (deg)</span>
                  <input
                    type="number"
                    min="0"
                    max="359.999999"
                    step="any"
                    required
                    value={coneRa}
                    placeholder="e.g. 69.26825"
                    aria-describedby="lofar-search-help"
                    aria-invalid={coneRaInvalid}
                    onChange={(event) => setConeRa(event.currentTarget.value)}
                  />
                </label>
                <label className="catalog-field">
                  <span>Center Dec (deg)</span>
                  <input
                    type="number"
                    min="-90"
                    max="90"
                    step="any"
                    required
                    value={coneDec}
                    placeholder="e.g. 29.67052"
                    aria-describedby="lofar-search-help"
                    aria-invalid={coneDecInvalid}
                    onChange={(event) => setConeDec(event.currentTarget.value)}
                  />
                </label>
                <label className="catalog-field">
                  <span>Search radius (arcmin)</span>
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
                  <span>Sort field</span>
                  <select value={coneSortBy} onChange={(event) => setConeSortBy(event.currentTarget.value as LofarConeSortField)}>
                    <option value="distance">Angular separation</option>
                    <option value="total_flux">Total flux</option>
                    <option value="peak_flux">Peak flux</option>
                  </select>
                </label>
                <label className="catalog-field">
                  <span>Sort order</span>
                  <select value={coneSortDirection} onChange={(event) => setConeSortDirection(event.currentTarget.value as SortDirection)}>
                    <option value="asc">Nearest / lowest first</option>
                    <option value="desc">Farthest / highest first</option>
                  </select>
                </label>
                <ResultLimitField value={coneLimit} onChange={setConeLimit} />
              </div>
            </fieldset>
          )}

          <p id="lofar-search-help" className="catalog-form-help">
            {mode === 'brightness'
              ? 'Leave the Source ID prefix blank to retrieve the top sources across the catalog using the selected flux measure.'
              : 'Enter decimal-degree ICRS coordinates. The radius may range from 0.1 to 60 arcmin; results are initially ordered by angular separation.'}
            {' '}Results are displayed in pages of 25 sources.
          </p>
          <details className="catalog-query-preview">
            <summary>View TAP query</summary>
            <pre><code>{adqlPreview}</code></pre>
            <p>Familiar names and physical classifications are added through positional cross-matching with SIMBAD.</p>
          </details>
          <div className="catalog-search-actions">
            <button className="catalog-search-button" type="submit" disabled={activeState.status === 'loading'}>
              {activeState.status === 'loading' ? 'Running TAP job…' : submitLabel}
            </button>
            {activeState.status === 'loading' && (
              <button className="catalog-cancel-button" type="button" onClick={cancelSearch}>
                Stop waiting
              </button>
            )}
          </div>
          {activeState.status === 'loading' && (
            <p className="catalog-cancel-help">
              This stops waiting in the browser only. The server job may continue until it finishes or reaches its time limit,
              after which it will be cleaned up.
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
      <span>Maximum results (TOP)</span>
      <select value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {RESULT_LIMIT_OPTIONS.map((option) => (
          <option key={option} value={option}>{option}</option>
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
          <h2 id="lofar-results-title">{isCone ? 'Cone search results' : 'Brightness-ranked catalog results'}</h2>
        </div>
        {response && <span>{response.result_count} returned · TOP {response.limit}</span>}
      </header>

      {status === 'idle' && !response && (
        <div className="catalog-message">
          <strong>{isCone ? 'Enter a center position and search radius.' : 'Choose the catalog query parameters.'}</strong>
          <span>{isCone ? 'Find LoTSS DR3 radio sources within the specified cone.' : 'Retrieve the brightest sources across the catalog.'}</span>
        </div>
      )}
      {status === 'loading' && (
        <p className={response ? 'catalog-refresh-status' : 'catalog-inline-status'} role="status">
          <span className="button-spinner" aria-hidden="true" />
          Running an asynchronous ASTRON TAP job. Resolving familiar names afterward may take additional time.
        </p>
      )}
      {status === 'error' && (
        <div className={response ? 'catalog-error catalog-error-inline' : 'catalog-error'} role="alert">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry}>Retry with the same parameters</button>}
        </div>
      )}
      {status === 'success' && response && sources.length === 0 && (
        <div className="catalog-message">
          <strong>No matching sources found.</strong>
          <span>{isCone ? 'Increase the search radius or check the center coordinates.' : 'Shorten or clear the Source ID prefix and try again.'}</span>
        </div>
      )}

      {response && sources.length > 0 && (
        <>
          <p className="catalog-result-summary" role="status">
            {response.result_count} {response.result_count === 1 ? 'result' : 'results'} · {sortLabel(response.sort_by)}{' '}
            {response.sort_direction === 'desc' ? 'descending' : 'ascending'}
            {isCone
              ? ` · center ${response.center_ra_deg ?? '—'}°, ${response.center_dec_deg ?? '—'}° · radius ${response.radius_arcmin ?? '—'}′`
              : response.source_prefix ? ` · Source ID “${response.source_prefix}”` : ' · entire catalog'}
          </p>
          <EnrichmentNotice response={response} />
          <SourceTypeLegend sources={sources} morphologyCodebook={response.morphology_codebook} />
          <div className="catalog-table-wrap">
            <table>
              <caption>LOFAR DR3 TAP results. Selected sources remain available for the observation-visibility calculation.</caption>
              <thead>
                <tr>
                  <th scope="col">Select</th>
                  <th scope="col">Source name</th>
                  <th scope="col">Classification</th>
                  <th scope="col">ICRS coordinates</th>
                  {isCone && (
                    <th scope="col" aria-sort={response.sort_by === 'distance' ? sortAria(response.sort_direction) : 'none'}>
                      Angular separation <small>arcmin</small>
                    </th>
                  )}
                  <th scope="col" aria-sort={response.sort_by === 'total_flux' ? sortAria(response.sort_direction) : 'none'}>
                    Total flux <small>mJy</small>
                  </th>
                  <th scope="col" aria-sort={response.sort_by === 'peak_flux' ? sortAria(response.sort_direction) : 'none'}>
                    Peak flux <small>mJy/beam</small>
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
                            aria-label={`${source.name}: ${selected ? 'remove from visibility targets' : 'add to visibility targets'}`}
                          />
                          <span aria-hidden="true">✓</span>
                        </label>
                      </td>
                      <th scope="row">
                        <strong>{source.name}</strong>
                        {source.counterpart_name && <small>SIMBAD · {source.counterpart_name}</small>}
                        <small>LoTSS · {source.source_id}</small>
                        {(source.aliases?.length ?? 0) > 0 && (
                          <small className="catalog-aliases">Aliases · {source.aliases.slice(0, 3).join(' · ')}</small>
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
            <nav className="catalog-pagination" aria-label="LOFAR result pages">
              <button type="button" disabled={safePage <= 1} onClick={() => onChangePage(safePage - 1)}>Previous</button>
              <span><strong>{safePage}</strong> / {totalPages} pages · {rangeStart}–{rangeEnd} / {sources.length}</span>
              <button type="button" disabled={safePage >= totalPages} onClick={() => onChangePage(safePage + 1)}>Next</button>
            </nav>
          )}
        </>
      )}

      {atTargetLimit && (
        <p className="catalog-limit-note" role="status">
          You can select up to {maximumTargetCount} targets across the example 3C sources and LOFAR sources.
        </p>
      )}
    </section>
  )
}

function sortLabel(sortBy: LofarConeSortField) {
  if (sortBy === 'distance') return 'angular separation'
  return sortBy === 'total_flux' ? 'total flux' : 'peak flux'
}

function sortAria(direction: SortDirection) {
  return direction === 'desc' ? 'descending' : 'ascending'
}

function EnrichmentNotice({ response }: { response: LofarSearchResponse }) {
  if (!response.enrichment_status || response.enrichment_status === 'complete') return null
  const warning = englishCatalogText(response.enrichment_warning)
  return (
    <p className={`catalog-enrichment-notice is-${response.enrichment_status}`} role="status">
      <strong>SIMBAD name and type enrichment {response.enrichment_status === 'partial' ? 'partially completed' : 'unavailable'}</strong>
      <span>{warning ?? 'The LoTSS positions and flux measurements remain available.'}</span>
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
  const morphologyLabel = englishCatalogText(source.morphology_label)
  const morphologyDescription = englishCatalogText(source.morphology_description)
  const objectTypeLabel = englishCatalogText(source.object_type_label)
  const objectTypeDescription = englishCatalogText(source.object_type_description)
  return (
    <div className="catalog-classification">
      <span title={morphologyDescription ?? undefined}>
        <small>LoTSS radio morphology</small>
        <b>{source.morphology_code
          ? `${source.morphology_code} — ${morphologyLabel ?? 'No description'}`
          : 'Unclassified'}</b>
      </span>
      <span title={objectTypeDescription ?? undefined}>
        <small>SIMBAD physical type</small>
        <b>{objectTypeLabel
          ? `${objectTypeLabel}${source.object_type_code ? ` (${source.object_type_code})` : ''}`
          : hasCounterpart ? 'Unclassified type' : '—'}</b>
      </span>
      {hasCounterpart && source.crossmatch_separation_arcsec !== null ? (
        <em className={`catalog-match-confidence is-${source.crossmatch_confidence ?? 'caution'}`}>
          {formatAngularDistance(source.crossmatch_separation_arcsec, 'arcsec')} positional candidate
        </em>
      ) : (
        <em className="catalog-no-counterpart">
          {enrichmentStatus === 'complete' ? 'No SIMBAD match within 5″' : 'SIMBAD match not checked'}
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
    const label = englishCatalogText(source.object_type_label)
    if (source.object_type_code && label && !simbadTypes.has(source.object_type_code)) {
      simbadTypes.set(source.object_type_code, {
        label,
        description: englishCatalogText(source.object_type_description),
      })
    }
  }
  const rawMorphologyDefinitions = morphologyCodebook?.length ? morphologyCodebook : [
    { code: 'S' as const, label: 'Single Gaussian', description: '' },
    { code: 'M' as const, label: 'Source composed of multiple Gaussians', description: '' },
    { code: 'C' as const, label: 'Single-Gaussian source in an island with other sources', description: '' },
  ]
  const morphologyDefinitions = rawMorphologyDefinitions.map((definition) => ({
    ...definition,
    label: englishCatalogText(definition.label) ?? 'No English description',
    description: englishCatalogText(definition.description) ?? '',
  }))
  return (
    <details className="catalog-code-legend">
      <summary>Classification codes and positional-matching criteria</summary>
      <div className="catalog-code-legend-grid">
        <section>
          <h3>LoTSS radio morphology (S_Code)</h3>
          <p>This describes how Gaussians form a source in the radio image; it is not a physical object type.</p>
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
          <h3>SIMBAD physical type</h3>
          <p>These are SIMBAD positional candidates within 5″ of a LoTSS position. A name or classification does not confirm that both catalog entries represent the same object.</p>
          {simbadTypes.size > 0 ? (
            <dl>
              {[...simbadTypes].map(([code, value]) => (
                <div key={code}>
                  <dt>{code}</dt>
                  <dd>{value.label}{value.description ? ` — ${value.description}` : ''}</dd>
                </div>
              ))}
            </dl>
          ) : <p>No SIMBAD object-type codes are available in these results.</p>}
          <a href="https://simbad.cds.unistra.fr/Pages/guide/otypes_desc.htx">Official SIMBAD object-type reference</a>
        </section>
      </div>
    </details>
  )
}
