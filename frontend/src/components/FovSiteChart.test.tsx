import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { VisibilityTarget } from '../types'
import { FovSiteChart, type FovSite } from './FovSiteChart'

const targets: VisibilityTarget[] = [
  {
    id: '3c123',
    name: '3C123',
    aliases: [],
    ra_deg: 69.27,
    dec_deg: 29.67,
    location_series: [],
    simultaneous_mask: [true, true],
    visible_intervals: [],
    max_common_altitude_deg: 70,
    simultaneous_visible: true,
  },
  {
    id: '3c273',
    name: '3C273',
    aliases: [],
    ra_deg: 187.28,
    dec_deg: 2.05,
    location_series: [],
    simultaneous_mask: [true, true],
    visible_intervals: [],
    max_common_altitude_deg: 60,
    simultaneous_visible: true,
  },
]

const site: FovSite = {
  location_id: 'ltn',
  location_name: 'LTN',
  ew_width_deg: 70,
  ns_width_deg: 80,
  target_series: [
    {
      target_id: '3c123',
      east_west_deg: [10, 40],
      north_south_deg: [20, 20],
      in_fov: [true, false],
    },
    {
      target_id: '3c273',
      east_west_deg: [50, 100],
      north_south_deg: [0, 0],
      in_fov: [false, false],
    },
  ],
}

