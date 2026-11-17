"""Step 5 (optional) - cross-check the radar burn map with NASA OPERA DIST-ALERT (optical: Landsat + Sentinel-2)

OPERA DIST-ALERT-HLS flags vegetation loss every few days from the Harmonized Landsat Sentinel-2
(HLS) archive. It is one of the NASA resources of the challenge. Optical satellites cannot see through
cloud or smoke, radar can - but where the optical data is clear, the two should agree.

For each zone this script:
  1. finds the OPERA DIST-ALERT granules over the zone after the fire (no download yet),
  2. downloads only two small layers per MGRS tile: VEG-DIST-STATUS and VEG-DIST-DATE,
  3. puts them on the same grid as the radar analysis,
  4. measures how much of the radar scar the optical product confirms,
  5. writes data/work/<zone>_dist.json and web/data/layers/<zone>/dist.png.

    python scripts/05_dist.py --zone all
    python scripts/04_export.py           # then refresh the web page

Needs the Earthdata login already used for step 2.
"""
import argparse
import json
import re
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import reproject, Resampling
from scipy import ndimage

import config as C
from common import Grid, save_rgba

SHORT_NAME = "OPERA_L3_DIST-ALERT-HLS_V1"
LAYERS = ("VEG-DIST-STATUS", "VEG-DIST-DATE")
# VEG-DIST-STATUS (OPERA DIST-ALERT v1): 0 none, 1 first detection <50 %, 2 provisional <50 %, 3 confirmed <50 %,
# 4 first detection >=50 %, 5 provisional >=50 %, 6 confirmed >=50 %, 7 finished <50 %, 8 finished >=50 %, 255 no data
DISTURBED = (2, 3, 5, 6, 7, 8)
DATE0 = date(2020, 12, 31)                     # VEG-DIST-DATE counts days since this date


def d(s):
    return date.fromisoformat(s)


def tile_of(name):
    m = re.search(r"_T(\d{2}[A-Z]{3})_", name)
    return m.group(1) if m else name


def when_of(name):
    m = re.search(r"_(\d{8})T\d{6}Z_", name)
    return m.group(1) if m else ""


def search(zone):
    import earthaccess
    z = C.ZONES[zone]
    t0, t1 = d(z["fire_end"]) + timedelta(days=3), d(z["fire_end"]) + timedelta(days=80)
    res = earthaccess.search_data(short_name=SHORT_NAME, bounding_box=z["bbox"], temporal=(t0.isoformat(), t1.isoformat()), count=-1)
    latest = {}
    for g in res:
        name = g["umm"]["GranuleUR"]
        k = tile_of(name)
        if k not in latest or when_of(name) > when_of(latest[k]["umm"]["GranuleUR"]):
            latest[k] = g
    print(f"[{zone}] {len(res)} OPERA DIST-ALERT granules after the fire, {len(latest)} tile(s): {', '.join(sorted(latest))}")
    return list(latest.values())


def download(zone, granules):
    import earthaccess
    out = C.DATA / "raw" / f"{zone}_dist"
    out.mkdir(parents=True, exist_ok=True)
    urls = [u for g in granules for u in g.data_links() if any(u.endswith(f"_{L}.tif") for L in LAYERS)]
    have = {p.name for p in out.glob("*.tif")}
    todo = [u for u in urls if u.rsplit("/", 1)[-1] not in have]
    if todo:
        earthaccess.download(todo, str(out))
    return sorted(out.glob("*.tif"))


def on_grid(grid, path):
    """Categorical raster -> analysis grid (nearest neighbour, 255 = no data)."""
    out = np.full((grid.H, grid.W), 255, dtype="int32")
    with rasterio.open(path) as src:
        a = src.read(1).astype("int32")
        reproject(a, out, src_transform=src.transform, src_crs=src.crs, dst_transform=grid.T, dst_crs=grid.crs,
                  src_nodata=src.nodata if src.nodata is not None else 255, dst_nodata=255, resampling=Resampling.nearest)
    return out


