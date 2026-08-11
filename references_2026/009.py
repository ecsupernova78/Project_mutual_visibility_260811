# %% Imports
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import imageio
import matplotlib.pyplot as plt
import numpy as np
from astropy import units as u
from astropy.coordinates import AltAz, EarthLocation, SkyCoord
from astropy.coordinates.erfa_astrom import ErfaAstromInterpolator, erfa_astrom
from astropy.time import Time
from matplotlib.patches import Rectangle as MplRectangle

# %%

# Define input parameters
## RA, Dec domain Setting:
ra_start_deg: float = 0.0
ra_end_deg: float = 360.0
dec_start_deg: float = -90.0
dec_end_deg: float = 90.0
ra_step_deg: float = 1
dec_step_deg: float = 1

## Time domain Setting:
# center_time = Time.now()
center_time = Time("2026-03-18T10:30", format="isot", scale="utc")
time_before_hours = 12.0
time_after_hours = 12.0
time_step_hours = 0.5

## Observatory Informations:
loc_narrabri = EarthLocation(lat=-30.31667 * u.deg, lon=149.76667 * u.deg, height=0 * u.m)
loc_pyeongchang = EarthLocation(lat=37.36889 * u.deg, lon=128.39028 * u.deg, height=0 * u.m)
# sites = [loc_narrabri, loc_pyeongchang]
alt_limit: float = 0
time_resolution = 360 * u.s


@dataclass
class VisibilitySummary:
    time: Time
    dec_min: float | None
    dec_max: float | None
    ra_min: float | None
    ra_max: float | None
    coverage_fraction: float


@dataclass
class Target:
    name: str  # name of the target
    coord: SkyCoord  # SkyCoord 객체로 coordinate 저장


# %%
def generate_ra_dec_grid(ra_start_deg: float, ra_end_deg: float, dec_start_deg: float, dec_end_deg: float, ra_step_deg: float, dec_step_deg: float) -> tuple[np.ndarray, np.ndarray, int, int]:

    ra_vals = np.arange(ra_start_deg, ra_end_deg + ra_step_deg * 1, ra_step_deg)
    dec_vals = np.arange(dec_start_deg, dec_end_deg + dec_step_deg * 1, dec_step_deg)

    # 1-D array of [RA (0 360 deg)/ Dec (-90 90 deg) / # of RA / # of Dec]
    return ra_vals, dec_vals, len(ra_vals), len(dec_vals)


def time_now_grid(time_center: Time, time_before: float, time_after: float, time_step: float) -> Time:
    n_before = int(np.floor(time_before / time_step))
    n_after = int(np.floor(time_after / time_step)) + 1
    dt = (np.arange(-n_before, n_after) * time_step) * u.hour
    return time_center + dt


# Compute altitude(s) of sky coordinate(s) for one site over time.
def compute_altitudes(
    coords: SkyCoord,
    times: Time,
    location: EarthLocation,
    time_resolution: Optional[u.Quantity],
) -> u.Quantity:

    altaz_frame = AltAz(obstime=times, location=location, pressure=0 * u.hPa)

    def _transform(c: Skycoord) -> SkyCoord:
        if time_resolution is not None:
            with erfa_astrom.set(ErfaAstromInterpolator(time_resolution)):
                return c.transform_to(altaz_frame)
        return c.transform_to(altaz_frame)

    # scalar SkyCoord: do NOT index with [:, None]
    if coords.isscalar:
        altaz = _transform(coords)
        return altaz.alt[None, :]

    # array SkyCoord: broadcast coordinates against time axis
    altaz = _transform(coords[:, None])
    # altitudes[u.quantity]: Array of altitude angles in deg, shape (N_coord, N_time).
    # 즉, altaz.alt: [천체 좌표, 관측 시간]에 따른 해당 천체의 고도가 나타나는 배열.
    return altaz.alt  # (N_coord, N_time) 형태


