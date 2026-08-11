# %% Imports
from __future__ import annotations

import os
from dataclasses import dataclass

import matplotlib.pyplot as plt
import numpy as np
from astropy import units as u
from astropy.coordinates import AltAz, EarthLocation, SkyCoord
from astropy.time import Time


# %% Definitions
@dataclass
class Target:
    name: str  # name of the target
    coord: SkyCoord  # SkyCoord 객체로 coordinate 저장


# Targets: List[Target], Target = name, coord
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
    # Target(name="Sagittarius A", coord=SkyCoord(ra="17:45:40", dec="-29:0:28", unit=(u.hourangle, u.deg),frame="icrs",),),
]
"""
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
"""

targets_Brightests: list[Target] = [
    Target(
        name="Cygnus A (3C405)",
        coord=SkyCoord(
            ra="19:59:28.36",
            dec="+40:44:02.10",
            unit=(u.hourangle, u.deg),
            frame="icrs",
        ),
    ),
    Target(
        name="Centaurus A (NGC 5128)",
        coord=SkyCoord(
            ra="13:25:27.62",
            dec="-43:01:08.81",
            unit=(u.hourangle, u.deg),
            frame="icrs",
        ),
    ),
    Target(
        name="Hercules A (3C348)",
        coord=SkyCoord(
            ra="16:51:08.1",
            dec="+04:59:34",
            unit=(u.hourangle, u.deg),
            frame="icrs",
        ),
    ),
    Target(
        name="Crab Nebula (3C144, M1)",
        coord=SkyCoord(
            ra="05:34:31.8",
            dec="+22:01:03",
            unit=(u.hourangle, u.deg),
            frame="icrs",
        ),
    ),
    Target(
        name="Virgo A (3C274, M87)",
        coord=SkyCoord(
            ra="12:30:49.4",
            dec="+12:23:28.04",
            unit=(u.hourangle, u.deg),
            frame="icrs",
        ),
    ),
    # Target(name="Sagittarius A", coord=SkyCoord(ra="17:45:40", dec="-29:0:28", unit=(u.hourangle, u.deg),frame="icrs",),),
]


# Observing sites Location(name, lat [deg], lon [deg], height [m])
loc_narrabri = EarthLocation(lat=-30.31667 * u.deg, lon=149.76667 * u.deg, height=0.0 * u.m)
loc_pyeongchang = EarthLocation(lat=37.36889 * u.deg, lon=128.39028 * u.deg, height=0.0 * u.m)

# Time setting (UTC, hour)
# time_start = "2026-01-01 00:00"  # ISO format "0000-00-00 00:00"
time_now = Time.now()
# time_set = Time("2026-01-01T00:00", format="isot", scale="utc")
time_set = Time("2026-03-18T09:00", format="isot", scale="utc")
time_before_hours = 12
time_after_hours = 12
time_step_hours = 0.1  # [hours]


## %% Function definitions
def time_now_grid(time_center: Time, time_before: float, time_after: float, time_step: float) -> Time:
    n_before = int(np.floor(time_before / time_step))
    n_after = int(np.floor(time_after / time_step)) + 1
    dt = (np.arange(-n_before, n_after) * time_step) * u.hour
    return time_center + dt


def compute_alt(target: SkyCoord, location: EarthLocation, times: Time) -> np.ndarray:
    frame = AltAz(obstime=times, location=location, pressure=0 * u.hPa)
    # AltAz 함수 설명:
    altaz = target.transform_to(frame)
    return altaz.alt.to_value(u.deg)


# %% Main Sequences
# times = time_grid(time_start, time_duration_hours, time_step_hours)
times = time_now_grid(time_set, time_before_hours, time_after_hours, time_step_hours)

os.makedirs("plots", exist_ok=True)  # mkdir output_dir, 만약 있으면 건너뛰기.

dt = times.to_datetime()  # Time 배열을 python의 datetime 배열로 변경: np.ndarray

fig, ax = plt.subplots(figsize=(12, 6))
colors = ["red", "blue", "green"] # "orange", "purple"
i = 0

for target in targets:
    SC = target.coord

    alts1 = compute_alt(SC, loc_narrabri, times)  # Compute the target's Altitude of each location
    alts2 = compute_alt(SC, loc_pyeongchang, times)
    ax.plot(dt, alts1, label=f"{target.name}", color=colors[i], linewidth=2)
    ax.plot(dt, alts2, color=colors[i], linewidth=2, linestyle="--")
    i += 1

ax.set_xlabel("Time [UTC]", fontsize=23)
ax.set_ylabel("Altitude [°]", fontsize=23)
ax.set_ylim(0, 90)
# ax.set_title("Time - Altitude Plot", fontsize=15)
ax.grid(True, linestyle=":", alpha=0.7)
ax.legend(loc="upper right", fontsize=20)  # legend 오른쪽 위에 배치
# plt.legend(("ㅡ : Nrbbri", "-- : Pynchng"))

# label=f"{target.name}, Pyngchng",

fig.autofmt_xdate()  # x축의 label 문자열 겹치지 않도록 자동 정렬 및 회전.
fig.tight_layout()  # title, axis, label, legend 등이 그림 밖으로 잘리지 않게 자동 스케일 조정해 줌.

"""
filename = "elevation_Narrabri_vs_Pyeongchang_008_01.png"
    # 파일명 생성. replace(' ', '_') : 이름에 공백( ) 있으면 (_)로 교체.
filepath = os.path.join("plots", filename)
    # 파일경로 생성. output_dir 경로 + filename 합쳐서 최종 경로 생성. os는 운영체제에 맞는 구분자 자동 적용함.
fig.savefig(filepath, dpi=300)  # fig 저장, 위치 및 dpi 설정.
"""
plt.show()
plt.close(fig)  # 메모리에서 fig 닫기. 안 닫으면 메모리 사용량 급증

# %%
