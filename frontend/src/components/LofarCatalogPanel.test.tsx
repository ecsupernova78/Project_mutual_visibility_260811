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

  it('cone search 조건을 전용 endpoint로 보내고 친숙한 이름·전파 형태·SIMBAD 유형을 표시한다', async () => {
    const user = userEvent.setup()
    const source = {
      ...makeSource(0),
      name: '3C 123',
      aliases: ['3C123'],
      morphology_code: 'M',
      morphology_label: '복수 Gaussian',
      morphology_description: '복수 Gaussian으로 구성된 source',
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

    await user.click(screen.getByRole('radio', { name: /좌표 주변 검색/ }))
    await user.type(screen.getByLabelText('중심 RA (deg)'), '69.26825')
    await user.type(screen.getByLabelText('중심 Dec (deg)'), '29.67052')
    await user.click(screen.getByText('실행할 TAP 쿼리 보기'))
    expect(screen.getByText((_, element) => (
      element?.tagName === 'CODE'
      && element.textContent?.includes("DISTANCE(POINT('ICRS', RA, DEC)") === true
      && element.textContent.includes("CIRCLE('ICRS', 69.26825, 29.67052, 5/60.0)")
    ))).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '좌표 주변 천체 검색' }))

    expect(await screen.findByText('3C 123', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('LoTSS · ILTJ123400.0+451234')).toBeInTheDocument()
    expect(screen.getByText('M — 복수 Gaussian')).toBeInTheDocument()
    expect(screen.getByText('Seyfert Galaxy (SyG)')).toBeInTheDocument()
    expect(screen.getByText('0.94″ 위치 후보')).toBeInTheDocument()
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

    await user.click(screen.getByRole('checkbox', { name: '3C 123 계산 대상에 추가' }))
    expect(onToggleSource).toHaveBeenCalledWith(source)
    await user.click(screen.getByText('Source 유형 코드표와 위치 대응 기준'))
    expect(screen.getByText('단일 Gaussian')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'SIMBAD 공식 유형 코드표' })).toHaveAttribute(
      'href',
      'https://simbad.cds.unistra.fr/Pages/guide/otypes_desc.htx',
    )
  })

  it('검색 방식별 입력과 결과를 독립적으로 보존하고 잘못된 cone 범위는 요청 전에 차단한다', async () => {
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

    await user.type(screen.getByLabelText('Source ID 앞부분 (선택)'), 'ILTJ1234')
    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 목록 불러오기' }))
    expect(await screen.findByText(browseSource.source_id, { selector: 'strong' })).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /좌표 주변 검색/ }))
    await user.type(screen.getByLabelText('중심 RA (deg)'), '360')
    await user.type(screen.getByLabelText('중심 Dec (deg)'), '-20')
    await user.clear(screen.getByLabelText('검색 반경 (arcmin)'))
    await user.type(screen.getByLabelText('검색 반경 (arcmin)'), '61')
    await user.click(screen.getByRole('button', { name: '좌표 주변 천체 검색' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('RA 0° 이상 360° 미만')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await user.clear(screen.getByLabelText('중심 RA (deg)'))
    await user.type(screen.getByLabelText('중심 RA (deg)'), '10')
    await user.clear(screen.getByLabelText('검색 반경 (arcmin)'))
    await user.type(screen.getByLabelText('검색 반경 (arcmin)'), '3')
    await user.click(screen.getByRole('button', { name: '좌표 주변 천체 검색' }))
    expect(await screen.findByText(coneSource.source_id, { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('SIMBAD 이름·유형 보강 사용 불가')).toBeInTheDocument()
    expect(screen.getByText('SIMBAD service unavailable')).toBeInTheDocument()

    await user.click(screen.getByRole('radio', { name: /밝기 순 목록/ }))
    expect(screen.getByLabelText('Source ID 앞부분 (선택)')).toHaveValue('ILTJ1234')
    expect(screen.getByText(browseSource.source_id, { selector: 'strong' })).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('친숙한 이름이 없는 source와 부분 보강 결과를 오해 없이 표시한다', async () => {
    const user = userEvent.setup()
    const source = {
      ...makeSource(0),
      morphology_code: 'S' as const,
      morphology_label: '단일 Gaussian',
      morphology_description: '하나의 Gaussian으로 구성된 source',
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      catalog: 'lofar_dr3',
      catalog_release: 'LoTSS DR3 v1.0',
      coordinate_frame: 'icrs',
      reference_frequency_mhz: 144,
      tap_mode: 'async',
      search_mode: 'brightness',
      enrichment_status: 'partial',
      enrichment_warning: 'SIMBAD 유형 설명 일부를 불러오지 못했습니다.',
      morphology_codebook: [{ code: 'S', label: '단일 Gaussian', description: '하나의 Gaussian' }],
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

    await user.click(screen.getByRole('button', { name: 'LOFAR DR3 목록 불러오기' }))

    expect(await screen.findByText(source.source_id, { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('SIMBAD 대응 확인 안 됨')).toBeInTheDocument()
    expect(screen.queryByText('SIMBAD 5″ 내 대응 없음')).not.toBeInTheDocument()
    expect(screen.getByText('SIMBAD 이름·유형 보강 일부 완료')).toBeInTheDocument()
  })
})
