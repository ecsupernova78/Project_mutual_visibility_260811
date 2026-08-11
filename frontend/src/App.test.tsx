import { render, screen, waitFor } from '@testing-library/react'
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
  it('기본 관측지와 다섯 개 카탈로그 천체를 표시한다', () => {
    render(<App />)

    expect(screen.getByDisplayValue('Narrabri')).toBeInTheDocument()
    expect(screen.getByDisplayValue('평창')).toBeInTheDocument()
    expect(screen.getAllByText('북위 + · 남위 −')).toHaveLength(2)
    expect(screen.getAllByText('동경 + · 서경 −')).toHaveLength(2)
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    expect(screen.getByRole('button', { name: '동시 가시성 계산' })).toBeEnabled()
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

    await user.click(screen.getByRole('button', { name: '동시 가시성 계산' }))

    expect(await screen.findByRole('img', { name: /3C123 시간–고도 그래프/ })).toBeInTheDocument()
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
  })

  it('관측지 순서를 교환한다', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(screen.getByRole('button', { name: '관측지 A와 B 위치 교환' }))

    const nameInputs = screen.getAllByRole('textbox')
    expect(nameInputs[0]).toHaveValue('평창')
    expect(nameInputs[1]).toHaveValue('Narrabri')
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
    await user.click(screen.getByRole('button', { name: '동시 가시성 계산' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('샘플이 1개뿐입니다')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
