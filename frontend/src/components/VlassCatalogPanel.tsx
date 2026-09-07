import { useEffect, useRef, useState, type FormEvent } from 'react'

import { coneSearchVlassSources, searchVlassSources } from '../api'
import type {
  SimbadTypeCategory,
  SortDirection,
  VlassComponentCode,
  VlassConeSearchParams,
  VlassConeSortField,
  VlassSearchParams,
  VlassSearchResponse,
  VlassSortField,
  VlassSource,
} from '../types'

type SearchMode = 'brightness' | 'cone'
type SearchStatus = 'idle' | 'loading' | 'success' | 'error'
type SearchRequest =
  | { mode: 'brightness'; params: VlassSearchParams }
  | { mode: 'cone'; params: VlassConeSearchParams }

interface ModeState {
  status: SearchStatus
  error: string | null
  notice: string | null
  canRetry: boolean
  response: VlassSearchResponse | null
  currentPage: number
}

const LOCAL_PAGE_SIZE = 25
const RESULT_LIMIT_OPTIONS = [10, 25, 50, 100, 250, 500, 1000] as const
const SOURCE_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 +.-]{0,79}$/
const HANGUL_PATTERN = new RegExp('[\u3131-\u318e\uac00-\ud7a3]')
const COMPONENT_OPTIONS: Array<{
  code: VlassComponentCode
  label: string
  description: string
}> = [
  { code: 'S', label: 'Single-Gaussian fit', description: 'One Gaussian fitted in its island' },
  { code: 'C', label: 'Shared-island Gaussian', description: 'One Gaussian fitted in an island with other components' },
  { code: 'M', label: 'Multi-Gaussian fit', description: 'Multiple Gaussians fitted to one source' },
  { code: 'E', label: 'Empty island', description: 'No components were fitted in the island' },
]
const SIMBAD_TYPE_OPTIONS: Array<{
  category: SimbadTypeCategory
  label: string
  description: string
}> = [
  { category: 'galaxy', label: 'Galaxies', description: 'Official SIMBAD GGG galaxy family' },
  { category: 'agn', label: 'Active galactic nuclei', description: 'AGN, LINER, quasar, blazar, radio-galaxy, and Seyfert types' },
  { category: 'quasar', label: 'Quasars', description: 'Confirmed SIMBAD QSO primary type' },
  { category: 'blazar', label: 'Blazars', description: 'Confirmed blazar and BL Lac primary types' },
  { category: 'radio_galaxy', label: 'Radio galaxies', description: 'Confirmed SIMBAD radio-galaxy primary type' },
  { category: 'seyfert', label: 'Seyfert galaxies', description: 'Seyfert, Seyfert 1, and Seyfert 2 primary types' },
  { category: 'star', label: 'Stars', description: 'Official SIMBAD stellar family' },
  { category: 'pulsar', label: 'Pulsars', description: 'Confirmed SIMBAD pulsar primary type' },
  { category: 'ism', label: 'Interstellar-medium objects', description: 'Official SIMBAD interstellar-medium family' },
  { category: 'radio_source', label: 'Radio sources', description: 'Radio-emitting sources whose physical nature is otherwise unknown' },
]

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

function validNumber(value: string, minimum: number, maximum: number, includeMaximum = true) {
  if (!value.trim()) return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= minimum && (includeMaximum ? parsed <= maximum : parsed < maximum)
}

function simbadCategoryLabel(category: SimbadTypeCategory) {
  return SIMBAD_TYPE_OPTIONS.find((option) => option.category === category)?.label ?? category
}

function englishCatalogText(value: string | null | undefined) {
  return value && !HANGUL_PATTERN.test(value) ? value : null
}

function recommendedPredicates(enabled: boolean) {
  return enabled ? ["DupFlag < 2", 'QualFlag IN (0, 4)', "SCode <> 'E'"] : []
}

