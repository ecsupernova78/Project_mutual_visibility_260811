"""Small, version-controlled target catalog derived from the reference scripts."""

from __future__ import annotations

from dataclasses import dataclass

from astropy import units as u
from astropy.coordinates import SkyCoord


@dataclass(frozen=True, slots=True)
class CatalogTarget:
    """A fixed ICRS target used by the first visibility prototype."""

    id: str
    name: str
    aliases: tuple[str, ...]
    ra_hms: str
    dec_dms: str

    @property
    def coordinate(self) -> SkyCoord:
        return SkyCoord(
            ra=self.ra_hms,
            dec=self.dec_dms,
            unit=(u.hourangle, u.deg),
            frame="icrs",
        )


# Coordinates are copied from references_2026/008.py and 009.py. Keeping their
# sexagesimal representation here makes provenance and future catalog checks easy.
TARGETS: tuple[CatalogTarget, ...] = (
    CatalogTarget("3c123", "3C123", ("3C 123",), "04:37:04.38", "+29:40:13.86"),
    CatalogTarget("3c273", "3C273", ("3C 273",), "12:29:06.7", "+02:03:09"),
    CatalogTarget("3c433", "3C433", ("3C 433",), "21:23:44.557", "+25:04:28.04"),
    CatalogTarget("3c295", "3C295", ("3C 295",), "14:11:20.522", "+52:12:09.60"),
    CatalogTarget("3c134", "3C134", ("3C 134",), "05:04:04.20", "+38:06:11.0"),
)

TARGETS_BY_ID = {target.id: target for target in TARGETS}
