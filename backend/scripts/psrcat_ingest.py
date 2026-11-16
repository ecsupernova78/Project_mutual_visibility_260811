#!/usr/bin/env python3
"""
psrcat_ingest.py -- turn the ATNF Pulsar Catalogue (psrcat.db) into flat files
for the Mutual Visibility web monitor.

Pure standard library (Python >= 3.8). No numpy / astropy needed at runtime.

Typical use
-----------
  # latest release straight from ATNF
  python psrcat_ingest.py --out data/atnf

  # pinned release (reproducible)
  python psrcat_ingest.py --version 2.9.0 --out data/atnf

  # already-downloaded tarball or extracted psrcat.db
  python psrcat_ingest.py --tarball psrcat_pkg.tar.gz --out data/atnf
  python psrcat_ingest.py --db psrcat_tar/psrcat.db --out data/atnf

Outputs (in --out)
------------------
  atnf_psrcat.csv            curated, one row per pulsar (columns: see COLUMNS)
  atnf_psrcat.json           same rows as a JSON array (null for missing)
  atnf_psrcat_full.json.gz   every raw parameter: {PARAM: {value, err, err_raw, ref}}
  atnf_psrcat_slim.json      columnar subset (positioned pulsars only) for a map layer
  atnf_psrcat_meta.json      version, counts, sha256, source, citation, timestamps

Format notes (psrcat.db, "v1" text format shipped inside psrcat_pkg.tar.gz)
-----------------------------------------------------------------------------
  * '#' lines are comments; the first one containing 'CATALOGUE' carries the
    version as its last token. Lines starting with 'WARNING' are also comments.
  * A line starting with '@' ends the current pulsar record.
  * Data lines:  PARAM  VALUE  [ERROR]  [REF]   (whitespace separated)
    - 3rd token is an ERROR if it parses as a number, else a REF.
  * ERROR convention (same as psrqpy): an integer error is in units of the last
    quoted digit of VALUE (e.g. "1.2345  6" -> 0.0006). An error that contains
    '.' or starts with '-' is already absolute. For RAJ/DECJ the "units" are
    those of the LAST sexagesimal field (seconds of time / arcsec / ...).
  * Only "raw" parameters are stored. RAJD/DECJD, GL/GB, DIST, P0<->F0 etc. are
    DERIVED here (the psrcat CLI and psrqpy derive them the same way).
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import gzip
import hashlib
import io
import json
import math
import os
import re
import sys
import tarfile
import urllib.request

PARSER_VERSION = "1.0.0"

ATNF_BASE_URL = "https://www.atnf.csiro.au/research/pulsar/psrcat/"
ATNF_TARBALL = ATNF_BASE_URL + "downloads/psrcat_pkg.tar.gz"
ATNF_VERSION_TARBALL = ATNF_BASE_URL + "downloads/psrcat_pkg.v{}.tar.gz"

CITATION = (
    "Manchester, R. N., Hobbs, G. B., Teoh, A. & Hobbs, M., AJ, 129, 1993-2006 "
    "(2005), astro-ph/0412641; ATNF Pulsar Catalogue "
    "https://www.atnf.csiro.au/research/pulsar/psrcat"
)

# Mean pulsar spectral index used ONLY as a last-resort fallback for flux
# extrapolation (Jankowski et al. 2018, MNRAS 473, 4436: <alpha> = -1.60 +/- 0.54).
DEFAULT_SPECTRAL_INDEX = -1.6

# Frequencies (MHz) at which an estimated flux density is reported.
# BURSTT: band 400-800 MHz, FRB search band 400-700 MHz.
DEFAULT_EST_FREQS_MHZ = (400.0, 600.0, 800.0)

# Position uncertainty above which a position is flagged "coarse".
COARSE_POS_ARCSEC = 60.0

# Mean obliquity of the ecliptic at J2000 (IAU 2006), arcsec.
OBLIQUITY_J2000_ARCSEC = 84381.406

# ICRS (~J2000) -> Galactic rotation matrix (Hipparcos / ESA 1997 definition).
_EQ2GAL = (
    (-0.0548755604162154, -0.8734370902348850, -0.4838350155487132),
    (+0.4941094278755837, -0.4448296299600112, +0.7469822444972189),
    (-0.8676661490190047, -0.1980763734312015, +0.4559837761750669),
)

_FLUX_KEY_RE = re.compile(r"^S(\d+)(G?)$")  # S400, S1400, S10G, S150G ...
_BRACKET_RE = re.compile(r"\[[^\]]*\]")


# --------------------------------------------------------------------------
# small numeric helpers
# --------------------------------------------------------------------------
def _to_float(s):
    """float() that also accepts Fortran 'D' exponents; returns None on failure."""
    if s is None:
        return None
    try:
        v = float(s.replace("D", "e").replace("d", "e"))
    except (ValueError, AttributeError):
        return None
    if math.isnan(v) or math.isinf(v):
        return None
    return v


def _is_number(s):
    return _to_float(s) is not None


def last_digit_scale(value_str):
    """Size of one unit in the last quoted digit of value_str.

    For sexagesimal strings only the last ':'-separated field is considered,
    so the result is in units of that field.
    """
    val = value_str.split(":")[-1].lstrip("+-")
    parts = re.split(r"[eEdD]", val)
    mant = parts[0]
    exp = int(parts[1]) if len(parts) == 2 and parts[1] not in ("", "+", "-") else 0
    dp = mant.find(".")
    ndec = (len(mant) - dp - 1) if dp != -1 else 0
    return 10.0 ** (exp - ndec)


def absolute_error(value_str, err_str):
    """Convert a psrcat.db error token to an absolute error (see module doc)."""
    e = _to_float(err_str)
    if e is None:
        return None
    # '.'/'-' -> absolute (psrqpy rule). Exponent form is also taken as absolute
    # (psrqpy would scale it; such tokens are not expected in psrcat.db).
    if err_str.startswith("-") or "." in err_str or re.search(r"[eEdD]", err_str):
        return abs(e)
    return e * last_digit_scale(value_str)


def parse_sexagesimal(s, is_ra):
    """Parse 'hh:mm:ss.s' / '+dd:mm:ss.s' (1-3 fields).

    Returns (deg, last_field_unit_deg, resolution_deg) or None.
      last_field_unit_deg : size of 1 unit of the last field, in degrees of the
                            coordinate (RA: NOT multiplied by cos(dec)).
      resolution_deg      : one unit of the last quoted digit, in degrees.
    """
    if s is None:
        return None
    t = s.strip()
    sign = 1.0
    if t[:1] in "+-":
        if is_ra and t[0] == "-":
            return None
        sign = -1.0 if t[0] == "-" else 1.0
        t = t[1:]
    fields = t.split(":")
    if not 1 <= len(fields) <= 3:
        return None
    vals = []
    for f in fields:
        v = _to_float(f)
        if v is None:
            return None
        vals.append(v)
    x = vals[0]
    if len(vals) > 1:
        x += vals[1] / 60.0
    if len(vals) > 2:
        x += vals[2] / 3600.0
    scale = 15.0 if is_ra else 1.0
    unit_last = scale / (60.0 ** (len(fields) - 1))
    res = last_digit_scale(fields[-1]) * unit_last
    return sign * x * scale, unit_last, res


def _unit_vector(ra_deg, dec_deg):
    a, d = math.radians(ra_deg), math.radians(dec_deg)
    return (math.cos(d) * math.cos(a), math.cos(d) * math.sin(a), math.sin(d))


def _to_lonlat(v):
    x, y, z = v
    lon = math.degrees(math.atan2(y, x)) % 360.0
    lat = math.degrees(math.atan2(z, math.hypot(x, y)))
    return lon, lat


def ecliptic_to_equatorial(elong_deg, elat_deg):
    """Mean ecliptic & equinox of J2000 -> equatorial J2000 (~ICRS).

    Frame bias (<~25 mas) is ignored; irrelevant for this application.
    """
    eps = math.radians(OBLIQUITY_J2000_ARCSEC / 3600.0)
    x, y, z = _unit_vector(elong_deg, elat_deg)
    ce, se = math.cos(eps), math.sin(eps)
    return _to_lonlat((x, y * ce - z * se, y * se + z * ce))


def equatorial_to_galactic(ra_deg, dec_deg):
    v = _unit_vector(ra_deg, dec_deg)
    g = tuple(sum(_EQ2GAL[i][j] * v[j] for j in range(3)) for i in range(3))
    return _to_lonlat(g)


def _split_list(raw):
    """Split 'A[ref1],B[ref2]' into ['A', 'B'] (refs in [] removed)."""
    if not raw:
        return []
    out, depth, cur = [], 0, ""
    for ch in raw:
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth = max(0, depth - 1)
        if ch in ",;" and depth == 0:
            out.append(cur)
            cur = ""
        else:
            cur += ch
    out.append(cur)
    return [_BRACKET_RE.sub("", x).strip() for x in out if _BRACKET_RE.sub("", x).strip()]


# --------------------------------------------------------------------------
# reading
# --------------------------------------------------------------------------
def download(url, dest, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "mutual-visibility-psrcat-ingest/" + PARSER_VERSION})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(dest, "wb") as f:
        f.write(r.read())
    return dest


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def read_db_from_tarball(path):
    """Return (psrcat.db text, list of member names)."""
    with tarfile.open(path, mode="r:gz") as tf:
        names = tf.getnames()
        cands = [n for n in names if n.rstrip("/").split("/")[-1] == "psrcat.db"]
        if not cands:
            raise RuntimeError("psrcat.db not found in tarball; members: %s" % names[:50])
        cands.sort(key=len)  # prefer psrcat_tar/psrcat.db
        data = tf.extractfile(cands[0]).read()
    return data.decode("utf-8", errors="replace"), names


def parse_psrcat_db(text):
    """Parse psrcat.db text -> (version, [record], stats).

    record = {PARAM: {"value": str, "err_raw": str|None, "ref": str|None}}
    Later duplicates of a PARAM within one record overwrite earlier ones
    (psrqpy behaviour); they are counted in stats["duplicate_params"].
    """
    version = None
    records, cur = [], {}
    stats = {"comment_lines": 0, "warning_lines": 0, "duplicate_params": 0,
             "empty_value_lines": 0, "data_lines": 0}
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        if s.startswith("#"):
            stats["comment_lines"] += 1
            m = re.match(r"^#\s*CATALOGUE\s+(\S+)", s)
            if m:
                version = m.group(1)
            elif version is None and "CATALOGUE" in s:  # psrqpy fallback (case-sensitive)
                version = s.split()[-1]
            continue
        if s.startswith("WARNING"):
            stats["warning_lines"] += 1
            continue
        if s.startswith("@"):
            if cur:
                records.append(cur)
            cur = {}
            continue
        tok = s.split()
        key = tok[0].upper()
        if len(tok) == 1:
            stats["empty_value_lines"] += 1
            continue
        entry = {"value": tok[1], "err_raw": None, "ref": None}
        if len(tok) >= 3:
            if _is_number(tok[2]):
                entry["err_raw"] = tok[2]
            else:
                entry["ref"] = tok[2]
        if len(tok) >= 4:
            entry["ref"] = tok[3]
        if key in cur:
            stats["duplicate_params"] += 1
        cur[key] = entry
        stats["data_lines"] += 1
    if cur:
        records.append(cur)
    return version, records, stats


# --------------------------------------------------------------------------
# derivation
# --------------------------------------------------------------------------
COLUMNS = [
    # identity
    "name", "jname", "bname", "provisional",
    # position (J2000 / ICRS-equivalent)
    "ra_deg", "dec_deg", "raj", "decj", "pos_source",
    "ra_err_arcsec", "dec_err_arcsec", "pos_unc_arcsec", "pos_unc_kind", "pos_coarse",
    "posepoch_mjd", "pos_ref",
    "pmra_masyr", "pmdec_masyr", "px_mas",
    "gl_deg", "gb_deg",
    # spin / propagation
    "p0_s", "p1", "f0_hz", "f1", "pepoch_mjd",
    "dm", "dm_err", "dm_ref", "rm", "w50_ms", "w10_ms", "tau_sc_s",
    # flux
    "s400_mjy", "s600_mjy", "s700_mjy", "s800_mjy", "s1400_mjy", "spindx", "n_flux",
    # (s_est_* columns are appended dynamically)
    # distance
    "dist_kpc", "dist_method", "dist_dm_kpc",
    # classification
    "type_codes", "binary_model", "pb_d", "bincomp", "is_binary", "is_msp",
    "assoc", "survey", "discovery_survey", "date", "nglt",
]


def _val(rec, key):
    e = rec.get(key)
    return _to_float(e["value"]) if e else None


def _err(rec, key):
    e = rec.get(key)
    if not e or e["err_raw"] is None:
        return None
    return absolute_error(e["value"], e["err_raw"])


def _str(rec, key):
    e = rec.get(key)
    return e["value"] if e else None


def flux_points(rec):
    """[(freq_MHz, S_mJy)] for every positive S<freq> parameter, sorted."""
    pts = []
    for k, e in rec.items():
        m = _FLUX_KEY_RE.match(k)
        if not m:
            continue
        f = float(m.group(1)) * (1000.0 if m.group(2) else 1.0)
        s = _to_float(e["value"])
        if s is not None and s > 0:
            pts.append((f, s))
    pts.sort()
    return pts


def estimate_flux(pts, nu, spindx=None):
    """Estimated S(nu) [mJy] and method string.

    measured      : catalogue value at exactly nu
    interp        : log-log interpolation between nearest bracketing values
    spindx        : nearest value scaled with catalogue SPINDX
    extrap_two_point : no SPINDX; slope from the two values nearest to nu
    alpha_default : single value scaled with alpha = -1.6 (population mean)
    none          : no flux density in catalogue
    """
    if not pts:
        return None, "none"
    for f, s in pts:
        if abs(f - nu) < 1e-6:
            return s, "measured"
    lo = [p for p in pts if p[0] < nu]
    hi = [p for p in pts if p[0] > nu]
    if lo and hi:
        (f1, s1), (f2, s2) = lo[-1], hi[0]
        a = math.log(s2 / s1) / math.log(f2 / f1)
        return s1 * (nu / f1) ** a, "interp"
    near = sorted(pts, key=lambda p: abs(math.log(p[0] / nu)))
    f0, s0 = near[0]
    if spindx is not None:
        return s0 * (nu / f0) ** spindx, "spindx"
    if len(near) >= 2:
        f1, s1 = near[1]
        a = math.log(s1 / s0) / math.log(f1 / f0)
        return s0 * (nu / f0) ** a, "extrap_two_point"
    return s0 * (nu / f0) ** DEFAULT_SPECTRAL_INDEX, "alpha_default"


def derive(rec, est_freqs=DEFAULT_EST_FREQS_MHZ):
    out = {c: None for c in COLUMNS}

    # ---- names
    jname = _str(rec, "PSRJ")
    bname = _str(rec, "PSRB")
    out["jname"], out["bname"] = jname, bname
    out["name"] = bname or jname
    out["provisional"] = bool(jname and jname.upper().endswith("_P"))

    # ---- position
    ra = dec = None
    raj, decj = _str(rec, "RAJ"), _str(rec, "DECJ")
    pra = parse_sexagesimal(raj, True) if raj else None
    pdec = parse_sexagesimal(decj, False) if decj else None
    if pra and pdec:
        ra, dec = pra[0] % 360.0, pdec[0]
        out["pos_source"] = "equatorial"
        out["raj"], out["decj"] = raj, decj
        cosd = math.cos(math.radians(dec))
        ra_e = rec["RAJ"]["err_raw"]
        de_e = rec["DECJ"]["err_raw"]
        if ra_e is not None:
            out["ra_err_arcsec"] = absolute_error(raj, ra_e) * pra[1] * 3600.0 * cosd
        if de_e is not None:
            out["dec_err_arcsec"] = absolute_error(decj, de_e) * pdec[1] * 3600.0
        if out["ra_err_arcsec"] is not None or out["dec_err_arcsec"] is not None:
            out["pos_unc_arcsec"] = max(x for x in (out["ra_err_arcsec"], out["dec_err_arcsec"]) if x is not None)
            out["pos_unc_kind"] = "quoted"
        else:
            out["pos_unc_arcsec"] = max(pra[2] * 3600.0 * cosd, pdec[2] * 3600.0)
            out["pos_unc_kind"] = "implied_by_precision"
        out["pos_ref"] = rec["RAJ"]["ref"]
    else:
        el, eb = _val(rec, "ELONG"), _val(rec, "ELAT")
        if el is not None and eb is not None:
            ra, dec = ecliptic_to_equatorial(el, eb)
            out["pos_source"] = "ecliptic"
            el_e, eb_e = _err(rec, "ELONG"), _err(rec, "ELAT")
            errs = []
            if el_e is not None:
                errs.append(el_e * 3600.0 * math.cos(math.radians(eb)))
            if eb_e is not None:
                errs.append(eb_e * 3600.0)
            if errs:
                out["pos_unc_arcsec"] = max(errs)
                out["pos_unc_kind"] = "quoted_ecliptic"
            else:
                out["pos_unc_arcsec"] = 3600.0 * max(last_digit_scale(rec["ELONG"]["value"]),
                                                     last_digit_scale(rec["ELAT"]["value"]))
                out["pos_unc_kind"] = "implied_by_precision"
            out["pos_ref"] = rec["ELONG"]["ref"]
            out["raj"], out["decj"] = _fmt_ra(ra), _fmt_dec(dec)
    if ra is not None:
        out["ra_deg"], out["dec_deg"] = ra, dec
        out["gl_deg"], out["gb_deg"] = equatorial_to_galactic(ra, dec)
        out["pos_coarse"] = bool(out["pos_unc_arcsec"] is not None and out["pos_unc_arcsec"] > COARSE_POS_ARCSEC)
    else:
        out["pos_unc_kind"] = "no_position"

    pe = _val(rec, "POSEPOCH")
    out["posepoch_mjd"] = pe if pe is not None else _val(rec, "PEPOCH")
    out["pmra_masyr"], out["pmdec_masyr"] = _val(rec, "PMRA"), _val(rec, "PMDEC")
    out["px_mas"] = _val(rec, "PX")

    # ---- spin
    p0, p1, f0, f1 = _val(rec, "P0"), _val(rec, "P1"), _val(rec, "F0"), _val(rec, "F1")
    if p0 is None and f0:
        p0 = 1.0 / f0
    if f0 is None and p0:
        f0 = 1.0 / p0
    if p1 is None and f1 is not None and f0:
        p1 = -f1 / f0 ** 2
    if f1 is None and p1 is not None and p0:
        f1 = -p1 / p0 ** 2
    out.update(p0_s=p0, p1=p1, f0_hz=f0, f1=f1, pepoch_mjd=_val(rec, "PEPOCH"))
    out["dm"], out["dm_err"] = _val(rec, "DM"), _err(rec, "DM")
    out["dm_ref"] = rec["DM"]["ref"] if "DM" in rec else None
    out["rm"], out["w50_ms"], out["w10_ms"] = _val(rec, "RM"), _val(rec, "W50"), _val(rec, "W10")
    out["tau_sc_s"] = _val(rec, "TAU_SC")

    # ---- flux
    for f in (400, 600, 700, 800, 1400):
        out["s%d_mjy" % f] = _val(rec, "S%d" % f)
    out["spindx"] = _val(rec, "SPINDX")
    pts = flux_points(rec)
    out["n_flux"] = len(pts)
    for nu in est_freqs:
        s, how = estimate_flux(pts, nu, out["spindx"])
        out["s_est_%d_mjy" % int(nu)] = s
        out["s_est_%d_method" % int(nu)] = how

    # ---- distance (ATNF precedence: DIST_A > parallax(>3 sigma) > DIST_DM clipped to limits)
    dist_a, px, px_e = _val(rec, "DIST_A"), _val(rec, "PX"), _err(rec, "PX")
    ddm, amn, amx = _val(rec, "DIST_DM"), _val(rec, "DIST_AMN"), _val(rec, "DIST_AMX")
    out["dist_dm_kpc"] = ddm
    if dist_a is not None:
        out["dist_kpc"], out["dist_method"] = dist_a, "assoc_or_independent"
    elif px is not None and px_e and px > 0 and px / px_e > 3.0:
        out["dist_kpc"], out["dist_method"] = 1.0 / px, "parallax"
    elif ddm is not None:
        d, how = ddm, "dm"
        if amx is not None and d > amx:
            d, how = amx, "dm_clipped_to_limit"
        if amn is not None and d < amn:
            d, how = amn, "dm_clipped_to_limit"
        out["dist_kpc"], out["dist_method"] = d, how
    elif amn is not None and amx is not None:
        out["dist_kpc"], out["dist_method"] = 0.5 * (amn + amx), "limits_midpoint"

    # ---- classification
    types = _split_list(_str(rec, "TYPE"))
    pb = _val(rec, "PB")
    fb0 = _val(rec, "FB0")
    if pb is None and fb0:
        pb = 1.0 / fb0 / 86400.0
    out["pb_d"] = pb
    out["binary_model"] = _str(rec, "BINARY")
    out["bincomp"] = _str(rec, "BINCOMP")
    out["is_binary"] = bool(pb is not None or out["binary_model"] or "BINARY" in types)
    out["is_msp"] = bool(p0 is not None and p0 < 0.03)
    out["type_codes"] = ",".join(types) if types else None
    out["assoc"] = _str(rec, "ASSOC")
    surveys = _split_list(_str(rec, "SURVEY"))
    out["survey"] = ",".join(surveys) if surveys else None
    out["discovery_survey"] = surveys[0] if surveys else None
    out["date"] = _val(rec, "DATE")
    ng = _val(rec, "NGLT")
    out["nglt"] = int(ng) if ng is not None else None
    return out


def _fmt_ra(ra_deg):
    h = (ra_deg % 360.0) / 15.0
    hh = int(h); m = (h - hh) * 60; mm = int(m); ss = (m - mm) * 60
    if ss >= 59.99995:
        ss = 0.0; mm += 1
    if mm >= 60:
        mm = 0; hh = (hh + 1) % 24
    return "%02d:%02d:%07.4f" % (hh, mm, ss)


def _fmt_dec(dec_deg):
    sgn = "-" if dec_deg < 0 else "+"
    d = abs(dec_deg); dd = int(d); m = (d - dd) * 60; mm = int(m); ss = (m - mm) * 60
    if ss >= 59.9995:
        ss = 0.0; mm += 1
    if mm >= 60:
        mm = 0; dd += 1
    return "%s%02d:%02d:%06.3f" % (sgn, dd, mm, ss)


def _round(v, sig=10):
    """Trim float noise for the slim browser payload (keeps ~mas precision on RA/Dec)."""
    if isinstance(v, float):
        return float("%.*g" % (sig, v))
    return v


def raw_record(rec):
    out = {}
    for k, e in rec.items():
        v = _to_float(e["value"])
        out[k] = {
            "value": v if v is not None and k not in ("PSRJ", "PSRB", "RAJ", "DECJ") else e["value"],
            "err": absolute_error(e["value"], e["err_raw"]) if e["err_raw"] is not None else None,
            "err_raw": e["err_raw"],
            "ref": e["ref"],
        }
    return out


# --------------------------------------------------------------------------
# main
# --------------------------------------------------------------------------
def build(text, source_desc, est_freqs, tar_members=None, sha256=None):
    version, records, stats = parse_psrcat_db(text)
    rows = [derive(r, est_freqs) for r in records]
    cols = list(COLUMNS)
    i = cols.index("n_flux") + 1
    for nu in est_freqs:
        cols[i:i] = ["s_est_%d_mjy" % int(nu), "s_est_%d_method" % int(nu)]
        i += 2
    names = [r["jname"] for r in rows]
    meta = {
        "catalogue": "ATNF Pulsar Catalogue (psrcat)",
        "catalogue_version": version,
        "n_pulsars": len(rows),
        "n_with_position": sum(r["ra_deg"] is not None for r in rows),
        "n_position_from_ecliptic": sum(r["pos_source"] == "ecliptic" for r in rows),
        "n_provisional": sum(bool(r["provisional"]) for r in rows),
        "n_coarse_position": sum(bool(r["pos_coarse"]) for r in rows),
        "n_with_any_flux": sum((r["n_flux"] or 0) > 0 for r in rows),
        "n_with_dm": sum(r["dm"] is not None for r in rows),
        "n_missing_jname": sum(n is None for n in names),
        "n_duplicate_jname": len(names) - len(set(names)),
        "parse_stats": stats,
        "source": source_desc,
        "source_sha256": sha256,
        "tarball_members": tar_members,
        "est_freqs_mhz": list(est_freqs),
        "default_spectral_index": DEFAULT_SPECTRAL_INDEX,
        "coarse_pos_threshold_arcsec": COARSE_POS_ARCSEC,
        "generated_utc": _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds"),
        "parser_version": PARSER_VERSION,
        "citation": CITATION,
        "columns": cols,
    }
    return rows, [raw_record(r) for r in records], meta, cols


SLIM_COLUMNS = [
    "jname", "bname", "ra_deg", "dec_deg", "pos_unc_arcsec", "pos_coarse", "provisional",
    "p0_s", "dm", "s_est_600_mjy", "s_est_600_method", "type_codes", "is_binary", "is_msp",
]


def write_outputs(outdir, rows, raws, meta, cols):
    os.makedirs(outdir, exist_ok=True)
    # columnar, positions only -> small payload for a map layer in the browser
    slim_cols = [c for c in SLIM_COLUMNS if c in cols]
    slim_rows = [r for r in rows if r.get("ra_deg") is not None]
    slim = {"version": meta.get("catalogue_version"), "columns": slim_cols,
            "data": {c: [_round(r.get(c)) for r in slim_rows] for c in slim_cols}}
    with open(os.path.join(outdir, "atnf_psrcat_slim.json"), "w") as f:
        json.dump(slim, f, separators=(",", ":"))
    with open(os.path.join(outdir, "atnf_psrcat.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: ("" if r.get(k) is None else r.get(k)) for k in cols})
    with open(os.path.join(outdir, "atnf_psrcat.json"), "w") as f:
        json.dump([{k: r.get(k) for k in cols} for r in rows], f, separators=(",", ":"))
    with gzip.open(os.path.join(outdir, "atnf_psrcat_full.json.gz"), "wt") as f:
        json.dump(raws, f, separators=(",", ":"))
    with open(os.path.join(outdir, "atnf_psrcat_meta.json"), "w") as f:
        json.dump(meta, f, indent=2)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group()
    src.add_argument("--db", help="path to an extracted psrcat.db")
    src.add_argument("--tarball", help="path to a downloaded psrcat_pkg*.tar.gz")
    src.add_argument("--version", help="download this release, e.g. 2.9.0 (default: latest)")
    ap.add_argument("--out", required=True, help="output directory")
    ap.add_argument("--cache-dir", default=None, help="where to keep the downloaded tarball (default: --out)")
    ap.add_argument("--est-freqs", type=float, nargs="+", default=list(DEFAULT_EST_FREQS_MHZ),
                    help="frequencies (MHz) for estimated flux columns")
    ap.add_argument("--min-count", type=int, default=0,
                    help="abort (exit 2) if fewer pulsars are parsed, e.g. 4000 for production")
    a = ap.parse_args(argv)

    members = sha = None
    if a.db:
        with open(a.db, encoding="utf-8", errors="replace") as f:
            text = f.read()
        source, sha = os.path.abspath(a.db), sha256_of(a.db)
    else:
        if a.tarball:
            tb = a.tarball
            source = os.path.abspath(tb)
        else:
            url = ATNF_VERSION_TARBALL.format(a.version) if a.version else ATNF_TARBALL
            cache = a.cache_dir or a.out
            os.makedirs(cache, exist_ok=True)
            tb = os.path.join(cache, os.path.basename(url))
            download(url, tb)
            source = url
        sha = sha256_of(tb)
        text, members = read_db_from_tarball(tb)

    rows, raws, meta, cols = build(text, source, tuple(a.est_freqs), members, sha)
    if meta["n_pulsars"] < a.min_count:
        print("ERROR: parsed only %d pulsars (< --min-count %d); not writing outputs"
              % (meta["n_pulsars"], a.min_count), file=sys.stderr)
        return 2
    write_outputs(a.out, rows, raws, meta, cols)
    print("psrcat %s: %d pulsars (%d with position, %d provisional, %d coarse) -> %s"
          % (meta["catalogue_version"], meta["n_pulsars"], meta["n_with_position"],
             meta["n_provisional"], meta["n_coarse_position"], a.out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
