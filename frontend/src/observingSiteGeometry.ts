import type { ObserverLocation } from './types'

export const EARTH_MEAN_RADIUS_KM = 6371.0088
export const WEB_MERCATOR_MAX_LATITUDE = 85.05112878

export interface ObservingSitePairDistance {
  first: ObserverLocation
  second: ObserverLocation
  firstIndex: number
  secondIndex: number
  distanceKm: number
}

function degreesToRadians(value: number) {
  return value * Math.PI / 180
}

export function shortestLongitudeDelta(longitudeDelta: number) {
  return ((longitudeDelta + 540) % 360) - 180
}

export function greatCircleDistanceKm(
  first: Pick<ObserverLocation, 'latitude_deg' | 'longitude_deg'>,
  second: Pick<ObserverLocation, 'latitude_deg' | 'longitude_deg'>,
) {
  const latitude1 = degreesToRadians(first.latitude_deg)
  const latitude2 = degreesToRadians(second.latitude_deg)
  const deltaLatitude = latitude2 - latitude1
  const deltaLongitude = degreesToRadians(
    shortestLongitudeDelta(second.longitude_deg - first.longitude_deg),
  )
  const sinLatitude = Math.sin(deltaLatitude / 2)
  const sinLongitude = Math.sin(deltaLongitude / 2)
  const haversine = Math.min(1, Math.max(0,
    sinLatitude * sinLatitude
    + Math.cos(latitude1) * Math.cos(latitude2) * sinLongitude * sinLongitude,
  ))
  const centralAngle = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  return EARTH_MEAN_RADIUS_KM * centralAngle
}

export function orderedSelectedSites(
  locations: ObserverLocation[],
  selectedLocationIds: ReadonlySet<string>,
) {
  const locationsById = new Map(locations.map((location) => [location.id, location]))
  return [...selectedLocationIds].flatMap((id) => {
    const location = locationsById.get(id)
    return location ? [location] : []
  })
}

export function pairwiseSiteDistances(
  locations: ObserverLocation[],
): ObservingSitePairDistance[] {
  const pairs: ObservingSitePairDistance[] = []
  for (let firstIndex = 0; firstIndex < locations.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < locations.length; secondIndex += 1) {
      const first = locations[firstIndex]
      const second = locations[secondIndex]
      pairs.push({
        first,
        second,
        firstIndex,
        secondIndex,
        distanceKm: greatCircleDistanceKm(first, second),
      })
    }
  }
  return pairs
}

export function clampMapLatitude(latitude: number) {
  return Math.min(WEB_MERCATOR_MAX_LATITUDE, Math.max(-WEB_MERCATOR_MAX_LATITUDE, latitude))
}

export function shortestMapSegment(first: ObserverLocation, second: ObserverLocation) {
  const longitudeDelta = shortestLongitudeDelta(second.longitude_deg - first.longitude_deg)
  return [
    [clampMapLatitude(first.latitude_deg), first.longitude_deg],
    [clampMapLatitude(second.latitude_deg), first.longitude_deg + longitudeDelta],
  ] as [[number, number], [number, number]]
}
