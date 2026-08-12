import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VisibilityOverviewChart } from './VisibilityOverviewChart'

describe('VisibilityOverviewChart', () => {
  it('시간창 전체에 동시 관측 가능한 target이 없으면 빈 상태를 표시한다', () => {
    render(
      <VisibilityOverviewChart
        targets={[]}
        times={[
          '2026-08-11T00:00:00Z',
          '2026-08-11T00:15:00Z',
          '2026-08-11T00:30:00Z',
        ]}
        centerTime="2026-08-11T00:15:00Z"
        minimumAltitude={15}
      />,
    )

    expect(
      screen.getByText('선택한 시간창에 동시 관측 가능한 천체가 없습니다.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
