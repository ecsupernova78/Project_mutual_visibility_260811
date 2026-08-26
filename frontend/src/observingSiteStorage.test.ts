import { describe, expect, it } from 'vitest'

import {
  createObservingSiteId,
  DEFAULT_OBSERVING_SITES,
  loadObservingSiteState,
  OBSERVING_SITE_STORAGE_KEY,
  saveObservingSiteState,
} from './observingSiteStorage'

function memoryStorage(initial: string | null = null) {
  let value = initial
  return {
    getItem: (key: string) => key === OBSERVING_SITE_STORAGE_KEY ? value : null,
    setItem: (key: string, next: string) => {
      if (key === OBSERVING_SITE_STORAGE_KEY) value = next
    },
    value: () => value,
  }
}

describe('observing-site storage', () => {
  it('uses the three presets and two selected sites when no saved state exists', () => {
    const state = loadObservingSiteState(memoryStorage())

    expect(state.locations).toEqual(DEFAULT_OBSERVING_SITES)
    expect([...state.selectedLocationIds]).toEqual(['narrabri', 'pyeongchang'])
    expect(state.storageStatus).toBe('missing')
  })

  it('restores custom sites, drops unavailable selections, and limits selection to three', () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      locations: [
        ...DEFAULT_OBSERVING_SITES,
        {
          id: 'site-mauna-kea',
          name: 'Mauna Kea (USA)',
          latitude_deg: 19.8207,
          longitude_deg: 180,
          elevation_m: 4205,
        },
      ],
      selected_location_ids: [
        'site-mauna-kea',
        'site-mauna-kea',
        'missing-site',
        'narrabri',
        'pyeongchang',
        'fushan',
      ],
    }))

    const state = loadObservingSiteState(storage)
    expect(state.locations.at(-1)).toMatchObject({
      id: 'site-mauna-kea',
      longitude_deg: -180,
    })
    expect([...state.selectedLocationIds]).toEqual([
      'site-mauna-kea',
      'narrabri',
      'pyeongchang',
    ])
    expect(state.storageStatus).toBe('valid')
  })

  it('falls back safely for malformed JSON, duplicate ids, and invalid coordinates', () => {
    expect(loadObservingSiteState(memoryStorage('{bad json')).locations).toEqual(
      DEFAULT_OBSERVING_SITES,
    )
    expect(loadObservingSiteState(memoryStorage('{bad json')).storageStatus).toBe('invalid')

    const duplicate = JSON.stringify({
      version: 1,
      locations: [DEFAULT_OBSERVING_SITES[0], DEFAULT_OBSERVING_SITES[0]],
      selected_location_ids: [],
    })
    expect(loadObservingSiteState(memoryStorage(duplicate)).locations).toEqual(
      DEFAULT_OBSERVING_SITES,
    )

    const invalid = JSON.stringify({
      version: 1,
      locations: [{ ...DEFAULT_OBSERVING_SITES[0], latitude_deg: 91 }],
      selected_location_ids: [],
    })
    expect(loadObservingSiteState(memoryStorage(invalid)).locations).toEqual(
      DEFAULT_OBSERVING_SITES,
    )
  })

  it('removes unknown stored fields before sites can reach the strict API payload', () => {
    const storage = memoryStorage(JSON.stringify({
      version: 1,
      locations: [{
        ...DEFAULT_OBSERVING_SITES[0],
        unexpected: true,
      }],
      selected_location_ids: ['narrabri'],
    }))

    const state = loadObservingSiteState(storage)
    expect(state.storageStatus).toBe('valid')
    expect(state.locations[0]).toEqual(DEFAULT_OBSERVING_SITES[0])
    expect(state.locations[0]).not.toHaveProperty('unexpected')
  })

  it('rejects a stored custom-site set that exceeds the cap after presets are restored', () => {
    const customLocations = Array.from({ length: 50 }, (_, index) => ({
      id: `site-${index}`,
      name: `Custom Site ${index}`,
      latitude_deg: 10,
      longitude_deg: 20,
      elevation_m: 30,
    }))
    const state = loadObservingSiteState(memoryStorage(JSON.stringify({
      version: 1,
      locations: customLocations,
      selected_location_ids: [],
    })))

    expect(state.storageStatus).toBe('invalid')
    expect(state.locations).toEqual(DEFAULT_OBSERVING_SITES)
    expect(state.locations).toHaveLength(3)
  })

  it('round-trips valid state and refuses to overwrite storage with invalid drafts', () => {
    const storage = memoryStorage()
    const locations = [
      ...DEFAULT_OBSERVING_SITES,
      {
        id: 'site-atacama',
        name: 'Atacama Test Site',
        latitude_deg: -23.02,
        longitude_deg: -67.75,
        elevation_m: 5050,
      },
    ]
    expect(saveObservingSiteState(
      locations,
      new Set(['narrabri', 'site-atacama']),
      storage,
    )).toBe('saved')
    expect([...loadObservingSiteState(storage).selectedLocationIds]).toEqual([
      'narrabri',
      'site-atacama',
    ])

    const savedValue = storage.value()
    expect(saveObservingSiteState(
      [{ ...locations[0], latitude_deg: Number.NaN }],
      new Set(),
      storage,
    )).toBe('invalid')
    expect(storage.value()).toBe(savedValue)
  })

  it('creates backend-compatible immutable ids', () => {
    const id = createObservingSiteId()
    expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    expect(id.length).toBeLessThanOrEqual(40)
  })

  it('keeps the app usable when browser storage rejects writes', () => {
    expect(saveObservingSiteState(
      DEFAULT_OBSERVING_SITES,
      new Set(['narrabri']),
      { setItem: () => { throw new DOMException('Quota exceeded') } },
    )).toBe('unavailable')
  })
})
