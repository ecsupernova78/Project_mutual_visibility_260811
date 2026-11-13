# FUS provisional digital-beam model

The two CSV files in this directory are exact copies of the user-provided
`FUS_beam_centers_model.csv` and `FUS_beam_cells_model.csv` from
`references_2026/BURSTT_FoV` (2026-11-13). They describe a **model**, not
measured half-power beam contours or a frequency-dependent sensitivity map.

The assumed beam numbering is `beam = 16 * iy_NS + ix_EW`, with 0-based
indices and an inferred `b0 = -7.5`. The sign of the array's 3-degree
misalignment, operational offsets, disabled beams, and actual beam response
remain unverified. The visualization deliberately does not apply a further
3-degree rotation to these supplied local Az/El coordinates.

The API uses the cell polygons as a rough non-overlapping coverage model. A
source inside any modeled cell is marked in the FUS FoV. This is *not* a
detection or sensitivity prediction, and the cells may be replaced when
calibrated station data become available.
