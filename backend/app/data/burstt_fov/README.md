# BURSTT assignment-cell data

Source: `references_2026/BURSTT_FoV/BeamViz_SiteBeams_261113` (2026-11-13).
The application CSVs retain every field of the corresponding site rows from
`beam_centers.csv` and `beam_contours.csv`. The original response package,
including provenance, validation results and model scripts, is retained.

## FUS

`FUS_beam_centers_verified.csv`: 256 centres.
`FUS_beam_cells_verified.csv`: 256 closed cells, 49 vertices each.
Operational-code model, checked against 188,798 triggers with 99.3% joint
EW/NS ID agreement. Validation interval: 2025-03-30 through
2026-07-04T07:59:54Z; other dates assume that same mode. Sky coordinates
already include the verified -3 degree rotation, so no second rotation is
applied to polygons. Source directions are inverse-rotated for assignment.
Grid reference: 400 MHz; beam ID = 16 * iy_NS + ix_EW, b0 = -7.5.
The current nominal hardware band (300-700 MHz) is distinct from the grid
reference and the effective search band, which remains unknown.
The earlier `*_model.csv` files are retained for provenance but not loaded.

## PYC

`PYC_beam_centers_hypothesis.csv`: 16 EW direction cosines, no point centres.
`PYC_beam_strips_hypothesis.csv`: 16 closed fan strips, 121 vertices each.
Enabled at the user's request on 2026-11-13 as a **hypothesis**, displayed
as such. Assumes b0=-7.5, p=0 west, 400 MHz reference and -0.23 degree
rotation (already included in supplied sky contours). No NS digital stage.
Five recorded Crab events match; selection may have used the same model,
so this does not validate operational FPGA b0, numbering or BFM ID.
Strips run from horizon to horizon and are not clipped by the primary beam.
The approximate 12 degree south mechanical tilt and 90 degree NS primary
FWHM do not define digital strip boundaries or an assured detection area.

## Membership and limitations

Azimuth is clockwise from North. Plot x/y use the azimuthal equidistant
projection EW=(90-El)*sin(Az), NS=(90-El)*cos(Az). The axis ticks are these
projected components, not constant-azimuth or constant-altitude angles.
The spherical grid uses altitude circles and azimuth spokes.
Internal boundary ties choose the larger index (east/north); both outer
edges are closed. Outside the footprint or below the horizon gives no ID.
For PYC only EW is used. `in_fov` and common masks mean geometric membership
for these models, not power, FWHM, primary-beam or detection coverage.
Active masks and effective search bands are unknown.

LTN and OGW have no imported digital model. LTN needs EW direction/reference
wavelength and dated NS steering. OGW-32 needs geometry, pointing and beam
configuration; its displayed nominal ellipse retains legacy OGW-16 planning
parameters, explicitly recorded in the profile note.
