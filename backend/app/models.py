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
CatalogTypeCode = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
CatalogTypeLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
CatalogDescription = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)]
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
        pattern=r"^[A-Za-z0-9][A-Za-z0-9+_. -]*$",
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
VlassSourcePrefix = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=80,
        pattern=r"^[A-Za-z0-9][A-Za-z0-9+. -]*$",
    ),
]

SimbadTypeCategory = Literal[
    "galaxy",
    "agn",
    "quasar",
    "blazar",
    "radio_galaxy",
    "seyfert",
    "star",
    "pulsar",
    "ism",
    "radio_source",
]
SIMBAD_TYPE_CATEGORY_ORDER: tuple[SimbadTypeCategory, ...] = (
    "galaxy",
    "agn",
    "quasar",
    "blazar",
    "radio_galaxy",
    "seyfert",
    "star",
    "pulsar",
    "ism",
    "radio_source",
)


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
    catalog: Literal["lofar_dr3", "vlass"]
    catalog_source_id: CatalogSourceId
    total_flux_mjy: float | None = Field(default=None, ge=0.0)
    peak_flux_mjy: float | None = Field(default=None, ge=0.0)
    morphology_code: Literal["S", "M", "C", "E"] | None = None
    morphology_label: DisplayName | None = None
    morphology_description: CatalogDescription | None = None
    counterpart_name: DisplayName | None = None
    counterpart_aliases: list[DisplayName] = Field(default_factory=list, max_length=5)
    object_type_code: CatalogTypeCode | None = None
    object_type_label: CatalogTypeLabel | None = None
    object_type_description: CatalogDescription | None = None
    crossmatch_separation_arcsec: float | None = Field(default=None, ge=0.0, le=5.0)
    crossmatch_confidence: Literal["high", "caution"] | None = None
    crossmatch_catalog: Literal["SIMBAD"] | None = None
    duplicate_flag: int | None = Field(default=None, ge=0, le=2)
    quality_flag: int | None = Field(default=None, ge=0, le=7)
    main_sample: bool | None = None

    @field_validator("id")
    @classmethod
    def require_known_catalog_namespace(cls, value: str) -> str:
        if not value.startswith(("lotss-dr3-", "vlass-")):
            raise ValueError("catalog target ids must start with 'lotss-dr3-' or 'vlass-'")
        return value

    @model_validator(mode="after")
    def validate_crossmatch_metadata(self) -> Self:
        required_prefix = "lotss-dr3-" if self.catalog == "lofar_dr3" else "vlass-"
        if not self.id.startswith(required_prefix):
            raise ValueError(f"{self.catalog} target ids must start with '{required_prefix}'")
        if self.catalog == "lofar_dr3" and self.morphology_code == "E":
            raise ValueError("LOFAR DR3 targets do not support morphology code 'E'")

        vlass_quality = (self.duplicate_flag, self.quality_flag, self.main_sample)
        if self.catalog == "lofar_dr3" and any(value is not None for value in vlass_quality):
            raise ValueError("LOFAR DR3 targets must not contain VLASS quality metadata")
        if self.catalog == "vlass" and any(value is None for value in vlass_quality):
            raise ValueError("VLASS targets require duplicate_flag, quality_flag, and main_sample")

        metadata_present = any(
            value is not None
            for value in (
                self.counterpart_name,
                self.object_type_code,
                self.object_type_label,
                self.object_type_description,
                self.crossmatch_separation_arcsec,
                self.crossmatch_confidence,
            )
        ) or bool(self.counterpart_aliases)
        if self.crossmatch_catalog is None and metadata_present:
            raise ValueError("counterpart metadata requires crossmatch_catalog")
        if self.crossmatch_catalog == "SIMBAD":
            if (
                self.counterpart_name is None
                or self.crossmatch_separation_arcsec is None
                or self.crossmatch_confidence is None
            ):
                raise ValueError("SIMBAD metadata requires counterpart name, separation, and confidence")
            expected = "high" if self.crossmatch_separation_arcsec <= 2.0 else "caution"
            if self.crossmatch_confidence != expected:
                raise ValueError("crossmatch confidence does not match its separation")
        return self


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
    catalog: Literal["lofar_dr3", "vlass"] | None = None
    catalog_source_id: str | None = None
    total_flux_mjy: float | None = None
    peak_flux_mjy: float | None = None
    morphology_code: Literal["S", "M", "C", "E"] | None = None
    morphology_label: str | None = None
    morphology_description: str | None = None
    counterpart_name: str | None = None
    counterpart_aliases: list[str] = Field(default_factory=list)
    object_type_code: str | None = None
    object_type_label: str | None = None
    object_type_description: str | None = None
    crossmatch_separation_arcsec: float | None = None
    crossmatch_confidence: Literal["high", "caution"] | None = None
    crossmatch_catalog: Literal["SIMBAD"] | None = None
    duplicate_flag: int | None = None
    quality_flag: int | None = None
    main_sample: bool | None = None


