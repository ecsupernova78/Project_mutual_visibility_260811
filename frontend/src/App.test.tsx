import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import App from './App'

const responseBody = {
  times_utc: [
    '2026-08-11T00:00:00Z',
    '2026-08-11T00:15:00Z',
    '2026-08-11T00:30:00Z',
  ],
  visible_target_count: 1,
  targets: [
    {
      id: '3c123',
      name: '3C123',
      aliases: ['3C 123'],
      ra_deg: 69.26825,
      dec_deg: 29.67052,
      location_series: [
        {
          location_id: 'narrabri',
          location_name: 'Narrabri (Aus)',
          altitudes_deg: [18, 24, 28],
        },
        {
          location_id: 'pyeongchang',
          location_name: 'Pyeongchang (Kor)',
          altitudes_deg: [12, 19, 23],
        },
        {
          location_id: 'fushan',
          location_name: 'Fushan (Taiwan)',
          altitudes_deg: [16, 22, 27],
        },
      ],
      simultaneous_mask: [false, true, true],
      visible_intervals: [
        {
          start_time_utc: '2026-08-11T00:15:00Z',
          end_time_utc: '2026-08-11T00:30:00Z',
          peak_common_altitude_deg: 23,
          start_index: 1,
          end_index: 2,
          sample_count: 2,
        },
      ],
      max_common_altitude_deg: 23,
      simultaneous_visible: true,
    },
  ],
  locations: [],
  metadata: {
    center_time_utc: '2026-08-11T00:15:00Z',
    start_time_utc: '2026-08-11T00:00:00Z',
    end_time_utc: '2026-08-11T00:30:00Z',
    hours_before: 0.25,
    hours_after: 0.25,
    step_minutes: 15,
    sample_count: 3,
    location_count: 3,
    target_count: 1,
    minimum_altitude_deg: 15,
    coordinate_frame: 'icrs',
    altitude_frame: 'altaz',
    atmospheric_refraction: false,
    iers_source: 'bundled',
    longitude_convention: 'east-positive',
    visibility_definition: 'sampled',
    interval_definition: 'consecutive samples',
  },
}

