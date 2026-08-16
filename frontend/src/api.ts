import type {
  LofarConeSearchParams,
  LofarSearchParams,
  LofarSearchResponse,
  VisibilityRequest,
  VisibilityResponse,
} from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? ''
const ENDPOINT = `${API_BASE_URL}/api/v1/visibility/altitude-series`
const LOFAR_ENDPOINT = `${API_BASE_URL}/api/v1/catalogs/lotss-dr3/sources`
const LOFAR_CONE_ENDPOINT = `${API_BASE_URL}/api/v1/catalogs/lotss-dr3/cone`
const HANGUL_PATTERN = new RegExp('[\\u3131-\\u318e\\uac00-\\ud7a3]')

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

export async function calculateVisibility(
  payload: VisibilityRequest,
  signal?: AbortSignal,
): Promise<VisibilityResponse> {
  let response: Response

  try {
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

  let response: Response
  try {
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
