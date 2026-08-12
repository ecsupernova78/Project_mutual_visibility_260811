"""Validated HTTP request and response models."""

from __future__ import annotations

import math
from datetime import UTC, datetime
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator

from app.catalog import TARGETS_BY_ID

MAX_TIME_SAMPLES = 2_000
MAX_WINDOW_HOURS = 72.0
MAX_TARGETS_PER_REQUEST = 25

Identifier = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=40, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$"),
]
DisplayName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
TargetIdentifier = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$"),
]
CatalogSourceId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9+_.-]*$",
    ),
]
CatalogSourcePrefix = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9+.-]*$",
    ),
]


class ApiModel(BaseModel):
    """Shared strict model configuration for a predictable frontend contract."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Location(ApiModel):
    id: Identifier
    name: DisplayName
    latitude_deg: float = Field(ge=-90.0, le=90.0)
    longitude_deg: float = Field(
        ge=-180.0,
        le=180.0,
        description="East-positive geodetic longitude in the canonical [-180, 180) range.",
    )
    elevation_m: float = Field(ge=-500.0, le=10_000.0)

    @field_validator("longitude_deg", mode="before")
    @classmethod
    def canonicalize_antimeridian(cls, value: object) -> object:
        try:
            return -180.0 if float(value) == 180.0 else value
        except TypeError, ValueError:
            return value


class CustomTarget(ApiModel):
    """A validated coordinate snapshot imported from a supported external catalog."""

    id: TargetIdentifier
    name: DisplayName
    aliases: list[DisplayName] = Field(default_factory=list, max_length=5)
    ra_deg: float = Field(ge=0.0, lt=360.0)
    dec_deg: float = Field(ge=-90.0, le=90.0)
    catalog: Literal["lofar_dr3"]
    catalog_source_id: CatalogSourceId
    total_flux_mjy: float | None = Field(default=None, ge=0.0)
    peak_flux_mjy: float | None = Field(default=None, ge=0.0)

    @field_validator("id")
    @classmethod
    def require_catalog_namespace(cls, value: str) -> str:
        if not value.startswith("lotss-dr3-"):
            raise ValueError("LOFAR DR3 target ids must start with 'lotss-dr3-'")
        return value


class VisibilityRequest(ApiModel):
    locations: list[Location] = Field(
        min_length=1,
        max_length=3,
        description="One to three observing locations used for the common-visibility calculation.",
    )
    center_time_utc: datetime
    hours_before: float = Field(gt=0.0, le=MAX_WINDOW_HOURS)
    hours_after: float = Field(gt=0.0, le=MAX_WINDOW_HOURS)
    step_minutes: int = Field(ge=1, le=180)
    minimum_altitude_deg: float = Field(ge=-90.0, le=90.0)
    target_ids: list[str] = Field(default_factory=list, max_length=len(TARGETS_BY_ID))
    custom_targets: list[CustomTarget] = Field(default_factory=list, max_length=MAX_TARGETS_PER_REQUEST)

    @field_validator("center_time_utc")
    @classmethod
    def require_timezone(cls, value: datetime) -> datetime:
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("center_time_utc must include a UTC offset, for example 'Z'")
        return value.astimezone(UTC)

    @field_validator("target_ids")
    @classmethod
    def validate_target_ids(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("target_ids must not contain duplicates")

        unknown = sorted(set(value) - TARGETS_BY_ID.keys())
        if unknown:
            raise ValueError(f"unknown target_ids: {', '.join(unknown)}")
        return value

    @model_validator(mode="after")
    def validate_locations_and_sample_count(self) -> Self:
        location_ids = [location.id for location in self.locations]
        if len(location_ids) != len(set(location_ids)):
            raise ValueError("location ids must be unique")

        custom_ids = [target.id for target in self.custom_targets]
        if len(custom_ids) != len(set(custom_ids)):
            raise ValueError("custom target ids must be unique")
        collisions = sorted(set(self.target_ids) & set(custom_ids))
        if collisions:
            raise ValueError(f"target ids must be unique across catalogs: {', '.join(collisions)}")
        target_count = len(self.target_ids) + len(self.custom_targets)
        if target_count < 1:
            raise ValueError("at least one target is required")
        if target_count > MAX_TARGETS_PER_REQUEST:
            raise ValueError(f"maximum targets per request is {MAX_TARGETS_PER_REQUEST}")

        sample_count = (
            math.floor(self.hours_before * 60.0 / self.step_minutes)
            + math.floor(self.hours_after * 60.0 / self.step_minutes)
            + 1
        )
        if sample_count < 2:
            raise ValueError("request must create at least 2 time samples")
        if sample_count > MAX_TIME_SAMPLES:
            raise ValueError(f"request would create {sample_count} samples; maximum is {MAX_TIME_SAMPLES}")
        return self


class TargetCatalogItem(ApiModel):
    id: str
    name: str
    aliases: list[str]
    ra_hms: str
    dec_dms: str
    ra_deg: float
    dec_deg: float
    frame: str = "icrs"


class TargetCatalogResponse(ApiModel):
    targets: list[TargetCatalogItem]


class LocationSeries(ApiModel):
    location_id: str
    location_name: str
    altitudes_deg: list[float]


class VisibleInterval(ApiModel):
    start_time_utc: datetime
    end_time_utc: datetime
    peak_common_altitude_deg: float
    start_index: int
    end_index: int
    sample_count: int


class TargetVisibility(ApiModel):
    id: str
    name: str
    aliases: list[str]
    ra_deg: float
    dec_deg: float
    location_series: list[LocationSeries]
    simultaneous_mask: list[bool]
    visible_intervals: list[VisibleInterval]
    max_common_altitude_deg: float
    simultaneous_visible: bool
    catalog: Literal["lofar_dr3"] | None = None
    catalog_source_id: str | None = None
    total_flux_mjy: float | None = None
    peak_flux_mjy: float | None = None


class LofarSource(ApiModel):
    id: TargetIdentifier
    catalog: Literal["lofar_dr3"] = "lofar_dr3"
    source_id: str
    name: str
    ra_deg: float
    dec_deg: float
    ra_hms: str
    dec_dms: str
    total_flux_mjy: float | None
    peak_flux_mjy: float | None


class LofarSearchParameters(ApiModel):
    source_prefix: CatalogSourcePrefix | None = None
    sort_by: Literal["total_flux", "peak_flux"] = "total_flux"
    sort_direction: Literal["asc", "desc"] = "desc"
    limit: Literal[10, 25, 50, 100, 250, 500, 1000] = 100

    @field_validator("limit", mode="before")
    @classmethod
    def parse_query_string_limit(cls, value: object) -> object:
        """Coerce the numeric string supplied by an HTTP query parameter."""

        if isinstance(value, str) and value.isdecimal():
            return int(value)
        return value

    @field_validator("source_prefix", mode="before")
    @classmethod
    def empty_prefix_means_all_sources(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


class LofarSearchResponse(ApiModel):
    catalog: Literal["lofar_dr3"] = "lofar_dr3"
    catalog_release: str = "LoTSS DR3 v1.0"
    coordinate_frame: str = "icrs"
    reference_frequency_mhz: float = 144.0
    tap_mode: Literal["async"] = "async"
    sort_by: Literal["total_flux", "peak_flux"]
    sort_direction: Literal["asc", "desc"]
    limit: int
    source_prefix: str | None
    result_count: int
    sources: list[LofarSource]


class CalculationMetadata(ApiModel):
    center_time_utc: datetime
    start_time_utc: datetime
    end_time_utc: datetime
    hours_before: float
    hours_after: float
    step_minutes: int
    sample_count: int
    location_count: int
    target_count: int
    minimum_altitude_deg: float
    coordinate_frame: str = "icrs"
    altitude_frame: str = "altaz"
    atmospheric_refraction: bool = False
    iers_source: str = "astropy-iers-data bundled tables; network downloads disabled"
    longitude_convention: str = "east-positive degrees in [-180, 180)"
    visibility_definition: str = (
        "At a sampled UTC instant, geometric AltAz altitude (pressure=0; refraction ignored) "
        "is greater than or equal to minimum_altitude_deg at every selected location."
    )
    interval_definition: str = (
        "A visible interval is a run of consecutive visible samples; visibility between samples is not asserted."
    )


class VisibilityResponse(ApiModel):
    times_utc: list[datetime]
    locations: list[Location]
    targets: list[TargetVisibility]
    visible_target_count: int
    metadata: CalculationMetadata


class HealthResponse(ApiModel):
    status: str
    version: str
