"""FastAPI application entry point."""

from __future__ import annotations

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.catalog import TARGETS
from app.models import (
    HealthResponse,
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
    description="Altitude series for celestial targets observed from exactly two locations.",
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


@app.post(
    "/api/v1/visibility/altitude-series",
    response_model=VisibilityResponse,
    tags=["visibility"],
)
def altitude_series(request: VisibilityRequest) -> VisibilityResponse:
    return calculate_visibility(request)
