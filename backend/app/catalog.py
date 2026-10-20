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


# The original five coordinates are copied from references_2026/008.py and 009.py.
# New pulsar coordinates: NRAO GBT pulsar reference list
# https://www.gb.nrao.edu/GBT/spectrometer/spigot_card/novice.shtml
# New 3C calibrator coordinates: NRAO VLA calibrator list (J2000 entries)
# https://science.nrao.edu/facilities/vla/observing/callist
# Keep sexagesimal coordinates here for provenance and future catalog checks.
TARGETS: tuple[CatalogTarget, ...] = (
    CatalogTarget("3c123", "3C123", ("3C 123",), "04:37:04.38", "+29:40:13.86"),
    CatalogTarget("3c273", "3C273", ("3C 273",), "12:29:06.7", "+02:03:09"),
    CatalogTarget("3c433", "3C433", ("3C 433",), "21:23:44.557", "+25:04:28.04"),
    CatalogTarget("3c295", "3C295", ("3C 295",), "14:11:20.522", "+52:12:09.60"),
    CatalogTarget("3c134", "3C134", ("3C 134",), "05:04:04.20", "+38:06:11.0"),
    CatalogTarget(
        "b0329_54",
        "B0329+54 pulsar",
        ("PSR B0329+54", "PSR J0332+5434"),
        "03:32:59.3862",
        "+54:34:43.505",
    ),
    CatalogTarget(
        "crab_pulsar",
        "Crab pulsar",
        ("PSR B0531+21", "PSR J0534+2200"),
        "05:34:31.973",
        "+22:00:52.06",
    ),
    CatalogTarget("3c147", "3C147", ("3C 147",), "05:42:36.137916", "+49:51:07.23356"),
    CatalogTarget("3c48", "3C48", ("3C 48",), "01:37:41.299431", "+33:09:35.13299"),
)

TARGETS_BY_ID = {target.id: target for target in TARGETS}
