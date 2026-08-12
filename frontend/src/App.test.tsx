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
          location_name: 'Narrabri',
          altitudes_deg: [18, 24, 28],
        },
        {
          location_id: 'pyeongchang',
          location_name: '평창',
          altitudes_deg: [12, 19, 23],
        },
        {
          location_id: 'fushan',
          location_name: 'Fushan',
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

    expect(screen.getByDisplayValue('Narrabri')).toBeInTheDocument()
    expect(screen.getByDisplayValue('평창')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Fushan')).toBeInTheDocument()
    expect(screen.getAllByText('북위 + · 남위 −')).toHaveLength(3)
    expect(screen.getAllByText('동경 + · 서경 −')).toHaveLength(3)
    expect(screen.getAllByRole('checkbox')).toHaveLength(8)
    expect(screen.getByLabelText('Fushan 관측에 포함')).not.toBeChecked()
    expect(screen.getByText(/해발고도 미지정으로 기본 0 m/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '공통 가시성 계산' })).toBeEnabled()
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

    await user.click(screen.getByRole('button', { name: '공통 가시성 계산' }))

    expect(await screen.findByRole('img', { name: /3C123 시간–고도 그래프/ })).toBeInTheDocument()
    const detailImage = screen.getByRole('img', { name: /3C123 시간–고도 그래프/ })
    const overviewImage = screen.getByRole('img', { name: /공통 가시 천체 전체 시간–고도 개요/ })
    expect(detailImage).toBeInTheDocument()
    expect(overviewImage).toBeInTheDocument()
    expect(detailImage.querySelector('[role="slider"]')).not.toBeInTheDocument()
    expect(overviewImage.querySelector('[role="slider"]')).not.toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '시간 샘플 탐색' })).toBeInTheDocument()
    expect(screen.getByRole('slider', { name: '전체 천체 시간 샘플 탐색' })).toBeInTheDocument()
    expect(screen.getByText('최소 고도 15°', { selector: '.site-pattern-legend .legend-item' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /전체 개요로 이동/ })).toHaveAttribute(
      'href',
      '#common-visibility-overview',
    )
    expect(screen.getByText('동시 관측 가능', { selector: '.target-result-topline' })).toBeInTheDocument()

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
    })
    expect(payload.locations).toEqual([
      expect.objectContaining({ latitude_deg: -30.31667, longitude_deg: 149.76667 }),
      expect.objectContaining({ latitude_deg: 37.36889, longitude_deg: 128.39028 }),
    ])
    expect(String(payload.center_time_utc)).toMatch(/Z$/)

    const overviewPanel = document.querySelector('#common-visibility-overview')
    expect(overviewPanel).not.toBeNull()
    expect(within(overviewPanel as HTMLElement).queryByRole('table')).not.toBeInTheDocument()
    await user.click(screen.getByText('전체 수치 데이터 표'))
    expect(
      within(overviewPanel as HTMLElement).getByRole('table', {
        name: /공통 가시 천체의 관측지별/,
      }),
    ).toBeInTheDocument()
  })

  it('전체 개요는 시간창 전체가 아니라 중심 시각 샘플에서 공통 가시인 천체만 표시한다', async () => {
    const user = userEvent.setup()
    const outsideCenterTarget = {
      ...responseBody.targets[0],
      id: '3c273',
      name: '3C273',
      aliases: ['3C 273'],
      simultaneous_mask: [true, false, true],
    }
    const mixedResponse = {
      ...responseBody,
      visible_target_count: 2,
      targets: [...responseBody.targets, outsideCenterTarget],
      metadata: { ...responseBody.metadata, target_count: 2 },
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(mixedResponse), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    render(<App />)

    await user.click(screen.getByRole('button', { name: '공통 가시성 계산' }))

    expect(await screen.findByRole('tab', { name: /3C273/ })).toBeInTheDocument()
    const overview = document.querySelector('#common-visibility-overview')
    expect(overview).not.toBeNull()
    expect(within(overview as HTMLElement).getByText('3C123', { selector: '.legend-item' })).toBeInTheDocument()
    expect(within(overview as HTMLElement).queryByText('3C273', { selector: '.legend-item' })).not.toBeInTheDocument()
    expect(within(overview as HTMLElement).getByText('1개 천체')).toBeInTheDocument()
  })

  it('시간창에는 가시 천체가 있어도 중심 시각에 없으면 빈 개요를 표시한다', async () => {
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

    await user.click(screen.getByRole('button', { name: '공통 가시성 계산' }))

    expect(await screen.findByRole('img', { name: /3C123 시간–고도 그래프/ })).toBeInTheDocument()
    const overview = document.querySelector('#common-visibility-overview')
    expect(overview).not.toBeNull()
    expect(within(overview as HTMLElement).getByText('0개 천체')).toBeInTheDocument()
    expect(within(overview as HTMLElement).getByText(/중심 시각에 공통으로 보이는 천체가 없습니다/)).toBeInTheDocument()
    expect(within(overview as HTMLElement).queryByRole('img')).not.toBeInTheDocument()
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

    await user.click(screen.getByLabelText('Fushan 관측에 포함'))
    await user.click(screen.getByRole('button', { name: '공통 가시성 계산' }))

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
    expect(await screen.findAllByText('Fushan', { selector: '.legend-item' })).toHaveLength(2)
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

    await user.click(screen.getByLabelText('Fushan 관측에 포함'))
    const fushanLatitude = document.querySelector('#location-2-latitude') as HTMLInputElement
    expect(fushanLatitude).toBeEnabled()
    await user.clear(fushanLatitude)
    await user.type(fushanLatitude, '91')
    expect(fushanLatitude).toBeInvalid()

    await user.click(screen.getByLabelText('Fushan 관측에 포함'))
    expect(fushanLatitude).toBeDisabled()
    await user.click(screen.getByRole('button', { name: '공통 가시성 계산' }))

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

    await user.click(screen.getByLabelText('평창 관측에 포함'))
    await user.click(screen.getByRole('button', { name: '공통 가시성 계산' }))

    expect(await screen.findByRole('img', { name: /3C123 시간–고도 그래프/ })).toBeInTheDocument()
    const payload = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as {
      locations: Array<Record<string, unknown>>
    }
    expect(payload.locations).toEqual([
      expect.objectContaining({ id: 'narrabri' }),
    ])
    const detailChart = screen.getByRole('tabpanel', { name: /3C123 고도 그래프/ })
    expect(detailChart.querySelectorAll('.legend-line')).toHaveLength(1)
    expect(detailChart).toHaveTextContent('Narrabri')
    expect(detailChart).not.toHaveTextContent('평창')
    expect(detailChart).not.toHaveTextContent('Fushan')

    await user.click(screen.getByLabelText('Fushan 관측에 포함'))
    expect(screen.queryByRole('img', { name: /3C123 시간–고도 그래프/ })).not.toBeInTheDocument()
    expect(screen.getByText(/원하는 관측지를 골라/)).toBeInTheDocument()
  })

  it('관측지가 하나도 없으면 요청 전에 검증한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    await user.click(screen.getByLabelText('Narrabri 관측에 포함'))
    await user.click(screen.getByLabelText('평창 관측에 포함'))
    await user.click(screen.getByRole('button', { name: '공통 가시성 계산' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('관측지를 하나 이상 선택')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('시간–고도 곡선에 필요한 최소 두 샘플을 요청 전에 검증한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    render(<App />)

    const beforeInput = screen.getByLabelText(/이전/)
    const afterInput = screen.getByLabelText(/이후/)
    const stepInput = screen.getByLabelText(/계산 간격/)
    await user.clear(beforeInput)
    await user.type(beforeInput, '0.25')
    await user.clear(afterInput)
    await user.type(afterInput, '0.25')
    await user.clear(stepInput)
    await user.type(stepInput, '180')
    await user.click(screen.getByRole('button', { name: '공통 가시성 계산' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('샘플이 1개뿐입니다')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
