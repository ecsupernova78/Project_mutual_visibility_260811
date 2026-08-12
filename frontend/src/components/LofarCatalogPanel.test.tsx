import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { LofarCatalogPanel } from './LofarCatalogPanel'

const source = {
  id: 'lotss-dr3-source-a',
  catalog: 'lofar_dr3',
  source_id: 'ILTJ123456.7+451234',
  name: 'ILTJ123456.7+451234',
  ra_deg: 188.736,
  dec_deg: 45.209,
  ra_hms: '12:34:56.7',
  dec_dms: '+45:12:34',
  total_flux_mjy: 1200,
  peak_flux_mjy: 950,
}

function response(page: number, sources = [source], hasMore = false) {
  return new Response(JSON.stringify({
    catalog: 'lofar_dr3',
    query_mode: 'cone',
    page,
    page_size: 50,
    has_more: hasMore,
    sources,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function renderPanel() {
  return render(
    <LofarCatalogPanel
      hidden={false}
      selectedSourceIds={new Set()}
      selectedTargetCount={5}
      maximumTargetCount={25}
      onToggleSource={vi.fn()}
      onGoToVisibility={vi.fn()}
    />,
  )
}

describe('LofarCatalogPanel', () => {
  it('cone 검색, 플럭스 정렬과 페이지 이동 파라미터를 유지한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response(1, [source], true))
      .mockResolvedValueOnce(response(2, [], false))
    renderPanel()

    await user.click(screen.getByRole('radio', { name: '좌표 반경' }))
    const raInput = screen.getByRole('spinbutton', { name: /적경 RA/ })
    const decInput = screen.getByRole('spinbutton', { name: /적위 Dec/ })
    const radiusInput = screen.getByRole('spinbutton', { name: /검색 반경/ })
    await user.clear(raInput)
    await user.type(raInput, '123.5')
    await user.clear(decInput)
    await user.type(decInput, '-22.5')
    await user.clear(radiusInput)
    await user.type(radiusInput, '12.5')
    await user.selectOptions(screen.getByLabelText('밝기 기준'), 'peak_flux')
    await user.selectOptions(screen.getByLabelText('정렬 방향'), 'asc')
    await user.selectOptions(screen.getByLabelText('페이지당 결과'), '50')
    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 검색' }))

    expect(await screen.findByRole('checkbox', { name: `${source.name} 계산 대상에 추가` })).toBeInTheDocument()
    const firstQuery = new URL(String(fetchMock.mock.calls[0][0]), 'http://localhost').searchParams
    expect(Object.fromEntries(firstQuery)).toMatchObject({
      mode: 'cone',
      ra_deg: '123.5',
      dec_deg: '-22.5',
      radius_arcmin: '12.5',
      sort_by: 'peak_flux',
      sort_direction: 'asc',
      page: '1',
      page_size: '50',
    })
    expect(screen.getByRole('columnheader', { name: /피크 플럭스/ })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: '다음' }))
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const secondQuery = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost').searchParams
    expect(secondQuery.get('page')).toBe('2')
    expect(secondQuery.get('sort_by')).toBe('peak_flux')
    expect(await screen.findByText('일치하는 천체가 없습니다.')).toBeInTheDocument()
  })

  it('원격 검색 오류에서 동일 query를 다시 시도할 수 있다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response(1))
    renderPanel()

    await user.type(screen.getByLabelText('Source ID 앞 8자 이상'), 'ILTJ1234')
    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 검색' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('연결할 수 없습니다')

    await user.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('checkbox', { name: `${source.name} 계산 대상에 추가` })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe(String(fetchMock.mock.calls[0][0]))
  })
})
