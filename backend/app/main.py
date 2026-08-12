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
    catalog_query_coordinator,
)
from app.models import (
    HealthResponse,
    LofarSearchParameters,
    LofarSearchResponse,
    TargetCatalogItem,
    TargetCatalogResponse,
    VisibilityRequest,
    VisibilityResponse,
)
from app.visibility import calculate_visibility


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
        return await catalog_query_coordinator.search(
            LofarSearch(
                source_prefix=params.source_prefix,
                sort_by=params.sort_by,
                sort_direction=params.sort_direction,
                limit=params.limit,
            )
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except LofarCatalogBusy as error:
        raise HTTPException(
            status_code=429,
            detail="LOFAR DR3 검색 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
            headers={"Retry-After": "5"},
        ) from error
    except LofarCatalogTimeout as error:
        raise HTTPException(
            status_code=504,
            detail="LOFAR DR3 카탈로그가 제한 시간 안에 응답하지 않았습니다.",
        ) from error
    except LofarCatalogError as error:
        raise HTTPException(
            status_code=502,
            detail="LOFAR DR3 카탈로그를 일시적으로 이용할 수 없거나 응답 형식이 올바르지 않습니다.",
        ) from error


@app.post(
    "/api/v1/visibility/altitude-series",
    response_model=VisibilityResponse,
    tags=["visibility"],
)
def altitude_series(request: VisibilityRequest) -> VisibilityResponse:
    return calculate_visibility(request)
