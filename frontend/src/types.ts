export interface ObserverLocation {
  id: string
  name: string
  latitude_deg: number
  longitude_deg: number
  elevation_m: number
}

export type CatalogName = 'lofar_dr3'

export interface LofarSource {
  id: string
  catalog: CatalogName
  source_id: string
  name: string
  ra_deg: number
  dec_deg: number
  ra_hms: string
  dec_dms: string
  total_flux_mjy: number | null
  peak_flux_mjy: number | null
}

export type LofarQueryMode = 'name' | 'cone'
export type LofarSortField = 'total_flux' | 'peak_flux'
export type SortDirection = 'desc' | 'asc'

export interface LofarSearchParams {
  mode: LofarQueryMode
  query?: string
  ra_deg?: number
  dec_deg?: number
  radius_arcmin?: number
  sort_by: LofarSortField
  sort_direction: SortDirection
  page: number
  page_size: number
}

export interface LofarSearchResponse {
  catalog: CatalogName
  query_mode: LofarQueryMode
  page: number
  page_size: number
  has_more: boolean
  sources: LofarSource[]
}

export interface CustomTargetSnapshot {
  id: string
  name: string
  aliases: string[]
  ra_deg: number
  dec_deg: number
  catalog: CatalogName
  catalog_source_id: string
  total_flux_mjy?: number
  peak_flux_mjy?: number
}

export interface VisibilityRequest {
  locations: ObserverLocation[]
  center_time_utc: string
  hours_before: number
  hours_after: number
  step_minutes: number
  minimum_altitude_deg: number
  target_ids: string[]
  custom_targets: CustomTargetSnapshot[]
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
  catalog?: CatalogName | null
  catalog_source_id?: string | null
  total_flux_mjy?: number | null
  peak_flux_mjy?: number | null
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