def compute_visibility_mask(
    coords: SkyCoord,
    times: Time,
    loc_narrabri: EarthLocation,
    loc_pyeongchang: EarthLocation,
    alt_limit: float,
    time_resolution: u.Quantity,
) -> np.ndarray:
    """
    각 좌표/시각에 대해, 두 관측소에서 고도가 alt_limit 이상인지 판단.
    Return: (M, N) 배열임. M = n_ra * n_dec 임.
    mask : np.ndarray
        Boolean array with shape ``(M, N)``.  ``mask[i, j]`` is True if
        ``coords[i]`` has altitude ≥ ``alt_limit`` at **all** sites at
        ``times[j]``.
    """
    n_coords = len(coords)
    n_times = len(times)

    # Start with an all-True mask and refine by each site
    visibility = np.ones((n_coords, n_times), dtype=bool)  # np.ones: np.zeros ~1 버전
    alt_narrabri = compute_altitudes(coords, times, loc_narrabri, time_resolution)
    visibility &= alt_narrabri.to(u.deg).value >= alt_limit
    alt_pyeongchang = compute_altitudes(coords, times, loc_pyeongchang, time_resolution)
    visibility &= alt_pyeongchang.to(u.deg).value >= alt_limit
    return visibility


def summarize_visibility(
    mask: np.ndarray,
    ra_vals: np.ndarray,
    dec_vals: np.ndarray,
    times: Time,
    n_ra: int,
    n_dec: int,
) -> list[dict[str, object]]:
    """
    time interval에 대해, 각각 interval마다 양 끝점의 visible RA/Dec grid point를 찾는다.
    visible과 동시에 altitude requirement를 and 조건으로 만족해야 한다.

    #1. Parameters:
    mask: np.ndarray, shape: (M, N).
        M = n_ra * n_dec / N = # of time sample.
    mask[i,j]=True : cordii i는 시각 j에서, 두 site 모두에서 visible함.
    ra_vals: np.ndarray / dec_vals: np.ndarray : 둘 다 1-D array.
    times: 길이 N, astropy.Time array.

    #2. Returns
    summaries: list of dict.
        interval마다 하나씩, dictionary의 list를 반환하며, key는 아래와 같다:
            start_time [Time] / end_time [Time]
            visible_count [int]: 해당 interval에서 visible한 전체 (RA, Dec) 쌍의 개수임.
            visible_map [dict]: 각 dec 값에 대해 inverval 전체에서 visible한 RA 값들의 정렬된 list를 대응시킴.

    #3. Notes
    후처리를 위해, visible grid points 집합을 보존함.
    """

    # Validate mask shape
    n_times = mask.shape[1]
    if mask.shape[0] != n_ra * n_dec:
        raise ValueError("mask size does not match RA/Dec grid dimensions")

    # Reshape to (n_dec, n_ra, n_times) for easy slicing
    mask_3d = mask.reshape((n_dec, n_ra, n_times))
    n_intervals = n_times - 1
    summaries: list[dict[str, object]] = []

    for i in range(n_intervals):
        # Compute mask for interval i by requiring visibility at both end times
        interval_mask = mask_3d[:, :, i] & mask_3d[:, :, i + 1]  # shape (n_dec, n_ra)
        # Find indices where the interval mask is True
        visible_indices = np.argwhere(interval_mask)
        # Build a mapping from Dec value to sorted list of RA values
        dec_to_ra: dict[float, list[float]] = {}
        for dec_idx, ra_idx in visible_indices:
            dec_val = float(dec_vals[dec_idx])
            ra_val = float(ra_vals[ra_idx])
            dec_to_ra.setdefault(dec_val, []).append(ra_val)
        # Sort RA lists for each declination for neatness
        for dec_val, ra_list in dec_to_ra.items():
            ra_list.sort()
        summaries.append(
            {
                "start_time": times[i],
                "end_time": times[i + 1],
                "visible_count": len(visible_indices),
                "visible_map": dec_to_ra,
            }
        )
    return summaries


