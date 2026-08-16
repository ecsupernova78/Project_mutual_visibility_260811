import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { VisibilityTarget } from '../types'
import { AltitudeChart } from './AltitudeChart'

const times = ['2026-08-11T00:00:00Z', '2026-08-11T00:15:00Z']

function target(overrides: Partial<VisibilityTarget> = {}): VisibilityTarget {
  return {
    id: '3c84',
    name: '3C 84',
    aliases: [],
    ra_deg: 49.9507,
    dec_deg: 41.5117,
    location_series: [
      {
        location_id: 'narrabri',
        location_name: 'Aus - Narrabri',
        altitudes_deg: [20, 25],
      },
    ],
    simultaneous_mask: [true, true],
    visible_intervals: [],
    max_common_altitude_deg: 25,
    simultaneous_visible: true,
    ...overrides,
  }
}

describe('AltitudeChart', () => {
  it('shows an English empty state when no site altitude series is available', () => {
    render(
      <AltitudeChart
        target={target({ location_series: [] })}
        times={times}
        minimumAltitude={15}
      />,
    )

    expect(screen.getByRole('status')).toHaveTextContent('No altitude data are available to plot.')
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('provides English chart legends and accessible sampled-visibility controls', () => {
    render(<AltitudeChart target={target()} times={times} minimumAltitude={15} />)

    expect(screen.getByLabelText('Chart legend')).toHaveTextContent('Altitude threshold 15°')
    expect(screen.getByLabelText('Chart legend')).toHaveTextContent(
      'Samples meeting the simultaneous-visibility threshold',
    )
    expect(screen.getByRole('img')).toHaveAccessibleName(/3C 84 altitude–time chart/)
    expect(screen.getByRole('slider', { name: 'Explore time samples' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy 3C 84 altitude–time plot image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download 3C 84 altitude–time plot image' })).toBeInTheDocument()
  })

  it('plots a 0 to 90 degree axis and clips below-horizon path segments', () => {
    const { container } = render(
      <AltitudeChart
        target={target({
          location_series: [{
            location_id: 'narrabri',
            location_name: 'Aus - Narrabri',
            altitudes_deg: [-30, 45],
          }],
        })}
        times={times}
        minimumAltitude={15}
      />,
    )

    const yTickLabels = [...container.querySelectorAll('.chart-grid > g > text')]
      .slice(0, 7)
      .map((label) => label.textContent)
    expect(yTickLabels).toEqual(['0°', '15°', '30°', '45°', '60°', '75°', '90°'])

    const altitudePath = container.querySelector('.altitude-line')
    expect(altitudePath).toHaveAttribute('d', 'M58.00,429.33 L896.00,176.00')
    expect(altitudePath?.parentElement).toHaveAttribute('clip-path', expect.stringMatching(/^url\(#visible-/))
    expect(container.querySelector('desc')).toHaveTextContent(
      'The plotted altitude range is 0 to 90 degrees',
    )
  })
})