def compare(zone, files):
    z, paths, grid = C.ZONES[zone], C.zone_paths(zone), Grid(zone)
    sev_path = paths["work"] / "severity.tif"
    if not sev_path.exists():
        print(f"[{zone}] run 03_fire.py first (no severity.tif)"); return None
    with rasterio.open(sev_path) as s:
        radar = s.read(1) > 0
    status = np.full((grid.H, grid.W), 255, "int32"); ddate = np.zeros((grid.H, grid.W), "int32")
    by_tile = {}
    for f in files:
        for L in LAYERS:
            if f.name.endswith(f"_{L}.tif"):
                by_tile.setdefault(f.name.replace(f"_{L}.tif", ""), {})[L] = f
    for stem, lay in by_tile.items():
        if "VEG-DIST-STATUS" not in lay:
            continue
        st = on_grid(grid, lay["VEG-DIST-STATUS"])
        dt = on_grid(grid, lay["VEG-DIST-DATE"]) if "VEG-DIST-DATE" in lay else np.zeros_like(st)
        take = (st != 255) & ((status == 255) | np.isin(st, DISTURBED))   # several tiles: keep any disturbance
        status[take] = st[take]; ddate[take] = dt[take]
    valid = status != 255
    vals, cnt = np.unique(status[valid], return_counts=True)
    print(f"   status values on the grid: {dict(zip(vals.tolist(), cnt.tolist()))}")
    f0 = (d(z["fire_start"]) - DATE0).days - 5
    f1 = (d(z["fire_end"]) - DATE0).days + 60
    dated = (ddate <= 0) | ((ddate >= f0) & (ddate <= f1))                  # loss dated in the fire window
    optical = valid & np.isin(status, DISTURBED) & dated
    near = ndimage.binary_dilation(radar, iterations=max(1, int(1000 / grid.p)))   # within 1 km of the scar
    seen = radar & valid
    agree = radar & optical
    out = {
        "agree_pct": round(float(agree.sum() / max(1, seen.sum()) * 100), 1),
        "masked_pct": round(float((radar & ~valid).sum() / max(1, radar.sum()) * 100), 1),
        "optical_ha": int((optical & near).sum() * grid.px_ha),
        "overlap_ha": int(agree.sum() * grid.px_ha),
        "radar_ha": int(radar.sum() * grid.px_ha),
        "tiles": sorted(by_tile), "product": SHORT_NAME,
        "layer": f"data/layers/{zone}/dist.png",
    }
    rgba = np.zeros((grid.dH, grid.dW, 4), np.uint8)
    a_d = grid.to_display(agree.astype("float32")) > 0.5
    o_d = grid.to_display((optical & near & ~radar).astype("float32")) > 0.5
    rgba[a_d] = (34, 211, 238, 210); rgba[o_d] = (232, 121, 249, 200)
    paths["layers"].mkdir(parents=True, exist_ok=True)
    save_rgba(paths["layers"] / "dist.png", rgba, max_w=1600)
    (C.DATA / "work" / f"{zone}_dist.json").write_text(json.dumps(out), encoding="utf-8")
    print(f"   radar scar confirmed by optical: {out['agree_pct']} % (optical hidden by cloud/smoke on {out['masked_pct']} %)")
    print(f"   optical vegetation loss within 1 km of the scar: {out['optical_ha']:,} ha   -> {zone}_dist.json")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", default="all")
    ap.add_argument("--local", action="store_true", help="skip search/download, use files already in data/raw/<zone>_dist")
    a = ap.parse_args()
    zones = list(C.ZONES) if a.zone == "all" else [a.zone]
    if not a.local:
        import earthaccess
        earthaccess.login()
    for zone in zones:
        if a.local:
            files = sorted((C.DATA / "raw" / f"{zone}_dist").glob("*.tif"))
        else:
            gr = search(zone)
            if not gr:
                print(f"[{zone}] no OPERA DIST-ALERT granule found after the fire"); continue
            files = download(zone, gr)
        if not files:
            print(f"[{zone}] no DIST files"); continue
        compare(zone, files)
    print("Next: python scripts/04_export.py")


if __name__ == "__main__":
    main()
