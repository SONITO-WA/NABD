"""Optional - SYNTHETIC test data, to test the pipeline and the app before the
real NISAR files are downloaded.

For every real granule date in data/granules_<zone>.csv it fakes an HH/HV pair:
woodland, fields, a lake, seasonal greening, and a fire that spreads from the
real ignition point between the real start and end dates, with patchy severity
and a little regrowth after the autumn rains. Folders are prefixed DEMO_ and the
app shows a "demo data" banner. Delete data/raw/<zone>/DEMO_* when you have real data.

    python scripts/00_make_demo.py              # all zones
    python scripts/00_make_demo.py --zone sefrou
"""
import argparse
import csv
from datetime import date

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin
from scipy import ndimage

import config as C

LAKES = {   # (lat, lon, radius_m) - rough, for realism only
    "avila": [(40.43, -4.56, 1800), (40.39, -4.33, 1500)],
    "gironde": [(45.02, -1.10, 2500)],
    "sefrou": [(33.565, -4.935, 700)],
}
SEA_WEST_OF = {"gironde": -1.205}


def noise(rng, shape, sigma, amp=1.0):
    f = ndimage.gaussian_filter(rng.standard_normal(shape).astype("float32"), sigma)
    return f / f.std() * amp


def make(zone):
    z = C.ZONES[zone]
    rng = np.random.default_rng(abs(hash(zone)) % 2**32)
    P = z["pixel_m"]
    tr = Transformer.from_crs("EPSG:4326", z["crs"], always_xy=True)
    w, s, e, n = z["bbox"]
    xs, ys = tr.transform([w, e, w, e], [s, s, n, n])
    x0, x1, y0, y1 = min(xs) - 300, max(xs) + 300, min(ys) - 300, max(ys) + 300
    W, H = int((x1 - x0) / P), int((y1 - y0) / P)
    gx, gy = np.meshgrid(x0 + (np.arange(W) + .5) * P, y1 - (np.arange(H) + .5) * P)
    lon, lat = Transformer.from_crs(z["crs"], "EPSG:4326", always_xy=True).transform(gx, gy)

    # land cover ---------------------------------------------------------------
    forest = noise(rng, (H, W), 25) + 0.4 * noise(rng, (H, W), 5) > -0.35
    water = np.zeros((H, W), bool)
    for la, lo, r in LAKES.get(zone, []):
        cx, cy = tr.transform(lo, la)
        water |= ((gx - cx) ** 2 + (gy - cy) ** 2) < (r * (1 + 0.25 * noise(rng, (H, W), 15))) ** 2
    if zone in SEA_WEST_OF:
        water |= lon < SEA_WEST_OF[zone] + 0.004 * noise(rng, (H, W), 40)
    forest &= ~water
    texture = noise(rng, (H, W), 3, 0.9)

    # fire: arrival "distance" from the ignition, stretched by wind & fuel noise ----
    ix, iy = tr.transform(z["ignition"][1], z["ignition"][0])
    ang = rng.uniform(0, np.pi)
    u = (gx - ix) * np.cos(ang) + (gy - iy) * np.sin(ang)
    v = -(gx - ix) * np.sin(ang) + (gy - iy) * np.cos(ang)
    scale_m = np.sqrt(z['official_ha'] * 1e4)                              # fire size, metres
    arrival = (np.sqrt((u / 1.8) ** 2 + v ** 2) * np.clip(1 + 0.35 * noise(rng, (H, W), max(4, scale_m / P / 6)), 0.65, None)
               + 0.06 * scale_m * noise(rng, (H, W), max(2, scale_m / P / 40)))
    burnable = ~water
    target_px = z["official_ha"] * 1e4 / P ** 2
    a_final = np.sort(arrival[forest].ravel())[int(min(target_px, forest.sum() - 1))]   # official area = burned woodland
    severity = np.clip(0.65 + 0.25 * noise(rng, (H, W), 6), 0.2, 1)
    f0, f1 = date.fromisoformat(z["fire_start"]), date.fromisoformat(z["fire_end"])

    with open(C.zone_paths(zone)["granules"]) as f:
        granules = list(csv.DictReader(f))
    track_bias = {}
    for g in granules:
        t = date.fromisoformat(g["date"])
        doy = t.timetuple().tm_yday
        green = 1.6 * np.exp(-((doy - 110) / 45) ** 2)                 # spring greening of fields
        wet = 1.0 if (doy < 100 or doy > 290) else 0.0                 # wet season: brighter HH
        frac = np.clip((t - f0).days / max(1, (f1 - f0).days), 0, 1)
        burned = burnable & (arrival < a_final * frac ** 0.6) if t > f0 else np.zeros((H, W), bool)
        regrow = np.clip((t - date(2026, 9, 20)).days / 30, 0, 2) * 0.6 if t > date(2026, 9, 20) else 0
        b = track_bias.setdefault(g["track"], rng.normal(0, 0.5))
        hv = np.where(forest, -12.5 + 0.6 * texture, -20.0 + green + 0.8 * texture) + b
        hh = np.where(forest, -7.5 + 0.5 * texture, -11.0 + 0.5 * green + wet + 0.8 * texture) + b
        loss = np.where(forest, 3.0 + 4.5 * severity, 1.5 * severity) - regrow
        hv = np.where(burned, hv - np.maximum(loss, 0.5), hv)
        hh = np.where(burned, hh - 0.4 * np.maximum(loss, 0.5), hh)
        hv = np.where(water, -28.0, hv)
        hh = np.where(water, -22.0, hh)
        P_hh = (10 ** (hh / 10) * rng.gamma(4, 0.25, (H, W))).astype("float32")
        P_hv = (10 ** (hv / 10) * rng.gamma(4, 0.25, (H, W))).astype("float32")
        if g["frame"] == "071":                                        # two adjacent frames of one pass:
            P_hh[H // 2 + 20:], P_hv[H // 2 + 20:] = np.nan, np.nan    # 071 = north part, 072 = south part
        elif g["frame"] == "072" and zone == "sefrou":
            P_hh[:H // 2 - 20], P_hv[:H // 2 - 20] = np.nan, np.nan
        out = C.zone_paths(zone)["raw"] / f"DEMO_{g['granule']}"
        out.mkdir(parents=True, exist_ok=True)
        off = (int(g["track"]) % 7) * 3
        for pol, arr in (("HHHH", P_hh), ("HVHV", P_hv)):
            with rasterio.open(out / f"{g['granule']}_{pol}.tif", "w", driver="GTiff", height=H, width=W,
                               count=1, dtype="float32", crs=z["crs"], transform=from_origin(x0 + off, y1 - off, P, P),
                               nodata=np.nan, compress="deflate", predictor=3) as dst:
                dst.write(arr, 1)
                dst.set_band_description(1, pol)
        print(f"DEMO {zone} {g['date']} trk {g['track']} burned {burned.sum() * P * P / 1e4:8.0f} ha")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", default="all", choices=["all", *C.ZONES])
    a = ap.parse_args()
    for zone in (C.ZONES if a.zone == "all" else [a.zone]):
        make(zone)


if __name__ == "__main__":
    main()
