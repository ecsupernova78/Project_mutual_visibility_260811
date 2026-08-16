import { afterEach, describe, expect, it, vi } from 'vitest'

import { coneSearchLofarSources, searchLofarSources } from './api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LOFAR API errors', () => {
  it('replaces a legacy Korean backend detail with an English brightness-search fallback', async () => {
    const legacyKoreanDetail = String.fromCodePoint(0xd55c, 0xae00)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ detail: legacyKoreanDetail }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    ))

    await expect(searchLofarSources({
      sort_by: 'total_flux',
      sort_direction: 'desc',
      limit: 100,
    })).rejects.toMatchObject({
      message: 'Check the LOFAR DR3 search parameters and try again.',
      status: 400,
    })
  })

  it('preserves a useful English backend detail for a cone-search error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ detail: 'The requested sky region is unavailable.' }),
      { status: 422, headers: { 'Content-Type': 'application/json' } },
    ))

    await expect(coneSearchLofarSources({
      ra_deg: 10,
      dec_deg: 20,
      radius_arcmin: 5,
      sort_by: 'distance',
      sort_direction: 'asc',
      limit: 100,
    })).rejects.toMatchObject({
      message: 'The requested sky region is unavailable.',
      status: 422,
    })
  })
})
