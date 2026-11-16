import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  coneSearchAtnfSources,
  coneSearchLofarSources,
  coneSearchVlassSources,
  searchAtnfSources,
  searchLofarSources,
  searchVlassSources,
} from './api'

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

describe('VLASS API', () => {
  it('serializes brightness filters and the recommended-only switch', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ sources: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await searchVlassSources({
      source_prefix: 'VLASS1QLCIR J12',
      sort_by: 'peak_flux',
      sort_direction: 'desc',
      limit: 250,
      morphology_codes: ['S', 'C'],
      simbad_type_categories: ['quasar'],
      recommended_only: false,
    })

    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/v1/catalogs/vlass/sources')
    expect(url.searchParams.get('source_prefix')).toBe('VLASS1QLCIR J12')
    expect(url.searchParams.getAll('morphology_codes')).toEqual(['S', 'C'])
    expect(url.searchParams.getAll('simbad_type_categories')).toEqual(['quasar'])
    expect(url.searchParams.get('recommended_only')).toBe('false')
  })

  it('serializes cone coordinates and reports an English status fallback', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(
      JSON.stringify({ sources: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))

    await coneSearchVlassSources({
      ra_deg: 10,
      dec_deg: -20,
      radius_arcmin: 3,
      sort_by: 'distance',
      sort_direction: 'asc',
      limit: 100,
      recommended_only: true,
    })
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/v1/catalogs/vlass/cone')
    expect(url.searchParams.get('ra_deg')).toBe('10')
    expect(url.searchParams.get('recommended_only')).toBe('true')

    fetchMock.mockResolvedValueOnce(new Response('', { status: 503 }))
    await expect(coneSearchVlassSources({
      ra_deg: 10,
      dec_deg: -20,
      radius_arcmin: 3,
      sort_by: 'distance',
      sort_direction: 'asc',
      limit: 100,
      recommended_only: true,
    })).rejects.toMatchObject({
      message: 'The VLASS cone search could not be completed. Please try again shortly.',
      status: 503,
    })
  })
})

describe('ATNF API', () => {
  it('serializes pulsar filters and cone parameters', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(
      JSON.stringify({ sources: [] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    await searchAtnfSources({
      name: 'PSR B0329+54',
      sort_by: 'name',
      sort_direction: 'asc',
      limit: 25,
      dm_min: 20,
      p0_max: 1,
      min_flux_mjy: 1.5,
      flux_frequency_mhz: 600,
      include_coarse: false,
      include_provisional: true,
      type_code: 'HE',
      is_binary: false,
      is_msp: true,
    })
    const named = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(named.pathname).toBe('/api/v1/catalogs/atnf/sources')
    expect(named.searchParams.get('name')).toBe('PSR B0329+54')
    expect(named.searchParams.get('dm_min')).toBe('20')
    expect(named.searchParams.get('flux_frequency_mhz')).toBe('600')
    expect(named.searchParams.get('include_coarse')).toBe('false')
    expect(named.searchParams.get('type_code')).toBe('HE')
    expect(named.searchParams.get('is_binary')).toBe('false')
    expect(named.searchParams.get('is_msp')).toBe('true')

    await coneSearchAtnfSources({
      ra_deg: 83.633,
      dec_deg: 22.014,
      radius_arcmin: 60,
      sort_by: 'distance',
      sort_direction: 'asc',
      limit: 10,
      flux_frequency_mhz: 400,
      include_coarse: true,
      include_provisional: false,
    })
    const cone = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
    expect(cone.pathname).toBe('/api/v1/catalogs/atnf/cone')
    expect(cone.searchParams.get('ra_deg')).toBe('83.633')
    expect(cone.searchParams.get('radius_arcmin')).toBe('60')
    expect(cone.searchParams.get('include_provisional')).toBe('false')
  })
})