function buildBrightnessAdqlPreview(
  sourcePrefix: string,
  sortBy: VlassSortField,
  sortDirection: SortDirection,
  limit: number,
  morphologyCodes: VlassComponentCode[],
  recommendedOnly: boolean,
) {
  const normalizedPrefix = sourcePrefix.trim()
  const sortColumn = sortBy === 'total_flux' ? 'Ftot' : 'Fpeak'
  const direction = sortDirection === 'desc' ? 'DESC' : 'ASC'
  const escapedPrefix = normalizedPrefix.replaceAll("'", "''")
  const predicates = [
    `${sortColumn} IS NOT NULL`,
    morphologyCodes.length > 0
      ? `SCode IN (${morphologyCodes.map((code) => `'${code}'`).join(', ')})`
      : '1=0 /* Select at least one SCode */',
    ...recommendedPredicates(recommendedOnly),
    ...(normalizedPrefix ? [`CompName LIKE '${escapedPrefix.toUpperCase()}%'`] : []),
  ]
  return [
    `SELECT TOP ${limit}`,
    '  CompName, RAJ2000, DEJ2000, Ftot AS Total_mJy,',
    '  Fpeak/1000.0 AS Peak_mJy, SCode, DupFlag, QualFlag, MainSample',
    'FROM "J/ApJS/255/30/comp"',
    `WHERE ${predicates.join('\n  AND ')}`,
    `ORDER BY ${sortColumn} ${direction}, CompName ASC`,
  ].join('\n')
}

