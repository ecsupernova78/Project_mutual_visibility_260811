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
    throw new ApiError('계산 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // The friendly status-based message below is sufficient for non-JSON errors.
    }

    throw new ApiError(
      detail ||
        (response.status >= 500
          ? '서버에서 계산을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : '입력값을 확인한 뒤 다시 계산해 주세요.'),
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
    throw new ApiError('LOFAR DR3 카탈로그 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // Use the status-based message below for non-JSON responses.
    }
    throw new ApiError(
      detail ||
        (response.status >= 500
          ? 'LOFAR DR3 검색을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : 'LOFAR DR3 검색 조건을 확인해 주세요.'),
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
    throw new ApiError('LOFAR DR3 cone search 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.')
  }

  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: unknown }
      if (typeof body.detail === 'string') detail = body.detail
    } catch {
      // Use the status-based message below for non-JSON responses.
    }
    throw new ApiError(
      detail ||
        (response.status >= 500
          ? 'LOFAR DR3 cone search를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.'
          : '중심 좌표와 검색 반경을 확인해 주세요.'),
      response.status,
    )
  }

  return (await response.json()) as LofarSearchResponse
}