class LofarMorphologyDefinition(ApiModel):
    code: Literal["S", "M", "C"]
    label: str
    description: str


class LofarSource(ApiModel):
    id: TargetIdentifier
    catalog: Literal["lofar_dr3"] = "lofar_dr3"
    source_id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    ra_deg: float
    dec_deg: float
    ra_hms: str
    dec_dms: str
    total_flux_mjy: float | None
    peak_flux_mjy: float | None
    morphology_code: Literal["S", "M", "C"] | None = None
    morphology_label: str | None = None
    morphology_description: str | None = None
    separation_arcmin: float | None = None
    counterpart_name: str | None = None
    counterpart_aliases: list[str] = Field(default_factory=list)
    object_type_code: str | None = None
    object_type_label: str | None = None
    object_type_description: str | None = None
    crossmatch_separation_arcsec: float | None = None
    crossmatch_confidence: Literal["high", "caution"] | None = None
    crossmatch_catalog: Literal["SIMBAD"] | None = None


class LofarSearchParameters(ApiModel):
    source_prefix: CatalogSourcePrefix | None = None
    sort_by: Literal["total_flux", "peak_flux"] = "total_flux"
    sort_direction: Literal["asc", "desc"] = "desc"
    limit: Literal[10, 25, 50, 100, 250, 500, 1000] = 100
    morphology_codes: list[Literal["S", "M", "C"]] = Field(
        default_factory=lambda: ["S", "M", "C"],
        min_length=1,
        max_length=3,
    )
    simbad_type_categories: list[SimbadTypeCategory] = Field(default_factory=list, max_length=10)

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

    @field_validator("morphology_codes")
    @classmethod
    def canonical_morphology_codes(
        cls,
        value: list[Literal["S", "M", "C"]],
    ) -> list[Literal["S", "M", "C"]]:
        if len(set(value)) != len(value):
            raise ValueError("morphology_codes must not contain duplicates")
        return [code for code in ("S", "M", "C") if code in value]

    @field_validator("simbad_type_categories")
    @classmethod
    def canonical_simbad_type_categories(
        cls,
        value: list[SimbadTypeCategory],
    ) -> list[SimbadTypeCategory]:
        if len(set(value)) != len(value):
            raise ValueError("simbad_type_categories must not contain duplicates")
        return [category for category in SIMBAD_TYPE_CATEGORY_ORDER if category in value]


class LofarSearchResponse(ApiModel):
    catalog: Literal["lofar_dr3"] = "lofar_dr3"
    catalog_release: str = "LoTSS DR3 v1.0"
    coordinate_frame: str = "icrs"
    reference_frequency_mhz: float = 144.0
    tap_mode: Literal["async"] = "async"
    search_mode: Literal["brightness"] = "brightness"
    center_ra_deg: None = None
    center_dec_deg: None = None
    radius_arcmin: None = None
    sort_by: Literal["total_flux", "peak_flux"]
    sort_direction: Literal["asc", "desc"]
    limit: int
    source_prefix: str | None
    morphology_codes: list[Literal["S", "M", "C"]] = Field(
        default_factory=lambda: ["S", "M", "C"],
    )
    simbad_type_categories: list[SimbadTypeCategory] = Field(default_factory=list)
    candidate_count: int = Field(ge=0)
    result_count: int
    sources: list[LofarSource]
    enrichment_status: Literal["complete", "partial", "unavailable"] = "complete"
    enrichment_warning: str | None = None
    morphology_codebook: list[LofarMorphologyDefinition] = Field(default_factory=list)