function buildConeAdqlPreview(
  ra: string,
  dec: string,
  radiusArcmin: string,
  sortBy: VlassConeSortField,
  sortDirection: SortDirection,
  limit: number,
  recommendedOnly: boolean,
) {
  const safeRa = validNumber(ra, 0, 360, false) ? Number(ra) : '<RA_DEG>'
  const safeDec = validNumber(dec, -90, 90) ? Number(dec) : '<DEC_DEG>'
  const safeRadius = validNumber(radiusArcmin, 0.1, 60) ? Number(radiusArcmin) : '<RADIUS_ARCMIN>'
  const sortColumn = sortBy === 'distance' ? 'Separation_deg' : sortBy === 'total_flux' ? 'Ftot' : 'Fpeak'
  const direction = sortDirection === 'desc' ? 'DESC' : 'ASC'
  const predicates = [
    ...recommendedPredicates(recommendedOnly),
    `1=CONTAINS(POINT('ICRS', RAJ2000, DEJ2000), CIRCLE('ICRS', ${safeRa}, ${safeDec}, ${safeRadius}/60.0))`,
  ]
  if (sortBy === 'total_flux') predicates.push('Ftot IS NOT NULL')
  if (sortBy === 'peak_flux') predicates.push('Fpeak IS NOT NULL')
  return [
    `SELECT TOP ${limit}`,
    '  CompName, RAJ2000, DEJ2000, Ftot AS Total_mJy,',
    '  Fpeak/1000.0 AS Peak_mJy, SCode, DupFlag, QualFlag, MainSample,',
    `  DISTANCE(POINT('ICRS', RAJ2000, DEJ2000), POINT('ICRS', ${safeRa}, ${safeDec})) AS Separation_deg`,
    'FROM "J/ApJS/255/30/comp"',
    `WHERE ${predicates.join('\n  AND ')}`,
    `ORDER BY ${sortColumn} ${direction}, CompName ASC`,
  ].join('\n')
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

interface VlassCatalogPanelProps {
  hidden: boolean
  selectedSourceIds: ReadonlySet<string>
  selectedTargetCount: number
  maximumTargetCount: number
  onToggleSource: (source: VlassSource) => void
}

export function VlassCatalogPanel({
  hidden,
  selectedSourceIds,
  selectedTargetCount,
  maximumTargetCount,
  onToggleSource,
}: VlassCatalogPanelProps) {
  const [mode, setMode] = useState<SearchMode>('brightness')
  const [sourcePrefix, setSourcePrefix] = useState('')
  const [sortBy, setSortBy] = useState<VlassSortField>('total_flux')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [limit, setLimit] = useState(100)
  const [morphologyCodes, setMorphologyCodes] = useState<Set<VlassComponentCode>>(
    () => new Set(COMPONENT_OPTIONS.map((option) => option.code)),
  )
  const [simbadTypeSelection, setSimbadTypeSelection] = useState<Set<SimbadTypeCategory> | null>(null)
  const [recommendedOnly, setRecommendedOnly] = useState(true)
  const morphologySelectAllRef = useRef<HTMLInputElement>(null)
  const [coneRa, setConeRa] = useState('')
  const [coneDec, setConeDec] = useState('')
  const [coneRadius, setConeRadius] = useState('5')
  const [coneSortBy, setConeSortBy] = useState<VlassConeSortField>('distance')
  const [coneSortDirection, setConeSortDirection] = useState<SortDirection>('asc')
  const [coneLimit, setConeLimit] = useState(100)
  const [coneRecommendedOnly, setConeRecommendedOnly] = useState(true)
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
  const selectedMorphologyCodes = COMPONENT_OPTIONS
    .map((option) => option.code)
    .filter((code) => morphologyCodes.has(code))
  const allSimbadTypes = simbadTypeSelection === null
  const selectedSimbadTypeCategories = simbadTypeSelection === null
    ? []
    : SIMBAD_TYPE_OPTIONS.map((option) => option.category).filter((category) => simbadTypeSelection.has(category))
  const adqlPreview = mode === 'brightness'
    ? buildBrightnessAdqlPreview(
        sourcePrefix,
        sortBy,
        sortDirection,
        limit,
        selectedMorphologyCodes,
        recommendedOnly,
      )
    : buildConeAdqlPreview(
        coneRa,
        coneDec,
        coneRadius,
        coneSortBy,
        coneSortDirection,
        coneLimit,
        coneRecommendedOnly,
      )

  useEffect(() => () => activeRequest.current?.controller.abort(), [])

  useEffect(() => {
    if (morphologySelectAllRef.current) {
      morphologySelectAllRef.current.indeterminate = (
        selectedMorphologyCodes.length > 0 && selectedMorphologyCodes.length < COMPONENT_OPTIONS.length
      )
    }
  }, [selectedMorphologyCodes.length])

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
    patchModeState(request.mode, { status: 'loading', error: null, notice: null, canRetry: false })

    try {
      const nextResponse = request.mode === 'brightness'
        ? await searchVlassSources(request.params, controller.signal)
        : await coneSearchVlassSources(request.params, controller.signal)
      if (controller.signal.aborted) return
      patchModeState(request.mode, { response: nextResponse, currentPage: 1, status: 'success' })
    } catch (caught) {
      if (controller.signal.aborted) return
      patchModeState(request.mode, {
        error: caught instanceof Error ? caught.message : 'An unexpected error occurred while searching VLASS.',
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
      if (selectedMorphologyCodes.length === 0) {
        patchModeState(mode, {
          error: 'Select at least one VLASS S_Code component type.',
          notice: null,
          canRetry: false,
          status: 'error',
        })
        return
      }
      if (!allSimbadTypes && selectedSimbadTypeCategories.length === 0) {
        patchModeState(mode, {
          error: 'Select at least one SIMBAD physical type or choose All physical types.',
          notice: null,
          canRetry: false,
          status: 'error',
        })
        return
      }
      if (sourcePrefixInvalid) {
        patchModeState(mode, {
          error: 'The VLASS component ID prefix must begin with a letter or number and contain only letters, numbers, spaces, +, periods, and hyphens.',
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
          morphology_codes: selectedMorphologyCodes,
          ...(selectedSimbadTypeCategories.length > 0
            ? { simbad_type_categories: selectedSimbadTypeCategories }
            : {}),
          recommended_only: recommendedOnly,
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
        recommended_only: coneRecommendedOnly,
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
      notice: 'Stopped waiting in this browser. The server job may continue until it finishes or reaches its time limit, after which it will be cleaned up.',
    })
  }

  const atTargetLimit = selectedTargetCount >= maximumTargetCount
  const submitLabel = mode === 'brightness' ? 'Load VLASS sources' : 'Search around coordinates'

  return (
    <section
      id="vlass-provider-panel"
      className="catalog-provider-panel"
      role="tabpanel"
      aria-labelledby="vlass-provider-tab"
      hidden={hidden}
    >
      <header className="catalog-provider-intro">
        <div>
          <p className="eyebrow">VERY LARGE ARRAY SKY SURVEY · EPOCH 1 QUICK LOOK</p>
          <h2>VLASS</h2>
          <p>
            Browse CIRADA 3 GHz radio components by flux density or search around an ICRS sky position. Recommended
            quality filtering is enabled by default.
          </p>
          <p className="catalog-provenance">
            Data: <a href="https://cdsarc.cds.unistra.fr/viz-bin/cat/J/ApJS/255/30">VLASS Epoch 1 Quick Look (Gordon et al. 2021)</a>
            <span aria-hidden="true"> · </span>
            <a href="https://science.nrao.edu/vlass">NRAO VLASS</a>
            <span aria-hidden="true"> · </span>
            <a href="https://simbad.cds.unistra.fr/simbad/">SIMBAD</a>
          </p>
        </div>
      </header>

      <section className="catalog-search-card" aria-labelledby="vlass-search-title">
        <form onSubmit={handleSubmit} aria-busy={activeState.status === 'loading'} noValidate>
          <fieldset className="catalog-mode-switch" disabled={anyLoading}>
            <legend>Search mode</legend>
            <label className={mode === 'brightness' ? 'is-active' : ''}>
              <input
                type="radio"
                name="vlass-search-mode"
                value="brightness"
                checked={mode === 'brightness'}
                onChange={() => setMode('brightness')}
              />
              <span><strong>Brightest sources</strong><small>Bright radio components across the catalog</small></span>
            </label>
            <label className={mode === 'cone' ? 'is-active' : ''}>
              <input
                type="radio"
                name="vlass-search-mode"
                value="cone"
                checked={mode === 'cone'}
                onChange={() => setMode('cone')}
              />
              <span><strong>Cone search</strong><small>Radio components within a specified sky region</small></span>
            </label>
          </fieldset>

          <div className="catalog-search-heading">
            <div>
              <p className="eyebrow">TAP catalog query</p>
              <h2 id="vlass-search-title">{mode === 'brightness' ? 'Load brightest sources' : 'Source cone search'}</h2>
            </div>
            <span>J/ApJS/255/30/comp · 3 GHz</span>
          </div>

          {mode === 'brightness' ? (
            <>
              <fieldset className="catalog-query-fieldset" disabled={activeState.status === 'loading'}>
                <legend className="sr-only">VLASS brightness search parameters</legend>
                <div className="catalog-query-grid">
                  <label className="catalog-field catalog-name-query">
                    <span>VLASS component ID prefix (optional)</span>
                    <input
                      type="search"
                      value={sourcePrefix}
                      maxLength={80}
                      placeholder="Leave blank for the entire catalog"
                      aria-describedby="vlass-search-help"
                      aria-invalid={sourcePrefixInvalid}
                      onChange={(event) => setSourcePrefix(event.currentTarget.value)}
                    />
                  </label>
                  <label className="catalog-field">
                    <span>Flux measure</span>
                    <select value={sortBy} onChange={(event) => setSortBy(event.currentTarget.value as VlassSortField)}>
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
              <RecommendedOnlyControl
                checked={recommendedOnly}
                disabled={activeState.status === 'loading'}
                onChange={setRecommendedOnly}
              />
              <fieldset className="catalog-classification-filter" disabled={activeState.status === 'loading'}>
                <legend>VLASS component type <span>(S_Code)</span></legend>
                <div className="catalog-filter-grid">
                  <label className="catalog-filter-all">
                    <input
                      ref={morphologySelectAllRef}
                      type="checkbox"
                      checked={selectedMorphologyCodes.length === COMPONENT_OPTIONS.length}
                      onChange={() => setMorphologyCodes((current) => (
                        current.size === COMPONENT_OPTIONS.length
                          ? new Set()
                          : new Set(COMPONENT_OPTIONS.map((option) => option.code))
                      ))}
                      aria-label="Select all VLASS S_Code component types"
                    />
                    <strong>Select all</strong>
                    <small>S + C + M + E</small>
                  </label>
                  {COMPONENT_OPTIONS.map((option) => (
                    <label key={option.code}>
                      <input
                        type="checkbox"
                        checked={morphologyCodes.has(option.code)}
                        onChange={() => setMorphologyCodes((current) => {
                          const next = new Set(current)
                          if (next.has(option.code)) next.delete(option.code)
                          else next.add(option.code)
                          return next
                        })}
                      />
                      <strong>{option.code} — {option.label}</strong>
                      <small>{option.description}</small>
                    </label>
                  ))}
                </div>
              </fieldset>
              <SimbadFilter
                selection={simbadTypeSelection}
                disabled={activeState.status === 'loading'}
                onChange={setSimbadTypeSelection}
              />
            </>
          ) : (
            <>
              <fieldset className="catalog-query-fieldset" disabled={activeState.status === 'loading'}>
                <legend className="sr-only">VLASS cone search parameters</legend>
                <div className="catalog-query-grid catalog-cone-grid">
                  <label className="catalog-field">
                    <span>Center RA (deg)</span>
                    <input type="number" min="0" max="359.999999" step="any" required value={coneRa}
                      placeholder="e.g. 69.26825" aria-describedby="vlass-search-help" aria-invalid={coneRaInvalid}
                      onChange={(event) => setConeRa(event.currentTarget.value)} />
                  </label>
                  <label className="catalog-field">
                    <span>Center Dec (deg)</span>
                    <input type="number" min="-90" max="90" step="any" required value={coneDec}
                      placeholder="e.g. 29.67052" aria-describedby="vlass-search-help" aria-invalid={coneDecInvalid}
                      onChange={(event) => setConeDec(event.currentTarget.value)} />
                  </label>
                  <label className="catalog-field">
                    <span>Search radius (arcmin)</span>
                    <input type="number" min="0.1" max="60" step="0.1" required value={coneRadius}
                      aria-describedby="vlass-search-help" aria-invalid={coneRadiusInvalid}
                      onChange={(event) => setConeRadius(event.currentTarget.value)} />
                  </label>
                  <label className="catalog-field">
                    <span>Sort field</span>
                    <select value={coneSortBy} onChange={(event) => setConeSortBy(event.currentTarget.value as VlassConeSortField)}>
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
              <RecommendedOnlyControl
                checked={coneRecommendedOnly}
                disabled={activeState.status === 'loading'}
                onChange={setConeRecommendedOnly}
              />
            </>
          )}

          <p id="vlass-search-help" className="catalog-form-help">
            {mode === 'brightness'
              ? 'Leave the VLASS component ID prefix blank to retrieve the catalog-wide TOP list. S_Code describes radio-component structure; SIMBAD categories describe positional candidates.'
              : 'Enter decimal-degree ICRS coordinates. The radius may range from 0.1 to 60 arcmin; results are initially ordered by angular separation.'}
            {' '}Results are displayed in pages of 25 sources.
          </p>
          <details className="catalog-query-preview">
            <summary>View VLASS TAP query</summary>
            <pre><code>{adqlPreview}</code></pre>
            <p>Familiar names and physical classifications are added through positional cross-matching with SIMBAD.</p>
          </details>
          <div className="catalog-search-actions">
            <button className="catalog-search-button" type="submit" disabled={activeState.status === 'loading'}>
              {activeState.status === 'loading' ? 'Running TAP job…' : submitLabel}
            </button>
            {activeState.status === 'loading' && (
              <button className="catalog-cancel-button" type="button" onClick={cancelSearch}>Stop waiting</button>
            )}
          </div>
          {activeState.status === 'loading' && (
            <p className="catalog-cancel-help">
              This stops waiting in the browser only. The server job may continue until it finishes or reaches its time limit.
            </p>
          )}
          {activeState.notice && <p className="catalog-request-notice" role="status">{activeState.notice}</p>}
        </form>
      </section>

      <VlassResults
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
    </section>
  )
}

function ResultLimitField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return (
    <label className="catalog-field">
      <span>Maximum results (TOP)</span>
      <select value={value} onChange={(event) => onChange(Number(event.currentTarget.value))}>
        {RESULT_LIMIT_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  )
}

function RecommendedOnlyControl({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="catalog-recommended-filter">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>Recommended sources only</strong>
        <small>Exclude strong duplicates, unsupported quality flags, and empty islands with no fitted components.</small>
      </span>
    </label>
  )
}

function SimbadFilter({
  selection,
  disabled,
  onChange,
}: {
  selection: Set<SimbadTypeCategory> | null
  disabled: boolean
  onChange: (selection: Set<SimbadTypeCategory> | null) => void
}) {
  const allTypes = selection === null
  return (
    <fieldset className="catalog-classification-filter catalog-simbad-filter" disabled={disabled}>
      <legend>SIMBAD physical type <span>(nearest 5″ positional candidate)</span></legend>
      <div className="catalog-filter-grid">
        <label className="catalog-filter-all">
          <input
            type="checkbox"
            checked={allTypes}
            onChange={(event) => onChange(event.currentTarget.checked ? null : new Set())}
            aria-label="Select all VLASS SIMBAD physical types"
          />
          <strong>All physical types</strong>
          <small>No SIMBAD restriction; includes sources without a counterpart</small>
        </label>
        {SIMBAD_TYPE_OPTIONS.map((option) => (
          <label key={option.category}>
            <input
              type="checkbox"
              checked={!allTypes && selection.has(option.category)}
              onChange={() => {
                const next = new Set(selection ?? [])
                if (next.has(option.category)) next.delete(option.category)
                else next.add(option.category)
                onChange(next)
              }}
            />
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function VlassResults({
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
  onToggleSource: (source: VlassSource) => void
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
  const simbadCategories = response?.simbad_type_categories ?? []
  const hasSimbadFilter = !isCone && simbadCategories.length > 0
  const candidateCount = response?.candidate_count ?? response?.result_count ?? 0

  return (
    <section className="catalog-results-card" aria-labelledby="vlass-results-title" aria-busy={status === 'loading'}>
      <header className="catalog-results-heading">
        <div>
          <p className="eyebrow">Query results</p>
          <h2 id="vlass-results-title">{isCone ? 'Cone search results' : 'Brightness-ranked catalog results'}</h2>
        </div>
        {response && <span>{response.result_count} returned · TOP {response.limit}</span>}
      </header>

      {status === 'idle' && !response && (
        <div className="catalog-message">
          <strong>{isCone ? 'Enter a center position and search radius.' : 'Choose the catalog query parameters.'}</strong>
          <span>{isCone ? 'Find VLASS components within the specified cone.' : 'Retrieve the brightest VLASS components.'}</span>
        </div>
      )}
      {status === 'loading' && (
        <p className={response ? 'catalog-refresh-status' : 'catalog-inline-status'} role="status">
          <span className="button-spinner" aria-hidden="true" />
          Running an asynchronous TAP job. Resolving familiar names afterward may take additional time.
        </p>
      )}
      {status === 'error' && (
        <div className={response ? 'catalog-error catalog-error-inline' : 'catalog-error'} role="alert">
          <span>{error}</span>
          {onRetry && <button type="button" onClick={onRetry}>Retry with the same parameters</button>}
        </div>
      )}
      {status === 'success' && response && sources.length === 0 && (
        <div className="catalog-message" role="status">
          <strong>No matching sources found.</strong>
          <span>{isCone
            ? 'Increase the search radius or check the center coordinates.'
            : hasSimbadFilter
              ? 'Select additional SIMBAD physical types or choose All physical types.'
              : 'Relax the filters or clear the VLASS component ID prefix.'}</span>
        </div>
      )}

      {response && sources.length > 0 && (
        <>
          <p className="catalog-result-summary" role="status">
            {response.result_count} {response.result_count === 1 ? 'result' : 'results'} · {sortLabel(response.sort_by)}{' '}
            {response.sort_direction === 'desc' ? 'descending' : 'ascending'}
            {isCone
              ? ` · center ${response.center_ra_deg ?? '—'}°, ${response.center_dec_deg ?? '—'}° · radius ${response.radius_arcmin ?? '—'}′`
              : response.source_prefix ? ` · VLASS component ID “${response.source_prefix}”` : ' · entire catalog'}
            {` · recommended only ${response.recommended_only ? 'on' : 'off'}`}
            {!isCone && response.morphology_codes?.length
              ? ` · S_Code ${response.morphology_codes.length === COMPONENT_OPTIONS.length ? 'All (S, C, M, E)' : response.morphology_codes.join(', ')}`
              : ''}
            {!isCone ? ` · SIMBAD physical type ${hasSimbadFilter ? simbadCategories.map(simbadCategoryLabel).join(', ') : 'All'}` : ''}
            {hasSimbadFilter ? ` · ${response.result_count} matches among ${candidateCount} VLASS candidates` : ''}
          </p>
          <EnrichmentNotice response={response} />
          <SourceTypeLegend sources={sources} morphologyCodebook={response.morphology_codebook} />
          <div className="catalog-table-wrap">
            <table>
              <caption>VLASS TAP results. Selected sources remain available for the observation-visibility calculation.</caption>
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
                  return (
                    <tr key={source.id} className={selected ? 'is-selected' : ''}>
                      <td>
                        <label className="catalog-row-select">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!selected && atTargetLimit}
                            onChange={() => onToggleSource(source)}
                            aria-label={`${source.name}: ${selected ? 'remove from visibility targets' : 'add to visibility targets'}`}
                          />
                          <span aria-hidden="true">✓</span>
                        </label>
                      </td>
                      <th scope="row">
                        <strong>{source.name}</strong>
                        {source.counterpart_name && <small>SIMBAD · {source.counterpart_name}</small>}
                        <small>VLASS · {source.source_id}</small>
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
            <nav className="catalog-pagination" aria-label="VLASS result pages">
              <button type="button" disabled={safePage <= 1} onClick={() => onChangePage(safePage - 1)}>Previous</button>
              <span><strong>{safePage}</strong> / {totalPages} pages · {rangeStart}–{rangeEnd} / {sources.length}</span>
              <button type="button" disabled={safePage >= totalPages} onClick={() => onChangePage(safePage + 1)}>Next</button>
            </nav>
          )}
        </>
      )}

      {atTargetLimit && (
        <p className="catalog-limit-note" role="status">
          You can select up to {maximumTargetCount} targets across the example and catalog sources.
        </p>
      )}
    </section>
  )
}

function sortLabel(sortBy: VlassConeSortField) {
  if (sortBy === 'distance') return 'angular separation'
  return sortBy === 'total_flux' ? 'total flux' : 'peak flux'
}

function sortAria(direction: SortDirection) {
  return direction === 'desc' ? 'descending' : 'ascending'
}

function EnrichmentNotice({ response }: { response: VlassSearchResponse }) {
  if (response.enrichment_status === 'complete') return null
  const warning = englishCatalogText(response.enrichment_warning)
  return (
    <p className={`catalog-enrichment-notice is-${response.enrichment_status}`} role="status">
      <strong>SIMBAD name and type enrichment {response.enrichment_status === 'partial' ? 'partially completed' : 'unavailable'}</strong>
      <span>{warning ?? 'The VLASS positions and flux measurements remain available.'}</span>
    </p>
  )
}

function SourceClassification({
  source,
  enrichmentStatus,
}: {
  source: VlassSource
  enrichmentStatus: VlassSearchResponse['enrichment_status']
}) {
  const hasCounterpart = Boolean(source.crossmatch_catalog && source.counterpart_name)
  const morphologyLabel = englishCatalogText(source.morphology_label)
  const morphologyDescription = englishCatalogText(source.morphology_description)
  const objectTypeLabel = englishCatalogText(source.object_type_label)
  const objectTypeDescription = englishCatalogText(source.object_type_description)
  return (
    <div className="catalog-classification">
      <span title={morphologyDescription ?? undefined}>
        <small>VLASS component type</small>
        <b>{source.morphology_code
          ? `${source.morphology_code} — ${morphologyLabel ?? 'No description'}`
          : 'Unclassified'}</b>
      </span>
      <span>
        <small>Catalog quality</small>
        <b>Quality {source.quality_flag} · Duplicate {source.duplicate_flag} · {source.main_sample ? 'Main sample' : 'Outside main sample'}</b>
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
  sources: VlassSource[]
  morphologyCodebook: VlassSearchResponse['morphology_codebook']
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
  const definitions = (morphologyCodebook.length > 0 ? morphologyCodebook : COMPONENT_OPTIONS).map((definition) => ({
    ...definition,
    label: englishCatalogText(definition.label) ?? 'No English description',
    description: englishCatalogText(definition.description) ?? '',
  }))
  return (
    <details className="catalog-code-legend">
      <summary>Classification codes, quality flags, and positional-matching criteria</summary>
      <div className="catalog-code-legend-grid">
        <section>
          <h3>VLASS component type (S_Code)</h3>
          <p>This describes the catalog component structure; it is not a physical object type.</p>
          <dl>
            {definitions.map((definition) => (
              <div key={definition.code}>
                <dt>{definition.code}</dt>
                <dd>{definition.label}{definition.description ? ` — ${definition.description}` : ''}</dd>
              </div>
            ))}
          </dl>
          <p>Recommended-only queries use DupFlag &lt; 2, QualFlag 0 or 4, and exclude S_Code E.</p>
        </section>
        <section>
          <h3>SIMBAD physical type</h3>
          <p>These are SIMBAD positional candidates within 5″ of a VLASS position, not confirmed identifications.</p>
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
