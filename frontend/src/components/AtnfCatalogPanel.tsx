import { useEffect, useRef, useState, type FormEvent } from 'react'

import { coneSearchAtnfSources, searchAtnfSources } from '../api'
import type {
  AtnfConeSearchParams,
  AtnfConeSortField,
  AtnfFluxFrequency,
  AtnfFluxMethod,
  AtnfSearchParams,
  AtnfSearchResponse,
  AtnfSortField,
  AtnfSource,
  SortDirection,
} from '../types'

type SearchMode = 'name' | 'cone'
type SearchRequest =
  | { mode: 'name'; params: AtnfSearchParams }
  | { mode: 'cone'; params: AtnfConeSearchParams }
type SearchStatus = 'idle' | 'loading' | 'success' | 'error'
interface SearchState {
  status: SearchStatus
  response: AtnfSearchResponse | null
  error: string | null
  canRetry: boolean
  page: number
}

const RESULT_LIMITS = [10, 25, 50, 100, 250, 500, 1000] as const
const PAGE_SIZE = 25

function emptySearchState(): SearchState {
  return { status: 'idle', response: null, error: null, canRetry: false, page: 1 }
}

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : undefined
}

function validOptionalNumber(value: string, minimum: number, maximum: number) {
  const number = optionalNumber(value)
  return number === undefined || (Number.isFinite(number) && number >= minimum && number <= maximum)
}

function formatValue(value: number | null | undefined, digits = 3) {
  if (value == null || !Number.isFinite(value)) return '—'
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
}

function methodLabel(method: AtnfFluxMethod) {
  const labels: Record<AtnfFluxMethod, string> = {
    measured: 'measured',
    interp: 'interpolated',
    spindx: 'catalogue spectral index',
    extrap_two_point: 'two-point extrapolation',
    alpha_default: 'assumed α = −1.6',
    none: 'unavailable',
  }
  return labels[method]
}

function fluxCell(value: number | null, method: AtnfFluxMethod) {
  return (
    <span className={'atnf-flux' + (method === 'alpha_default' ? ' is-assumed' : '')}>
      <strong>{formatValue(value)} mJy</strong>
      <small>{methodLabel(method)}</small>
    </span>
  )
}

interface AtnfCatalogPanelProps {
  hidden: boolean
  selectedSourceIds: ReadonlySet<string>
  selectedTargetCount: number
  maximumTargetCount: number
  onToggleSource: (source: AtnfSource) => void
}

