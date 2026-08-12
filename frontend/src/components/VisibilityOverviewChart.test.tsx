import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VisibilityOverviewChart } from './VisibilityOverviewChart'
import { getTargetColor } from './chartStyles'

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

  it('동적 카탈로그 target의 선과 범례에 같은 fallback 색상을 적용한다', () => {
    const target = (id: string, name: string) => ({
      id,
      name,
      aliases: [],
      ra_deg: 10,
      dec_deg: 20,
      location_series: [{
        location_id: 'narrabri',
        location_name: 'Narrabri',
        altitudes_deg: [20, 25, 30],
      }],
      simultaneous_mask: [true, true, true],
      visible_intervals: [],
      max_common_altitude_deg: 30,
      simultaneous_visible: true,
    })
    const targets = [target('lotss-dr3-a', 'ILTJ-A'), target('lotss-dr3-b', 'ILTJ-B')]
    const { container } = render(
      <VisibilityOverviewChart
        targets={targets}
        times={[
          '2026-08-11T00:00:00Z',
          '2026-08-11T00:15:00Z',
          '2026-08-11T00:30:00Z',
        ]}
        centerTime="2026-08-11T00:15:00Z"
        minimumAltitude={15}
      />,
    )

    const paths = [...container.querySelectorAll('.overview-altitude-line')]
    expect(paths.map((path) => path.getAttribute('stroke'))).toEqual([
      getTargetColor(targets[0].id),
      getTargetColor(targets[1].id),
    ])
    const legendDots = [...container.querySelectorAll('.target-color-legend .legend-color-dot')]
    expect(legendDots.map((legend) => legend.getAttribute('style'))).toEqual([
      `--legend-color: ${getTargetColor(targets[0].id)};`,
      `--legend-color: ${getTargetColor(targets[1].id)};`,
    ])

    const originalSecondColor = paths[1].getAttribute('stroke')
    const { container: filteredContainer } = render(
      <VisibilityOverviewChart
        targets={[targets[1]]}
        times={[
          '2026-08-11T00:00:00Z',
          '2026-08-11T00:15:00Z',
          '2026-08-11T00:30:00Z',
        ]}
        centerTime="2026-08-11T00:15:00Z"
        minimumAltitude={15}
      />,
    )
    expect(filteredContainer.querySelector('.overview-altitude-line')).toHaveAttribute(
      'stroke',
      originalSecondColor,
    )
  })
})
