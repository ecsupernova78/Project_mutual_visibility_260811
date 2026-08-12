export interface ObserverLocation {
  id: string
  name: string
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
}

export interface VisibilityRequest {
  locations: ObserverLocation[]
  center_time_utc: string
  hours_before: number
  hours_after: number
  step_minutes: number
  minimum_altitude_deg: number
  target_ids: string[]
}

export interface LocationSeries {
  location_id: string
  location_name: string
  altitudes_deg: number[]
}

export interface VisibleInterval {
  start_time_utc: string
  end_time_utc: string
  peak_common_altitude_deg: number
  start_index: number
  end_index: number
  sample_count: number
}

export interface VisibilityTarget {
  id: string
  name: string
  aliases: string[]
  ra_deg: number
  dec_deg: number
  location_series: LocationSeries[]
  simultaneous_mask: boolean[]
  visible_intervals: VisibleInterval[]
  max_common_altitude_deg: number
  simultaneous_visible: boolean
}

export interface CalculationMetadata {
  center_time_utc: string
  start_time_utc: string
  end_time_utc: string
  hours_before: number
  hours_after: number
  step_minutes: number
  sample_count: number
  location_count: number
  target_count: number
  minimum_altitude_deg: number
  coordinate_frame: string
  altitude_frame: string
  atmospheric_refraction: boolean
  iers_source: string
  longitude_convention: string
  visibility_definition: string
  interval_definition: string
}

export interface VisibilityResponse {
  times_utc: string[]
  locations: ObserverLocation[]
  visible_target_count: number
  targets: VisibilityTarget[]
  metadata: CalculationMetadata
}
