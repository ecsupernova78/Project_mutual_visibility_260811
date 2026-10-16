"""Astropy-backed mutual altitude calculation."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
from astropy import units as u
from astropy.coordinates import AltAz, EarthLocation, SkyCoord
from astropy.time import Time
from astropy.utils import iers

from app.catalog import TARGETS_BY_ID
from app.models import (
    CalculationMetadata,
    FovCommonMask,
    FovResponse,
    FovSite,
    FovTargetSeries,
    Location,
    LocationSeries,
    TargetVisibility,
    VisibilityRequest,
    VisibilityResponse,
    VisibleInterval,
)

# Calculations must be deterministic and must never wait on a network request.
# Astropy's bundled IERS table is sufficient for this planning interface.
iers.conf.auto_download = False
iers.conf.auto_max_age = None
iers.conf.iers_degraded_accuracy = "warn"


def _fov_dimensions(location: Location) -> tuple[float, float]:
    """Return full east-west and north-south widths for the named instrument."""

    if any(
        re.search(r"(?<![A-Za-z0-9])LTN(?![A-Za-z0-9])", value, re.IGNORECASE) for value in (location.id, location.name)
    ):
        return 70.0, 80.0
    return 60.0, 90.0


@dataclass(frozen=True, slots=True)
class _CalculationTarget:
    id: str
    name: str
    aliases: tuple[str, ...]
    coordinate: SkyCoord
    catalog: str | None = None
    catalog_source_id: str | None = None
    total_flux_mjy: float | None = None
    peak_flux_mjy: float | None = None
    morphology_code: str | None = None
    morphology_label: str | None = None
    morphology_description: str | None = None
    counterpart_name: str | None = None
    counterpart_aliases: tuple[str, ...] = ()
    object_type_code: str | None = None
    object_type_label: str | None = None
    object_type_description: str | None = None
    crossmatch_separation_arcsec: float | None = None
    crossmatch_confidence: str | None = None
    crossmatch_catalog: str | None = None
    duplicate_flag: int | None = None
    quality_flag: int | None = None
    main_sample: bool | None = None


def _calculation_targets(request: VisibilityRequest) -> list[_CalculationTarget]:
    targets = [
        _CalculationTarget(
            id=target.id,
            name=target.name,
            aliases=target.aliases,
            coordinate=target.coordinate,
        )
        for target_id in request.target_ids
        if (target := TARGETS_BY_ID[target_id])
    ]
    targets.extend(
        _CalculationTarget(
            id=target.id,
            name=target.name,
            aliases=tuple(target.aliases),
            coordinate=SkyCoord(ra=target.ra_deg * u.deg, dec=target.dec_deg * u.deg, frame="icrs"),
            catalog=target.catalog,
            catalog_source_id=target.catalog_source_id,
            total_flux_mjy=target.total_flux_mjy,
            peak_flux_mjy=target.peak_flux_mjy,
            morphology_code=target.morphology_code,
            morphology_label=target.morphology_label,
            morphology_description=target.morphology_description,
            counterpart_name=target.counterpart_name,
            counterpart_aliases=tuple(target.counterpart_aliases),
            object_type_code=target.object_type_code,
            object_type_label=target.object_type_label,
            object_type_description=target.object_type_description,
            crossmatch_separation_arcsec=target.crossmatch_separation_arcsec,
            crossmatch_confidence=target.crossmatch_confidence,
            crossmatch_catalog=target.crossmatch_catalog,
            duplicate_flag=target.duplicate_flag,
            quality_flag=target.quality_flag,
            main_sample=target.main_sample,
        )
        for target in request.custom_targets
    )
    return targets


def _build_times(request: VisibilityRequest) -> list[datetime]:
    before_samples = int(np.floor(request.hours_before * 60.0 / request.step_minutes))
    after_samples = int(np.floor(request.hours_after * 60.0 / request.step_minutes))
    return [
        request.center_time_utc + timedelta(minutes=index * request.step_minutes)
        for index in range(-before_samples, after_samples + 1)
    ]


def _visible_intervals(
    times: list[datetime],
    simultaneous_mask: np.ndarray,
    common_altitudes: np.ndarray,
) -> list[VisibleInterval]:
    intervals: list[VisibleInterval] = []
    start_index: int | None = None

    for index, is_visible in enumerate(simultaneous_mask):
        if is_visible and start_index is None:
            start_index = index

        is_last_sample = index == len(simultaneous_mask) - 1
        if start_index is not None and (not is_visible or is_last_sample):
            end_index = index if is_visible and is_last_sample else index - 1
            intervals.append(
                VisibleInterval(
                    start_time_utc=times[start_index],
                    end_time_utc=times[end_index],
                    peak_common_altitude_deg=round(float(np.max(common_altitudes[start_index : end_index + 1])), 6),
                    start_index=start_index,
                    end_index=end_index,
                    sample_count=end_index - start_index + 1,
                )
            )
            start_index = None

    return intervals


def calculate_visibility(request: VisibilityRequest) -> VisibilityResponse:
    """Calculate sampled target altitudes and simultaneous visibility."""

    times = _build_times(request)
    astropy_times = Time(times, scale="utc")

    earth_locations = [
        EarthLocation.from_geodetic(
            lon=location.longitude_deg * u.deg,
            lat=location.latitude_deg * u.deg,
            height=location.elevation_m * u.m,
        )
        for location in request.locations
    ]

    fov_sites: list[FovSite] = []
    if request.include_fov:
        for location in request.locations:
            ew_width_deg, ns_width_deg = _fov_dimensions(location)
            fov_sites.append(
                FovSite(
                    location_id=location.id,
                    location_name=location.name,
                    ew_width_deg=ew_width_deg,
                    ns_width_deg=ns_width_deg,
                    target_series=[],
                )
            )
    fov_common_masks: list[FovCommonMask] = []

    target_results: list[TargetVisibility] = []
    for target in _calculation_targets(request):
        coordinate = target.coordinate
        altitude_arrays: list[np.ndarray] = []
        location_series: list[LocationSeries] = []
        fov_mask_arrays: list[np.ndarray] = []

        for site_index, (location, earth_location) in enumerate(zip(request.locations, earth_locations, strict=True)):
            frame = AltAz(obstime=astropy_times, location=earth_location, pressure=0 * u.hPa)
            altaz = coordinate.transform_to(frame)
            altitudes = np.asarray(altaz.alt.to_value(u.deg), dtype=float)
            altitude_arrays.append(altitudes)
            location_series.append(
                LocationSeries(
                    location_id=location.id,
                    location_name=location.name,
                    altitudes_deg=np.round(altitudes, 6).tolist(),
                )
            )

            if request.include_fov:
                # Zenithal equidistant projection: the zenith is (0, 0),
                # east is +x, north is +y, and the horizon is the r=90 circle.
                azimuth_radians = np.deg2rad(np.asarray(altaz.az.to_value(u.deg), dtype=float))
                zenith_distance_deg = 90.0 - altitudes
                east_west_deg = zenith_distance_deg * np.sin(azimuth_radians)
                north_south_deg = zenith_distance_deg * np.cos(azimuth_radians)
                fov_site = fov_sites[site_index]
                in_fov = (
                    (altitudes >= 0.0)
                    & (np.abs(east_west_deg) <= fov_site.ew_width_deg / 2.0)
                    & (np.abs(north_south_deg) <= fov_site.ns_width_deg / 2.0)
                )
                fov_mask_arrays.append(in_fov)
                fov_site.target_series.append(
                    FovTargetSeries(
                        target_id=target.id,
                        east_west_deg=np.round(east_west_deg, 6).tolist(),
                        north_south_deg=np.round(north_south_deg, 6).tolist(),
                        in_fov=in_fov.tolist(),
                    )
                )

        if request.include_fov:
            fov_common_masks.append(
                FovCommonMask(target_id=target.id, in_fov=np.all(np.stack(fov_mask_arrays), axis=0).tolist())
            )

        # The common altitude is the limiting (lowest) altitude across every
        # selected location. This definition also naturally covers one site.
        common_altitudes = np.min(np.stack(altitude_arrays), axis=0)
        simultaneous_mask = common_altitudes >= request.minimum_altitude_deg
        intervals = _visible_intervals(times, simultaneous_mask, common_altitudes)

        target_results.append(
            TargetVisibility(
                id=target.id,
                name=target.name,
                aliases=list(target.aliases),
                ra_deg=round(float(coordinate.ra.deg), 9),
                dec_deg=round(float(coordinate.dec.deg), 9),
                location_series=location_series,
                simultaneous_mask=simultaneous_mask.tolist(),
                visible_intervals=intervals,
                max_common_altitude_deg=round(float(np.max(common_altitudes)), 6),
                simultaneous_visible=bool(np.any(simultaneous_mask)),
                catalog=target.catalog,
                catalog_source_id=target.catalog_source_id,
                total_flux_mjy=target.total_flux_mjy,
                peak_flux_mjy=target.peak_flux_mjy,
                morphology_code=target.morphology_code,
                morphology_label=target.morphology_label,
                morphology_description=target.morphology_description,
                counterpart_name=target.counterpart_name,
                counterpart_aliases=list(target.counterpart_aliases),
                object_type_code=target.object_type_code,
                object_type_label=target.object_type_label,
                object_type_description=target.object_type_description,
                crossmatch_separation_arcsec=target.crossmatch_separation_arcsec,
                crossmatch_confidence=target.crossmatch_confidence,
                crossmatch_catalog=target.crossmatch_catalog,
                duplicate_flag=target.duplicate_flag,
                quality_flag=target.quality_flag,
                main_sample=target.main_sample,
            )
        )

    return VisibilityResponse(
        times_utc=times,
        locations=request.locations,
        targets=target_results,
        visible_target_count=sum(target.simultaneous_visible for target in target_results),
        metadata=CalculationMetadata(
            center_time_utc=request.center_time_utc,
            start_time_utc=times[0],
            end_time_utc=times[-1],
            hours_before=request.hours_before,
            hours_after=request.hours_after,
            step_minutes=request.step_minutes,
            sample_count=len(times),
            location_count=len(request.locations),
            target_count=len(target_results),
            minimum_altitude_deg=request.minimum_altitude_deg,
        ),
        fov=FovResponse(sites=fov_sites, common_masks=fov_common_masks) if request.include_fov else None,
    )
