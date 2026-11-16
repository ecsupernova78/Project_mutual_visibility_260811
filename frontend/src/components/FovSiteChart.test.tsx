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
  it('renders 16 hypothesis fan strips without invented centres or corner labels', () => {
    const pyc: FovSite = {
      ...site, station_code: 'PYC', location_name: 'PYC',
      beam_model: {
        model_type: 'modeled_assignment_cells', geometry_type: 'fan_strips',
        evidence_status: 'hypothesis', reference_frequency_mhz: 400,
        note: 'Horizon-to-horizon EW strips, not clipped by the primary beam.',
        beams: Array.from({ length: 16 }, (_, index) => ({
          beam_id: index, ix_ew: index, iy_ns: 0,
          center_east_west_deg: null, center_north_south_deg: null,
          polygon_ew_ns_deg: [[index - 8, -89], [index - 7, -89], [index - 7, 89], [index - 8, 89], [index - 8, -89]],
        })),
      },
      target_series: [{ target_id: '3c123', east_west_deg: [0, 0], north_south_deg: [0, 90], in_fov: [true, true], beam_ids: [8, 7] }],
    }
    const { container, rerender } = render(
      <FovSiteChart site={pyc} targets={[targets[0]]} timeIndex={0} timeUtc="2026-11-13T00:00:00Z" />,
    )
    expect(container.querySelector('.fov-svg-title')).toHaveTextContent(/^PYC \(16\)$/)
    expect(container.querySelector('.fov-svg-subtitle')).toHaveTextContent('Hypothesis')
    expect(container.querySelector('.fov-beam-model')).toHaveAttribute('aria-label', 'PYC hypothesis digital fan beams 0 through 15')
    expect(container.querySelectorAll('.fov-beam-cell')).toHaveLength(16)
    expect(container.querySelectorAll('.fov-beam-number')).toHaveLength(0)
    expect(container.querySelectorAll('.fov-beam-model text')).toHaveLength(0)
    expect(container.querySelector('[data-beam-id="8"]')).toHaveClass('fov-beam-cell--active')
    expect(container.querySelector('.fov-legend-beam')).toHaveTextContent('#8')
    expect(container.querySelector('.fov-region')).toBeNull()
    expect(container.querySelector('svg')?.innerHTML).not.toContain('NaN')
    // The supplied closed strips include the horizon; rounding must not mark it below.
    rerender(<FovSiteChart site={pyc} targets={[targets[0]]} timeIndex={1} timeUtc="2026-11-13T00:15:00Z" />)
    expect(container.querySelector('.fov-legend-status')).toHaveTextContent('O')
    expect(container.querySelector('.fov-legend-beam')).toHaveTextContent('#7')
    expect(container.querySelector('[data-beam-id="8"]')).not.toHaveClass('fov-beam-cell--active')
    expect(container.querySelector('[data-beam-id="7"]')).toHaveClass('fov-beam-cell--active')
  })

  it('labels only the four FUS corners outside the cells and highlights the current target beam', () => {
    const beams = Array.from({ length: 256 }, (_, beamId) => {
      const ix = beamId % 16
      const iy = Math.floor(beamId / 16)
      const eastWest = (ix - 7.5) * 4
      const northSouth = (iy - 7.5) * 5
      return {
        beam_id: beamId,
        ix_ew: ix,
        iy_ns: iy,
        center_east_west_deg: eastWest,
        center_north_south_deg: northSouth,
        polygon_ew_ns_deg: [
          [eastWest - 2, northSouth - 2.5],
          [eastWest + 2, northSouth - 2.5],
          [eastWest + 2, northSouth + 2.5],
          [eastWest - 2, northSouth + 2.5],
        ] as [number, number][],
      }
    })
    const fus: FovSite = {
      ...site,
      station_code: 'FUS',
      location_name: 'Fushan (Taiwan)',
      beam_model: {
        model_type: 'modeled_assignment_cells',
        reference_frequency_mhz: 400,
        note: 'Provisional model cells',
        beams,
      },
      target_series: [{
        target_id: '3c123',
        east_west_deg: [0, 50],
        north_south_deg: [0, 0],
        in_fov: [true, false],
        beam_ids: [136, null],
      }],
    }
    const { container, rerender } = render(
      <FovSiteChart site={fus} targets={[targets[0]]} timeIndex={0} timeUtc="2026-08-11T00:00:00Z" />,
    )
    expect(container.querySelectorAll('.fov-beam-cell')).toHaveLength(256)
    expect([...container.querySelectorAll('.fov-beam-number')].map((label) => label.textContent)).toEqual(['0', '15', '240', '255'])
    expect(container.querySelectorAll('.fov-beam-model text')).toHaveLength(0)
    expect(container.querySelector('[data-beam-id="0"]')).toHaveTextContent('Modeled beam 0')
    expect(container.querySelector('[data-beam-id="255"]')).toHaveTextContent('Modeled beam 255')
    expect(container.querySelector('[data-beam-id="136"]')).toHaveClass('fov-beam-cell--active')
    expect(container.querySelector('.fov-region')).toBeNull()
    expect(container.querySelector('.fov-site-chart')).toHaveClass('fov-site-chart--beam-model')
    expect(container.querySelector('.fov-svg-title')).toHaveTextContent(/^FUS \(256\)$/)
    expect(container.querySelector('.fov-legend-label')).toHaveTextContent('3C123')
    expect(container.querySelector('.fov-legend-beam')).toHaveTextContent('#136')
    expect(container.querySelector('.fov-method-note')).toBeNull()
    expect(container.querySelectorAll('.fov-sky-grid circle')).toHaveLength(4)
    expect(container.querySelectorAll('.fov-sky-grid line')).toHaveLength(12)
    expect(container.querySelector('.fov-sky-grid circle')).toHaveAttribute('r', '60')
    expect(container.querySelector('.fov-sky-grid circle')).toHaveTextContent('Altitude 70°')
    expect(container.querySelector('.fov-symbol-key')).toHaveAttribute('transform', 'translate(82 78)')
    expect([...container.querySelectorAll('.fov-symbol-key text')].map((text) => text.getAttribute('x'))).toEqual(['8', '8', '8'])
    expect(container.querySelectorAll('.fov-target-legend [role="row"]')).toHaveLength(1)

    rerender(<FovSiteChart site={fus} targets={[targets[0]]} timeIndex={1} timeUtc="2026-08-11T00:15:00Z" />)
    expect(container.querySelector('[data-beam-id="136"]')).not.toHaveClass('fov-beam-cell--active')
    expect(container.querySelector('.fov-legend-beam')).toHaveTextContent('—')
  })

  it.each([
    { code: 'LTN', rows: 4, last: 63, status: 'partially_validated', caption: 'Model (EW partly validated)' },
    { code: 'OGW', rows: 2, last: 31, status: 'hypothesis', caption: 'Hypothesis' },
  ] as const)('plots $code modeled cells and the correct corner IDs', ({ code, rows, last, status, caption }) => {
    const beams = Array.from({ length: rows * 16 }, (_, beamId) => {
      const ix = beamId % 16
      const iy = Math.floor(beamId / 16)
      const x = (ix - 7.5) * 3
      const y = (iy - (rows - 1) / 2) * 10
      return {
        beam_id: beamId, ix_ew: ix, iy_ns: iy,
        center_east_west_deg: x, center_north_south_deg: y,
        polygon_ew_ns_deg: [[x - 1.5, y - 5], [x + 1.5, y - 5], [x + 1.5, y + 5], [x - 1.5, y + 5], [x - 1.5, y - 5]] as [number, number][],
      }
    })
    const modelSite: FovSite = {
      ...site, station_code: code, location_name: code,
      beam_model: {
        model_type: 'modeled_assignment_cells', evidence_status: status,
        reference_frequency_mhz: 400, note: `${code} assignment model, not sensitivity contours.`, beams,
      },
      target_series: [{ target_id: '3c123', east_west_deg: [0, 0], north_south_deg: [0, 0], in_fov: [true, true], beam_ids: [8, 8] }],
    }
    const { container } = render(
      <FovSiteChart site={modelSite} targets={[targets[0]]} timeIndex={0} timeUtc="2026-11-16T00:00:00Z" />,
    )
    expect(container.querySelectorAll('.fov-beam-cell')).toHaveLength(rows * 16)
    expect([...container.querySelectorAll('.fov-beam-number')].map((label) => label.textContent))
      .toEqual(['0', '15', String(last - 15), String(last)])
    expect(container.querySelector('.fov-svg-subtitle')).toHaveTextContent(caption)
    expect(container.querySelector('.fov-region')).toBeNull()
    expect(container.querySelector('[data-beam-id="8"]')).toHaveClass('fov-beam-cell--active')
    expect(container.querySelector('svg')?.innerHTML).not.toContain('NaN')
  })

  it('matches the reference geometry and identifies targets beside colored symbols', () => {
    const { container } = render(
      <FovSiteChart site={site} targets={targets} timeIndex={0} timeUtc="2026-08-11T00:00:00Z" />,
    )

    const chart = screen.getByRole('img', { name: /LTN field of view/ })
    expect(chart).toHaveTextContent('EW [°]')
    expect(chart).toHaveTextContent('NS [°]')
    expect(chart).toHaveTextContent('Zenith')
    expect(container.querySelector('.fov-svg-title')).toHaveTextContent(/^LTN \(64\)$/)
    expect(chart).toHaveTextContent('constant-altitude circles')
    expect(container.querySelector('.fov-horizon')).toHaveAttribute('r', '270')
    expect(container.querySelector('.fov-region')?.tagName.toLowerCase()).toBe('ellipse')
    expect(container.querySelector('.fov-region')).toHaveAttribute('cx', '258')
    expect(container.querySelector('.fov-region')).toHaveAttribute('cy', '250')
    expect(container.querySelector('.fov-region')).toHaveAttribute('rx', '105')
    expect(container.querySelector('.fov-region')).toHaveAttribute('ry', '120')
    expect([...container.querySelectorAll('.fov-grid text')].map((label) => label.textContent)).toEqual([
      '-60', '-40', '-20', '0', '20', '40', '60',
      '-60', '-40', '-20', '0', '20', '40', '60',
    ])
    expect(container.querySelectorAll('.fov-zenith-cross')).toHaveLength(2)
    expect(container.querySelector('[data-target-id="3c123"]')).toHaveTextContent('O')
    expect(container.querySelector('[data-target-id="3c123"]')).toHaveAttribute('data-in-fov', 'true')
    expect(container.querySelector('[data-target-id="3c273"]')).toHaveTextContent('X')
    expect(container.querySelector('[data-target-id="3c273"]')).toHaveAttribute('x', '408')
    expect(container.querySelector('[data-target-label="3c123"]')).toHaveTextContent('3C123')
    expect(container.querySelector('[data-target-label="3c273"]')).toHaveTextContent('3C273')
    expect(chart).toHaveTextContent('Below')
    expect(screen.getByRole('button', { name: 'Copy LTN field of view plot image' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download LTN field of view plot image' })).toBeInTheDocument()
  })

  it('uses default 60 by 90 degree FoV geometry for a non-LTN site', () => {
    const { container } = render(
      <FovSiteChart
        site={{ ...site, location_name: 'FUS', ew_width_deg: 60, ns_width_deg: 90 }}
        targets={targets}
        timeIndex={0}
        timeUtc="2026-08-11T00:00:00Z"
      />,
    )

    expect(container.querySelector('.fov-region')).toHaveAttribute('rx', '90')
    expect(container.querySelector('.fov-region')).toHaveAttribute('ry', '135')
    expect(container.querySelector('.fov-svg-title')).toHaveTextContent(/^FUS \(256\)$/)
  })

  it('draws tilted nominal footprints for sites without a beam model', () => {
    const { container, rerender } = render(
      <FovSiteChart
        site={{
          ...site,
          station_code: null,
          location_name: 'Tilted test site',
          ew_width_deg: 60,
          ns_width_deg: 90,
          center_east_west_deg: -18,
          center_north_south_deg: 0,
          rotation_deg: -5.5,
          antenna_count: 16,
          antenna_rows: 2,
          antennas_per_row: 8,
          spacing_ew_m: 1,
          spacing_ns_m: 1,
          frequency_min_mhz: 400,
          frequency_max_mhz: 800,
        }}
        targets={targets}
        timeIndex={0}
        timeUtc="2026-08-11T00:00:00Z"
      />,
    )
    expect(container.querySelector('.fov-region')).toHaveAttribute('cx', '204')
    expect(container.querySelector('.fov-region')).toHaveAttribute('cy', '250')
    expect(container.querySelector('.fov-region')).toHaveAttribute('transform', 'rotate(5.5 204 250)')
    expect(screen.getByText('Boresight', { selector: '.fov-boresight-label' })).toBeInTheDocument()
    expect(container.querySelector('[aria-label="Boresight 18° W"]')).toBeInTheDocument()
    expect(screen.queryByText(/16 antennas \(2 × 8\)/)).not.toBeInTheDocument()

    rerender(
      <FovSiteChart
        site={{ ...site, station_code: null, center_east_west_deg: 0, center_north_south_deg: -16, rotation_deg: -0.23 }}
        targets={targets}
        timeIndex={0}
        timeUtc="2026-08-11T00:00:00Z"
      />,
    )
    expect(container.querySelector('.fov-region')).toHaveAttribute('cx', '258')
    expect(container.querySelector('.fov-region')).toHaveAttribute('cy', '298')
    expect(container.querySelector('.fov-region')).toHaveAttribute('transform', 'rotate(0.23 258 298)')
    expect(container.querySelector('[aria-label="Boresight 16° S"]')).toBeInTheDocument()
  })

  it('updates symbols for the timestamp and omits targets outside the cropped plot', () => {
    const { container, rerender } = render(
      <FovSiteChart site={site} targets={targets} timeIndex={0} timeUtc="2026-08-11T00:00:00Z" />,
    )
    rerender(<FovSiteChart site={site} targets={targets} timeIndex={1} timeUtc="2026-08-11T00:15:00Z" />)

    expect(container.querySelector('[data-target-id="3c123"]')).toHaveTextContent('X')
    expect(container.querySelector('[data-target-id="3c123"]')).toHaveAttribute('x', '378')
    expect(container.querySelector('[data-target-id="3c273"]')).toBeNull()
    expect(container.querySelector('[data-target-label="3c273"]')).toBeNull()
    expect(screen.getByText('3C273', { selector: '.fov-legend-label' })).toBeInTheDocument()
    expect(container.querySelector('.fov-target-legend')).toHaveTextContent('\u25bc')
    expect(container.querySelectorAll('.fov-legend-label title')[1]).toHaveTextContent('outside the displayed -60 to 60 degree range')
    expect(screen.getByText('2026-08-11 00:15 UTC')).toBeInTheDocument()
  })

  it('does not draw a far off-plot source but retains its true coordinates in the legend', () => {
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

    expect(container.querySelector('[data-target-id="3c123"]')).toBeNull()
    expect(container.querySelector('[data-target-label="3c123"]')).toBeNull()
    expect(container.querySelector('.fov-legend-status')).toHaveTextContent('\u25bc')
    expect(container.querySelector('.fov-legend-label title')).toHaveTextContent('EW -120.0 deg, NS -100.0 deg')
    expect(container.querySelector('.fov-legend-label title')).toHaveTextContent('outside the displayed -60 to 60 degree range')
  })

  it('draws points on the 60-degree boundary but hides points just beyond either axis', () => {
    const boundarySite: FovSite = {
      ...site,
      target_series: [
        { target_id: '3c123', east_west_deg: [60, 60.1], north_south_deg: [0, 0], in_fov: [false, false] },
        { target_id: '3c273', east_west_deg: [0, 0], north_south_deg: [-60.1, -60], in_fov: [false, false] },
      ],
    }
    const { container, rerender } = render(
      <FovSiteChart site={boundarySite} targets={targets} timeIndex={0} timeUtc="2026-08-11T00:00:00Z" />,
    )

    expect(container.querySelector('[data-target-id="3c123"]')).toHaveAttribute('x', '438')
    expect(container.querySelector('[data-target-id="3c273"]')).toBeNull()

    rerender(<FovSiteChart site={boundarySite} targets={targets} timeIndex={1} timeUtc="2026-08-11T00:15:00Z" />)
    expect(container.querySelector('[data-target-id="3c123"]')).toBeNull()
    expect(container.querySelector('[data-target-id="3c273"]')).toHaveAttribute('y', '430')
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

  it('truncates long names in the legend and plot while retaining the full accessible name', () => {
    const longName = 'ILTJ043704.43+294013.1'
    const longSite = {
      ...site,
      target_series: [{
        target_id: 'long-source',
        east_west_deg: [50, 100],
        north_south_deg: [0, 0],
        in_fov: [false, false],
      }],
    }
    const longTargets = [{ ...targets[0], id: 'long-source', name: longName }]
    const { container, rerender } = render(
      <FovSiteChart
        site={longSite}
        targets={longTargets}
        timeIndex={0}
        timeUtc="2026-08-11T00:00:00Z"
      />,
    )

    expect(container.querySelector('[data-target-label="long-source"]')).toHaveAttribute('aria-label', longName)
    expect(container.querySelector('[data-target-label="long-source"]')).toHaveTextContent('ILTJ043704.43+')
    rerender(<FovSiteChart site={longSite} targets={longTargets} timeIndex={1} timeUtc="2026-08-11T00:15:00Z" />)

    const label = container.querySelector('.fov-legend-label')
    const visibleLabel = label?.lastChild?.textContent ?? ''
    expect(visibleLabel.endsWith('...')).toBe(true)
    expect(visibleLabel.length).toBeLessThanOrEqual(15)
    expect(label?.querySelector('title')).toHaveTextContent(`${longName}: EW 100.0 deg, NS 0.0 deg`)
    expect(container.querySelector('[data-target-label="long-source"]')).toBeNull()
  })
})