class LofarConeSearchParameters(ApiModel):
    ra_deg: float = Field(ge=0.0, lt=360.0)
    dec_deg: float = Field(ge=-90.0, le=90.0)
    radius_arcmin: float = Field(gt=0.0, le=60.0)
    sort_by: Literal["distance", "total_flux", "peak_flux"] = "distance"
    sort_direction: Literal["asc", "desc"] = "asc"
    limit: Literal[10, 25, 50, 100, 250, 500, 1000] = 100

    @field_validator("limit", mode="before")
    @classmethod
    def parse_query_string_limit(cls, value: object) -> object:
        if isinstance(value, str) and value.isdecimal():
            return int(value)
        return value


class LofarConeSearchResponse(ApiModel):
    catalog: Literal["lofar_dr3"] = "lofar_dr3"
    catalog_release: str = "LoTSS DR3 v1.0"
    coordinate_frame: str = "icrs"
    reference_frequency_mhz: float = 144.0
    tap_mode: Literal["async"] = "async"
    search_mode: Literal["cone"] = "cone"
    center_ra_deg: float
    center_dec_deg: float
    radius_arcmin: float
    sort_by: Literal["distance", "total_flux", "peak_flux"]
    sort_direction: Literal["asc", "desc"]
    limit: int
    source_prefix: None = None
    result_count: int
    sources: list[LofarSource]
    enrichment_status: Literal["complete", "partial", "unavailable"] = "complete"
    enrichment_warning: str | None = None
    morphology_codebook: list[LofarMorphologyDefinition] = Field(default_factory=list)


class VlassMorphologyDefinition(ApiModel):
    code: Literal["S", "M", "C", "E"]
    label: str
    description: str


class VlassSource(ApiModel):
    id: TargetIdentifier
    catalog: Literal["vlass"] = "vlass"
    source_id: CatalogSourceId
    name: str
    aliases: list[str] = Field(default_factory=list)
    ra_deg: float
    dec_deg: float
    ra_hms: str
    dec_dms: str
    total_flux_mjy: float | None
    peak_flux_mjy: float | None
    morphology_code: Literal["S", "M", "C", "E"] | None = None
    morphology_label: str | None = None
    morphology_description: str | None = None
    separation_arcmin: float | None = None
    duplicate_flag: int = Field(ge=0, le=2)
    quality_flag: int = Field(ge=0, le=7)
    main_sample: bool
    counterpart_name: str | None = None
    counterpart_aliases: list[str] = Field(default_factory=list)
    object_type_code: str | None = None
    object_type_label: str | None = None
    object_type_description: str | None = None
    crossmatch_separation_arcsec: float | None = None
    crossmatch_confidence: Literal["high", "caution"] | None = None
    crossmatch_catalog: Literal["SIMBAD"] | None = None


