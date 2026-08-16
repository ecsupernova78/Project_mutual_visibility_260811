import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LofarCatalogPanel } from './LofarCatalogPanel'

function makeSource(index: number) {
  const suffix = String(index).padStart(2, '0')
  return {
    id: `lotss-dr3-source-${suffix}`,
    catalog: 'lofar_dr3' as const,
    source_id: `ILTJ1234${suffix}.0+451234`,
    name: `ILTJ1234${suffix}.0+451234`,
    ra_deg: 188.736 + index / 100,
    dec_deg: 45.209,
    ra_hms: '12:34:56.7',
    dec_dms: '+45:12:34',
    total_flux_mjy: 1200 - index,
    peak_flux_mjy: 950 - index,
    aliases: [],
    morphology_code: null,
    morphology_label: null,
    morphology_description: null,
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

function response({
  sources = [makeSource(0)],
  sortBy = 'total_flux',
  sortDirection = 'desc',
  limit = 100,
  sourcePrefix = null,
}: {
  sources?: ReturnType<typeof makeSource>[]
  sortBy?: 'total_flux' | 'peak_flux'
  sortDirection?: 'desc' | 'asc'
  limit?: number
  sourcePrefix?: string | null
} = {}) {
  return new Response(JSON.stringify({
    catalog: 'lofar_dr3',
    catalog_release: 'LoTSS DR3 v1.0',
    coordinate_frame: 'icrs',
    reference_frequency_mhz: 144,
    tap_mode: 'async',
    search_mode: 'brightness',
    enrichment_status: 'complete',
    enrichment_warning: null,
    sort_by: sortBy,
    sort_direction: sortDirection,
    limit,
    source_prefix: sourcePrefix,
    center_ra_deg: null,
    center_dec_deg: null,
    radius_arcmin: null,
    result_count: sources.length,
    sources,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function renderPanel(selectedSourceIds: ReadonlySet<string> = new Set()) {
  return render(
    <LofarCatalogPanel
      hidden={false}
      selectedSourceIds={selectedSourceIds}
      selectedTargetCount={5 + selectedSourceIds.size}
      maximumTargetCount={25}
      onToggleSource={vi.fn()}
      onGoToVisibility={vi.fn()}
    />,
  )
}

describe('LofarCatalogPanel', () => {
  it('loads a brightness-ranked TOP list once and paginates it locally in groups of 25', async () => {
    const user = userEvent.setup()
    const sources = Array.from({ length: 30 }, (_, index) => makeSource(index))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({ sources, sortBy: 'peak_flux', sortDirection: 'asc', limit: 1000 }),
    )
    renderPanel()

    await user.selectOptions(screen.getByLabelText('Flux measure'), 'peak_flux')
    await user.selectOptions(screen.getByLabelText('Sort order'), 'asc')
    await user.selectOptions(screen.getByLabelText('Maximum results (TOP)'), '1000')
    await user.click(screen.getByText('View TAP query'))
    expect(screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes('SELECT TOP 1000') === true
      && element.textContent.includes('WHERE Peak_flux IS NOT NULL')
      && element.textContent.includes('ORDER BY Peak_flux ASC, Source_Name ASC')
    ))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    expect(await screen.findByRole('checkbox', { name: `${sources[0].name}: add to visibility targets` })).toBeInTheDocument()

    const query = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost').searchParams
    expect(Object.fromEntries(query)).toEqual({
      sort_by: 'peak_flux',
      sort_direction: 'asc',
      limit: '1000',
    })
    expect(query.has('source_prefix')).toBe(false)
    expect(query.has('page')).toBe(false)
    expect(query.has('page_size')).toBe(false)
    expect(screen.getAllByRole('checkbox')).toHaveLength(25)
    expect(screen.getByRole('columnheader', { name: /Peak flux/ })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    expect(screen.getByRole('checkbox', { name: `${sources[25].name}: add to visibility targets` })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/26–30 \/ 30/)).toBeInTheDocument()
  })

  it('retries the same TAP parameters, including the Source ID prefix, after an error', async () => {
    const user = userEvent.setup()
    const source = makeSource(0)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response({ sources: [source], sourcePrefix: 'ILTJ1234' }))
    renderPanel()

    await user.type(screen.getByLabelText('Source ID prefix (optional)'), 'ILTJ1234')
    await user.click(screen.getByText('View TAP query'))
    expect(screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes('WHERE Total_flux IS NOT NULL') === true
      && element.textContent.includes("AND 1=ivo_nocasematch(Source_Name, 'ILTJ1234%')")
      && element.textContent.includes('ORDER BY Total_flux DESC, Source_Name ASC')
    ))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect')

    await user.click(screen.getByRole('button', { name: 'Retry with the same parameters' }))
    expect(await screen.findByRole('checkbox', { name: `${source.name}: add to visibility targets` })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe(String(fetchMock.mock.calls[0][0]))
    const query = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost').searchParams
    expect(query.get('source_prefix')).toBe('ILTJ1234')
  })

  it('locks query parameters during a long TAP request and lets the user stop waiting', async () => {
    const user = userEvent.setup()
    let requestSignal: AbortSignal | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation((_input, init) => {
      requestSignal = init?.signal as AbortSignal
      return new Promise<Response>((_resolve, reject) => {
        requestSignal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    expect(await screen.findByText(/Running an asynchronous ASTRON TAP job/)).toBeInTheDocument()
    expect(screen.getByLabelText('Flux measure')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Running TAP job…' })).toBeDisabled()

    expect(screen.getByText(/stops waiting in the browser only.*server job may continue/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Stop waiting' }))
    await waitFor(() => expect(requestSignal?.aborted).toBe(true))
    expect(await screen.findByText(/Stopped waiting in this browser.*reaches its time limit/)).toBeInTheDocument()
    expect(screen.getByLabelText('Flux measure')).toBeEnabled()
    expect(screen.queryByText(/Running an asynchronous ASTRON TAP job/)).not.toBeInTheDocument()
  })

  it('blocks an injection-shaped prefix and escapes quotes in the read-only preview', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    renderPanel()

    const prefixInput = screen.getByLabelText('Source ID prefix (optional)')
    await user.type(prefixInput, "ILTJ' OR 1=1 --")
    expect(prefixInput).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByText('View TAP query'))
    const preview = screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes("AND 1=ivo_nocasematch(Source_Name, 'ILTJ'' OR 1=1 --%')") === true
    ))
    expect(preview).toBeInTheDocument()
    expect(preview.querySelector('script')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('letters, numbers, +, periods, and hyphens')
    expect(screen.queryByRole('button', { name: 'Retry with the same parameters' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('shows a parent-owned target selection as selected in newly loaded results', async () => {
    const user = userEvent.setup()
    const source = makeSource(0)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ sources: [source] }))
    renderPanel(new Set([source.id]))

    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    expect(await screen.findByRole('checkbox', { name: `${source.name}: remove from visibility targets` })).toBeChecked()
  })

  it('allows selected LOFAR sources to be removed at the target limit while blocking new additions', async () => {
    const user = userEvent.setup()
    const selectedSource = makeSource(0)
    const unselectedSource = makeSource(1)
    const onToggleSource = vi.fn()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({
      sources: [selectedSource, unselectedSource],
    }))
    render(
      <LofarCatalogPanel
        hidden={false}
        selectedSourceIds={new Set([selectedSource.id])}
        selectedTargetCount={25}
        maximumTargetCount={25}
        onToggleSource={onToggleSource}
        onGoToVisibility={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    const selectedCheckbox = await screen.findByRole('checkbox', {
      name: `${selectedSource.name}: remove from visibility targets`,
    })
    const unselectedCheckbox = screen.getByRole('checkbox', {
      name: `${unselectedSource.name}: add to visibility targets`,
    })

    expect(selectedCheckbox).toBeEnabled()
    expect(unselectedCheckbox).toBeDisabled()
    await user.click(selectedCheckbox)
    expect(onToggleSource).toHaveBeenCalledWith(selectedSource)
  })

  it('sends cone parameters to the dedicated endpoint and shows names, morphology, and SIMBAD types', async () => {
    const user = userEvent.setup()
    const source = {
      ...makeSource(0),
      name: '3C 123',
      aliases: ['3C123'],
      morphology_code: 'M',
      morphology_label: 'Multiple Gaussian',
      morphology_description: 'Source composed of multiple Gaussians',
      separation_arcmin: 0.08,
      counterpart_name: 'NAME Per B',
      counterpart_aliases: ['3C 123'],
      object_type_code: 'SyG',
      object_type_label: 'Seyfert Galaxy',
      object_type_description: 'Seyfert galaxy',
      crossmatch_separation_arcsec: 0.94,
      crossmatch_confidence: 'high',
      crossmatch_catalog: 'SIMBAD',
    } as const
    const onToggleSource = vi.fn()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      catalog: 'lofar_dr3',
      catalog_release: 'LoTSS DR3 v1.0',
      coordinate_frame: 'icrs',
      reference_frequency_mhz: 144,
      tap_mode: 'async',
      search_mode: 'cone',
      enrichment_status: 'complete',
      enrichment_warning: null,
      sort_by: 'distance',
      sort_direction: 'asc',
      limit: 100,
      source_prefix: null,
      center_ra_deg: 69.26825,
      center_dec_deg: 29.67052,
      radius_arcmin: 5,
      result_count: 1,
      sources: [source],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(
      <LofarCatalogPanel
        hidden={false}
        selectedSourceIds={new Set()}
        selectedTargetCount={5}
        maximumTargetCount={25}
        onToggleSource={onToggleSource}
        onGoToVisibility={vi.fn()}
      />,
    )

    await user.click(screen.getByRole('radio', { name: /Cone search/ }))
    await user.type(screen.getByLabelText('Center RA (deg)'), '69.26825')
    await user.type(screen.getByLabelText('Center Dec (deg)'), '29.67052')
    await user.click(screen.getByText('View TAP query'))
    expect(screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes("DISTANCE(POINT('ICRS', RA, DEC)") === true
      && element.textContent.includes("CIRCLE('ICRS', 69.26825, 29.67052, 5/60.0)")
    ))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Search around coordinates' }))

    expect(await screen.findByText('3C 123', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('LoTSS · ILTJ123400.0+451234')).toBeInTheDocument()
    expect(screen.getByText('M — Multiple Gaussian')).toBeInTheDocument()
    expect(screen.getByText('Seyfert Galaxy (SyG)')).toBeInTheDocument()
    expect(screen.getByText('0.94″ positional candidate')).toBeInTheDocument()
    expect(screen.getByText('0.08′')).toBeInTheDocument()

    const queryUrl = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost')
    expect(queryUrl.pathname).toBe('/api/v1/catalogs/lotss-dr3/cone')
    expect(Object.fromEntries(queryUrl.searchParams)).toEqual({
      ra_deg: '69.26825',
      dec_deg: '29.67052',
      radius_arcmin: '5',
      sort_by: 'distance',
      sort_direction: 'asc',
      limit: '100',
    })

    await user.click(screen.getByRole('checkbox', { name: '3C 123: add to visibility targets' }))
    expect(onToggleSource).toHaveBeenCalledWith(source)
    await user.click(screen.getByText('Classification codes and positional-matching criteria'))
    expect(screen.getByText('Single Gaussian')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Official SIMBAD object-type reference' })).toHaveAttribute(
      'href',
      'https://simbad.cds.unistra.fr/Pages/guide/otypes_desc.htx',
    )
  })

  it('preserves each search mode independently and rejects an invalid cone before requesting', async () => {
    const user = userEvent.setup()
    const browseSource = makeSource(1)
    const coneSource = { ...makeSource(2), separation_arcmin: 1.5 }
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ sources: [browseSource], sourcePrefix: 'ILTJ1234' }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        catalog: 'lofar_dr3',
        catalog_release: 'LoTSS DR3 v1.0',
        coordinate_frame: 'icrs',
        reference_frequency_mhz: 144,
        tap_mode: 'async',
        search_mode: 'cone',
        enrichment_status: 'unavailable',
        enrichment_warning: 'SIMBAD service unavailable',
        sort_by: 'distance',
        sort_direction: 'asc',
        limit: 100,
        source_prefix: null,
        center_ra_deg: 10,
        center_dec_deg: -20,
        radius_arcmin: 3,
        result_count: 1,
        sources: [coneSource],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    renderPanel()

    await user.type(screen.getByLabelText('Source ID prefix (optional)'), 'ILTJ1234')
    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    expect(await screen.findByText(browseSource.source_id, { selector: 'strong' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Cone search/ }))
    await user.type(screen.getByLabelText('Center RA (deg)'), '360')
    await user.type(screen.getByLabelText('Center Dec (deg)'), '-20')
    await user.clear(screen.getByLabelText('Search radius (arcmin)'))
    await user.type(screen.getByLabelText('Search radius (arcmin)'), '61')
    await user.click(screen.getByRole('button', { name: 'Search around coordinates' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('RA from 0° (inclusive) to 360° (exclusive)')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await user.clear(screen.getByLabelText('Center RA (deg)'))
    await user.type(screen.getByLabelText('Center RA (deg)'), '10')
    await user.clear(screen.getByLabelText('Search radius (arcmin)'))
    await user.type(screen.getByLabelText('Search radius (arcmin)'), '3')
    await user.click(screen.getByRole('button', { name: 'Search around coordinates' }))
    expect(await screen.findByText(coneSource.source_id, { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('SIMBAD name and type enrichment unavailable')).toBeInTheDocument()
    expect(screen.getByText('SIMBAD service unavailable')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /Brightest sources/ }))
    expect(screen.getByLabelText('Source ID prefix (optional)')).toHaveValue('ILTJ1234')
    expect(screen.getByText(browseSource.source_id, { selector: 'strong' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('shows an unmatched source and partially enriched response without implying a confirmed match', async () => {
    const user = userEvent.setup()
    const legacyKoreanCopy = String.fromCodePoint(0xd55c, 0xae00)
    const source = {
      ...makeSource(0),
      morphology_code: 'S' as const,
      morphology_label: legacyKoreanCopy,
      morphology_description: legacyKoreanCopy,
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      catalog: 'lofar_dr3',
      catalog_release: 'LoTSS DR3 v1.0',
      coordinate_frame: 'icrs',
      reference_frequency_mhz: 144,
      tap_mode: 'async',
      search_mode: 'brightness',
      enrichment_status: 'partial',
      enrichment_warning: legacyKoreanCopy,
      morphology_codebook: [{ code: 'S', label: legacyKoreanCopy, description: legacyKoreanCopy }],
      sort_by: 'total_flux',
      sort_direction: 'desc',
      limit: 100,
      source_prefix: null,
      center_ra_deg: null,
      center_dec_deg: null,
      radius_arcmin: null,
      result_count: 1,
      sources: [source],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    renderPanel()

    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))

    expect(await screen.findByText(source.source_id, { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('SIMBAD match not checked')).toBeInTheDocument()
    expect(screen.queryByText('No SIMBAD match within 5″')).not.toBeInTheDocument()
    expect(screen.getByText('SIMBAD name and type enrichment partially completed')).toBeInTheDocument()
    expect(screen.getByText('The LoTSS positions and flux measurements remain available.')).toBeInTheDocument()
    expect(screen.getByText('S — No description')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(legacyKoreanCopy)
  })
})
