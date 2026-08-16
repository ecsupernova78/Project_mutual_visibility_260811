import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { VisibilityOverviewChart } from './VisibilityOverviewChart'
import { getTargetColor } from './chartStyles'

describe('VisibilityOverviewChart', () => {
  it('shows an empty state when no targets are selected for plotting', () => {
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
      screen.getByText('Select at least one target to plot.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('uses the same fallback color for dynamic-catalog target lines and legends', () => {
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

  it('caps the in-chart tooltip when many targets are plotted', () => {
    const targets = Array.from({ length: 25 }, (_, index) => ({
      id: `target-${index}`,
      name: `Target ${index + 1}`,
      aliases: [],
      ra_deg: index,
      dec_deg: 20,
      location_series: [{
        location_id: 'narrabri',
        location_name: 'Aus - Narrabri',
        altitudes_deg: [20, 25, 30],
      }],
      simultaneous_mask: [true, true, true],
      visible_intervals: [],
      max_common_altitude_deg: 30,
      simultaneous_visible: true,
    }))
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

    fireEvent.focus(screen.getByRole('slider', { name: 'Explore time samples for all targets' }))

    expect(screen.getByText('+13 more targets · see table')).toBeInTheDocument()
    expect(container.querySelector('.overview-tooltip rect')).toHaveAttribute('height', '305')
    expect(container.querySelectorAll('.overview-tooltip .tooltip-value')).toHaveLength(13)
  })
})
