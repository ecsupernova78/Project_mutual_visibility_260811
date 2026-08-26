import { describe, expect, it } from 'vitest'

import { DEFAULT_OBSERVING_SITES } from './observingSiteStorage'
import {
  EARTH_MEAN_RADIUS_KM,
  greatCircleDistanceKm,
  orderedSelectedSites,
  pairwiseSiteDistances,
  shortestLongitudeDelta,
} from './observingSiteGeometry'

describe('observing-site geometry', () => {
  it('computes stable great-circle distances, including the antimeridian', () => {
    expect(greatCircleDistanceKm(
      { latitude_deg: 0, longitude_deg: 0 },
      { latitude_deg: 0, longitude_deg: 0 },
    )).toBe(0)
    expect(greatCircleDistanceKm(
      { latitude_deg: 0, longitude_deg: 0 },
      { latitude_deg: 0, longitude_deg: 1 },
    )).toBeCloseTo(111.195, 3)
    expect(greatCircleDistanceKm(
      { latitude_deg: 0, longitude_deg: 179 },
      { latitude_deg: 0, longitude_deg: -179 },
    )).toBeCloseTo(222.390, 3)
    expect(greatCircleDistanceKm(
      { latitude_deg: 0, longitude_deg: 0 },
      { latitude_deg: 0, longitude_deg: 180 },
    )).toBeCloseTo(Math.PI * EARTH_MEAN_RADIUS_KM, 8)
    expect(shortestLongitudeDelta(-358)).toBe(2)
  })

  it('preserves selection order and returns each pair once', () => {
    const selected = orderedSelectedSites(
      DEFAULT_OBSERVING_SITES,
      new Set(['fushan', 'narrabri', 'missing', 'pyeongchang']),
    )
    expect(selected.map((site) => site.id)).toEqual(['fushan', 'narrabri', 'pyeongchang'])

    const pairs = pairwiseSiteDistances(selected)
    expect(pairs.map((pair) => `${pair.first.id}-${pair.second.id}`)).toEqual([
      'fushan-narrabri',
      'fushan-pyeongchang',
      'narrabri-pyeongchang',
    ])
    expect(pairs[0].distanceKm).toBeCloseTo(6820.937, 3)
    expect(pairs[1].distanceKm).toBeCloseTo(1543.933, 3)
    expect(pairs[2].distanceKm).toBeCloseTo(7848.135, 3)
  })
})
