"""Build the pinned ATNF v2.9.0 app snapshot from the official PSRCAT tarball.

The handoff ingester derives the astronomical fields. This wrapper protects
400/600/800 MHz estimates from unstable two-point extrapolation: if the
inferred spectral index is outside [-4, +2], it uses the documented -1.6
population default from the nearest measured frequency and labels the result
``alpha_default``. Original S* catalogue measurements remain unchanged.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import psrcat_ingest as base

VERSION = "2.9.0"
OFFICIAL_URL = f"https://www.atnf.csiro.au/research/pulsar/psrcat/downloads/psrcat_pkg.v{VERSION}.tar.gz"
EXPECTED_SHA256 = "00310698cf681413273e92232d97cdb8f8a8b1cd2edcdcbafcc433cb89d45ccc"
SLOPE_MIN = -4.0
SLOPE_MAX = 2.0
FREQUENCIES = (400.0, 600.0, 800.0)


def build_snapshot(tarball: Path, output_dir: Path, minimum_count: int = 4000) -> dict:
    digest = base.sha256_of(str(tarball))
    if digest != EXPECTED_SHA256:
        raise ValueError(f"ATNF v{VERSION} tarball SHA-256 changed: {digest}")
    text, members = base.read_db_from_tarball(str(tarball))
    rows, raws, meta, columns = base.build(text, OFFICIAL_URL, FREQUENCIES, members, digest)
    if meta["catalogue_version"] != VERSION or meta["n_pulsars"] < minimum_count:
        raise ValueError("ATNF snapshot has an unexpected version or too few pulsars")
    _, records, _ = base.parse_psrcat_db(text)
    if len(records) != len(rows):
        raise ValueError("ATNF raw and curated record counts differ")

    counts = {str(int(frequency)): 0 for frequency in FREQUENCIES}
    affected: set[str] = set()
    for row, raw in zip(rows, records, strict=True):
        points = base.flux_points(raw)
        for frequency in FREQUENCIES:
            key = str(int(frequency))
            if row[f"s_est_{key}_method"] != "extrap_two_point":
                continue
            nearest = sorted(points, key=lambda item: abs(math.log(item[0] / frequency)))[:2]
            (frequency0, flux0), (frequency1, flux1) = nearest
            slope = math.log(flux1 / flux0) / math.log(frequency1 / frequency0)
            if math.isfinite(slope) and SLOPE_MIN <= slope <= SLOPE_MAX:
                continue
            row[f"s_est_{key}_mjy"] = flux0 * (frequency / frequency0) ** base.DEFAULT_SPECTRAL_INDEX
            row[f"s_est_{key}_method"] = "alpha_default"
            counts[key] += 1
            affected.add(row["jname"])

    meta["flux_extrapolation_guard"] = {
        "policy": "two_point_slope_outside_range_uses_nearest_value_with_alpha_default",
        "min_spectral_index": SLOPE_MIN,
        "max_spectral_index": SLOPE_MAX,
        "fallback_spectral_index": base.DEFAULT_SPECTRAL_INDEX,
        "changed_estimate_counts_by_mhz": counts,
        "affected_pulsars": len(affected),
        "raw_measured_flux_unchanged": True,
    }
    base.write_outputs(str(output_dir), rows, raws, meta, columns)
    return meta


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tarball", required=True, type=Path)
    parser.add_argument("--out", type=Path, default=Path(__file__).resolve().parents[1] / "app" / "data" / "atnf")
    parser.add_argument("--min-count", type=int, default=4000)
    arguments = parser.parse_args()
    meta = build_snapshot(arguments.tarball, arguments.out, arguments.min_count)
    print(
        f"ATNF {meta['catalogue_version']}: {meta['n_pulsars']} pulsars; "
        f"flux slope guard {meta['flux_extrapolation_guard']['changed_estimate_counts_by_mhz']}"
    )


if __name__ == "__main__":
    main()