def merge_visible_map_to_rectangles(
    visible_map: dict[float, list[float]],
    ra_step: float,
    dec_step: float,
) -> list[dict[str, float]]:

    dec_segments: dict[float, list[tuple[float, float]]] = {}
    for dec, ra_list in visible_map.items():
        if not ra_list:
            continue
        # Normalize RA values into [0,360)
        norm_ra = [(ra if ra < 360.0 else 0.0) for ra in ra_list]
        # Remove duplicates and sort
        norm_ra = sorted(set(norm_ra))
        # Build contiguous segments
        segments: list[tuple[float, float]] = []
        start_ra = norm_ra[0]
        prev_ra = norm_ra[0]
        for ra in norm_ra[1:]:
            # Compute difference, taking into account wrap‑around
            diff = ra - prev_ra
            # Because RA values have been normalized to [0,360), diff will be negative across wrap; adjust
            if diff < 0:
                diff += 360.0
            # If diff equals the RA step (within a small tolerance), it's contiguous
            if abs(diff - ra_step) < 1e-6:
                prev_ra = ra
            else:
                # End current segment
                segments.append((start_ra, prev_ra))
                start_ra = ra
                prev_ra = ra
        # Append last segment
        segments.append((start_ra, prev_ra))
        dec_segments[dec] = segments

    # Now merge segments across declinations.
    # Sort declinations for processing.
    sorted_decs = sorted(dec_segments.keys())
    rectangles: list[dict[str, float]] = []
    # Active rectangles keyed by (ra_min, ra_max) with values: dict(dec_min, dec_max, last_dec).
    active: dict[tuple[float, float], dict[str, float]] = {}
    for dec in sorted_decs:
        segments = dec_segments[dec]
        used_keys = set()
        for ra_min, ra_max in segments:
            key = (ra_min, ra_max)
            if key in active and abs(dec - active[key]["last_dec"] - dec_step) < 1e-6:
                # Extend existing rectangle
                active[key]["dec_max"] = dec
                active[key]["last_dec"] = dec
                used_keys.add(key)
            else:
                # Start a new rectangle.  If there was an existing rectangle with the same
                # RA range but not contiguous in dec, finalise it first.
                if key in active:
                    rectangles.append(
                        {
                            "ra_min": key[0],
                            "ra_max": key[1],
                            "dec_min": active[key]["dec_min"],
                            "dec_max": active[key]["dec_max"],
                        }
                    )
                active[key] = {
                    "ra_min": ra_min,
                    "ra_max": ra_max,
                    "dec_min": dec,
                    "dec_max": dec,
                    "last_dec": dec,
                }
                used_keys.add(key)
        # Finalise active rectangles that were not used at this declination
        for key in list(active.keys()):
            if key not in used_keys:
                rectangles.append(
                    {
                        "ra_min": key[0],
                        "ra_max": key[1],
                        "dec_min": active[key]["dec_min"],
                        "dec_max": active[key]["dec_max"],
                    }
                )
                del active[key]
    # Finalise any remaining active rectangles
    for key, rect in active.items():
        rectangles.append(
            {
                "ra_min": key[0],
                "ra_max": key[1],
                "dec_min": rect["dec_min"],
                "dec_max": rect["dec_max"],
            }
        )
    return rectangles


def build_interval_rectangle_summary(
    mask: np.ndarray,
    ra_vals: np.ndarray,
    dec_vals: np.ndarray,
    times: Time,
    n_ra: int,
    n_dec: int,
    ra_step: float,
    dec_step: float,
) -> list[dict[str, object]]:
    n_times = mask.shape[1]
    if mask.shape[0] != n_ra * n_dec:
        raise ValueError("mask size does not match RA/Dec grid dimensions")
    mask_3d = mask.reshape((n_dec, n_ra, n_times))
    n_intervals = n_times - 1
    summaries: list[dict[str, object]] = []
    for i in range(n_intervals):
        interval_mask = mask_3d[:, :, i] & mask_3d[:, :, i + 1]
        visible_indices = np.argwhere(interval_mask)
        dec_to_ra: dict[float, list[float]] = {}
        for dec_idx, ra_idx in visible_indices:
            dec_val = float(dec_vals[dec_idx])
            ra_val = float(ra_vals[ra_idx])
            dec_to_ra.setdefault(dec_val, []).append(ra_val)
        # Sort RA lists
        for dec_val, ra_list in dec_to_ra.items():
            ra_list.sort()
        rectangles = merge_visible_map_to_rectangles(dec_to_ra, ra_step, dec_step)
        summaries.append(
            {
                "start_time": times[i],
                "end_time": times[i + 1],
                "rectangles": rectangles,
            }
        )
    return summaries


def write_interval_rectangles_to_csv(
    interval_summaries: list[dict[str, object]],
    file_path: str,
) -> None:
    import csv

    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["start_time", "end_time", "dec_min", "dec_max", "ra_min", "ra_max"])
        for summary in interval_summaries:
            start_str = summary["start_time"].isot
            end_str = summary["end_time"].isot
            for rect in summary["rectangles"]:
                writer.writerow(
                    [
                        start_str,
                        end_str,
                        f"{rect['dec_min']:.2f}",
                        f"{rect['dec_max']:.2f}",
                        f"{rect['ra_min']:.2f}",
                        f"{rect['ra_max']:.2f}",
                    ]
                )


