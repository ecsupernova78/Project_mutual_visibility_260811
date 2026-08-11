import type { VisibilityRequest, VisibilityResponse } from './types'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ?? ''
const ENDPOINT = `${API_BASE_URL}/api/v1/visibility/altitude-series`

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