export function AtnfCatalogPanel({
  hidden,
  selectedSourceIds,
  selectedTargetCount,
  maximumTargetCount,
  onToggleSource,
}: AtnfCatalogPanelProps) {
  const [mode, setMode] = useState<SearchMode>('name')
  const [name, setName] = useState('')
  const [ra, setRa] = useState('')
  const [dec, setDec] = useState('')
  const [radius, setRadius] = useState('60')
  const [dmMin, setDmMin] = useState('')
  const [dmMax, setDmMax] = useState('')
  const [p0Min, setP0Min] = useState('')
  const [p0Max, setP0Max] = useState('')
  const [minFlux, setMinFlux] = useState('')
  const [typeCode, setTypeCode] = useState('')
  const [binaryFilter, setBinaryFilter] = useState('all')
  const [mspFilter, setMspFilter] = useState('all')
  const [frequency, setFrequency] = useState<AtnfFluxFrequency>(600)
  const [includeCoarse, setIncludeCoarse] = useState(true)
  const [includeProvisional, setIncludeProvisional] = useState(true)
  const [sortBy, setSortBy] = useState<AtnfSortField>('flux')
  const [coneSortBy, setConeSortBy] = useState<AtnfConeSortField>('distance')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [coneSortDirection, setConeSortDirection] = useState<SortDirection>('asc')
  const [limit, setLimit] = useState(100)
  const [suggestions, setSuggestions] = useState<AtnfSource[]>([])
  const [states, setStates] = useState<Record<SearchMode, SearchState>>(() => ({
    name: emptySearchState(),
    cone: emptySearchState(),
  }))
  const activeRequest = useRef<AbortController | null>(null)
  const lastRequest = useRef<Partial<Record<SearchMode, SearchRequest>>>({})
  const state = states[mode]
  const response = state.response
  const atLimit = selectedTargetCount >= maximumTargetCount

  useEffect(() => () => activeRequest.current?.abort(), [])

  useEffect(() => {
    if (hidden || mode !== 'name' || name.trim().length < 2) {
      return
    }
    const controller = new AbortController()
    const timeout = window.setTimeout(() => {
      void searchAtnfSources({
        name: name.trim(),
        sort_by: 'name',
        sort_direction: 'asc',
        limit: 8,
        flux_frequency_mhz: frequency,
        include_coarse: includeCoarse,
        include_provisional: includeProvisional,
        ...(dmMin ? { dm_min: Number(dmMin) } : {}),
        ...(dmMax ? { dm_max: Number(dmMax) } : {}),
        ...(p0Min ? { p0_min: Number(p0Min) } : {}),
        ...(p0Max ? { p0_max: Number(p0Max) } : {}),
        ...(minFlux ? { min_flux_mjy: Number(minFlux) } : {}),
        ...(typeCode.trim() ? { type_code: typeCode.trim() } : {}),
        ...(binaryFilter === 'all' ? {} : { is_binary: binaryFilter === 'yes' }),
        ...(mspFilter === 'all' ? {} : { is_msp: mspFilter === 'yes' }),
      }, controller.signal).then((suggested) => {
        if (!controller.signal.aborted) setSuggestions(suggested.sources)
      }).catch(() => {
        if (!controller.signal.aborted) setSuggestions([])
      })
    }, 250)
    return () => {
      window.clearTimeout(timeout)
      controller.abort()
    }
  }, [
    name, hidden, mode, frequency, includeCoarse, includeProvisional,
    dmMin, dmMax, p0Min, p0Max, minFlux, typeCode, binaryFilter, mspFilter,
  ])

  const patchState = (targetMode: SearchMode, patch: Partial<SearchState>) => {
    setStates((current) => ({
      ...current,
      [targetMode]: { ...current[targetMode], ...patch },
    }))
  }

  const executeSearch = async (request: SearchRequest) => {
    activeRequest.current?.abort()
    const controller = new AbortController()
    activeRequest.current = controller
    lastRequest.current[request.mode] = request
    patchState(request.mode, { status: 'loading', error: null, canRetry: false })
    try {
      const result = request.mode === 'name'
        ? await searchAtnfSources(request.params, controller.signal)
        : await coneSearchAtnfSources(request.params, controller.signal)
      if (controller.signal.aborted) return
      patchState(request.mode, { response: result, status: 'success', page: 1 })
      setSuggestions([])
    } catch (error) {
      if (controller.signal.aborted) return
      patchState(request.mode, {
        status: 'error',
        canRetry: true,
        error: error instanceof Error ? error.message : 'The ATNF search failed.',
      })
    } finally {
      if (activeRequest.current === controller) activeRequest.current = null
    }
  }

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const ranges = [
      ['DM minimum', dmMin, 0, 100000],
      ['DM maximum', dmMax, 0, 100000],
      ['period minimum', p0Min, 0, 1000],
      ['period maximum', p0Max, 0, 1000],
      ['flux minimum', minFlux, 0, 1000000],
    ] as const
    const invalid = ranges.find(([,, minimum, maximum], index) => (
      !validOptionalNumber([dmMin, dmMax, p0Min, p0Max, minFlux][index], minimum, maximum)
    ))
    if (typeCode.trim() && !/^[A-Za-z0-9_+-]+$/.test(typeCode.trim())) {
      patchState(mode, { status: 'error', canRetry: false, error: 'Use one ATNF type code containing letters, numbers, _, +, or -.' })
      return
    }
    if (invalid || (dmMin && dmMax && Number(dmMin) > Number(dmMax))
      || (p0Min && p0Max && Number(p0Min) > Number(p0Max))) {
      patchState(mode, {
        status: 'error',
        canRetry: false,
        error: 'Enter valid DM, period, and flux ranges; each minimum must be no greater than its maximum.',
      })
      return
    }

    const common = {
      limit,
      flux_frequency_mhz: frequency,
      include_coarse: includeCoarse,
      include_provisional: includeProvisional,
      ...(dmMin ? { dm_min: Number(dmMin) } : {}),
      ...(dmMax ? { dm_max: Number(dmMax) } : {}),
      ...(p0Min ? { p0_min: Number(p0Min) } : {}),
      ...(p0Max ? { p0_max: Number(p0Max) } : {}),
      ...(minFlux ? { min_flux_mjy: Number(minFlux) } : {}),
      ...(typeCode.trim() ? { type_code: typeCode.trim() } : {}),
      ...(binaryFilter === 'all' ? {} : { is_binary: binaryFilter === 'yes' }),
      ...(mspFilter === 'all' ? {} : { is_msp: mspFilter === 'yes' }),
    }
    if (mode === 'name') {
      void executeSearch({
        mode,
        params: {
          ...common,
          ...(name.trim() ? { name: name.trim() } : {}),
          sort_by: sortBy,
          sort_direction: sortDirection,
        },
      })
      return
    }
    if (!validOptionalNumber(ra, 0, 359.999999) || !ra.trim()
      || !validOptionalNumber(dec, -90, 90) || !dec.trim()
      || !validOptionalNumber(radius, 0.1, 60) || !radius.trim()) {
      patchState(mode, {
        status: 'error',
        canRetry: false,
        error: 'Enter RA from 0° to less than 360°, Dec from −90° to 90°, and radius from 0.1 to 60 arcmin.',
      })
      return
    }
    void executeSearch({
      mode,
      params: {
        ...common,
        ra_deg: Number(ra),
        dec_deg: Number(dec),
        radius_arcmin: Number(radius),
        sort_by: coneSortBy,
        sort_direction: coneSortDirection,
      },
    })
  }

  const sources = response?.sources ?? []
  const totalPages = Math.max(1, Math.ceil(sources.length / PAGE_SIZE))
  const page = Math.min(state.page, totalPages)
  const visibleSources = sources.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <section id="atnf-provider-panel" className="catalog-provider-panel" role="tabpanel"
      aria-labelledby="atnf-provider-tab" hidden={hidden}>
      <header className="catalog-provider-intro">
        <div>
          <p className="eyebrow">CSIRO SPACE &amp; ASTRONOMY · PULSAR CATALOGUE</p>
          <h2>ATNF Pulsar Catalogue</h2>
          <p>Find pulsars by J/B name or sky position. Filter by dispersion measure, spin period, and estimated radio flux.</p>
          <p className="catalog-provenance">
            Data: <a href="https://www.atnf.csiro.au/research/pulsar/psrcat/">ATNF Pulsar Catalogue v{response?.catalogue_version ?? '2.9.0'}</a>
            <span aria-hidden="true"> · </span>
            <a href="https://doi.org/10.1086/428488">Manchester et al. 2005, AJ 129, 1993</a>
          </p>
        </div>
      </header>

      <section className="catalog-search-card" aria-labelledby="atnf-search-title">
        <form onSubmit={onSubmit} aria-busy={state.status === 'loading'} noValidate>
          <fieldset className="catalog-mode-switch" disabled={state.status === 'loading'}>
            <legend>Search mode</legend>
            <label className={mode === 'name' ? 'is-active' : ''}>
              <input type="radio" name="atnf-search-mode" checked={mode === 'name'} onChange={() => setMode('name')} />
              <span><strong>Name and catalogue</strong><small>J/B pulsar names or ranked catalogue list</small></span>
            </label>
            <label className={mode === 'cone' ? 'is-active' : ''}>
              <input type="radio" name="atnf-search-mode" checked={mode === 'cone'} onChange={() => setMode('cone')} />
              <span><strong>Cone search</strong><small>Pulsars near an ICRS coordinate</small></span>
            </label>
          </fieldset>
          <div className="catalog-search-heading">
            <div>
              <p className="eyebrow">LOCAL RELEASE · VERSION PINNED</p>
              <h2 id="atnf-search-title">{mode === 'name' ? 'Find pulsars' : 'Pulsar cone search'}</h2>
            </div>
            <span>v{response?.catalogue_version ?? '2.9.0'}</span>
          </div>

          {mode === 'name' ? (
            <fieldset className="catalog-query-fieldset" disabled={state.status === 'loading'}>
              <legend className="sr-only">ATNF name search parameters</legend>
              <div className="catalog-query-grid">
                <div className="atnf-name-field">
                  <label className="catalog-field">
                    <span>PSR J/B name (optional)</span>
                    <input type="search" value={name} maxLength={80} autoComplete="off"
                      placeholder="e.g. B0329+54 or PSR J0332+5434" aria-describedby="atnf-search-help"
                      onChange={(event) => { setName(event.currentTarget.value); setSuggestions([]) }} />
                  </label>
                  {name.trim().length >= 2 && suggestions.length > 0 && (
                    <div className="atnf-suggestions" aria-label="Pulsar name suggestions">
                      {suggestions.map((source) => (
                        <button type="button" key={source.id} onClick={() => { setName(source.source_id); setSuggestions([]) }}>
                          <strong>{source.name}</strong>
                          <small>{source.source_id}</small>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <label className="catalog-field">
                  <span>Sort by</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.currentTarget.value as AtnfSortField)}>
                    <option value="flux">Estimated flux</option>
                    <option value="name">Pulsar name</option>
                    <option value="dm">Dispersion measure</option>
                  </select>
                </label>
                <label className="catalog-field">
                  <span>Order</span>
                  <select value={sortDirection} onChange={(event) => setSortDirection(event.currentTarget.value as SortDirection)}>
                    <option value="desc">Descending</option>
                    <option value="asc">Ascending</option>
                  </select>
                </label>
                <label className="catalog-field">
                  <span>Result limit</span>
                  <select value={limit} onChange={(event) => setLimit(Number(event.currentTarget.value))}>
                    {RESULT_LIMITS.map((count) => <option value={count} key={count}>{count}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>
          ) : (
            <fieldset className="catalog-query-fieldset" disabled={state.status === 'loading'}>
              <legend className="sr-only">ATNF cone search parameters</legend>
              <div className="catalog-query-grid catalog-cone-grid">
                <label className="catalog-field"><span>Center RA (°)</span>
                  <input type="number" step="any" min="0" max="359.999999" value={ra} placeholder="83.633"
                    onChange={(event) => setRa(event.currentTarget.value)} />
                </label>
                <label className="catalog-field"><span>Center Dec (°)</span>
                  <input type="number" step="any" min="-90" max="90" value={dec} placeholder="22.014"
                    onChange={(event) => setDec(event.currentTarget.value)} />
                </label>
                <label className="catalog-field"><span>Radius (arcmin)</span>
                  <input type="number" step="any" min="0.1" max="60" value={radius}
                    onChange={(event) => setRadius(event.currentTarget.value)} />
                </label>
                <label className="catalog-field"><span>Sort by</span>
                  <select value={coneSortBy} onChange={(event) => setConeSortBy(event.currentTarget.value as AtnfConeSortField)}>
                    <option value="distance">Angular separation</option>
                    <option value="flux">Estimated flux</option>
                    <option value="name">Pulsar name</option>
                    <option value="dm">Dispersion measure</option>
                  </select>
                </label>
                <label className="catalog-field"><span>Order</span>
                  <select value={coneSortDirection} onChange={(event) => setConeSortDirection(event.currentTarget.value as SortDirection)}>
                    <option value="asc">Nearest / lowest first</option>
                    <option value="desc">Farthest / highest first</option>
                  </select>
                </label>
                <label className="catalog-field"><span>Result limit</span>
                  <select value={limit} onChange={(event) => setLimit(Number(event.currentTarget.value))}>
                    {RESULT_LIMITS.map((count) => <option value={count} key={count}>{count}</option>)}
                  </select>
                </label>
              </div>
            </fieldset>
          )}

          <fieldset className="catalog-classification-filter atnf-numeric-filters" disabled={state.status === 'loading'}>
            <legend>Physical filters</legend>
            <div className="catalog-query-grid">
              <label className="catalog-field"><span>DM min (pc cm⁻³)</span>
                <input type="number" min="0" step="any" value={dmMin} onChange={(event) => setDmMin(event.currentTarget.value)} />
              </label>
              <label className="catalog-field"><span>DM max (pc cm⁻³)</span>
                <input type="number" min="0" step="any" value={dmMax} onChange={(event) => setDmMax(event.currentTarget.value)} />
              </label>
              <label className="catalog-field"><span>P₀ min (s)</span>
                <input type="number" min="0" step="any" value={p0Min} onChange={(event) => setP0Min(event.currentTarget.value)} />
              </label>
              <label className="catalog-field"><span>P₀ max (s)</span>
                <input type="number" min="0" step="any" value={p0Max} onChange={(event) => setP0Max(event.currentTarget.value)} />
              </label>
              <label className="catalog-field"><span>Flux frequency</span>
                <select value={frequency} onChange={(event) => setFrequency(Number(event.currentTarget.value) as AtnfFluxFrequency)}>
                  <option value={400}>400 MHz</option><option value={600}>600 MHz</option><option value={800}>800 MHz</option>
                </select>
              </label>
              <label className="catalog-field"><span>Minimum estimated flux (mJy)</span>
                <input type="number" min="0" step="any" value={minFlux} onChange={(event) => setMinFlux(event.currentTarget.value)} />
              </label>
              <label className="catalog-field"><span>ATNF type code (optional)</span>
                <input type="text" maxLength={20} value={typeCode} placeholder="e.g. HE or RRAT"
                  onChange={(event) => setTypeCode(event.currentTarget.value)} />
              </label>
              <label className="catalog-field"><span>Binary system</span>
                <select value={binaryFilter} onChange={(event) => setBinaryFilter(event.currentTarget.value)}>
                  <option value="all">All</option><option value="yes">Binary only</option><option value="no">Non-binary only</option>
                </select>
              </label>
              <label className="catalog-field"><span>Millisecond pulsar</span>
                <select value={mspFilter} onChange={(event) => setMspFilter(event.currentTarget.value)}>
                  <option value="all">All</option><option value="yes">MSP only</option><option value="no">Non-MSP only</option>
                </select>
              </label>
            </div>
          </fieldset>
          <div className="atnf-quality-filters">
            <label><input type="checkbox" checked={includeCoarse} onChange={(event) => setIncludeCoarse(event.currentTarget.checked)} />
              Include coarse positions</label>
            <label><input type="checkbox" checked={includeProvisional} onChange={(event) => setIncludeProvisional(event.currentTarget.checked)} />
              Include provisional pulsars</label>
          </div>
          <p id="atnf-search-help" className="catalog-form-help">
            Name matching accepts J and B aliases, with or without the PSR prefix. Leave the name blank for a ranked catalogue list.
            Flux is measured or estimated at the selected frequency; the method appears with each result. Results are shown in pages of 25.
          </p>
          <div className="catalog-search-actions">
            <button type="submit" className="catalog-search-button" disabled={state.status === 'loading'}>
              {state.status === 'loading' ? 'Searching pulsars…' : mode === 'name' ? 'Search ATNF pulsars' : 'Search around coordinates'}
            </button>
            {state.status === 'loading' && (
              <button type="button" className="catalog-cancel-button" onClick={() => {
                activeRequest.current?.abort()
                activeRequest.current = null
                patchState(mode, { status: response ? 'success' : 'idle', error: null })
              }}>Stop waiting</button>
            )}
          </div>
        </form>
      </section>

      <section className="catalog-results-card" aria-labelledby="atnf-results-title" aria-busy={state.status === 'loading'}>
        <header className="catalog-results-heading">
          <div><p className="eyebrow">QUERY RESULTS</p><h2 id="atnf-results-title">ATNF pulsars</h2></div>
          {response && <span>{formatValue(response.result_count, 0)} of {formatValue(response.candidate_count, 0)} matches · limit {response.limit}</span>}
        </header>
        {state.status === 'idle' && !response && (
          <div className="catalog-message"><strong>Search the pinned pulsar catalogue.</strong>
            <span>Choose a name, a sky cone, or physical filters.</span></div>
        )}
        {state.status === 'loading' && (
          <p className={response ? 'catalog-refresh-status' : 'catalog-inline-status'} role="status">
            <span className="button-spinner" aria-hidden="true" /> Searching the local catalogue…
          </p>
        )}
        {state.status === 'error' && (
          <div className={response ? 'catalog-error catalog-error-inline' : 'catalog-error'} role="alert">
            <span>{state.error}</span>
            {state.canRetry && (
              <button type="button" onClick={() => void executeSearch(lastRequest.current[mode] as SearchRequest)}>
                Retry with the same parameters
              </button>
            )}
          </div>
        )}
        {state.status === 'success' && response && sources.length === 0 && (
          <div className="catalog-message" role="status"><strong>No matching pulsars found.</strong>
            <span>Adjust the name, cone radius, or physical filters.</span></div>
        )}
        {response && sources.length > 0 && (
          <>
            <p className="catalog-result-summary" role="status">
              {formatValue(response.result_count, 0)} of {formatValue(response.candidate_count, 0)} matching pulsars · ATNF v{response.catalogue_version}
              {mode === 'cone' && response.center_ra_deg != null
                ? ' · center ' + response.center_ra_deg + '°, ' + response.center_dec_deg + '° · radius ' + response.radius_arcmin + '′'
                : ''}
              {' · flux at ' + response.reference_frequency_mhz + ' MHz'}
            </p>
            <div className="catalog-table-wrap">
              <table>
                <caption>ATNF pulsar catalogue results. Select pulsars for the visibility calculation.</caption>
                <thead><tr>
                  <th scope="col">Select</th>
                  <th scope="col">Pulsar</th>
                  <th scope="col">ICRS coordinates</th>
                  {mode === 'cone' && <th scope="col">Separation <small>arcmin</small></th>}
                  <th scope="col">DM <small>pc cm⁻³</small></th>
                  <th scope="col">P₀ <small>s</small></th>
                  <th scope="col">S400 <small>mJy</small></th>
                  <th scope="col">S600 <small>mJy</small></th>
                  <th scope="col">S800 <small>mJy</small></th>
                </tr></thead>
                <tbody>
                  {visibleSources.map((source) => {
                    const selected = selectedSourceIds.has(source.id)
                    return <tr key={source.id} className={selected ? 'is-selected' : ''}>
                      <td><label className="catalog-row-select">
                        <input type="checkbox" checked={selected} disabled={!selected && atLimit}
                          aria-label={source.name + ': ' + (selected ? 'remove from visibility targets' : 'add to visibility targets')}
                          onChange={() => onToggleSource(source)} />
                        <span aria-hidden="true">✓</span>
                      </label></td>
                      <th scope="row">
                        <strong>{source.name}</strong>
                        {source.source_id !== source.name && <small>ATNF · {source.source_id}</small>}
                        {source.aliases.length > 0 && <small className="catalog-aliases">Aliases · {source.aliases.join(' · ')}</small>}
                        <span className="atnf-badges">
                          {source.provisional && <small className="atnf-badge">Provisional</small>}
                          {source.pos_coarse && <small className="atnf-badge">Coarse position</small>}
                          {source.is_msp && <small className="atnf-badge">MSP</small>}
                          {source.is_binary && <small className="atnf-badge">Binary</small>}
                        </span>
                        {source.type_codes && <small>Type · {source.type_codes}</small>}
                      </th>
                      <td><span className="catalog-coordinate">{source.ra_hms} · {source.dec_dms}</span>
                        <small>{source.pos_unc_arcsec == null
                          ? 'Uncertainty unavailable'
                          : 'Position uncertainty ' + formatValue(source.pos_unc_arcsec, 2) + ' arcsec'}</small></td>
                      {mode === 'cone' && <td>{formatValue(source.separation_arcmin, 2)}′</td>}
                      <td>{formatValue(source.dm)}</td>
                      <td>{formatValue(source.p0_s, 6)}</td>
                      <td>{fluxCell(source.s_est_400_mjy, source.s_est_400_method)}</td>
                      <td>{fluxCell(source.s_est_600_mjy, source.s_est_600_method)}</td>
                      <td>{fluxCell(source.s_est_800_mjy, source.s_est_800_method)}</td>
                    </tr>
                  })}
                </tbody>
              </table>
            </div>
            {totalPages > 1 && <nav className="catalog-pagination" aria-label="ATNF result pages">
              <button type="button" disabled={page <= 1} onClick={() => patchState(mode, { page: page - 1 })}>Previous</button>
              <span>{page} / {totalPages} pages · {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sources.length)} / {sources.length}</span>
              <button type="button" disabled={page >= totalPages} onClick={() => patchState(mode, { page: page + 1 })}>Next</button>
            </nav>}
          </>
        )}
        {atLimit && <p className="catalog-limit-note" role="status">
          You can select up to {maximumTargetCount} targets across the example and catalog sources.
        </p>}
      </section>
    </section>
  )
}
