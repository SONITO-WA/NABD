"""Step 2 - download ONLY the zone window of each NISAR GCOV granule (HH + HV).

A full GCOV file is 5-7.5 GB; we never download it whole:
  harmony (default)  NASA Harmony crops on the server -> small GeoTIFFs
  stream             reads only the needed bytes of the .h5 over HTTPS (h5py + fsspec)

Needs a free NASA Earthdata Login stored in ~/.netrc (Windows: %USERPROFILE%\\_netrc):
    machine urs.earthdata.nasa.gov login YOUR_USERNAME password YOUR_PASSWORD

    python scripts/02_download.py --zone avila --limit 2      # quick test first
    python scripts/02_download.py --zone avila
    python scripts/02_download.py --zone all --track 087
    python scripts/02_download.py --zone sefrou --method stream
    python scripts/02_download.py --zone avila --fresh       # after changing the bbox in config.py
"""
import argparse
import csv
import sys
import traceback

import numpy as np

import config as C


def load(zone, track=None, limit=None):
    with open(C.zone_paths(zone)["granules"]) as f:
        rows = list(csv.DictReader(f))
    if track:
        rows = [r for r in rows if r["track"] == track]
    return rows[:limit] if limit else rows


def done(zone, name):
    d = C.zone_paths(zone)["raw"] / name
    return d.exists() and len(list(d.glob("*.tif"))) >= 2


def clear_old(out):
    """A granule folder must hold one download only (old crops would be picked up first)."""
    for f in out.glob("*.tif"):
        f.unlink()


def download_harmony(zone, rows):
    from harmony import BBox, Client, Collection, Request

    client = Client()                               # uses ~/.netrc
    w, s, e, n = C.ZONES[zone]["bbox"]
    jobs = []
    for r in rows:
        req = Request(collection=Collection(id=C.GCOV_COLLECTIONS[r.get("collection") or
                                                                   "NISAR_L2_GCOV_PROVISIONAL_V1"]),
                      granule_name=[r["granule"]], spatial=BBox(w, s, e, n),
                      variables=C.GCOV_VARIABLES, format="image/tiff")
        if not req.is_valid():
            print("  invalid request:", req.error_messages())
            continue
        jobs.append((r, client.submit(req)))
        print(f"  submitted {r['date']} track {r['track']}")
    failed = []
    for r, job in jobs:
        out = C.zone_paths(zone)["raw"] / r["granule"]
        out.mkdir(parents=True, exist_ok=True)
        try:
            client.wait_for_processing(job, show_progress=True)
            clear_old(out)
            files = [f.result() for f in client.download_all(job, directory=str(out), overwrite=True)]
            print(f"  {r['date']}: {len(files)} file(s)")
        except Exception as exc:                      # noqa: BLE001
            print(f"  {r['date']}: Harmony failed ({exc})")
            failed.append(r)
    return failed


def download_stream(zone, rows):
    import earthaccess
    import h5py
    import rasterio
    from pyproj import Transformer
    from rasterio.transform import from_origin

    earthaccess.login(strategy="netrc")
    fs = earthaccess.get_fsspec_https_session()
    w, s, e, n = C.ZONES[zone]["bbox"]
    failed = []
    for r in rows:
        out = C.zone_paths(zone)["raw"] / r["granule"]
        out.mkdir(parents=True, exist_ok=True)
        try:
            print(f"  streaming {r['date']} track {r['track']} ...")
            clear_old(out)
            with fs.open(r["h5_url"], cache_type="background", block_size=8 * 1024 * 1024) as fo, \
                    h5py.File(fo, "r") as h5:
                grid = "science/LSAR/GCOV/grids/frequencyA"
                x, y = h5[f"{grid}/xCoordinates"][:], h5[f"{grid}/yCoordinates"][:]
                proj = h5[f"{grid}/projection"]
                epsg = int(proj.attrs.get("epsg_code", proj[()] if proj.shape == () else 0))
                xs, ys = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform(
                    [w, e, w, e], [s, s, n, n])
                xi = np.where((x >= min(xs)) & (x <= max(xs)))[0]
                yi = np.where((y >= min(ys)) & (y <= max(ys)))[0]
                if not len(xi) or not len(yi):
                    raise RuntimeError("granule does not overlap the zone")
                x0, x1, y0, y1 = xi[0], xi[-1] + 1, yi[0], yi[-1] + 1
                dx, dy = float(x[1] - x[0]), float(y[1] - y[0])
                transform = from_origin(x[x0] - dx / 2, y[y0] - dy / 2, dx, -dy)
                for var in C.GCOV_VARIABLES:
                    pol = var.rsplit("/", 1)[-1]
                    if var.lstrip("/") not in h5:
                        continue
                    arr = h5[var.lstrip("/")][y0:y1, x0:x1].astype("float32")
                    with rasterio.open(out / f"{r['granule']}_{pol}.tif", "w", driver="GTiff",
                                       height=arr.shape[0], width=arr.shape[1], count=1, dtype="float32",
                                       crs=f"EPSG:{epsg}", transform=transform, nodata=np.nan,
                                       compress="deflate") as dst:
                        dst.write(arr, 1)
                        dst.set_band_description(1, pol)
            print(f"    ok ({y1 - y0} x {x1 - x0} px)")
        except Exception:                              # noqa: BLE001
            traceback.print_exc()
            failed.append(r)
    return failed


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", default="all", choices=["all", *C.ZONES])
    ap.add_argument("--method", choices=["harmony", "stream"], default="harmony")
    ap.add_argument("--track")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--fresh", action="store_true", help="download again even if already there (new bbox)")
    a = ap.parse_args()
    bad = []
    for zone in (C.ZONES if a.zone == "all" else [a.zone]):
        rows = [r for r in load(zone, a.track, a.limit) if a.fresh or not done(zone, r["granule"])]
        print(f"[{zone}] {len(rows)} granule(s) to download with {a.method}")
        if not rows:
            continue
        failed = download_harmony(zone, rows) if a.method == "harmony" else download_stream(zone, rows)
        if failed and a.method == "harmony":
            print(f"  {len(failed)} failed with Harmony, retrying by streaming ...")
            failed = download_stream(zone, failed)
        bad += [f"{zone} {r['date']}" for r in failed]
    if bad:
        print("\nStill failed:", ", ".join(bad))
        sys.exit(1)
    print("\nDone. Next: python scripts/03_fire.py --zone all")


if __name__ == "__main__":
    main()