describe('상호 가시성 인터페이스', () => {
  it('세 관측지와 다섯 개 카탈로그 천체를 표시한다', () => {
    render(<App />)

    expect(screen.getByDisplayValue('Narrabri (Aus)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Pyeongchang (Kor)')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Fushan (Taiwan)')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Observation Setup' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Reference Time UTC/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Target Selection/ })).toBeInTheDocument()
    expect(screen.getAllByText('Latitude (N: + / S: −)')).toHaveLength(3)
    expect(screen.getAllByText('Longitude (E: + / W: −)')).toHaveLength(3)
    expect(screen.getByRole('spinbutton', { name: 'Narrabri (Aus) latitude (N: + / S: −)' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Pyeongchang (Kor) longitude (E: + / W: −)' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Fushan (Taiwan) elevation' })).toBeDisabled()
    expect(screen.queryByText('관측지 A')).not.toBeInTheDocument()
    expect(screen.queryByText('관측지 B')).not.toBeInTheDocument()
    expect(screen.queryByText('관측지 C')).not.toBeInTheDocument()
    expect(screen.queryByText('첫 번째 관측 계획')).not.toBeInTheDocument()
    expect(screen.queryByText(/원하는 관측지를 골라/)).not.toBeInTheDocument()
    expect(screen.getAllByRole('checkbox')).toHaveLength(8)
    const builtInTargetList = screen.getByRole('list', { name: 'Examples of 5 Radio sources' })
    const builtInTargets = within(builtInTargetList).getAllByRole('listitem')
    expect(builtInTargets.map((item) => item.querySelector('b')?.textContent)).toEqual([
      '3C123', '3C273', '3C433', '3C295', '3C134',
    ])
    expect(screen.getByLabelText('Include Fushan (Taiwan) in the observation')).not.toBeChecked()
    expect(screen.getByText(/Elevation defaults to 0 m/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plot Altitude-Time' })).toBeEnabled()
  })

  it('API 계약대로 계산을 요청하고 선택 천체 그래프를 표시한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    expect(await screen.findByRole('img', { name: /3C123 altitude–time chart/ })).toBeInTheDocument()
    const detailImage = screen.getByRole('img', { name: /3C123 altitude–time chart/ })
    const overviewImage = screen.getByRole('img', { name: /Altitude–time overview of simultaneously visible targets/ })
    expect(detailImage).toBeInTheDocument()
    expect(overviewImage).toBeInTheDocument()
    expect(detailImage.querySelector('[role="slider"]')).not.toBeInTheDocument()
    expect(overviewImage.querySelector('[role="slider"]')).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '3C123 time (UTC)' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: 'Overview time (UTC)' })).toBeInTheDocument()
    expect(screen.getByText('Altitude threshold 15°', { selector: '.site-pattern-legend .legend-item' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Jump to Overview/ })).toHaveAttribute(
      'href',
      '#common-visibility-overview',
    )
    const targetCard = screen.getByRole('tab', { name: /3C123/ })
    expect(within(targetCard).getByText('Maximum Altitude 23.0°')).toBeInTheDocument()
    expect(within(targetCard).getByText('Longest Common Window')).toBeInTheDocument()
    expect(within(targetCard).getByText('15 min')).toBeInTheDocument()
    const detailPanel = screen.getByRole('tabpanel', { name: '3C123 altitude chart' })
    const durationMetric = within(detailPanel)
      .getByText('Longest Common Window')
      .closest('.duration-metric')
    expect(durationMetric).toHaveTextContent('15 min')
    expect(detailPanel).toHaveTextContent('Target: 3C123')
    expect(detailPanel).not.toHaveTextContent('Sample-based')
    expect(detailPanel).not.toHaveTextContent('Reaches window boundary')
    expect(detailPanel).not.toHaveTextContent('Visibility Criteria')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/v1/visibility/altitude-series')
    expect(init?.method).toBe('POST')
    const payload = JSON.parse(String(init?.body)) as Record<string, unknown>
    expect(payload).toMatchObject({
      hours_before: 6,
      hours_after: 6,
      step_minutes: 15,
      minimum_altitude_deg: 15,
      target_ids: ['3c123', '3c273', '3c433', '3c295', '3c134'],
      custom_targets: [],
    })
    expect(payload.locations).toEqual([
      expect.objectContaining({ latitude_deg: -30.31667, longitude_deg: 149.76667 }),
      expect.objectContaining({ latitude_deg: 37.36889, longitude_deg: 128.39028 }),
    ])
    expect(String(payload.center_time_utc)).toMatch(/Z$/)

    const overviewPanel = document.querySelector('#common-visibility-overview')
    expect(overviewPanel).not.toBeNull()
    expect(within(overviewPanel as HTMLElement).queryByRole('table')).not.toBeInTheDocument()
    await user.click(screen.getByText('Full numerical data table'))
    expect(
      within(overviewPanel as HTMLElement).getByRole('table', {
        name: /Altitude–time data in UTC by observing site for simultaneously visible targets/,
      }),
    ).toBeInTheDocument()
  })

  it('LOFAR DR3를 검색해 선택한 천체 snapshot을 계산 요청에 함께 보낸다', async () => {
    const user = userEvent.setup()
    const source = {
      id: 'lotss-dr3-abc123',
      catalog: 'lofar_dr3',
      source_id: 'ILTJ123456.78+451234.5',
      name: 'ILTJ123456.78+451234.5',
      ra_deg: 188.73658,
      dec_deg: 45.20958,
      ra_hms: '12:34:56.78',
      dec_dms: '+45:12:34.5',
      total_flux_mjy: 4321.5,
      peak_flux_mjy: 3210.25,
      aliases: ['3C 123', 'ILTJ123456.78+451234.5'],
      morphology_code: 'M',
      morphology_label: '복수 Gaussian',
      morphology_description: '복수 Gaussian으로 구성된 source',
      separation_arcmin: null,
      counterpart_name: 'NAME Per B',
      counterpart_aliases: ['3C 123'],
      object_type_code: 'SyG',
      object_type_label: 'Seyfert Galaxy',
      object_type_description: 'Seyfert galaxy',
      crossmatch_separation_arcsec: 0.94,
      crossmatch_confidence: 'high',
      crossmatch_catalog: 'SIMBAD',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.startsWith('/api/v1/catalogs/lotss-dr3/sources')) {
        return new Response(JSON.stringify({
          catalog: 'lofar_dr3',
          catalog_release: 'LoTSS DR3 v1.0',
          coordinate_frame: 'icrs',
          reference_frequency_mhz: 144,
          tap_mode: 'async',
          search_mode: 'brightness',
          enrichment_status: 'complete',
          enrichment_warning: null,
          morphology_codebook: [],
          sort_by: 'total_flux',
          sort_direction: 'desc',
          limit: 100,
          source_prefix: 'ILTJ1234',
          center_ra_deg: null,
          center_dec_deg: null,
          radius_arcmin: null,
          result_count: 1,
          sources: [source],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      expect(init?.method).toBe('POST')
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    render(<App />)

    const visibilityTab = screen.getByRole('tab', { name: 'Observation Visibility' })
    const catalogTab = screen.getByRole('tab', { name: 'LOFAR DR3 Catalog' })
    expect(visibilityTab).toHaveAttribute('aria-selected', 'true')
    await user.click(catalogTab)
    expect(catalogTab).toHaveAttribute('aria-selected', 'true')

    await user.type(screen.getByLabelText('Source ID prefix (optional)'), 'ILTJ1234')
    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    const sourceCheckbox = await screen.findByRole('checkbox', {
      name: `${source.name}: add to visibility targets`,
    })
    expect(sourceCheckbox).not.toBeChecked()

    const searchUrl = String(fetchMock.mock.calls[0][0])
    const searchParams = new URL(searchUrl, 'http://localhost').searchParams
    expect(searchParams.get('source_prefix')).toBe('ILTJ1234')
    expect(searchParams.get('sort_by')).toBe('total_flux')
    expect(searchParams.get('sort_direction')).toBe('desc')
    expect(searchParams.get('limit')).toBe('100')

    await user.click(sourceCheckbox)
    expect(sourceCheckbox).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Go to Observation Setup' }))
    expect(screen.getByText('Targets Imported from LOFAR DR3')).toBeInTheDocument()
    const importedList = screen.getByLabelText('Imported LOFAR DR3 target list')
    expect(within(importedList).getByText(source.name, { selector: 'b' })).toBeInTheDocument()
    expect(importedList).not.toHaveTextContent(/[가-힣]/)

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const payload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      target_ids: string[]
      custom_targets: Array<Record<string, unknown>>
    }
    expect(payload.target_ids).toHaveLength(5)
    expect(payload.custom_targets).toEqual([{
      id: source.id,
      name: source.name,
      aliases: ['3C 123', source.source_id],
      ra_deg: source.ra_deg,
      dec_deg: source.dec_deg,
      catalog: 'lofar_dr3',
      catalog_source_id: source.source_id,
      total_flux_mjy: source.total_flux_mjy,
      peak_flux_mjy: source.peak_flux_mjy,
      morphology_code: source.morphology_code,
      counterpart_name: source.counterpart_name,
      counterpart_aliases: source.counterpart_aliases,
      object_type_code: source.object_type_code,
      object_type_label: source.object_type_label,
      object_type_description: source.object_type_description,
      crossmatch_separation_arcsec: source.crossmatch_separation_arcsec,
      crossmatch_confidence: source.crossmatch_confidence,
      crossmatch_catalog: source.crossmatch_catalog,
    }])

    await user.click(screen.getByRole('tab', { name: /LOFAR DR3 Catalog/ }))
    expect(screen.getByLabelText('Source ID prefix (optional)')).toHaveValue('ILTJ1234')
    expect(screen.getByRole('checkbox', { name: `${source.name}: remove from visibility targets` })).toBeChecked()
  })

  it('메인에서 LOFAR 천체를 해제해도 목록을 보존하고 계산 payload에만 선택 상태를 반영한다', async () => {
    const user = userEvent.setup()
    const source = {
      id: 'lotss-dr3-toggle',
      catalog: 'lofar_dr3',
      source_id: 'ILTJ043704.43+294013.1',
      name: '3C123',
      ra_deg: 69.26846,
      dec_deg: 29.67031,
      ra_hms: '04:37:04.43',
      dec_dms: '+29:40:13.1',
      total_flux_mjy: 1000,
      peak_flux_mjy: 900,
      aliases: ['ILTJ043704.43+294013.1'],
      morphology_code: 'S',
      morphology_label: '단일 Gaussian',
      morphology_description: '하나의 Gaussian으로 구성된 source',
      separation_arcmin: null,
      counterpart_name: 'NAME Per B',
      counterpart_aliases: ['3C 123'],
      object_type_code: 'SyG',
      object_type_label: 'Seyfert Galaxy',
      object_type_description: 'Seyfert galaxy',
      crossmatch_separation_arcsec: 0.94,
      crossmatch_confidence: 'high',
      crossmatch_catalog: 'SIMBAD',
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input).startsWith('/api/v1/catalogs/lotss-dr3/sources')) {
        return new Response(JSON.stringify({
          catalog: 'lofar_dr3', catalog_release: 'LoTSS DR3 v1.0', coordinate_frame: 'icrs',
          reference_frequency_mhz: 144, tap_mode: 'async', search_mode: 'brightness',
          enrichment_status: 'complete', enrichment_warning: null, morphology_codebook: [],
          sort_by: 'total_flux', sort_direction: 'desc', limit: 100, source_prefix: null,
          center_ra_deg: null, center_dec_deg: null, radius_arcmin: null,
          result_count: 1, sources: [source],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })
    render(<App />)

    await user.click(screen.getByRole('tab', { name: 'LOFAR DR3 Catalog' }))
    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    await user.click(await screen.findByRole('checkbox', { name: '3C123: add to visibility targets' }))
    await user.click(screen.getByRole('button', { name: 'Go to Observation Setup' }))

    const importedList = screen.getByLabelText('Imported LOFAR DR3 target list')
    const importedCheckbox = within(importedList).getByRole('checkbox', {
      name: 'Exclude 3C123 from the calculation',
    })
    await user.click(importedCheckbox)
    expect(within(importedList).getByText('3C123', { selector: 'b' })).toBeInTheDocument()
    expect(within(importedList).getByRole('checkbox', {
      name: 'Include 3C123 in the calculation',
    })).not.toBeChecked()

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).custom_targets).toEqual([])

    const unselectedCheckbox = within(importedList).getByRole('checkbox', {
      name: 'Include 3C123 in the calculation',
    })
    await user.click(unselectedCheckbox)
    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body)).custom_targets).toHaveLength(1)

    await user.click(within(importedList).getByRole('button', { name: 'Remove 3C123 from the imported list' }))
    expect(screen.queryByLabelText('Imported LOFAR DR3 target list')).not.toBeInTheDocument()
  })

  it('Source ID prefix를 비워 두면 전체 카탈로그 TOP 목록을 요청한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      catalog: 'lofar_dr3',
      catalog_release: 'LoTSS DR3 v1.0',
      coordinate_frame: 'icrs',
      reference_frequency_mhz: 144,
      tap_mode: 'async',
      sort_by: 'total_flux',
      sort_direction: 'desc',
      limit: 100,
      source_prefix: null,
      result_count: 0,
      sources: [],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<App />)

    await user.click(screen.getByRole('tab', { name: 'LOFAR DR3 Catalog' }))
    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))

    expect(await screen.findByText('No matching sources found.')).toBeInTheDocument()
    const searchParams = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost').searchParams
    expect(searchParams.has('source_prefix')).toBe(false)
    expect(searchParams.get('limit')).toBe('100')
  })

  it('기본 천체와 LOFAR 천체 합계가 25개를 넘지 않도록 모든 추가 경로를 막는다', async () => {
    const user = userEvent.setup()
    const sources = Array.from({ length: 25 }, (_, index) => ({
      id: `lotss-dr3-limit-${String(index).padStart(2, '0')}`,
      catalog: 'lofar_dr3',
      source_id: `ILTJ1234${String(index).padStart(2, '0')}`,
      name: `ILTJ1234${String(index).padStart(2, '0')}`,
      ra_deg: 100 + index,
      dec_deg: 20,
      ra_hms: '08:00:00',
      dec_dms: '+20:00:00',
      total_flux_mjy: 1000 - index,
      peak_flux_mjy: 900 - index,
    }))
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      catalog: 'lofar_dr3',
      catalog_release: 'LoTSS DR3 v1.0',
      coordinate_frame: 'icrs',
      reference_frequency_mhz: 144,
      tap_mode: 'async',
      sort_by: 'total_flux',
      sort_direction: 'desc',
      limit: 100,
      source_prefix: 'ILTJ1234',
      result_count: sources.length,
      sources,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Deselect All' }))
    await user.click(screen.getByRole('tab', { name: 'LOFAR DR3 Catalog' }))
    await user.type(screen.getByLabelText('Source ID prefix (optional)'), 'ILTJ1234')
    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    const sourceChecks = await screen.findAllByRole('checkbox', { name: /add to visibility targets/ })
    expect(sourceChecks).toHaveLength(25)
    for (const checkbox of sourceChecks) await user.click(checkbox)
    expect(screen.getByText('25 / 25')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Go to Observation Setup' }))
    expect(screen.getByRole('checkbox', { name: /3C123/ })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Select All' }))
    expect(screen.getByText(/0\/5 selected/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /3C123/ })).not.toBeChecked()
  }, 10_000)

  it('전체 개요에서 시간창 내 가시 천체만 골라 플롯하고 새 계산 때 모두 복원한다', async () => {
    const user = userEvent.setup()
    const outsideCenterTarget = {
      ...responseBody.targets[0],
      id: '3c273',
      name: '3C273',
      aliases: ['3C 273'],
      simultaneous_mask: [true, false, true],
    }
    const neverVisibleTarget = {
      ...responseBody.targets[0],
      id: '3c433',
      name: '3C433',
      aliases: ['3C 433'],
      simultaneous_mask: [false, false, false],
      visible_intervals: [],
      simultaneous_visible: false,
    }
    const mixedResponse = {
      ...responseBody,
      visible_target_count: 2,
      targets: [...responseBody.targets, outsideCenterTarget, neverVisibleTarget],
      metadata: { ...responseBody.metadata, target_count: 3 },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify(mixedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    expect(await screen.findByRole('tab', { name: /3C273/ })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /3C433/ })).not.toBeInTheDocument()
    const overview = document.querySelector('#common-visibility-overview')
    expect(overview).not.toBeNull()
    expect(within(overview as HTMLElement).getByText('3C123', { selector: '.legend-item' })).toBeInTheDocument()
    expect(within(overview as HTMLElement).getByText('3C273', { selector: '.legend-item' })).toBeInTheDocument()
    expect(within(overview as HTMLElement).queryByText('3C433', { selector: '.legend-item' })).not.toBeInTheDocument()
    const target123Checkbox = within(overview as HTMLElement).getByRole('checkbox', {
      name: 'Plot 3C123 in the overview',
    })
    const target273Checkbox = within(overview as HTMLElement).getByRole('checkbox', {
      name: 'Plot 3C273 in the overview',
    })
    expect(target123Checkbox).toBeChecked()
    expect(target273Checkbox).toBeChecked()
    expect(within(overview as HTMLElement).queryByRole('checkbox', {
      name: 'Plot 3C433 in the overview',
    })).not.toBeInTheDocument()
    expect(within(overview as HTMLElement).getByText('2 / 2 plotted')).toBeInTheDocument()
    expect(overview?.querySelectorAll('.overview-altitude-line')).toHaveLength(
      responseBody.targets[0].location_series.length * 2,
    )

    await user.click(target273Checkbox)

    expect(target273Checkbox).not.toBeChecked()
    expect(within(overview as HTMLElement).getByText('1 / 2 plotted')).toBeInTheDocument()
    expect(within(overview as HTMLElement).getByText('3C123', { selector: '.legend-item' })).toBeInTheDocument()
    expect(within(overview as HTMLElement).queryByText('3C273', { selector: '.legend-item' })).not.toBeInTheDocument()
    expect(overview?.querySelectorAll('.overview-altitude-line')).toHaveLength(
      responseBody.targets[0].location_series.length,
    )
    expect(screen.getByRole('tab', { name: /3C123/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /3C273/ })).toBeInTheDocument()

    await user.click(within(overview as HTMLElement).getByText('Full numerical data table'))
    const filteredTable = within(overview as HTMLElement).getByRole('table')
    expect(within(filteredTable).getAllByRole('columnheader', { name: /3C123/ })).not.toHaveLength(0)
    expect(within(filteredTable).queryByRole('columnheader', { name: /3C273/ })).not.toBeInTheDocument()

    await user.click(within(overview as HTMLElement).getByRole('button', { name: 'Hide All' }))

    expect(target123Checkbox).not.toBeChecked()
    expect(within(overview as HTMLElement).getByText('0 / 2 plotted')).toBeInTheDocument()
    expect(within(overview as HTMLElement).getByText('Select at least one target to plot.')).toBeInTheDocument()
    expect(within(overview as HTMLElement).queryByRole('img')).not.toBeInTheDocument()
    expect(within(overview as HTMLElement).queryByRole('slider')).not.toBeInTheDocument()
    expect(within(overview as HTMLElement).queryByText('Full numerical data table')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /3C273/ })).toBeInTheDocument()

    await user.click(within(overview as HTMLElement).getByRole('button', {
      name: 'Show All Visible Targets',
    }))

    expect(target123Checkbox).toBeChecked()
    expect(target273Checkbox).toBeChecked()
    expect(within(overview as HTMLElement).getByText('2 / 2 plotted')).toBeInTheDocument()
    expect(overview?.querySelectorAll('.overview-altitude-line')).toHaveLength(
      responseBody.targets[0].location_series.length * 2,
    )

    await user.click(target273Checkbox)
    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('2 / 2 plotted')).toBeInTheDocument()
    const recalculatedOverview = document.querySelector('#common-visibility-overview')
    expect(recalculatedOverview).not.toBeNull()
    expect(within(recalculatedOverview as HTMLElement).getByRole('checkbox', {
      name: 'Plot 3C273 in the overview',
    })).toBeChecked()
  })

  it('가시 구간이 샘플 하나뿐이면 지속시간을 과장하지 않는다', async () => {
    const user = userEvent.setup()
    const singleSampleResponse = {
      ...responseBody,
      targets: responseBody.targets.map((target) => ({
        ...target,
        simultaneous_mask: [false, true, false],
        visible_intervals: [
          {
            ...target.visible_intervals[0],
            end_time_utc: target.visible_intervals[0].start_time_utc,
            end_index: 1,
            sample_count: 1,
          },
        ],
      })),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(singleSampleResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    const targetCard = await screen.findByRole('tab', { name: /3C123/ })
    expect(targetCard).toHaveTextContent('0 min')
    expect(targetCard).not.toHaveTextContent('Duration undetermined')
    const detailPanel = screen.getByRole('tabpanel', { name: '3C123 altitude chart' })
    expect(detailPanel.querySelector('.duration-metric')).toHaveTextContent('0 min')
    expect(detailPanel.querySelector('.duration-metric')).not.toHaveTextContent('Duration undetermined')
  })

  it('중심 시각에 보이지 않아도 시간창 안에 가시 샘플이 있으면 개요에 표시한다', async () => {
    const user = userEvent.setup()
    const outsideCenterResponse = {
      ...responseBody,
      targets: responseBody.targets.map((target) => ({
        ...target,
        simultaneous_mask: [true, false, true],
      })),
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(outsideCenterResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    expect(await screen.findByRole('img', { name: /3C123 altitude–time chart/ })).toBeInTheDocument()
    const overview = document.querySelector('#common-visibility-overview')
    expect(overview).not.toBeNull()
    expect(within(overview as HTMLElement).getByText('1 / 1 plotted')).toBeInTheDocument()
    expect(within(overview as HTMLElement).getByText('3C123', { selector: '.legend-item' })).toBeInTheDocument()
    expect(within(overview as HTMLElement).getByRole('img', {
      name: /Altitude–time overview of simultaneously visible targets/,
    })).toHaveAccessibleDescription(/from 0 to 90 degrees in UTC/)
  })

  it('Fushan을 포함하면 세 관측지를 요청하고 세 위치 곡선을 표시한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByLabelText('Include Fushan (Taiwan) in the observation'))
    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      locations: Array<Record<string, unknown>>
    }
    expect(payload.locations).toHaveLength(3)
    expect(payload.locations[2]).toMatchObject({
      id: 'fushan',
      latitude_deg: 24.7564722222,
      longitude_deg: 121.5816388889,
      elevation_m: 0,
    })
    expect(await screen.findAllByText('Fushan (Taiwan)', { selector: '.legend-item' })).toHaveLength(2)
  })

  it('제외한 관측지의 잘못된 입력은 선택된 관측지 계산을 막지 않는다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByLabelText('Include Fushan (Taiwan) in the observation'))
    const fushanLatitude = document.querySelector('#location-2-latitude') as HTMLInputElement
    expect(fushanLatitude).toBeEnabled()
    await user.clear(fushanLatitude)
    await user.type(fushanLatitude, '91')
    expect(fushanLatitude).toBeInvalid()

    await user.click(screen.getByLabelText('Include Fushan (Taiwan) in the observation'))
    expect(fushanLatitude).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      locations: Array<{ id: string }>
    }
    expect(payload.locations.map((location) => location.id)).toEqual([
      'narrabri',
      'pyeongchang',
    ])
  })

  it('한 관측지만 선택해 해당 위치만 요청하고 결과 변경 시 이전 결과를 지운다', async () => {
    const user = userEvent.setup()
    const oneSiteResponse = {
      ...responseBody,
      targets: responseBody.targets.map((target) => ({
        ...target,
        location_series: target.location_series.filter(
          (series) => series.location_id === 'narrabri',
        ),
      })),
      metadata: { ...responseBody.metadata, location_count: 1 },
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(oneSiteResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByLabelText('Include Pyeongchang (Kor) in the observation'))
    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    expect(await screen.findByRole('img', { name: /3C123 altitude–time chart/ })).toBeInTheDocument()
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      locations: Array<Record<string, unknown>>
    }
    expect(payload.locations).toEqual([
      expect.objectContaining({ id: 'narrabri' }),
    ])
    const detailChart = screen.getByRole('tabpanel', { name: /3C123 altitude chart/ })
    expect(detailChart.querySelectorAll('.legend-line')).toHaveLength(1)
    expect(detailChart).toHaveTextContent('Narrabri (Aus)')
    expect(detailChart).not.toHaveTextContent('Pyeongchang (Kor)')
    expect(detailChart).not.toHaveTextContent('Fushan (Taiwan)')

    await user.click(screen.getByLabelText('Include Fushan (Taiwan) in the observation'))
    expect(screen.queryByRole('img', { name: /3C123 altitude–time chart/ })).not.toBeInTheDocument()
    expect(screen.getByText('Simultaneously Visible Target Search')).toBeInTheDocument()
  })

  it('관측지가 하나도 없으면 요청 전에 검증한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    await user.click(screen.getByLabelText('Include Narrabri (Aus) in the observation'))
    await user.click(screen.getByLabelText('Include Pyeongchang (Kor) in the observation'))
    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Select at least one observation site')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('시간–고도 곡선에 필요한 최소 두 샘플을 요청 전에 검증한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    const beforeInput = screen.getByLabelText(/Before/)
    const afterInput = screen.getByLabelText(/After/)
    const stepInput = screen.getByLabelText(/Calculation Interval/)
    await user.clear(beforeInput)
    await user.type(beforeInput, '0.25')
    await user.clear(afterInput)
    await user.type(afterInput, '0.25')
    await user.clear(stepInput)
    await user.type(stepInput, '180')
    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('produce fewer than two time points')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
