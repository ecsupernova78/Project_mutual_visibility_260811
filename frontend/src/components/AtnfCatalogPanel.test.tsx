import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AtnfSearchResponse, AtnfSource } from '../types'
import { AtnfCatalogPanel } from './AtnfCatalogPanel'

const source: AtnfSource = {
  id: 'atnf-j0332+5434',
  catalog: 'atnf',
  catalogue_version: '2.9.0',
  catalogue_citation: 'Manchester et al. (2005), AJ 129, 1993; ATNF Pulsar Catalogue',
  source_id: 'J0332+5434',
  name: 'B0329+54',
  aliases: ['J0332+5434'],
  ra_deg: 53.25,
  dec_deg: 54.58,
  ra_hms: '03:32:59',
  dec_dms: '+54:34:44',
  total_flux_mjy: 100,
  peak_flux_mjy: null,
  separation_arcmin: null,
  dm: 26.8,
  p0_s: 0.7145,
  pos_unc_arcsec: 120,
  pos_coarse: true,
  provisional: true,
  type_codes: 'HE,RRAT',
  is_binary: false,
  is_msp: false,
  flux_frequency_mhz: 600,
  flux_method: 'alpha_default',
  s_est_400_mjy: 120,
  s_est_400_method: 'measured',
  s_est_600_mjy: 100,
  s_est_600_method: 'alpha_default',
  s_est_800_mjy: null,
  s_est_800_method: 'none',
}

function response(mode: 'brightness' | 'cone' = 'brightness'): Response {
  const body: AtnfSearchResponse = {
    catalog: 'atnf',
    catalog_release: 'ATNF Pulsar Catalogue v2.9.0',
    catalogue_version: '2.9.0',
    citation: 'Manchester et al. (2005), AJ 129, 1993',
    coordinate_frame: 'icrs',
    reference_frequency_mhz: 600,
    search_mode: mode,
    sort_by: mode === 'cone' ? 'distance' : 'flux',
    sort_direction: mode === 'cone' ? 'asc' : 'desc',
    limit: 100,
    name: null,
    center_ra_deg: mode === 'cone' ? 53.25 : null,
    center_dec_deg: mode === 'cone' ? 54.58 : null,
    radius_arcmin: mode === 'cone' ? 60 : null,
    candidate_count: 4503,
    result_count: 1,
    sources: [{ ...source, separation_arcmin: mode === 'cone' ? 0 : null }],
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function renderPanel(onToggleSource = vi.fn()) {
  render(<AtnfCatalogPanel hidden={false} selectedSourceIds={new Set()} selectedTargetCount={0}
    maximumTargetCount={25} onToggleSource={onToggleSource} />)
}

afterEach(() => vi.restoreAllMocks())

describe('AtnfCatalogPanel', () => {
  it('shows ATNF provenance, physical filters, result quality, and selects a pulsar', async () => {
    const user = userEvent.setup()
    const onToggleSource = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response())
    renderPanel(onToggleSource)
    expect(screen.getByText(/ATNF Pulsar Catalogue v2.9.0/)).toBeInTheDocument()
    expect(screen.getByText(/Manchester et al. 2005/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('DM min (pc cm⁻³)'), '20')
    await user.type(screen.getByLabelText('Minimum estimated flux (mJy)'), '5')
    await user.type(screen.getByLabelText('ATNF type code (optional)'), 'HE')
    await user.selectOptions(screen.getByLabelText('Binary system'), 'no')
    await user.click(screen.getByRole('button', { name: 'Search ATNF pulsars' }))

    const select = await screen.findByRole('checkbox', { name: 'B0329+54: add to visibility targets' })
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.searchParams.get('dm_min')).toBe('20')
    expect(url.searchParams.get('min_flux_mjy')).toBe('5')
    expect(url.searchParams.get('type_code')).toBe('HE')
    expect(url.searchParams.get('is_binary')).toBe('false')
    expect(screen.getByText(/1 of 4,503 matches/)).toBeInTheDocument()
    expect(screen.getByText('Provisional')).toBeInTheDocument()
    expect(screen.getByText('Coarse position')).toBeInTheDocument()
    expect(screen.getByText('assumed α = −1.6')).toBeInTheDocument()
    await user.click(select)
    expect(onToggleSource).toHaveBeenCalledWith(expect.objectContaining({ catalog: 'atnf', source_id: 'J0332+5434' }))
  })

  it('searches a sky cone and keeps its result separate from name mode', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('cone'))
    renderPanel()
    const panel = document.getElementById('atnf-provider-panel') as HTMLElement
    await user.click(within(panel).getByRole('radio', { name: /Cone search/ }))
    await user.type(screen.getByLabelText('Center RA (°)'), '53.25')
    await user.type(screen.getByLabelText('Center Dec (°)'), '54.58')
    await user.click(screen.getByRole('button', { name: 'Search around coordinates' }))
    await screen.findByRole('checkbox', { name: 'B0329+54: add to visibility targets' })
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/v1/catalogs/atnf/cone')
    expect(url.searchParams.get('ra_deg')).toBe('53.25')
    expect(url.searchParams.get('radius_arcmin')).toBe('60')
  })
  it('applies physical filters to name suggestions', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response())
    renderPanel()
    await user.type(screen.getByLabelText(/DM min/), '100')
    await user.type(screen.getByLabelText('PSR J/B name (optional)'), 'B0329')
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) =>
      String(input).startsWith('/api/v1/catalogs/atnf/sources'))).toBe(true))
    const call = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('/api/v1/catalogs/atnf/sources'))
    const url = new URL(String(call?.[0]), 'http://localhost')
    expect(url.searchParams.get('dm_min')).toBe('100')
  })

})
