import type {
  LofarConeSearchParams,
  LofarSearchParams,
  LofarSearchResponse,
  VlassConeSearchParams,
  VlassSearchParams,
  VlassSearchResponse,
  VisibilityRequest,
  VisibilityResponse,
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? ''
const HEALTH_ENDPOINT = `${API_BASE_URL}/health`
const ENDPOINT = `${API_BASE_URL}/api/v1/visibility/altitude-series`
const LOFAR_ENDPOINT = `${API_BASE_URL}/api/v1/catalogs/lotss-dr3/sources`
const LOFAR_CONE_ENDPOINT = `${API_BASE_URL}/api/v1/catalogs/lotss-dr3/cone`
const VLASS_ENDPOINT = `${API_BASE_URL}/api/v1/catalogs/vlass/sources`
const VLASS_CONE_ENDPOINT = `${API_BASE_URL}/api/v1/catalogs/vlass/cone`
const HANGUL_PATTERN = new RegExp('[\\u3131-\\u318e\\uac00-\\ud7a3]')
const API_READY_TTL_MS = 10 * 60 * 1000
const API_WAKE_RETRY_DELAY_MS = 4_000
const API_WAKE_ATTEMPTS = 24

let apiReadyUntil = 0
let apiWakePromise: Promise<void> | null = null

function englishErrorDetail(detail: unknown) {
  return typeof detail === 'string' && !HANGUL_PATTERN.test(detail) ? detail : ''
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function waitForRetry(delayMs: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const timeout = window.setTimeout(() => {
      signal?.removeEventListener('abort', handleAbort)
      resolve()
    }, delayMs)
    const handleAbort = () => {
      window.clearTimeout(timeout)
      reject(abortError())
    }
    signal?.addEventListener('abort', handleAbort, { once: true })
  })
}

async function probeApiUntilReady() {
  let lastError: unknown

  for (let attempt = 0; attempt < API_WAKE_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(HEALTH_ENDPOINT, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      })
      if (response.ok) {
        const body = (await response.json()) as { status?: unknown }
        if (body.status === 'ok') {
          apiReadyUntil = Date.now() + API_READY_TTL_MS
          return
        }
      }
      lastError = new Error(`Health check returned HTTP ${response.status}.`)
    } catch (error) {
      lastError = error
    }

    if (attempt < API_WAKE_ATTEMPTS - 1) {
      await waitForRetry(API_WAKE_RETRY_DELAY_MS)
    }
  }

  throw new ApiError(
    'The free calculation server is still starting. Please wait a moment and try again.',
    lastError instanceof ApiError ? lastError.status : undefined,
  )
}

async function waitForApiReady(signal?: AbortSignal) {
  // Local development uses Vite's same-origin proxy and does not need a wake-up probe.
  if (!API_BASE_URL || Date.now() < apiReadyUntil) return
  if (signal?.aborted) throw abortError()

  apiWakePromise ??= probeApiUntilReady().finally(() => {
    apiWakePromise = null
  })

  if (!signal) {
    await apiWakePromise
    return
  }

  await Promise.race([
    apiWakePromise,
    new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(abortError()), { once: true })
    }),
  ])
}

export async function calculateVisibility(
  payload: VisibilityRequest,
  signal?: AbortSignal,
): Promise<VisibilityResponse> {
  let response: Response

  try {
    await waitForApiReady(signal)
    response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error
    }
    throw new ApiError('Unable to connect to the calculation server. Please try again shortly.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      detail = englishErrorDetail(body.detail)
    } catch {
      // The friendly status-based message below is sufficient for non-JSON errors.
    }

    throw new ApiError(
      detail ||
        (response.status >= 500
          ? 'The server could not complete the calculation. Please try again shortly.'
          : 'Check the input values and run the calculation again.'),
      response.status,
    )
  }

  return (await response.json()) as VisibilityResponse
}

