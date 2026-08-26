import { afterEach, describe, expect, it, vi } from 'vitest'

import { coneSearchLofarSources, searchLofarSources } from './api'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('LOFAR API errors', () => {
  it('serializes brightness classification filters as repeated query parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ sources: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await searchLofarSources({
      sort_by: 'total_flux',
      sort_direction: 'desc',
      limit: 100,
      morphology_codes: ['S', 'C'],
      simbad_type_categories: ['galaxy', 'pulsar'],
    })

    const query = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost').searchParams
    expect(query.getAll('morphology_codes')).toEqual(['S', 'C'])
    expect(query.getAll('simbad_type_categories')).toEqual(['galaxy', 'pulsar'])
  })

  it('omits the SIMBAD parameter for the unrestricted All physical types state', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ sources: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await searchLofarSources({
      sort_by: 'total_flux',
      sort_direction: 'desc',
      limit: 100,
      morphology_codes: ['S', 'M', 'C'],
    })

    const query = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost').searchParams
    expect(query.has('simbad_type_categories')).toBe(false)
  })

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
      morphology_codes: ['S', 'M', 'C'],
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
