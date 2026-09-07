import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { VlassSource } from '../types'
import { VlassCatalogPanel } from './VlassCatalogPanel'

function makeSource(index = 0): VlassSource {
  return {
    id: `vlass-source-${index}`,
    catalog: 'vlass',
    source_id: `VLASS1QLCIR J12345${index}.00+451234.0`,
    name: `VLASS1QLCIR J12345${index}.00+451234.0`,
    ra_deg: 188.736 + index / 100,
    dec_deg: 45.209,
    ra_hms: '12:34:56.70',
    dec_dms: '+45:12:34.0',
    total_flux_mjy: 1200 - index,
    peak_flux_mjy: 950 - index,
    aliases: [],
    morphology_code: 'S',
    morphology_label: 'Single-Gaussian fit',
    morphology_description: 'One Gaussian fitted in its island',
    duplicate_flag: 0,
    quality_flag: 0,
    main_sample: true,
    separation_arcmin: null,
    counterpart_name: null,
    counterpart_aliases: [],
    object_type_code: null,
    object_type_label: null,
    object_type_description: null,
    crossmatch_separation_arcsec: null,
    crossmatch_confidence: null,
    crossmatch_catalog: null,
  }
}

function catalogResponse({
  sources = [makeSource()],
  mode = 'brightness',
  recommendedOnly = true,
}: {
  sources?: VlassSource[]
  mode?: 'brightness' | 'cone'
  recommendedOnly?: boolean
} = {}) {
  return new Response(JSON.stringify({
    catalog: 'vlass',
    catalog_release: 'VLASS Epoch 1 Quick Look (Gordon et al. 2021)',
    coordinate_frame: 'icrs',
    reference_frequency_mhz: 3000,
    tap_mode: 'async',
    search_mode: mode,
    enrichment_status: 'complete',
    enrichment_warning: null,
    morphology_codebook: [
      { code: 'S', label: 'Single-Gaussian fit', description: 'One Gaussian fitted in its island' },
      { code: 'E', label: 'Empty island', description: 'No components were fitted in the island' },
    ],
    recommended_only: recommendedOnly,
    sort_by: mode === 'cone' ? 'distance' : 'total_flux',
    sort_direction: mode === 'cone' ? 'asc' : 'desc',
    limit: 100,
    source_prefix: null,
    morphology_codes: mode === 'brightness' ? ['S', 'C', 'M', 'E'] : null,
    simbad_type_categories: [],
    candidate_count: sources.length,
    center_ra_deg: mode === 'cone' ? 188.736 : null,
    center_dec_deg: mode === 'cone' ? 45.209 : null,
    radius_arcmin: mode === 'cone' ? 5 : null,
    result_count: sources.length,
    sources,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function renderPanel({
  selectedSourceIds = new Set<string>(),
  selectedTargetCount = 5,
  onToggleSource = vi.fn(),
}: {
  selectedSourceIds?: ReadonlySet<string>
  selectedTargetCount?: number
  onToggleSource?: (source: VlassSource) => void
} = {}) {
  render(
    <VlassCatalogPanel
      hidden={false}
      selectedSourceIds={selectedSourceIds}
      selectedTargetCount={selectedTargetCount}
      maximumTargetCount={25}
      onToggleSource={onToggleSource}
    />,
  )
}

describe('VlassCatalogPanel', () => {
  it('runs a brightness search with the VLASS filters and can select its result', async () => {
    const user = userEvent.setup()
    const source = makeSource()
    const onToggleSource = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(catalogResponse({ sources: [source] }))
    renderPanel({ onToggleSource })

    await user.type(screen.getByLabelText('VLASS component ID prefix (optional)'), 'vlass1qlcir J12')
    await user.click(screen.getByText('View VLASS TAP query'))
    expect(screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes('FROM "J/ApJS/255/30/comp"') === true
      && element.textContent.includes("DupFlag < 2")
      && element.textContent.includes("SCode <> 'E'")
      && element.textContent.includes("CompName LIKE 'VLASS1QLCIR J12%'")
    ))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load VLASS sources' }))
    const checkbox = await screen.findByRole('checkbox', { name: `${source.name}: add to visibility targets` })
    const url = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/v1/catalogs/vlass/sources')
    expect(url.searchParams.get('recommended_only')).toBe('true')
    expect(url.searchParams.getAll('morphology_codes')).toEqual(['S', 'C', 'M', 'E'])
    expect(url.searchParams.get('source_prefix')).toBe('vlass1qlcir J12')
    expect(screen.getByText('Quality 0 · Duplicate 0 · Main sample')).toBeInTheDocument()

    await user.click(checkbox)
    expect(onToggleSource).toHaveBeenCalledWith(source)
  })

  it('uses the dedicated cone endpoint and retains independent mode results', async () => {
    const user = userEvent.setup()
    const brightnessSource = makeSource(1)
    const coneSource = { ...makeSource(2), separation_arcmin: 0.5 }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(catalogResponse({ sources: [brightnessSource] }))
      .mockResolvedValueOnce(catalogResponse({ sources: [coneSource], mode: 'cone' }))
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Load VLASS sources' }))
    expect(await screen.findByText(brightnessSource.source_id, { selector: 'strong' })).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Cone search/ }))
    await user.type(screen.getByLabelText('Center RA (deg)'), '188.736')
    await user.type(screen.getByLabelText('Center Dec (deg)'), '45.209')
    await user.selectOptions(screen.getByLabelText('Sort field'), 'total_flux')
    await user.click(screen.getByText('View VLASS TAP query'))
    expect(screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes('AND Ftot IS NOT NULL') === true
    ))).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Sort field'), 'distance')
    await user.click(screen.getByRole('button', { name: 'Search around coordinates' }))
    expect(await screen.findByText(coneSource.source_id, { selector: 'strong' })).toBeInTheDocument()

    const url = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost')
    expect(url.pathname).toBe('/api/v1/catalogs/vlass/cone')
    expect(url.searchParams.get('recommended_only')).toBe('true')
    expect(screen.getByText('0.50′')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Brightest sources/ }))
    expect(screen.getByText(brightnessSource.source_id, { selector: 'strong' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('allows a selected row to be removed when the global target limit is reached', async () => {
    const user = userEvent.setup()
    const selectedSource = makeSource(1)
    const unselectedSource = makeSource(2)
    const onToggleSource = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(catalogResponse({ sources: [selectedSource, unselectedSource] }))
    renderPanel({
      selectedSourceIds: new Set([selectedSource.id]),
      selectedTargetCount: 25,
      onToggleSource,
    })

    await user.click(screen.getByRole('button', { name: 'Load VLASS sources' }))
    const selectedCheckbox = await screen.findByRole('checkbox', {
      name: `${selectedSource.name}: remove from visibility targets`,
    })
    expect(selectedCheckbox).toBeEnabled()
    expect(screen.getByRole('checkbox', {
      name: `${unselectedSource.name}: add to visibility targets`,
    })).toBeDisabled()
    await user.click(selectedCheckbox)
    expect(onToggleSource).toHaveBeenCalledWith(selectedSource)
  })

  it('aborts a long request and retries a failed request with the same parameters', async () => {
    const user = userEvent.setup()
    let requestSignal: AbortSignal | undefined
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_input, init) => {
      requestSignal = init?.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
      })
    })
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Load VLASS sources' }))
    await user.click(await screen.findByRole('button', { name: 'Stop waiting' }))
    await waitFor(() => expect(requestSignal?.aborted).toBe(true))
    expect(screen.getByText(/Stopped waiting in this browser/)).toBeInTheDocument()

    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(catalogResponse())
    await user.click(screen.getByRole('button', { name: 'Load VLASS sources' }))
    await user.click(await screen.findByRole('button', { name: 'Retry with the same parameters' }))
    expect(await screen.findByRole('table')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('offers a tri-state component selector and rejects an empty selection', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    renderPanel()
    const group = screen.getByRole('group', { name: /VLASS component type.*S_Code/ })
    const selectAll = within(group).getByRole('checkbox', { name: 'Select all VLASS S_Code component types' })
    await user.click(selectAll)
    await user.click(screen.getByRole('button', { name: 'Load VLASS sources' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Select at least one VLASS S_Code component type.')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects ADQL wildcard characters in a VLASS component ID prefix', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    renderPanel()

    await user.type(screen.getByLabelText('VLASS component ID prefix (optional)'), 'VLASS1QLCIR_J12')
    await user.click(screen.getByRole('button', { name: 'Load VLASS sources' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The VLASS component ID prefix must begin with a letter or number and contain only letters, numbers, spaces, +, periods, and hyphens.',
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
