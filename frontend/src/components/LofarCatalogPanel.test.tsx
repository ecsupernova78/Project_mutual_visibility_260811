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
    sort_by: sortBy,
    sort_direction: sortDirection,
    limit,
    source_prefix: sourcePrefix,
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
  it('선택적 prefix와 밝기 정렬로 TOP 목록을 한 번 받아 25행씩 로컬 페이지로 표시한다', async () => {
    const user = userEvent.setup()
    const sources = Array.from({ length: 30 }, (_, index) => makeSource(index))
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      response({ sources, sortBy: 'peak_flux', sortDirection: 'asc', limit: 1000 }),
    )
    renderPanel()

    await user.selectOptions(screen.getByLabelText('밝기 기준'), 'peak_flux')
    await user.selectOptions(screen.getByLabelText('정렬 방향'), 'asc')
    await user.selectOptions(screen.getByLabelText('불러올 천체 수 (TOP)'), '1000')
    await user.click(screen.getByText('실행할 TAP 쿼리 보기'))
    expect(screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes('SELECT TOP 1000') === true
      && element.textContent.includes('WHERE Peak_flux IS NOT NULL')
      && element.textContent.includes('ORDER BY Peak_flux ASC, Source_Name ASC')
    ))).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 목록 불러오기' }))
    expect(await screen.findByRole('checkbox', { name: `${sources[0].name} 계산 대상에 추가` })).toBeInTheDocument()

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
    expect(screen.getByRole('columnheader', { name: /피크 플럭스/ })).toHaveAttribute('aria-sort', 'ascending')

    await user.click(screen.getByRole('button', { name: '다음' }))
    expect(screen.getAllByRole('checkbox')).toHaveLength(5)
    expect(screen.getByRole('checkbox', { name: `${sources[25].name} 계산 대상에 추가` })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/26–30 \/ 30/)).toBeInTheDocument()
  })

  it('Source ID prefix와 동일 TAP 조건을 오류 뒤 다시 시도한다', async () => {
    const user = userEvent.setup()
    const source = makeSource(0)
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(response({ sources: [source], sourcePrefix: 'ILTJ1234' }))
    renderPanel()

    await user.type(screen.getByLabelText('Source ID 앞부분 (선택)'), 'ILTJ1234')
    await user.click(screen.getByText('실행할 TAP 쿼리 보기'))
    expect(screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes('WHERE Total_flux IS NOT NULL') === true
      && element.textContent.includes("AND 1=ivo_nocasematch(Source_Name, 'ILTJ1234%')")
      && element.textContent.includes('ORDER BY Total_flux DESC, Source_Name ASC')
    ))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 목록 불러오기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('연결할 수 없습니다')

    await user.click(screen.getByRole('button', { name: '같은 조건으로 다시 시도' }))
    expect(await screen.findByRole('checkbox', { name: `${source.name} 계산 대상에 추가` })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toBe(String(fetchMock.mock.calls[0][0]))
    const query = new URL(String(fetchMock.mock.calls[1][0]), 'http://localhost').searchParams
    expect(query.get('source_prefix')).toBe('ILTJ1234')
  })

  it('오래 걸리는 TAP 요청 중 조건을 잠그고 사용자가 요청을 취소할 수 있다', async () => {
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

    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 목록 불러오기' }))
    expect(await screen.findByText(/ASTRON TAP 비동기 작업을 실행 중입니다/)).toBeInTheDocument()
    expect(screen.getByLabelText('밝기 기준')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'TAP 작업 실행 중…' })).toBeDisabled()

    expect(screen.getByText(/화면 대기만 중단합니다.*서버 작업은 계속될 수 있으며/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '화면 대기 중단' }))
    await waitFor(() => expect(requestSignal?.aborted).toBe(true))
    expect(await screen.findByText(/화면 대기를 중단했습니다.*완료되거나 제한시간에 도달하면 정리됩니다/)).toBeInTheDocument()
    expect(screen.getByLabelText('밝기 기준')).toBeEnabled()
    expect(screen.queryByText(/ASTRON TAP 비동기 작업을 실행 중입니다/)).not.toBeInTheDocument()
  })

  it('SQL injection 형태의 prefix를 차단하고 읽기 전용 preview에서는 따옴표를 이스케이프한다', async () => {
    const user = userEvent.setup()
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    renderPanel()

    const prefixInput = screen.getByLabelText('Source ID 앞부분 (선택)')
    await user.type(prefixInput, "ILTJ' OR 1=1 --")
    expect(prefixInput).toHaveAttribute('aria-invalid', 'true')
    await user.click(screen.getByText('실행할 TAP 쿼리 보기'))
    const preview = screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes("AND 1=ivo_nocasematch(Source_Name, 'ILTJ'' OR 1=1 --%')") === true
    ))
    expect(preview).toBeInTheDocument()
    expect(preview.querySelector('script')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 목록 불러오기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('영문자, 숫자, +, 마침표, 하이픈')
    expect(screen.queryByRole('button', { name: '같은 조건으로 다시 시도' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('부모가 보존한 target 선택을 새 목록에서도 선택된 상태로 표시한다', async () => {
    const user = userEvent.setup()
    const source = makeSource(0)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ sources: [source] }))
    renderPanel(new Set([source.id]))

    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 목록 불러오기' }))
    expect(await screen.findByRole('checkbox', { name: `${source.name} 계산 대상에서 제거` })).toBeChecked()
  })
})