def write_interval_visibility_to_csv(
    interval_summaries: list[dict[str, object]],
    file_path: str,
) -> None:
    import csv

    with open(file_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["start_time", "end_time", "dec", "ra_values"])
        for summary in interval_summaries:
            start_str = summary["start_time"].isot
            end_str = summary["end_time"].isot
            for dec_val, ra_list in summary["visible_map"].items():
                # Join RA values by semicolon for a single cell
                ra_str = ";".join(f"{ra:.2f}" for ra in ra_list)
                writer.writerow([start_str, end_str, f"{dec_val:.2f}", ra_str])


def generate_interval_rect_plots(
    interval_summaries: list[dict[str, object]],
    ra_start: float,
    ra_end: float,
    dec_start: float,
    dec_end: float,
    output_dir: str,
) -> list[str]:
    import os

    os.makedirs(output_dir, exist_ok=True)
    image_paths = []

    targets: list[Target] = [
        Target(
            name="3C123",
            coord=SkyCoord(
                ra="04:37:04.38",
                dec="+29:40:13.86",
                unit=(u.hourangle, u.deg),
                frame="icrs",
            ),
        ),
        Target(
            name="3C273",
            coord=SkyCoord(
                ra="12:29:06.7",
                dec="+02:03:09",
                unit=(u.hourangle, u.deg),
                frame="icrs",
            ),
        ),
        Target(
            name="3C433",
            coord=SkyCoord(
                ra="21:23:44.557",
                dec="+25:04:28.04",
                unit=(u.hourangle, u.deg),
                frame="icrs",
            ),
        ),
        Target(
            name="3C295",
            coord=SkyCoord(
                ra="14:11:20.522 ",
                dec="+52:12:09.60",
                unit=(u.hourangle, u.deg),
                frame="icrs",
            ),
        ),
        Target(
            name="3C134",
            coord=SkyCoord(
                ra="05:04:04.20 ",
                dec="+38:06:11.0",
                unit=(u.hourangle, u.deg),
                frame="icrs",
            ),
        ),
    ]

    for idx, summary in enumerate(interval_summaries):
        rects = summary.get("rectangles", [])
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.set_xlim(ra_start, ra_end)
        ax.set_ylim(dec_start, dec_end)
        ax.set_xlabel("RA (deg)")
        ax.set_ylabel("Dec (deg)")

        for rect in rects:
            ra_min = rect["ra_min"]
            ra_max = rect["ra_max"]
            dec_min = rect["dec_min"]
            dec_max = rect["dec_max"]
            # wrap‑around 처리
            if ra_max >= ra_min:
                width = ra_max - ra_min
                patch = MplRectangle((ra_min, dec_min), width, dec_max - dec_min, edgecolor="black", facecolor="blue", alpha=0.5)
                ax.add_patch(patch)
            else:
                width1 = ra_end - ra_min
                patch1 = MplRectangle((ra_min, dec_min), width1, dec_max - dec_min, edgecolor="black", facecolor="blue", alpha=0.5)
                ax.add_patch(patch1)
                width2 = ra_max - ra_start
                patch2 = MplRectangle((ra_start, dec_min), width2, dec_max - dec_min, edgecolor="black", facecolor="blue", alpha=0.5)
                ax.add_patch(patch2)

        colors = ["red", "blue", "green", "orange", "purple"]
        i = 0

        for target in targets:
            SC = target.coord

            ax.scatter(SC.ra.deg, SC.dec.deg, marker=",", s=50, c=colors[i], zorder=10, label=f"{target.name}")
            ax.text(SC.ra.deg + 3, SC.dec.deg + 3, f"{target.name}", fontsize=9, color=colors[i], zorder=11)
            i += 1

        start_str = summary["start_time"].isot
        end_str = summary["end_time"].isot
        ax.set_title(f"{start_str} → {end_str}")
        image_path = os.path.join(output_dir, f"interval_{idx:04d}.png")
        fig.savefig(image_path)
        plt.close(fig)
        image_paths.append(image_path)
    return image_paths


def create_video_from_images(image_paths: list[str], output_path: str, fps: int = 2) -> None:
    with imageio.get_writer(output_path, fps=fps) as writer:
        for img_path in image_paths:
            image = imageio.imread(img_path)
            writer.append_data(image)


