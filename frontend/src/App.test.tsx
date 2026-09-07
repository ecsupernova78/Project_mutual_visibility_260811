import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import App from './App'
import {
  DEFAULT_OBSERVING_SITES,
  OBSERVING_SITE_STORAGE_KEY,
} from './observingSiteStorage'

vi.mock('./components/ObservingSiteMap', () => ({
  ObservingSiteMap: () => (
    <div role="region" aria-label="Interactive map of selected observing sites" />
  ),
}))

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
    const visibilityPanel = document.querySelector('#visibility-panel') as HTMLElement
    const visibility = within(visibilityPanel)

    expect(visibility.getByDisplayValue('Narrabri (Aus)')).toBeInTheDocument()
    expect(visibility.getByDisplayValue('Pyeongchang (Kor)')).toBeInTheDocument()
    expect(visibility.getByDisplayValue('Fushan (Taiwan)')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Observation Setup' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Reference Time UTC/ })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: /Target Selection/ })).toBeInTheDocument()
    expect(visibility.getAllByText('Latitude (N: + / S: −)')).toHaveLength(3)
    expect(visibility.getAllByText('Longitude (E: + / W: −)')).toHaveLength(3)
    expect(screen.getByRole('spinbutton', { name: 'Narrabri (Aus) latitude (N: + / S: −)' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Pyeongchang (Kor) longitude (E: + / W: −)' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Fushan (Taiwan) elevation' })).toBeDisabled()
    expect(screen.queryByText('관측지 A')).not.toBeInTheDocument()
    expect(screen.queryByText('관측지 B')).not.toBeInTheDocument()
    expect(screen.queryByText('관측지 C')).not.toBeInTheDocument()
    expect(screen.queryByText('첫 번째 관측 계획')).not.toBeInTheDocument()
    expect(screen.queryByText(/원하는 관측지를 골라/)).not.toBeInTheDocument()
    expect(visibility.getAllByRole('checkbox')).toHaveLength(8)
    expect(screen.getByRole('tab', { name: /Observing Sites/ })).toHaveAttribute(
      'aria-controls',
      'observing-sites-panel',
    )
    const builtInTargetList = screen.getByRole('list', { name: 'Examples of 5 Radio sources' })
    const builtInTargets = within(builtInTargetList).getAllByRole('listitem')
    expect(builtInTargets.map((item) => item.querySelector('b')?.textContent)).toEqual([
      '3C123', '3C273', '3C433', '3C295', '3C134',
    ])
    expect(screen.getByLabelText('Include Fushan (Taiwan) in the observation')).not.toBeChecked()
    expect(screen.queryByText(/Elevation defaults to 0 m/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plot Altitude-Time' })).toBeEnabled()
  })

  it('supports keyboard navigation to the observing-site tab', async () => {
    const user = userEvent.setup()
    render(<App />)
    const visibilityTab = screen.getByRole('tab', { name: 'Observation Visibility' })

    visibilityTab.focus()
    await user.keyboard('{ArrowRight}')

    const siteTab = screen.getByRole('tab', { name: /Observing Sites/ })
    expect(siteTab).toHaveFocus()
    expect(siteTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: /Observing Sites/ })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Use Selected Sites' }))
    await waitFor(() => expect(visibilityTab).toHaveFocus())
    expect(visibilityTab).toHaveAttribute('aria-selected', 'true')

    await user.click(screen.getByRole('button', { name: 'Manage Sites' }))
    await waitFor(() => expect(siteTab).toHaveFocus())
  })

  it('does not overwrite corrupt saved-site data merely by mounting the app', async () => {
    const corruptValue = '{not valid json'
    localStorage.setItem(OBSERVING_SITE_STORAGE_KEY, corruptValue)

    render(<App />)
    await new Promise((resolve) => window.setTimeout(resolve, 0))
    expect(localStorage.getItem(OBSERVING_SITE_STORAGE_KEY)).toBe(corruptValue)

    const user = userEvent.setup()
    await user.click(screen.getByRole('tab', { name: /Observing Sites/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Saved site data could not be loaded and was left unchanged.',
    )
  })

  it('saves, edits, selects, and restores a custom observing site for calculation', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    const { unmount } = render(<App />)

    await user.click(screen.getByRole('tab', { name: /Observing Sites/ }))
    await user.type(screen.getByLabelText('Site name'), 'Mauna Kea (USA)')
    await user.type(screen.getByLabelText('Latitude (N: + / S: −)'), '19.8207')
    await user.type(screen.getByLabelText('Longitude (E: + / W: −)'), '-155.4681')
    await user.type(screen.getByLabelText('Elevation (m)'), '4205')
    await user.click(screen.getByRole('button', { name: 'Save Site' }))

    const savedList = screen.getByRole('list', { name: 'Saved observing sites' })
    const customCard = within(savedList).getByText('Mauna Kea (USA)').closest('article') as HTMLElement
    expect(within(customCard).getByRole('checkbox')).not.toBeChecked()

    await user.click(within(customCard).getByRole('button', { name: 'Edit Mauna Kea (USA)' }))
    const editName = within(customCard).getByLabelText('Site name')
    const editElevation = within(customCard).getByLabelText('Elevation (m)')
    await user.clear(editName)
    await user.type(editName, 'Mauna Kea VLBI (USA)')
    await user.clear(editElevation)
    await user.type(editElevation, '4300')
    await user.click(within(customCard).getByRole('button', { name: 'Save Changes' }))

    await user.click(screen.getByLabelText(
      'Use Mauna Kea VLBI (USA) in Observation Visibility',
    ))
    await user.click(screen.getByRole('button', { name: 'Use Selected Sites' }))
    await waitFor(() => expect(screen.getByRole('tab', {
      name: 'Observation Visibility',
    })).toHaveFocus())
    expect(screen.getByDisplayValue('Mauna Kea VLBI (USA)')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))
    const visibilityCalls = () => fetchMock.mock.calls.filter(
      ([input]) => String(input) === '/api/v1/visibility/altitude-series',
    )
    await waitFor(() => expect(visibilityCalls()).toHaveLength(1))
    const payload = JSON.parse(String(visibilityCalls()[0][1]?.body)) as {
      locations: Array<Record<string, unknown>>
    }
    expect(payload.locations).toContainEqual(expect.objectContaining({
      name: 'Mauna Kea VLBI (USA)',
      latitude_deg: 19.8207,
      longitude_deg: -155.4681,
      elevation_m: 4300,
    }))
    const customPayload = payload.locations.find((location) => (
      location.name === 'Mauna Kea VLBI (USA)'
    ))
    expect(customPayload?.id).toMatch(/^site-/)

    await waitFor(() => expect(localStorage.getItem(OBSERVING_SITE_STORAGE_KEY)).toContain(
      'Mauna Kea VLBI (USA)',
    ))
    unmount()
    render(<App />)
    await user.click(screen.getByRole('tab', { name: /Observing Sites/ }))
    expect(within(screen.getByRole('list', { name: 'Saved observing sites' }))
      .getByText('Mauna Kea VLBI (USA)')).toBeInTheDocument()
    expect(screen.getByLabelText(
      'Use Mauna Kea VLBI (USA) in Observation Visibility',
    )).toBeChecked()
  })

  it('deleting a selected saved site clears stale plots and removes it from the next request', async () => {
    const user = userEvent.setup()
    const customSite = {
      id: 'site-test-observatory',
      name: 'Test Observatory (USA)',
      latitude_deg: 35.2,
      longitude_deg: -106.5,
      elevation_m: 2100,
    }
    localStorage.setItem(OBSERVING_SITE_STORAGE_KEY, JSON.stringify({
      version: 1,
      locations: [...DEFAULT_OBSERVING_SITES, customSite],
      selected_location_ids: ['narrabri', 'pyeongchang', customSite.id],
    }))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))
    expect(await screen.findByRole('img', { name: /3C123 altitude–time chart/ })).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Observing Sites/ }))
    const savedList = screen.getByRole('list', { name: 'Saved observing sites' })
    const customCard = within(savedList)
      .getByText(customSite.name)
      .closest('article') as HTMLElement
    await user.click(within(customCard).getByRole('button', {
      name: `Delete ${customSite.name}`,
    }))
    await user.click(within(customCard).getByRole('button', {
      name: `Confirm deletion of ${customSite.name}`,
    }))
    await user.click(screen.getByRole('button', { name: 'Use Selected Sites' }))

    expect(screen.queryByRole('img', { name: /3C123 altitude–time chart/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', {
      name: 'Simultaneously Visible Target Search',
    })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))
    const visibilityCalls = () => fetchMock.mock.calls.filter(
      ([input]) => String(input) === '/api/v1/visibility/altitude-series',
    )
    await waitFor(() => expect(visibilityCalls()).toHaveLength(2))
    const secondPayload = JSON.parse(String(visibilityCalls()[1][1]?.body)) as {
      locations: Array<{ id: string }>
    }
    expect(secondPayload.locations.map((location) => location.id)).toEqual([
      'narrabri',
      'pyeongchang',
    ])
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
    expect(within(detailImage).getByText('Reference UTC', { selector: '.legend-item' })).toBeInTheDocument()
    expect(within(overviewImage).getByText('Reference UTC', { selector: '.legend-item' })).toBeInTheDocument()
    expect(screen.queryByText(/Altitude threshold/i)).not.toBeInTheDocument()
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
    const catalogTab = screen.getByRole('tab', { name: 'Catalog Search' })
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
    expect(screen.getByText('Targets Imported from Catalogs')).toBeInTheDocument()
    const importedList = screen.getByLabelText('Imported catalog target list')
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

    await user.click(screen.getByRole('tab', { name: 'Catalog Search' }))
    expect(screen.getByLabelText('Source ID prefix (optional)')).toHaveValue('ILTJ1234')
    expect(screen.getByRole('checkbox', { name: `${source.name}: remove from visibility targets` })).toBeChecked()
  })

  it('VLASS source를 선택해 catalog metadata snapshot을 가시성 요청으로 전달한다', async () => {
    const user = userEvent.setup()
    const source = {
      id: 'vlass-abc123',
      catalog: 'vlass',
      source_id: 'VLASS1QLCIR J122906.70+020308.6',
      name: '3C 273',
      ra_deg: 187.27792,
      dec_deg: 2.05239,
      ra_hms: '12:29:06.70',
      dec_dms: '+02:03:08.6',
      total_flux_mjy: 52310.5,
      peak_flux_mjy: 48200.25,
      aliases: ['QSO B1226+023'],
      morphology_code: 'S',
      morphology_label: 'Single-Gaussian fit',
      morphology_description: 'One Gaussian fitted in its island',
      duplicate_flag: 0,
      quality_flag: 0,
      main_sample: true,
      separation_arcmin: null,
      counterpart_name: '3C 273',
      counterpart_aliases: ['QSO B1226+023'],
      object_type_code: 'QSO',
      object_type_label: 'Quasar',
      object_type_description: 'Quasar',
      crossmatch_separation_arcsec: 0.42,
      crossmatch_confidence: 'high',
      crossmatch_catalog: 'SIMBAD',
    } as const
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input).startsWith('/api/v1/catalogs/vlass/sources')) {
        return new Response(JSON.stringify({
          catalog: 'vlass',
          catalog_release: 'VLASS Epoch 1 Quick Look (Gordon et al. 2021)',
          coordinate_frame: 'icrs',
          reference_frequency_mhz: 3000,
          tap_mode: 'async',
          search_mode: 'brightness',
          enrichment_status: 'complete',
          enrichment_warning: null,
          morphology_codebook: [],
          recommended_only: true,
          sort_by: 'total_flux',
          sort_direction: 'desc',
          limit: 100,
          source_prefix: null,
          morphology_codes: ['S', 'C', 'M', 'E'],
          simbad_type_categories: [],
          candidate_count: 1,
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

    await user.click(screen.getByRole('tab', { name: 'Catalog Search' }))
    await user.click(screen.getByRole('tab', { name: /VLASS/ }))
    await user.click(screen.getByRole('button', { name: 'Load VLASS sources' }))
    await user.click(await screen.findByRole('checkbox', { name: '3C 273: add to visibility targets' }))
    await user.click(screen.getByRole('button', { name: 'Go to Observation Setup' }))

    const importedList = screen.getByLabelText('Imported catalog target list')
    expect(within(importedList).getByText('3C 273', { selector: 'b' })).toBeInTheDocument()
    expect(within(importedList).getByText(/VLASS · VLASS1QLCIR J122906/)).toBeInTheDocument()
    expect(within(importedList).getByText(/Quality 0 · Duplicate 0 · Main sample/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Plot Altitude-Time' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const payload = JSON.parse(String(fetchMock.mock.calls[1][1]?.body)) as {
      custom_targets: Array<Record<string, unknown>>
    }
    expect(payload.custom_targets).toEqual([{
      id: source.id,
      name: source.name,
      aliases: ['QSO B1226+023', source.source_id],
      ra_deg: source.ra_deg,
      dec_deg: source.dec_deg,
      catalog: 'vlass',
      catalog_source_id: source.source_id,
      total_flux_mjy: source.total_flux_mjy,
      peak_flux_mjy: source.peak_flux_mjy,
      morphology_code: source.morphology_code,
      morphology_label: source.morphology_label,
      morphology_description: source.morphology_description,
      duplicate_flag: source.duplicate_flag,
      quality_flag: source.quality_flag,
      main_sample: source.main_sample,
      counterpart_name: source.counterpart_name,
      counterpart_aliases: source.counterpart_aliases,
      object_type_code: source.object_type_code,
      object_type_label: source.object_type_label,
      object_type_description: source.object_type_description,
      crossmatch_separation_arcsec: source.crossmatch_separation_arcsec,
      crossmatch_confidence: source.crossmatch_confidence,
      crossmatch_catalog: source.crossmatch_catalog,
    }])
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

    await user.click(screen.getByRole('tab', { name: 'Catalog Search' }))
    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    await user.click(await screen.findByRole('checkbox', { name: '3C123: add to visibility targets' }))
    await user.click(screen.getByRole('button', { name: 'Go to Observation Setup' }))

    const importedList = screen.getByLabelText('Imported catalog target list')
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
    expect(screen.queryByLabelText('Imported catalog target list')).not.toBeInTheDocument()
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

    await user.click(screen.getByRole('tab', { name: 'Catalog Search' }))
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
    await user.click(screen.getByRole('tab', { name: 'Catalog Search' }))
    await user.type(screen.getByLabelText('Source ID prefix (optional)'), 'ILTJ1234')
    await user.click(screen.getByRole('button', { name: 'Load LOFAR DR3 sources' }))
    const sourceChecks = await screen.findAllByRole('checkbox', { name: /add to visibility targets/ })
    expect(sourceChecks).toHaveLength(25)
    for (const checkbox of sourceChecks) fireEvent.click(checkbox)
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
