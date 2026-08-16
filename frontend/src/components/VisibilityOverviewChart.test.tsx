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
    expect(screen.queryByRole('button', { name: /plot image/i })).not.toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Copy overview altitude–time plot image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download overview altitude–time plot image' })).toBeInTheDocument()

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

  it('plots a 0 to 90 degree axis and clips below-horizon path segments', () => {
    const plottedTarget = {
      id: '3c84',
      name: '3C 84',
      aliases: [],
      ra_deg: 49.9507,
      dec_deg: 41.5117,
      location_series: [{
        location_id: 'narrabri',
        location_name: 'Aus - Narrabri',
        altitudes_deg: [-30, 45],
      }],
      simultaneous_mask: [false, true],
      visible_intervals: [],
      max_common_altitude_deg: 45,
      simultaneous_visible: true,
    }
    const { container } = render(
      <VisibilityOverviewChart
        targets={[plottedTarget]}
        times={['2026-08-11T00:00:00Z', '2026-08-11T00:15:00Z']}
        centerTime="2026-08-11T00:15:00Z"
        minimumAltitude={15}
      />,
    )

    const yTickLabels = [...container.querySelectorAll('.chart-grid > g > text')]
      .slice(0, 7)
      .map((label) => label.textContent)
    expect(yTickLabels).toEqual(['0°', '15°', '30°', '45°', '60°', '75°', '90°'])

    const altitudePath = container.querySelector('.overview-altitude-line')
    expect(altitudePath).toHaveAttribute('d', 'M58.00,486.67 L896.00,200.00')
    expect(altitudePath?.parentElement).toHaveAttribute('clip-path', expect.stringMatching(/^url\(#overview-/))
    expect(container.querySelector('desc')).toHaveTextContent(
      'The plotted altitude range is 0 to 90 degrees',
    )
  })
})
