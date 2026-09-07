"""FastAPI application entry point."""

from __future__ import annotations

import os
from typing import Annotated

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.catalog import TARGETS
from app.lotss_dr3 import (
    LofarCatalogBusy,
    LofarCatalogError,
    LofarCatalogTimeout,
    LofarSearch,
    LofarSimbadFilterUnavailable,
    catalog_query_coordinator,
    filter_simbad_type_categories,
)
from app.models import (
    HealthResponse,
    LofarConeSearchParameters,
    LofarConeSearchResponse,
    LofarSearchParameters,
    LofarSearchResponse,
    TargetCatalogItem,
    TargetCatalogResponse,
    VisibilityRequest,
    VisibilityResponse,
    VlassConeSearchParameters,
    VlassConeSearchResponse,
    VlassSearchParameters,
    VlassSearchResponse,
)
from app.visibility import calculate_visibility
from app.vlass import (
    VlassCatalogBusy,
    VlassCatalogError,
    VlassCatalogTimeout,
    VlassSearch,
    VlassSimbadFilterUnavailable,
    vlass_catalog_query_coordinator,
)
from app.vlass import (
    filter_simbad_type_categories as filter_vlass_simbad_type_categories,
)


def _cors_origins() -> list[str]:
    configured = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    return [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]


app = FastAPI(
    title="Mutual Visibility API",
    version=__version__,
    description=(
        "Altitude series for celestial targets observed from one to three locations, "
        "with common visibility evaluated across every selected location."
    ),
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins(),
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


@app.get("/health", response_model=HealthResponse, tags=["system"])
def health() -> HealthResponse:
    return HealthResponse(status="ok", version=__version__)


@app.get("/api/v1/targets", response_model=TargetCatalogResponse, tags=["catalog"])
def list_targets() -> TargetCatalogResponse:
    return TargetCatalogResponse(
        targets=[
            TargetCatalogItem(
                id=target.id,
                name=target.name,
                aliases=list(target.aliases),
                ra_hms=target.ra_hms,
                dec_dms=target.dec_dms,
                ra_deg=round(float(target.coordinate.ra.deg), 9),
                dec_deg=round(float(target.coordinate.dec.deg), 9),
            )
            for target in TARGETS
        ]
    )


@app.get(
    "/api/v1/catalogs/lotss-dr3/sources",
    response_model=LofarSearchResponse,
    tags=["catalog"],
)
async def search_lotss_dr3_sources(
    params: Annotated[LofarSearchParameters, Query()],
) -> LofarSearchResponse:
    """Browse the public LoTSS DR3 source table through a restricted async TAP adapter."""

    try:
        response = await catalog_query_coordinator.search(
            LofarSearch(
                source_prefix=params.source_prefix,
                sort_by=params.sort_by,
                sort_direction=params.sort_direction,
                limit=params.limit,
                morphology_codes=frozenset(params.morphology_codes),
            )
        )
        if not isinstance(response, LofarSearchResponse):
            raise LofarCatalogError("catalog coordinator returned the wrong response type")
        return filter_simbad_type_categories(response, params.simbad_type_categories)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except LofarCatalogBusy as error:
        raise HTTPException(
            status_code=429,
            detail="Too many LOFAR DR3 catalog searches are already running. Please try again shortly.",
            headers={"Retry-After": "5"},
        ) from error
    except LofarCatalogTimeout as error:
        raise HTTPException(
            status_code=504,
            detail="The LOFAR DR3 catalog did not respond before the request timeout.",
        ) from error
    except LofarSimbadFilterUnavailable as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "SIMBAD physical-type filtering is temporarily unavailable. "
                "Try again later or select All physical types."
            ),
        ) from error
    except LofarCatalogError as error:
        raise HTTPException(
            status_code=502,
            detail="The LOFAR DR3 catalog is temporarily unavailable or returned an invalid response.",
        ) from error


