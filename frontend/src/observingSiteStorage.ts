import type { ObserverLocation } from './types'
import { BURSTT_STATIONS, isBursttStationCode, stationCodeForLocation } from './bursttStations'

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
    name: 'Pyeongchang (Kor) · PYC',
    latitude_deg: BURSTT_STATIONS.PYC.latitude_deg,
    longitude_deg: BURSTT_STATIONS.PYC.longitude_deg,
    elevation_m: BURSTT_STATIONS.PYC.elevation_m,
    burstt_station_code: 'PYC',
  },
  {
    id: 'fushan',
    name: BURSTT_STATIONS.FUS.name,
    latitude_deg: BURSTT_STATIONS.FUS.latitude_deg,
    longitude_deg: BURSTT_STATIONS.FUS.longitude_deg,
    elevation_m: BURSTT_STATIONS.FUS.elevation_m,
    burstt_station_code: 'FUS',
  },
  ...(['LTN', 'GRN', 'KMN', 'OGW', 'GBD', 'PHL', 'FUG'] as const).map((code) => ({
    id: `burstt-${code.toLowerCase()}`,
    name: BURSTT_STATIONS[code].name,
    latitude_deg: BURSTT_STATIONS[code].latitude_deg,
    longitude_deg: BURSTT_STATIONS[code].longitude_deg,
    elevation_m: BURSTT_STATIONS[code].elevation_m,
    burstt_station_code: code,
  })),
]

export const DEFAULT_SELECTED_SITE_IDS = ['narrabri', 'pyeongchang']

export type ObservingSiteStorageStatus = 'missing' | 'valid' | 'invalid' | 'unavailable'

export interface ObservingSiteState {
  locations: ObserverLocation[]
  selectedLocationIds: Set<string>
  storageStatus: ObservingSiteStorageStatus
}

interface StoredObservingSiteState {
  version: 1 | 2 | 3
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
    && (candidate.burstt_station_code === undefined || isBursttStationCode(candidate.burstt_station_code))
  )
}

function normalizedLocation(location: ObserverLocation, migrateSurvey = false): ObserverLocation {
  const presetCode = location.id === 'pyeongchang' ? 'PYC'
    : DEFAULT_OBSERVING_SITES.find((preset) => preset.id === location.id)?.burstt_station_code
  const surveyedCode = migrateSurvey && (
    presetCode
    || (isBursttStationCode(location.burstt_station_code) ? location.burstt_station_code : null)
    || Object.values(BURSTT_STATIONS).find((station) => station.name === location.name.trim())?.code
  )
  const stationCode = surveyedCode || stationCodeForLocation(location)
  // Migrate pre-GNSS profiles once, then preserve edits saved with version 3.
  const surveyed = stationCode && migrateSurvey ? BURSTT_STATIONS[stationCode] : null
  return {
    id: location.id,
    name: surveyed && presetCode ? surveyed.name : location.name.trim(),
    latitude_deg: surveyed?.latitude_deg ?? location.latitude_deg,
    longitude_deg: surveyed?.longitude_deg ?? (location.longitude_deg === 180 ? -180 : location.longitude_deg),
    elevation_m: surveyed?.elevation_m ?? location.elevation_m,
    ...(stationCode ? { burstt_station_code: stationCode } : {}),
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
      (parsed.version !== 1 && parsed.version !== 2 && parsed.version !== 3)
      || !Array.isArray(parsed.locations)
      || parsed.locations.length > MAXIMUM_SAVED_SITES
      || !parsed.locations.every(isObserverLocation)
      || !Array.isArray(parsed.selected_location_ids)
      || !parsed.selected_location_ids.every((id) => typeof id === 'string')
    ) return defaultState('invalid')

    const locationsById = new Map<string, ObserverLocation>()
    for (const location of parsed.locations) {
      if (locationsById.has(location.id)) return defaultState('invalid')
      locationsById.set(location.id, normalizedLocation(location, parsed.version !== 3))
    }

    // The former generic Pyeongchang preset and separate PYC preset referred
    // to the same station. Keep the stable selected 'pyeongchang' id.
    const legacyPyc = locationsById.get('burstt-pyc')
    if (legacyPyc && stationCodeForLocation(legacyPyc) === 'PYC') {
      locationsById.delete('burstt-pyc')
    }

    const storedLocations = [...locationsById.values()]
    const storedStationCodes = new Set(storedLocations.map(stationCodeForLocation))
    const storedDefaultIds = new Set(DEFAULT_OBSERVING_SITES.map((location) => location.id))
    const storedDefaults = DEFAULT_OBSERVING_SITES.flatMap((location) => {
      const stored = locationsById.get(location.id)
      return stored ? [stored] : []
    })
    const customLocations = storedLocations.filter((location) => !storedDefaultIds.has(location.id))
    const missingDefaults = DEFAULT_OBSERVING_SITES.filter((location) => (
      !locationsById.has(location.id)
      && (!location.burstt_station_code || !storedStationCodes.has(location.burstt_station_code))
    ))
    // Keep all pre-existing profiles when new presets would exceed the cap.
    const spaceForPresets = Math.max(0, MAXIMUM_SAVED_SITES - storedLocations.length)
    const locations = [
      ...storedDefaults,
      ...missingDefaults.slice(0, spaceForPresets).map((location) => ({ ...location })),
      ...customLocations,
    ]

    const availableIds = new Set(locations.map((location) => location.id))
    const selectedLocationIds = new Set(
      [...new Set(parsed.selected_location_ids
        .map((id) => id === 'burstt-pyc' ? 'pyeongchang' : id)
        .filter((id) => availableIds.has(id)))]
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
    version: 3,
    locations: locations.map((location) => normalizedLocation(location)),
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
