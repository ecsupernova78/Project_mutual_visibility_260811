import type { ObserverLocation } from './types'

export const MAXIMUM_SELECTED_SITES = 10
export const MAXIMUM_SAVED_SITES = 50
export const OBSERVING_SITE_STORAGE_KEY = 'mutual-sky.observing-sites.v1'

export const DEFAULT_OBSERVING_SITES: ObserverLocation[] = [
  {
    id: 'narrabri',
    name: 'Narrabri (Aus)',
    latitude_deg: -30.31667,
    longitude_deg: 149.76667,
    elevation_m: 237,
  },
  {
    id: 'pyeongchang',
    name: 'Pyeongchang (Kor)',
    latitude_deg: 37.36889,
    longitude_deg: 128.39028,
    elevation_m: 700,
  },
  {
    id: 'fushan',
    name: 'Fushan (Taiwan)',
    latitude_deg: 24.7564722222,
    longitude_deg: 121.5816388889,
    elevation_m: 0,
  },
]

export const DEFAULT_SELECTED_SITE_IDS = ['narrabri', 'pyeongchang']

export type ObservingSiteStorageStatus = 'missing' | 'valid' | 'invalid' | 'unavailable'

export interface ObservingSiteState {
  locations: ObserverLocation[]
  selectedLocationIds: Set<string>
  storageStatus: ObservingSiteStorageStatus
}

interface StoredObservingSiteState {
  version: 1
  locations: ObserverLocation[]
  selected_location_ids: string[]
}

const LOCATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isObserverLocation(value: unknown): value is ObserverLocation {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<ObserverLocation>
  return (
    typeof candidate.id === 'string'
    && LOCATION_ID_PATTERN.test(candidate.id)
    && typeof candidate.name === 'string'
    && candidate.name.trim().length >= 1
    && candidate.name.trim().length <= 80
    && isFiniteNumber(candidate.latitude_deg)
    && candidate.latitude_deg >= -90
    && candidate.latitude_deg <= 90
    && isFiniteNumber(candidate.longitude_deg)
    && candidate.longitude_deg >= -180
    && candidate.longitude_deg <= 180
    && isFiniteNumber(candidate.elevation_m)
    && candidate.elevation_m >= -500
    && candidate.elevation_m <= 10_000
  )
}

function normalizedLocation(location: ObserverLocation): ObserverLocation {
  return {
    id: location.id,
    name: location.name.trim(),
    latitude_deg: location.latitude_deg,
    longitude_deg: location.longitude_deg === 180 ? -180 : location.longitude_deg,
    elevation_m: location.elevation_m,
  }
}

function defaultState(storageStatus: ObservingSiteStorageStatus): ObservingSiteState {
  return {
    locations: DEFAULT_OBSERVING_SITES.map((location) => ({ ...location })),
    selectedLocationIds: new Set(DEFAULT_SELECTED_SITE_IDS),
    storageStatus,
  }
}

export function loadObservingSiteState(storage?: Pick<Storage, 'getItem'>): ObservingSiteState {
  let raw: string | null
  try {
    const targetStorage = storage ?? (typeof window === 'undefined' ? null : window.localStorage)
    if (!targetStorage) return defaultState('unavailable')
    raw = targetStorage.getItem(OBSERVING_SITE_STORAGE_KEY)
  } catch {
    return defaultState('unavailable')
  }

  if (!raw) return defaultState('missing')

  try {
    const parsed = JSON.parse(raw) as Partial<StoredObservingSiteState>
    if (
      parsed.version !== 1
      || !Array.isArray(parsed.locations)
      || parsed.locations.length > MAXIMUM_SAVED_SITES
      || !parsed.locations.every(isObserverLocation)
      || !Array.isArray(parsed.selected_location_ids)
      || !parsed.selected_location_ids.every((id) => typeof id === 'string')
    ) return defaultState('invalid')

    const locationsById = new Map<string, ObserverLocation>()
    for (const location of parsed.locations) {
      if (locationsById.has(location.id)) return defaultState('invalid')
      locationsById.set(location.id, normalizedLocation(location))
    }

    const locations = [
      ...DEFAULT_OBSERVING_SITES.map((defaultLocation) => (
        locationsById.get(defaultLocation.id) ?? { ...defaultLocation }
      )),
      ...[...locationsById.values()].filter((location) => (
        !DEFAULT_OBSERVING_SITES.some((defaultLocation) => defaultLocation.id === location.id)
      )),
    ]
    if (locations.length > MAXIMUM_SAVED_SITES) return defaultState('invalid')

    const availableIds = new Set(locations.map((location) => location.id))
    const selectedLocationIds = new Set(
      [...new Set(parsed.selected_location_ids.filter((id) => availableIds.has(id)))]
        .slice(0, MAXIMUM_SELECTED_SITES),
    )
    return { locations, selectedLocationIds, storageStatus: 'valid' }
  } catch {
    return defaultState('invalid')
  }
}

export function saveObservingSiteState(
  locations: ObserverLocation[],
  selectedLocationIds: ReadonlySet<string>,
  storage?: Pick<Storage, 'setItem'>,
) {
  if (
    locations.length > MAXIMUM_SAVED_SITES
    || !locations.every(isObserverLocation)
    || new Set(locations.map((location) => location.id)).size !== locations.length
  ) return 'invalid' as const

  const availableIds = new Set(locations.map((location) => location.id))
  const payload: StoredObservingSiteState = {
    version: 1,
    locations: locations.map(normalizedLocation),
    selected_location_ids: [...selectedLocationIds]
      .filter((id) => availableIds.has(id))
      .slice(0, MAXIMUM_SELECTED_SITES),
  }
  try {
    const targetStorage = storage ?? (typeof window === 'undefined' ? null : window.localStorage)
    if (!targetStorage) return 'unavailable' as const
    targetStorage.setItem(OBSERVING_SITE_STORAGE_KEY, JSON.stringify(payload))
    return 'saved' as const
  } catch {
    return 'unavailable' as const
  }
}

export function createObservingSiteId() {
  const randomPart = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID().replaceAll('-', '').slice(0, 24)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
  return `site-${randomPart}`.slice(0, 40)
}

export function isDefaultObservingSite(id: string) {
  return DEFAULT_OBSERVING_SITES.some((location) => location.id === id)
}