class VlassSearchParameters(ApiModel):
    source_prefix: VlassSourcePrefix | None = None
    sort_by: Literal["total_flux", "peak_flux"] = "total_flux"
    sort_direction: Literal["asc", "desc"] = "desc"
    limit: Literal[10, 25, 50, 100, 250, 500, 1000] = 100
    morphology_codes: list[Literal["S", "M", "C", "E"]] = Field(
        default_factory=lambda: ["S", "C", "M", "E"],
        min_length=1,
        max_length=4,
    )
    simbad_type_categories: list[SimbadTypeCategory] = Field(default_factory=list, max_length=10)
    recommended_only: bool = True

    @field_validator("limit", mode="before")
    @classmethod
    def parse_query_string_limit(cls, value: object) -> object:
        if isinstance(value, str) and value.isdecimal():
            return int(value)
        return value

    @field_validator("source_prefix", mode="before")
    @classmethod
    def empty_prefix_means_all_sources(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("morphology_codes")
    @classmethod
    def canonical_morphology_codes(
        cls,
        value: list[Literal["S", "M", "C", "E"]],
    ) -> list[Literal["S", "M", "C", "E"]]:
        if len(set(value)) != len(value):
            raise ValueError("morphology_codes must not contain duplicates")
        return [code for code in ("S", "C", "M", "E") if code in value]

    @field_validator("simbad_type_categories")
    @classmethod
    def canonical_simbad_type_categories(
        cls,
        value: list[SimbadTypeCategory],
    ) -> list[SimbadTypeCategory]:
        if len(set(value)) != len(value):
            raise ValueError("simbad_type_categories must not contain duplicates")
        return [category for category in SIMBAD_TYPE_CATEGORY_ORDER if category in value]


class VlassSearchResponse(ApiModel):
    catalog: Literal["vlass"] = "vlass"
    catalog_release: Literal["VLASS Epoch 1 Quick Look (Gordon et al. 2021)"] = (
        "VLASS Epoch 1 Quick Look (Gordon et al. 2021)"
    )
    coordinate_frame: str = "icrs"
    reference_frequency_mhz: float = 3000.0
    tap_mode: Literal["async"] = "async"
    search_mode: Literal["brightness"] = "brightness"
    center_ra_deg: None = None
    center_dec_deg: None = None
    radius_arcmin: None = None
    sort_by: Literal["total_flux", "peak_flux"]
    sort_direction: Literal["asc", "desc"]
    limit: int
    source_prefix: str | None
    morphology_codes: list[Literal["S", "M", "C", "E"]] = Field(
        default_factory=lambda: ["S", "C", "M", "E"],
    )
    simbad_type_categories: list[SimbadTypeCategory] = Field(default_factory=list)
    recommended_only: bool = True
    candidate_count: int = Field(ge=0)
    result_count: int
    sources: list[VlassSource]
    enrichment_status: Literal["complete", "partial", "unavailable"] = "complete"
    enrichment_warning: str | None = None
    morphology_codebook: list[VlassMorphologyDefinition] = Field(default_factory=list)


class VlassConeSearchParameters(ApiModel):
    ra_deg: float = Field(ge=0.0, lt=360.0)
    dec_deg: float = Field(ge=-90.0, le=90.0)
    radius_arcmin: float = Field(gt=0.0, le=60.0)
    sort_by: Literal["distance", "total_flux", "peak_flux"] = "distance"
    sort_direction: Literal["asc", "desc"] = "asc"
    limit: Literal[10, 25, 50, 100, 250, 500, 1000] = 100
    recommended_only: bool = True

    @field_validator("limit", mode="before")
    @classmethod
    def parse_query_string_limit(cls, value: object) -> object:
        if isinstance(value, str) and value.isdecimal():
            return int(value)
        return value


class VlassConeSearchResponse(ApiModel):
    catalog: Literal["vlass"] = "vlass"
    catalog_release: Literal["VLASS Epoch 1 Quick Look (Gordon et al. 2021)"] = (
        "VLASS Epoch 1 Quick Look (Gordon et al. 2021)"
    )
    coordinate_frame: str = "icrs"
    reference_frequency_mhz: float = 3000.0
    tap_mode: Literal["async"] = "async"
    search_mode: Literal["cone"] = "cone"
    center_ra_deg: float
    center_dec_deg: float
    radius_arcmin: float
    sort_by: Literal["distance", "total_flux", "peak_flux"]
    sort_direction: Literal["asc", "desc"]
    limit: int
    source_prefix: None = None
    recommended_only: bool = True
    result_count: int
    sources: list[VlassSource]
    enrichment_status: Literal["complete", "partial", "unavailable"] = "complete"
    enrichment_warning: str | None = None
    morphology_codebook: list[VlassMorphologyDefinition] = Field(default_factory=list)


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
