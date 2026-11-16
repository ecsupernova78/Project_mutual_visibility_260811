# ATNF Pulsar Catalogue snapshot

This directory contains a pinned, locally searchable snapshot of the official ATNF Pulsar Catalogue v2.9.0. The official [PSRCAT release tarball](https://www.atnf.csiro.au/research/pulsar/psrcat/downloads/psrcat_pkg.v2.9.0.tar.gz) has SHA-256 `00310698cf681413273e92232d97cdb8f8a8b1cd2edcdcbafcc433cb89d45ccc`. The API reads `atnf_psrcat.json` and `atnf_psrcat_meta.json` at runtime. The CSV, slim JSON, and full raw JSON archive are generated companion files. No user search calls the ATNF website.

To regenerate from the pinned source in the project root:

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
Invoke-WebRequest -Uri 'https://www.atnf.csiro.au/research/pulsar/psrcat/downloads/psrcat_pkg.v2.9.0.tar.gz' -OutFile '.cache/psrcat_pkg.v2.9.0.tar.gz'
py -3 backend/scripts/build_atnf_snapshot.py --tarball .cache/psrcat_pkg.v2.9.0.tar.gz --out backend/app/data/atnf --min-count 4000
```

`backend/scripts/psrcat_ingest.py` is the handoff parser copied from `references_2026/atnf_psrcat_handoff/scripts/psrcat_ingest.py`. The app wrapper checks the exact tarball hash, version, and minimum record count before writing. To move to another release, update the pinned version/hash in the wrapper after reviewing the new official file and rerun the real-data acceptance tests.

The parsed release has 4,503 pulsars, all with a usable position, including 241 positions derived from ecliptic coordinates; 814 names carry the provisional `_P` suffix and 659 positions are flagged coarse. The parser reports 23,325 repeated parameters, primarily 21,766 repeated `S1284` measurements across 628 pulsars. As documented by the handoff parser, the last value of a repeated parameter is retained, matching psrqpy behaviour. B0329+54 and the Crab agree with the expected coordinates, DM, and period; the Crab cone search returns `J0534+2200` first.

Catalogued `S400`, `S600`, and other `S*` measurements are preserved. The `s_est_400/600/800_mjy` values are mean flux estimates, not guaranteed detectability or sensitivity. Their method is recorded for every row. In particular, extrapolating two very close high-frequency measurements could produce extreme values in the BURSTT band. The app wrapper substitutes the documented population index α = −1.6 from the nearest measured flux when the inferred two-point index is outside [−4, +2], and labels that estimate `alpha_default`. This changed 88, 119, and 118 estimates at 400, 600, and 800 MHz respectively; the detailed policy and counts are stored in `atnf_psrcat_meta.json`. The original measured values are unchanged. Searches can include all positions by default or exclude coarse and provisional rows.

Please cite Manchester et al. (2005), AJ 129, 1993, and the [ATNF Pulsar Catalogue](https://www.atnf.csiro.au/research/pulsar/psrcat/). The original parameter references are retained in `atnf_psrcat_full.json.gz`.
