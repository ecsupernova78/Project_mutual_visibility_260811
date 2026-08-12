import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VisibilityOverviewChart } from './VisibilityOverviewChart'

describe('VisibilityOverviewChart', () => {
  it('플롯 대상으로 선택한 target이 없으면 빈 상태를 표시한다', () => {
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
      screen.getByText('플롯할 천체를 하나 이상 선택하세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
