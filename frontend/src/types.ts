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
  aliases: string[]
  morphology_code: 'S' | 'M' | 'C' | null
  morphology_label: string | null
  morphology_description: string | null
  counterpart_name: string | null
  counterpart_aliases: string[]
  object_type_code: string | null
  object_type_label: string | null
  object_type_description: string | null
  crossmatch_separation_arcsec: number | null
  crossmatch_confidence: 'high' | 'caution' | null
  crossmatch_catalog: 'SIMBAD' | null
  separation_arcmin: number | null
}

export type LofarSortField = 'total_flux' | 'peak_flux'
export type LofarConeSortField = 'distance' | LofarSortField
export type SortDirection = 'desc' | 'asc'

export interface LofarMorphologyDefinition {
  code: 'S' | 'M' | 'C'
  label: string
  description: string
}

export interface LofarSearchParams {
  source_prefix?: string
  sort_by: LofarSortField
  sort_direction: SortDirection
  limit: number
}

export interface LofarConeSearchParams {
  ra_deg: number
  dec_deg: number
  radius_arcmin: number
  sort_by: LofarConeSortField
  sort_direction: SortDirection
  limit: number
}

export interface LofarSearchResponse {
  catalog: CatalogName
  catalog_release: string
  coordinate_frame: 'icrs'
  reference_frequency_mhz: number
  tap_mode: 'async'
  search_mode: 'brightness' | 'cone'
  enrichment_status: 'complete' | 'partial' | 'unavailable'
  enrichment_warning: string | null
  morphology_codebook: LofarMorphologyDefinition[]
  sort_by: LofarConeSortField
  sort_direction: SortDirection
  limit: number
  source_prefix: string | null
  center_ra_deg: number | null
  center_dec_deg: number | null
  radius_arcmin: number | null
  result_count: number
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
  morphology_code?: 'S' | 'M' | 'C'
  morphology_label?: string
  morphology_description?: string
  counterpart_name?: string
  counterpart_aliases?: string[]
  object_type_code?: string
  object_type_label?: string
  object_type_description?: string
  crossmatch_separation_arcsec?: number
  crossmatch_confidence?: 'high' | 'caution'
  crossmatch_catalog?: 'SIMBAD'
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
  morphology_code?: 'S' | 'M' | 'C' | null
  morphology_label?: string | null
  morphology_description?: string | null
  counterpart_name?: string | null
  counterpart_aliases?: string[]
  object_type_code?: string | null
  object_type_label?: string | null
  object_type_description?: string | null
  crossmatch_separation_arcsec?: number | null
  crossmatch_confidence?: 'high' | 'caution' | null
  crossmatch_catalog?: 'SIMBAD' | null
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