@app.get(
    "/api/v1/catalogs/lotss-dr3/cone",
    response_model=LofarConeSearchResponse,
    tags=["catalog"],
)
async def cone_search_lotss_dr3_sources(
    params: Annotated[LofarConeSearchParameters, Query()],
) -> LofarConeSearchResponse:
    """Find LoTSS DR3 sources inside a validated ICRS cone through async TAP."""

    try:
        response = await catalog_query_coordinator.search(
            LofarSearch(
                source_prefix=None,
                sort_by=params.sort_by,
                sort_direction=params.sort_direction,
                limit=params.limit,
                mode="cone",
                ra_deg=params.ra_deg,
                dec_deg=params.dec_deg,
                radius_arcmin=params.radius_arcmin,
            )
        )
        if not isinstance(response, LofarConeSearchResponse):
            raise LofarCatalogError("catalog coordinator returned the wrong response type")
        return response
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except LofarCatalogBusy as error:
        raise HTTPException(
            status_code=429,
            detail="Too many LOFAR DR3 catalog searches are already running. Please try again shortly.",
            headers={"Retry-After": "5"},
        ) from error
    except LofarCatalogTimeout as error:
        raise HTTPException(
            status_code=504,
            detail="The LOFAR DR3 catalog did not respond before the request timeout.",
        ) from error
    except LofarCatalogError as error:
        raise HTTPException(
            status_code=502,
            detail="The LOFAR DR3 catalog is temporarily unavailable or returned an invalid response.",
        ) from error


@app.get(
    "/api/v1/catalogs/vlass/sources",
    response_model=VlassSearchResponse,
    tags=["catalog"],
)
async def search_vlass_sources(
    params: Annotated[VlassSearchParameters, Query()],
) -> VlassSearchResponse:
    """Browse the published VLASS Epoch 1 Quick Look component table through VizieR TAP."""

    try:
        response = await vlass_catalog_query_coordinator.search(
            VlassSearch(
                source_prefix=params.source_prefix,
                sort_by=params.sort_by,
                sort_direction=params.sort_direction,
                limit=params.limit,
                morphology_codes=frozenset(params.morphology_codes),
                recommended_only=params.recommended_only,
            )
        )
        if not isinstance(response, VlassSearchResponse):
            raise VlassCatalogError("catalog coordinator returned the wrong response type")
        return filter_vlass_simbad_type_categories(response, params.simbad_type_categories)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except VlassCatalogBusy as error:
        raise HTTPException(
            status_code=429,
            detail="Too many VLASS catalog searches are already running. Please try again shortly.",
            headers={"Retry-After": "5"},
        ) from error
    except VlassCatalogTimeout as error:
        raise HTTPException(
            status_code=504,
            detail="The VLASS catalog did not respond before the request timeout.",
        ) from error
    except VlassSimbadFilterUnavailable as error:
        raise HTTPException(
            status_code=502,
            detail=(
                "SIMBAD physical-type filtering is temporarily unavailable. "
                "Try again later or select All physical types."
            ),
        ) from error
    except VlassCatalogError as error:
        raise HTTPException(
            status_code=502,
            detail="The VLASS catalog is temporarily unavailable or returned an invalid response.",
        ) from error


@app.get(
    "/api/v1/catalogs/vlass/cone",
    response_model=VlassConeSearchResponse,
    tags=["catalog"],
)
async def cone_search_vlass_sources(
    params: Annotated[VlassConeSearchParameters, Query()],
) -> VlassConeSearchResponse:
    """Find published VLASS Epoch 1 Quick Look components inside a validated ICRS cone."""

    try:
        response = await vlass_catalog_query_coordinator.search(
            VlassSearch(
                source_prefix=None,
                sort_by=params.sort_by,
                sort_direction=params.sort_direction,
                limit=params.limit,
                mode="cone",
                ra_deg=params.ra_deg,
                dec_deg=params.dec_deg,
                radius_arcmin=params.radius_arcmin,
                recommended_only=params.recommended_only,
            )
        )
        if not isinstance(response, VlassConeSearchResponse):
            raise VlassCatalogError("catalog coordinator returned the wrong response type")
        return response
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except VlassCatalogBusy as error:
        raise HTTPException(
            status_code=429,
            detail="Too many VLASS catalog searches are already running. Please try again shortly.",
            headers={"Retry-After": "5"},
        ) from error
    except VlassCatalogTimeout as error:
        raise HTTPException(
            status_code=504,
            detail="The VLASS catalog did not respond before the request timeout.",
        ) from error
    except VlassCatalogError as error:
        raise HTTPException(
            status_code=502,
            detail="The VLASS catalog is temporarily unavailable or returned an invalid response.",
        ) from error


@app.post(
    "/api/v1/visibility/altitude-series",
    response_model=VisibilityResponse,
    tags=["visibility"],
)
def altitude_series(request: VisibilityRequest) -> VisibilityResponse:
    return calculate_visibility(request)
