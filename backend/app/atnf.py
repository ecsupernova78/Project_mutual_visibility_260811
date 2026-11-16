"""Pinned ATNF Pulsar Catalogue v2.9.0 search over curated local data.

The derived coordinates and flux estimates come from the handoff ingester. No
request-time access to the ATNF web form or other external service is made.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.models import (
    ATNF_CATALOGUE_CITATION,
    AtnfConeSearchParameters,
    AtnfSearchParameters,
    AtnfSearchResponse,
    AtnfSource,
)

DATA_DIR = Path(__file__).resolve().parent / "data" / "atnf"
VERSION = "2.9.0"
SOURCE_URL = "https://www.atnf.csiro.au/research/pulsar/psrcat/downloads/psrcat_pkg.v2.9.0.tar.gz"


def normalize_name(value: str) -> str:
    """Normalize PSR, case, spaces, and common Unicode minus signs."""
    normalized = value.strip().upper().replace("−", "-").replace("–", "-")
    normalized = re.sub(r"^PSR\s*", "", normalized)
    return re.sub(r"\s+", "", normalized)


def _name_keys(row: dict[str, Any]) -> frozenset[str]:
    keys: set[str] = set()
    for field in ("jname", "bname"):
        raw_name = row.get(field)
        if not raw_name:
            continue
        name = normalize_name(raw_name)
        variants = {name, name[:-2]} if name.endswith("_P") else {name}
        keys.update(variants)
        keys.update(variant[1:] for variant in variants if variant.startswith(("J", "B")))
    return frozenset(keys)


def _unit_vector(ra_deg: float, dec_deg: float) -> tuple[float, float, float]:
    ra = math.radians(ra_deg)
    dec = math.radians(dec_deg)
    return math.cos(dec) * math.cos(ra), math.cos(dec) * math.sin(ra), math.sin(dec)


def _angular_separation_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    """Vincenty great-circle distance, stable across RA wrap and at the poles."""
    a1, d1, a2, d2 = map(math.radians, (ra1, dec1, ra2, dec2))
    delta = a2 - a1
    numerator = math.hypot(
        math.cos(d2) * math.sin(delta),
        math.cos(d1) * math.sin(d2) - math.sin(d1) * math.cos(d2) * math.cos(delta),
    )
    denominator = math.sin(d1) * math.sin(d2) + math.cos(d1) * math.cos(d2) * math.cos(delta)
    return math.degrees(math.atan2(numerator, denominator))


def _source_id(jname: str) -> str:
    digest = hashlib.blake2s(jname.encode("utf-8"), digest_size=10).hexdigest()
    return f"atnf-{digest}"


class AtnfCatalog:
    def __init__(self, rows: list[dict[str, Any]], meta: dict[str, Any]) -> None:
        if meta.get("catalogue_version") != VERSION or meta.get("n_pulsars") != len(rows) or len(rows) < 4_000:
            raise ValueError("ATNF snapshot has an unexpected version or row count")
        if meta.get("citation") != ATNF_CATALOGUE_CITATION:
            raise ValueError("ATNF snapshot has an unexpected citation")
        jnames = [row.get("jname") for row in rows]
        if any(not name for name in jnames) or len(set(jnames)) != len(rows):
            raise ValueError("ATNF snapshot contains missing or duplicate J names")
        self.rows = rows
        self.meta = meta
        self.keys = [_name_keys(row) for row in rows]
        self.vectors = [
            _unit_vector(row["ra_deg"], row["dec_deg"])
            if row.get("ra_deg") is not None and row.get("dec_deg") is not None
            else None
            for row in rows
        ]

    @classmethod
    def from_data_dir(cls, path: Path = DATA_DIR) -> AtnfCatalog:
        with (path / "atnf_psrcat_meta.json").open(encoding="utf-8") as file:
            meta = json.load(file)
        with (path / "atnf_psrcat.json").open(encoding="utf-8") as file:
            rows = json.load(file)
        return cls(rows, meta)

    @staticmethod
    def _passes(row: dict[str, Any], params: AtnfSearchParameters | AtnfConeSearchParameters) -> bool:
        # Rows without a position remain in the pinned data but cannot be
        # imported as visibility targets or placed on the plot.
        if row.get("ra_deg") is None or row.get("dec_deg") is None:
            return False
        if not params.include_coarse and row.get("pos_coarse"):
            return False
        if not params.include_provisional and row.get("provisional"):
            return False
        for field, lower, upper in (
            ("dm", params.dm_min, params.dm_max),
            ("p0_s", params.p0_min, params.p0_max),
        ):
            value = row.get(field)
            if (lower is not None or upper is not None) and (
                value is None or (lower is not None and value < lower) or (upper is not None and value > upper)
            ):
                return False
        flux = row.get(f"s_est_{params.flux_frequency_mhz}_mjy")
        if params.min_flux_mjy is not None and (flux is None or flux < params.min_flux_mjy):
            return False
        if params.type_code is not None:
            types = set((row.get("type_codes") or "").upper().split(","))
            if params.type_code.upper() not in types:
                return False
        if params.is_binary is not None and bool(row.get("is_binary")) != params.is_binary:
            return False
        return params.is_msp is None or bool(row.get("is_msp")) == params.is_msp

    @staticmethod
    def _sort_rows(
        hits: list[tuple[dict[str, Any], float | None, bool]],
        params: AtnfSearchParameters | AtnfConeSearchParameters,
    ) -> None:
        descending = params.sort_direction == "desc"
        if params.sort_by == "name":
            hits.sort(key=lambda item: (item[0].get("name") or item[0]["jname"]).upper(), reverse=descending)
        elif params.sort_by == "distance":
            hits.sort(key=lambda item: item[1] if item[1] is not None else math.inf, reverse=descending)
        else:
            field = f"s_est_{params.flux_frequency_mhz}_mjy" if params.sort_by == "flux" else "dm"
            hits.sort(
                key=lambda item: (
                    item[0].get(field) is None,
                    -(item[0].get(field) or 0.0) if descending else (item[0].get(field) or 0.0),
                    item[0]["jname"],
                )
            )
        # An exact J/B alias match remains first even if the secondary sort
        # requested by the user is flux or DM.
        if params.name:
            hits.sort(key=lambda item: not item[2])

    def _as_source(self, row: dict[str, Any], frequency_mhz: int, separation_deg: float | None) -> AtnfSource:
        name = row.get("name") or row["jname"]
        aliases = list(dict.fromkeys(n for n in (row.get("jname"), row.get("bname")) if n and n != name))
        return AtnfSource(
            id=_source_id(row["jname"]),
            source_id=row["jname"],
            catalogue_version=self.meta["catalogue_version"],
            catalogue_citation=self.meta["citation"],
            name=name,
            aliases=aliases,
            ra_deg=row["ra_deg"],
            dec_deg=row["dec_deg"],
            ra_hms=row["raj"],
            dec_dms=row["decj"],
            total_flux_mjy=row.get(f"s_est_{frequency_mhz}_mjy"),
            flux_frequency_mhz=frequency_mhz,
            flux_method=row.get(f"s_est_{frequency_mhz}_method") or "none",
            s_est_400_mjy=row.get("s_est_400_mjy"),
            s_est_400_method=row.get("s_est_400_method") or "none",
            s_est_600_mjy=row.get("s_est_600_mjy"),
            s_est_600_method=row.get("s_est_600_method") or "none",
            s_est_800_mjy=row.get("s_est_800_mjy"),
            s_est_800_method=row.get("s_est_800_method") or "none",
            dm=row.get("dm"),
            p0_s=row.get("p0_s"),
            pos_source=row["pos_source"],
            pos_unc_arcsec=row.get("pos_unc_arcsec"),
            pos_unc_kind=row.get("pos_unc_kind"),
            pos_coarse=bool(row.get("pos_coarse")),
            provisional=bool(row.get("provisional")),
            type_codes=row.get("type_codes"),
            is_binary=bool(row.get("is_binary")),
            is_msp=bool(row.get("is_msp")),
            dist_kpc=row.get("dist_kpc"),
            dist_method=row.get("dist_method"),
            discovery_survey=row.get("discovery_survey"),
            separation_arcmin=separation_deg * 60.0 if separation_deg is not None else None,
        )

    def search(self, params: AtnfSearchParameters | AtnfConeSearchParameters) -> AtnfSearchResponse:
        cone = isinstance(params, AtnfConeSearchParameters)
        query = normalize_name(params.name) if params.name else None
        center_vector = _unit_vector(params.ra_deg, params.dec_deg) if cone else None
        cone_cosine = math.cos(math.radians(params.radius_arcmin / 60.0)) if cone else None
        hits: list[tuple[dict[str, Any], float | None, bool]] = []
        for row, keys, vector in zip(self.rows, self.keys, self.vectors, strict=True):
            if not self._passes(row, params):
                continue
            exact = query in keys if query else False
            if query and not exact and not any(query in key for key in keys):
                continue
            separation_deg: float | None = None
            if cone:
                if vector is None or center_vector is None or cone_cosine is None:
                    continue
                dot = sum(left * right for left, right in zip(vector, center_vector, strict=True))
                if dot < cone_cosine - 1e-15:
                    continue
                separation_deg = _angular_separation_deg(params.ra_deg, params.dec_deg, row["ra_deg"], row["dec_deg"])
                if separation_deg > params.radius_arcmin / 60.0:
                    continue
            hits.append((row, separation_deg, exact))
        self._sort_rows(hits, params)
        selected = hits[: params.limit]
        return AtnfSearchResponse(
            catalogue_version=self.meta["catalogue_version"],
            citation=self.meta["citation"],
            search_mode="cone" if cone else "brightness",
            center_ra_deg=params.ra_deg if cone else None,
            center_dec_deg=params.dec_deg if cone else None,
            radius_arcmin=params.radius_arcmin if cone else None,
            name=params.name,
            sort_by=params.sort_by,
            sort_direction=params.sort_direction,
            limit=params.limit,
            reference_frequency_mhz=params.flux_frequency_mhz,
            candidate_count=len(hits),
            result_count=len(selected),
            sources=[self._as_source(row, params.flux_frequency_mhz, separation) for row, separation, _ in selected],
        )


@lru_cache(maxsize=1)
def get_atnf_catalog() -> AtnfCatalog:
    return AtnfCatalog.from_data_dir()