# %%
def main() -> None:
    # Generate RA/Dec grid and time array
    ra_vals, dec_vals, n_ra, n_dec = generate_ra_dec_grid(
        ra_start_deg,
        ra_end_deg,
        dec_start_deg,
        dec_end_deg,
        ra_step_deg,
        dec_step_deg,
    )
    times = time_now_grid(center_time, time_before_hours, time_after_hours, time_step_hours)

    print(f"Generated RA grid with {n_ra} points and Dec grid with {n_dec} points.")
    print(f"Total sky points: {n_ra * n_dec}")
    print(f"Number of time steps: {len(times)}")

    # SkyCoord grid
    ra_mesh, dec_mesh = np.meshgrid(ra_vals, dec_vals)
    coords = SkyCoord(ra=ra_mesh.ravel() * u.deg, dec=dec_mesh.ravel() * u.deg, frame="icrs")

    # Masking
    mask = compute_visibility_mask(coords, times, loc_narrabri, loc_pyeongchang, alt_limit, time_resolution)
    print("Visibility mask computed.")

    # time_interval testing
    interval_summaries = summarize_visibility(mask, ra_vals, dec_vals, times, n_ra, n_dec)
    interval_rect_summaries = build_interval_rectangle_summary(mask, ra_vals, dec_vals, times, n_ra, n_dec, ra_step_deg, dec_step_deg)

    # Print a sample of interval summaries for both RA lists and merged rectangles.
    print("\nSample interval visibility summary (RA lists):")
    sample_indices = [0, len(interval_summaries) // 2, len(interval_summaries) - 1]
    for idx in sample_indices:
        summary = interval_summaries[idx]
        start_str = summary["start_time"].isot
        end_str = summary["end_time"].isot
        count = summary["visible_count"]
        print(f"Interval {idx}: {start_str} → {end_str}, visible points: {count}")
        printed = 0
        for dec_val, ra_list in sorted(summary["visible_map"].items()):
            print(f"  Dec {dec_val:.1f}°: RA values = {ra_list[:10]}{'...' if len(ra_list) > 10 else ''}")
            printed += 1
            if printed >= 3:
                break
        if len(summary["visible_map"]) > printed:
            print(f"  ... and {len(summary['visible_map']) - printed} more declination rows")

    # Print a sample of rectangle summaries for the same intervals
    print("\nSample interval rectangle summary (merged rectangles):")
    for idx in sample_indices:
        rect_summary = interval_rect_summaries[idx]
        start_str = rect_summary["start_time"].isot
        end_str = rect_summary["end_time"].isot
        rects = rect_summary["rectangles"]
        print(f"Interval {idx}: {start_str} → {end_str}, {len(rects)} rectangles")
        for j, rect in enumerate(rects[:5]):
            print(f"  Rect {j}: Dec {rect['dec_min']:.1f}–{rect['dec_max']:.1f}°, RA {rect['ra_min']:.1f}–{rect['ra_max']:.1f}°")
        if len(rects) > 5:
            print(f"  ... and {len(rects) - 5} more rectangles")

    # Write the merged rectangle summaries to a CSV file
    # csv_path = r"C:\Supernova\#8_Computing\Python\astro\26_001\products\interval_rectangles_002.csv"
    # write_interval_rectangles_to_csv(interval_rect_summaries, csv_path)
    # print(f"\nRectangle summary CSV written to {csv_path}")

    interval_rect_summaries = build_interval_rectangle_summary(mask, ra_vals, dec_vals, times, n_ra, n_dec, ra_step_deg, dec_step_deg)

    # products 폴더 준비
    base_dir = Path("products")
    base_dir.mkdir(parents=True, exist_ok=True)
    csv_path = base_dir / "interval_rectangles.csv"
    write_interval_rectangles_to_csv(interval_rect_summaries, str(csv_path))
    print(f"\nRectangle summary CSV written to {csv_path}")

    # 이미지 생성 및 동영상 제작
    plots_dir = base_dir / "interval_plots"
    images = generate_interval_rect_plots(
        interval_rect_summaries,
        ra_start_deg,
        ra_end_deg,
        dec_start_deg,
        dec_end_deg,
        str(plots_dir),
    )
    video_path = base_dir / "interval_animation.mp4"
    create_video_from_images(images, str(video_path), fps=2)
    print(f"Interval plots saved to {plots_dir} and video written to {video_path}")


if __name__ == "__main__":
    # When run as a script, execute the main routine
    main()
