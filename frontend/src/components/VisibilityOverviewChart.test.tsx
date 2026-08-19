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
        location_name: 'Narrabri (Aus)',
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
      />,
    )
    expect(filteredContainer.querySelector('.overview-altitude-line')).toHaveAttribute(
      'stroke',
      originalSecondColor,
    )
  })

  it('caps the in-chart tooltip when many targets are plotted', () => {
    const lofarName = 'ILTJ043704.43+294013.1'
    const targets = Array.from({ length: 25 }, (_, index) => ({
      id: `target-${index}`,
      name: index === 0 ? lofarName : `Target ${index + 1}`,
      aliases: [],
      ra_deg: index,
      dec_deg: 20,
      location_series: [{
        location_id: 'narrabri',
        location_name: 'Narrabri (Aus)',
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
      />,
    )

    fireEvent.focus(screen.getByRole('slider', { name: 'Overview time (UTC)' }))

    const chart = screen.getByRole('img')
    const targetLegend = screen.getByLabelText('Target color legend')
    const siteLegend = screen.getByLabelText('Observing-site line-style legend')
    expect(chart.contains(targetLegend)).toBe(true)
    expect(chart.contains(siteLegend)).toBe(true)
    expect(container.querySelector('.overview-chart > .overview-legends')).not.toBeInTheDocument()
    expect(targetLegend.querySelectorAll('.legend-item')).toHaveLength(25)
    expect(screen.getByText(lofarName, {
      selector: '.target-color-legend .legend-item',
    })).toBeInTheDocument()
    expect(chart).toHaveAttribute('viewBox', '0 0 1040 892')
    const legendBaselines = [...chart.querySelectorAll<SVGTextElement>(
      '.svg-chart-legend .svg-legend-item-label',
    )].map((label) => Number(label.getAttribute('y')))
    const plotTop = Number(chart.querySelector('clipPath rect')?.getAttribute('y'))
    expect(Math.max(...legendBaselines)).toBeLessThan(plotTop)
    for (const legendText of chart.querySelectorAll(
      '.svg-legend-title, .svg-legend-item-label',
    )) {
      expect(legendText).toHaveAttribute('font-size', '16')
    }
    expect(screen.getByText('+13 more targets · see table')).toBeInTheDocument()
    expect(container.querySelector('.overview-tooltip rect')).toHaveAttribute('height', '305')
    expect(container.querySelector('.overview-tooltip rect')).toHaveAttribute('y', '482')
    expect(container.querySelector('.plot-background')).toHaveAttribute('fill', '#ffffff')
    expect(container.querySelector('.chart-grid')).toHaveAttribute('fill', '#111111')
    expect(container.querySelector('.overview-tooltip')).toHaveAttribute('fill', '#111111')
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
        location_name: 'Narrabri (Aus)',
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
      />,
    )

    expect(screen.getByText('Reference UTC', {
      selector: '.site-pattern-legend .legend-item',
    })).toBeInTheDocument()
    expect(container.querySelector('.center-time-line')).toBeInTheDocument()
    expect(screen.queryByText(/Altitude threshold/i)).not.toBeInTheDocument()
    expect(container.querySelector('.threshold-line')).not.toBeInTheDocument()

    const yTickLabels = [...container.querySelectorAll('.chart-grid > g > text')]
      .slice(0, 7)
      .map((label) => label.textContent)
    expect(yTickLabels).toEqual(['0', '15', '30', '45', '60', '75', '90'])
    expect(screen.getByText('Altitude [°]')).toHaveClass('axis-title')

    const altitudePath = container.querySelector('.overview-altitude-line')
    expect(altitudePath).toHaveAttribute('d', 'M92.00,616.67 L1000.00,330.00')
    expect(altitudePath?.parentElement).toHaveAttribute('clip-path', expect.stringMatching(/^url\(#overview-/))
    expect(container.querySelector('desc')).toHaveTextContent(
      'Altitude from 0 to 90 degrees',
    )
  })
})