describe('FovSiteChart', () => {
  it('draws the degree grid, horizon, FoV bounds, zenith and target statuses', () => {
    const { container } = render(
      <FovSiteChart site={site} targets={targets} timeIndex={0} timeUtc="2026-08-11T00:00:00Z" />,
    )

    const chart = screen.getByRole('img', { name: /LTN field of view/ })
    expect(chart).toHaveTextContent('EW offset [deg]')
    expect(chart).toHaveTextContent('NS offset [deg]')
    expect(chart).toHaveTextContent('Zenith')
    expect(container.querySelector('.fov-horizon')).toHaveAttribute('r', '180')
    expect(container.querySelector('.fov-region')).toHaveAttribute('x', '188')
    expect(container.querySelector('.fov-region')).toHaveAttribute('y', '170')
    expect(container.querySelector('.fov-region')).toHaveAttribute('width', '140')
    expect(container.querySelector('.fov-region')).toHaveAttribute('height', '160')
    expect(container.querySelector('[data-target-id="3c123"]')).toHaveTextContent('O')
    expect(container.querySelector('[data-target-id="3c123"]')).toHaveAttribute('data-in-fov', 'true')
    expect(container.querySelector('[data-target-id="3c273"]')).toHaveTextContent('X')
    expect(container.querySelector('[data-target-id="3c273"]')).toHaveAttribute('x', '358')
    expect(screen.getByRole('button', { name: 'Copy LTN field of view plot image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download LTN field of view plot image' })).toBeInTheDocument()
  })

  it('updates markers for the selected timestamp and reports off-plot targets', () => {
    const { container, rerender } = render(
      <FovSiteChart site={site} targets={targets} timeIndex={0} timeUtc="2026-08-11T00:00:00Z" />,
    )
    rerender(<FovSiteChart site={site} targets={targets} timeIndex={1} timeUtc="2026-08-11T00:15:00Z" />)

    expect(container.querySelector('[data-target-id="3c123"]')).toHaveTextContent('X')
    expect(container.querySelector('[data-target-id="3c123"]')).toHaveAttribute('x', '338')
    expect(container.querySelector('[data-target-id="3c273"]')).toHaveTextContent('X')
    expect(container.querySelector('[data-target-id="3c273"]')).toHaveAttribute('x', '426')
    expect(container.querySelector('[data-target-id="3c273"]')).toHaveAttribute('data-off-plot', 'true')
    expect(container.querySelector('[data-target-id="3c273"] title')).toHaveTextContent(
      'EW 100.0°, NS 0.0°; outside FoV; off plot',
    )
    expect(container.querySelector('.fov-clipped-marker-leader')).toHaveAttribute('x2', '438')
    expect(container.querySelector('.fov-clipped-marker-ring')).toHaveAttribute('cx', '426')
    expect(screen.getByText('3C273 (off plot)', { selector: '.fov-legend-label' })).toBeInTheDocument()
    expect(screen.getByText('2026-08-11 00:15 UTC')).toBeInTheDocument()
  })

  it('places an off-plot source at the nearest lower-left edge and retains actual coordinates', () => {
    const { container } = render(
      <FovSiteChart
        site={{
          ...site,
          target_series: [{
            target_id: '3c123',
            east_west_deg: [-120],
            north_south_deg: [-100],
            in_fov: [false],
          }],
        }}
        targets={[targets[0]]}
        timeIndex={0}
        timeUtc="2026-08-11T00:00:00Z"
      />,
    )

    const marker = container.querySelector('[data-target-id="3c123"]')
    expect(marker).toHaveTextContent('X')
    expect(marker).toHaveAttribute('x', '90')
    expect(marker).toHaveAttribute('y', '418')
    expect(marker?.querySelector('title')).toHaveTextContent('EW -120.0°, NS -100.0°')
    expect(container.querySelector('.fov-clipped-marker-leader')).toHaveAttribute('x2', '78')
    expect(container.querySelector('.fov-clipped-marker-leader')).toHaveAttribute('y2', '430')
    expect(container.querySelector('.fov-legend-label title')).toHaveTextContent('off plot')
  })

  it('keeps 25 source colors distinct and consistent between site charts', () => {
    const manyTargets = Array.from({ length: 25 }, (_, index) => ({
      ...targets[0],
      id: `source-${index}`,
      name: `Source ${index}`,
    }))
    const series = manyTargets.map((target) => ({
      target_id: target.id,
      east_west_deg: [0],
      north_south_deg: [0],
      in_fov: [true],
    }))
    const { container } = render(
      <>
        <FovSiteChart
          site={{ ...site, location_id: 'first', location_name: 'First', target_series: series }}
          targets={manyTargets}
          timeIndex={0}
          timeUtc="2026-08-11T00:00:00Z"
        />
        <FovSiteChart
          site={{ ...site, location_id: 'second', location_name: 'Second', target_series: [...series].reverse() }}
          targets={manyTargets}
          timeIndex={0}
          timeUtc="2026-08-11T00:00:00Z"
        />
      </>,
    )

    const siteCharts = container.querySelectorAll('.fov-site-chart')
    const firstColors = manyTargets.map((target) => (
      siteCharts[0].querySelector(`[data-target-id="${target.id}"]`)?.getAttribute('fill')
    ))
    const secondColors = manyTargets.map((target) => (
      siteCharts[1].querySelector(`[data-target-id="${target.id}"]`)?.getAttribute('fill')
    ))
    expect(firstColors).toEqual(secondColors)
    expect(new Set(firstColors).size).toBe(25)
    expect(firstColors.every(Boolean)).toBe(true)
  })

  it('truncates long off-plot names within a legend column while retaining the full title', () => {
    const longName = 'ILTJ043704.43+294013.1'
    const { container } = render(
      <FovSiteChart
        site={{
          ...site,
          target_series: [{
            target_id: 'long-source',
            east_west_deg: [100],
            north_south_deg: [0],
            in_fov: [false],
          }],
        }}
        targets={[{ ...targets[0], id: 'long-source', name: longName }]}
        timeIndex={0}
        timeUtc="2026-08-11T00:00:00Z"
      />,
    )

    const legendLabel = container.querySelector('.fov-legend-label')
    const visibleLabel = legendLabel?.lastChild?.textContent ?? ''
    expect(visibleLabel.endsWith(' (off plot)')).toBe(true)
    expect(visibleLabel.length).toBeLessThanOrEqual(19)
    expect(legendLabel?.querySelector('title')).toHaveTextContent(`${longName}: EW 100.0°, NS 0.0°`)
    expect(legendLabel?.querySelector('title')).toHaveTextContent('off plot')
  })
})