export async function searchLofarSources(
  params: LofarSearchParams,
  signal?: AbortSignal,
): Promise<LofarSearchResponse> {
  const query = new URLSearchParams({
    sort_by: params.sort_by,
    sort_direction: params.sort_direction,
    limit: String(params.limit),
  })

  const sourcePrefix = params.source_prefix?.trim()
  if (sourcePrefix) query.set('source_prefix', sourcePrefix)
  for (const code of params.morphology_codes) query.append('morphology_codes', code)
  for (const category of params.simbad_type_categories ?? []) {
    query.append('simbad_type_categories', category)
  }

  let response: Response
  try {
    await waitForApiReady(signal)
    response = await fetch(`${LOFAR_ENDPOINT}?${query.toString()}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Unable to connect to the LOFAR DR3 catalog service. Please try again shortly.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      detail = englishErrorDetail(body.detail)
    } catch {
      // Use the status-based message below for non-JSON responses.
    }
    throw new ApiError(
      detail ||
        (response.status >= 500
          ? 'The LOFAR DR3 search could not be completed. Please try again shortly.'
          : 'Check the LOFAR DR3 search parameters and try again.'),
      response.status,
    )
  }

  return (await response.json()) as LofarSearchResponse
}

export async function coneSearchLofarSources(
  params: LofarConeSearchParams,
  signal?: AbortSignal,
): Promise<LofarSearchResponse> {
  const query = new URLSearchParams({
    ra_deg: String(params.ra_deg),
    dec_deg: String(params.dec_deg),
    radius_arcmin: String(params.radius_arcmin),
    sort_by: params.sort_by,
    sort_direction: params.sort_direction,
    limit: String(params.limit),
  })

  let response: Response
  try {
    await waitForApiReady(signal)
    response = await fetch(`${LOFAR_CONE_ENDPOINT}?${query.toString()}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Unable to connect to the LOFAR DR3 cone-search service. Please try again shortly.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      detail = englishErrorDetail(body.detail)
    } catch {
      // Use the status-based message below for non-JSON responses.
    }
    throw new ApiError(
      detail ||
        (response.status >= 500
          ? 'The LOFAR DR3 cone search could not be completed. Please try again shortly.'
          : 'Check the center coordinates and search radius, then try again.'),
      response.status,
    )
  }

  return (await response.json()) as LofarSearchResponse
}

export async function searchVlassSources(
  params: VlassSearchParams,
  signal?: AbortSignal,
): Promise<VlassSearchResponse> {
  const query = new URLSearchParams({
    sort_by: params.sort_by,
    sort_direction: params.sort_direction,
    limit: String(params.limit),
    recommended_only: String(params.recommended_only),
  })

  const sourcePrefix = params.source_prefix?.trim()
  if (sourcePrefix) query.set('source_prefix', sourcePrefix)
  for (const code of params.morphology_codes) query.append('morphology_codes', code)
  for (const category of params.simbad_type_categories ?? []) {
    query.append('simbad_type_categories', category)
  }

  let response: Response
  try {
    await waitForApiReady(signal)
    response = await fetch(`${VLASS_ENDPOINT}?${query.toString()}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Unable to connect to the VLASS catalog service. Please try again shortly.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      detail = englishErrorDetail(body.detail)
    } catch {
      // Use the status-based message below for non-JSON responses.
    }
    throw new ApiError(
      detail ||
        (response.status >= 500
          ? 'The VLASS search could not be completed. Please try again shortly.'
          : 'Check the VLASS search parameters and try again.'),
      response.status,
    )
  }

  return (await response.json()) as VlassSearchResponse
}

export async function coneSearchVlassSources(
  params: VlassConeSearchParams,
  signal?: AbortSignal,
): Promise<VlassSearchResponse> {
  const query = new URLSearchParams({
    ra_deg: String(params.ra_deg),
    dec_deg: String(params.dec_deg),
    radius_arcmin: String(params.radius_arcmin),
    sort_by: params.sort_by,
    sort_direction: params.sort_direction,
    limit: String(params.limit),
    recommended_only: String(params.recommended_only),
  })

  let response: Response
  try {
    await waitForApiReady(signal)
    response = await fetch(`${VLASS_CONE_ENDPOINT}?${query.toString()}`, { signal })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError('Unable to connect to the VLASS cone-search service. Please try again shortly.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      detail = englishErrorDetail(body.detail)
    } catch {
      // Use the status-based message below for non-JSON responses.
    }
    throw new ApiError(
      detail ||
        (response.status >= 500
          ? 'The VLASS cone search could not be completed. Please try again shortly.'
          : 'Check the center coordinates and search radius, then try again.'),
      response.status,
    )
  }

  return (await response.json()) as VlassSearchResponse
}
