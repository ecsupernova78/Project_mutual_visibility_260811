import type { ObserverLocation } from './types'

export type BursttStationCode = 'FUS' | 'LTN' | 'GRN' | 'KMN' | 'OGW' | 'PYC' | 'GBD' | 'PHL' | 'FUG'

export interface BursttStationMetadata {
  code: BursttStationCode
  name: string
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
  antenna_count: number
  antenna_rows: number | null
  antennas_per_row: number | null
  spacing_ew_m: number | null
  spacing_ns_m: number | null
  frequency_min_mhz: number | null
  frequency_max_mhz: number | null
  rotation_deg: number | null
  center_east_west_deg: number
  center_north_south_deg: number
}

// Coordinates, antenna counts and array orientations follow the 2026 GNSS
// positioning CSV. Other layout/band fields retain the existing model, when
// available. A null orientation means the source does not specify one.
// OGW-32 pointing remains unknown; PYC has an approximate 12-degree south tilt.
export const BURSTT_STATIONS: Record<BursttStationCode, BursttStationMetadata> = {
  FUS: {
    code: 'FUS', name: 'Fushan (Taiwan)', latitude_deg: 24.75649349722,
    longitude_deg: 121.58164468611, elevation_m: 642.341,
    antenna_count: 256, antenna_rows: 16, antennas_per_row: 16,
    spacing_ew_m: 1, spacing_ns_m: 0.5, frequency_min_mhz: 300,
    frequency_max_mhz: 700, rotation_deg: -3,
    center_east_west_deg: 0, center_north_south_deg: 0,
  },
  LTN: {
    code: 'LTN', name: 'Longtien (Taiwan)', latitude_deg: 23.71457841944,
    longitude_deg: 120.82440456389, elevation_m: 882.641,
    antenna_count: 64, antenna_rows: 4, antennas_per_row: 16,
    spacing_ew_m: 1, spacing_ns_m: 2, frequency_min_mhz: 300,
    frequency_max_mhz: 700, rotation_deg: 0.5,
    center_east_west_deg: 0, center_north_south_deg: 0,
  },
  GRN: {
    code: 'GRN', name: 'Green Island (Taiwan)', latitude_deg: 22.67561324167,
    longitude_deg: 121.50121980833, elevation_m: 32.677,
    antenna_count: 64, antenna_rows: 4, antennas_per_row: 16,
    spacing_ew_m: 1, spacing_ns_m: 1, frequency_min_mhz: 400,
    frequency_max_mhz: 800, rotation_deg: 1.7,
    center_east_west_deg: 0, center_north_south_deg: 0,
  },
  KMN: {
    code: 'KMN', name: 'Kinmen (Taiwan)', latitude_deg: 24.43977323333,
    longitude_deg: 118.34267574167, elevation_m: 48.568,
    antenna_count: 32, antenna_rows: null, antennas_per_row: null,
    spacing_ew_m: null, spacing_ns_m: null, frequency_min_mhz: 300,
    frequency_max_mhz: 700, rotation_deg: 0.0715,
    center_east_west_deg: 0, center_north_south_deg: 0,
  },
  OGW: {
    code: 'OGW', name: 'Ogasawara (Japan)', latitude_deg: 27.0919857,
    longitude_deg: 142.21690964167, elevation_m: 261.534,
    antenna_count: 32, antenna_rows: 2, antennas_per_row: 16,
    spacing_ew_m: 0.833333, spacing_ns_m: 1, frequency_min_mhz: 300,
    frequency_max_mhz: 700, rotation_deg: -5.5,
    center_east_west_deg: 0, center_north_south_deg: 0,
  },
  PYC: {
    code: 'PYC', name: 'Pyeongchang (Kor) · PYC', latitude_deg: 37.53410008889,
    longitude_deg: 128.44857061389, elevation_m: 545.067,
    antenna_count: 16, antenna_rows: 1, antennas_per_row: 16,
    spacing_ew_m: 1, spacing_ns_m: 1, frequency_min_mhz: 300,
    frequency_max_mhz: 700, rotation_deg: -0.23,
    center_east_west_deg: 0, center_north_south_deg: -12,
  },
  GBD: {
    code: 'GBD', name: 'Gauribidanur (India)', latitude_deg: 13.60091666667,
    longitude_deg: 77.42641666667, elevation_m: 750,
    antenna_count: 16, antenna_rows: null, antennas_per_row: null,
    spacing_ew_m: null, spacing_ns_m: null, frequency_min_mhz: null,
    frequency_max_mhz: null, rotation_deg: null,
    center_east_west_deg: 0, center_north_south_deg: 0,
  },
  PHL: {
    code: 'PHL', name: 'Pahala (Hawaii)', latitude_deg: 19.25011111111,
    longitude_deg: -155.46827777778, elevation_m: 1760,
    antenna_count: 8, antenna_rows: null, antennas_per_row: null,
    spacing_ew_m: null, spacing_ns_m: null, frequency_min_mhz: null,
    frequency_max_mhz: null, rotation_deg: null,
    center_east_west_deg: 0, center_north_south_deg: 0,
  },
  FUG: {
    code: 'FUG', name: 'Cape Fuguei (Taiwan)', latitude_deg: 25.29752777778,
    longitude_deg: 121.53788888889, elevation_m: 20,
    antenna_count: 16, antenna_rows: null, antennas_per_row: null,
    spacing_ew_m: null, spacing_ns_m: null, frequency_min_mhz: null,
    frequency_max_mhz: null, rotation_deg: null,
    center_east_west_deg: 0, center_north_south_deg: 0,
  },
}

const STATION_CODES = Object.keys(BURSTT_STATIONS) as BursttStationCode[]

export function isBursttStationCode(value: unknown): value is BursttStationCode {
  return typeof value === 'string' && Object.hasOwn(BURSTT_STATIONS, value)
}

export function stationCodeForLocation(
  location: Pick<ObserverLocation, 'id' | 'name' | 'latitude_deg' | 'longitude_deg' | 'burstt_station_code'>,
): BursttStationCode | null {
  const nearbyStation = (code: BursttStationCode) => {
    const station = BURSTT_STATIONS[code]
    return Math.abs(location.latitude_deg - station.latitude_deg) < 0.1
      && Math.abs(location.longitude_deg - station.longitude_deg) < 0.1
  }
  if (isBursttStationCode(location.burstt_station_code)) {
    return nearbyStation(location.burstt_station_code) ? location.burstt_station_code : null
  }

  const name = location.name.toUpperCase()
  for (const code of STATION_CODES) {
    const station = BURSTT_STATIONS[code]
    const codeInName = new RegExp(`(^|[^A-Z0-9])${code}([^A-Z0-9]|$)`).test(name)
    const nearby = nearbyStation(code)
    const descriptiveName = name.includes(station.name.split(' (')[0].toUpperCase())
    if (nearby && (codeInName || descriptiveName)) return code
  }
  return null
}
