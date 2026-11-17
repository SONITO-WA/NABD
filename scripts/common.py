"""Helpers shared by the pipeline scripts."""
import base64
import math
import re
from collections import defaultdict
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import reproject, transform_bounds
from scipy import ndimage

import config as C

NAME_RE = re.compile(r"GCOV_(\d{3})_(\d{3})_([AD])_(\d{3})_.*?_(\d{8})T(\d{6})_")
POL_RE = re.compile(r"_\d{4}_([A-Z]{4})_[A-Z]_\d{8}T")


def parse_granule(name):
    m = NAME_RE.search(name)
    if not m:
        return None
    cyc, trk, d, frame, ymd, hms = m.groups()
    pol = POL_RE.search(name)
    return {"cycle": cyc, "track": trk, "frame": frame,
            "direction": "ascending" if d == "A" else "descending",
            "date": f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}", "time_utc": f"{hms[:2]}:{hms[2:4]}",
            "pol": pol.group(1) if pol else ""}


def usable(name):
    """Frequency A must carry both HH and HV (dual-pol H or quad-pol)."""
    info = parse_granule(name)
    return bool(info) and info["pol"][:2] in ("DH", "QP")


class Grid:
    """Common analysis grid (UTM) + display grid (lat/lon) for one zone."""

    def __init__(self, zone: str):
        z = C.ZONES[zone]
        self.zone, self.bbox, self.crs, self.p = zone, z["bbox"], z["crs"], z["pixel_m"]
        w, s, e, n = transform_bounds("EPSG:4326", self.crs, *self.bbox, densify_pts=21)
        p = self.p
        w, s = math.floor(w / p) * p, math.floor(s / p) * p
        e, n = math.ceil(e / p) * p, math.ceil(n / p) * p
        self.W, self.H = int((e - w) / p), int((n - s) / p)
        self.T = from_origin(w, n, p, p)
        bw, bs, be, bn = self.bbox
        lat0 = math.radians((bs + bn) / 2)
        self.dW = int(round((be - bw) * 111320 * math.cos(lat0) / p))
        self.dH = int(round((bn - bs) * 110950 / p))
        self.dT = from_bounds(bw, bs, be, bn, self.dW, self.dH)
        self.px_ha = p * p / 1e4

    def to_grid(self, path, band=1):
        out = np.full((self.H, self.W), np.nan, dtype="float32")
        with rasterio.open(path) as src:
            arr = src.read(band).astype("float32")
            if src.nodata is not None and not np.isnan(src.nodata):
                arr[arr == src.nodata] = np.nan
            arr[arr <= 0] = np.nan
            reproject(arr, out, src_transform=src.transform, src_crs=src.crs,
                      dst_transform=self.T, dst_crs=self.crs, src_nodata=np.nan,
                      dst_nodata=np.nan, resampling=Resampling.average)
        return out

    def mosaic(self, items):
        """Average several (path, band) rasters of the same date & track (adjacent frames)."""
        acc = np.zeros((self.H, self.W), "float64")
        cnt = np.zeros((self.H, self.W), "int16")
        for path, band in items:
            a = self.to_grid(path, band)
            ok = np.isfinite(a)
            acc[ok] += a[ok]
            cnt[ok] += 1
        with np.errstate(invalid="ignore", divide="ignore"):
            out = (acc / cnt).astype("float32")
        out[cnt == 0] = np.nan
        return out

    def to_display(self, arr, resampling=Resampling.nearest):
        out = np.full((self.dH, self.dW), np.nan, dtype="float32")
        reproject(arr.astype("float32"), out, src_transform=self.T, src_crs=self.crs,
                  dst_transform=self.dT, dst_crs="EPSG:4326", src_nodata=np.nan,
                  dst_nodata=np.nan, resampling=resampling)
        return out

    def save_tif(self, path, arr, dtype="float32"):
        with rasterio.open(path, "w", driver="GTiff", height=self.H, width=self.W, count=1,
                           dtype=dtype, crs=self.crs, transform=self.T, compress="deflate") as d:
            d.write(arr.astype(dtype), 1)

    @property
    def leaflet_bounds(self):
        w, s, e, n = self.bbox
        return [[s, w], [n, e]]


def find_pols(folder: Path):
    """{'HH': (path, band), 'HV': (path, band)} from Harmony or stream outputs."""
    found = {}
    keys = (("HH", "HHHH"), ("HV", "HVHV"))
    for tif in sorted(folder.glob("*.tif")):
        for pol, key in keys:
            if key in tif.name.upper() and pol not in found:
                found[pol] = (tif, 1)
        if len(found) < 2:
            with rasterio.open(tif) as src:
                for b, desc in enumerate(src.descriptions or [], start=1):
                    for pol, key in keys:
                        if key in (desc or "").upper() and pol not in found:
                            found[pol] = (tif, b)
    return found


def acquisitions(zone):
    """Group downloaded granules by (date, track): adjacent frames of one pass are mosaicked.
    Returns a date-sorted list of dicts: info + 'HH': [(path, band)...], 'HV': [...]."""
    raw = C.zone_paths(zone)["raw"]
    groups = defaultdict(lambda: {"HH": [], "HV": [], "granules": []})
    for folder in sorted(raw.iterdir()) if raw.exists() else []:
        if not folder.is_dir():
            continue
        info = parse_granule(folder.name)
        pols = find_pols(folder) if info else {}
        if not info or "HH" not in pols or "HV" not in pols:
            print(f"skip {folder.name}: HH/HV not found")
            continue
        g = groups[(info["date"], info["track"])]
        g.update({k: info[k] for k in ("date", "time_utc", "track", "direction", "cycle")})
        g["HH"].append(pols["HH"])
        g["HV"].append(pols["HV"])
        g["granules"].append(folder.name.removeprefix("DEMO_"))
        g["demo"] = folder.name.startswith("DEMO_")
    return [groups[k] for k in sorted(groups)]


def lee_filter(img, size):
    valid = np.isfinite(img)
    x = np.where(valid, img, 0.0)
    cnt = ndimage.uniform_filter(valid.astype("float32"), size)
    cnt[cnt == 0] = np.nan
    mean = ndimage.uniform_filter(x, size) / cnt
    sq = ndimage.uniform_filter(x * x, size) / cnt
    var = np.maximum(sq - mean * mean, 0)
    noise = np.nanmean(var[valid]) if valid.any() else 0
    w = var / (var + noise + 1e-12)
    out = mean + w * (x - mean)
    out[~valid] = np.nan
    return out


def db(x):
    with np.errstate(divide="ignore", invalid="ignore"):
        return 10 * np.log10(x)


def scale(x, lo, hi):
    return np.clip((x - lo) / (hi - lo), 0, 1)


def save_rgba(path, rgba, max_w=None):
    img = Image.fromarray(rgba, "RGBA")
    if max_w and img.width > max_w:                     # lighter web layers; analysis keeps full resolution
        img = img.resize((max_w, round(img.height * max_w / img.width)), Image.LANCZOS)
    if str(path).endswith(".webp"):
        img.save(path, "WEBP", quality=72, method=5)
    else:
        img.save(path, optimize=True)


def radar_rgba(grid, hh_db, hv_db):
    """False colour: R = HH, G = HV (woody vegetation), B = HH/HV ratio.
    Forest looks green/yellow, burned land turns magenta-purple, water black."""
    hh, hv = grid.to_display(hh_db), grid.to_display(hv_db)
    valid = np.isfinite(hh) & np.isfinite(hv)
    rgba = np.zeros((grid.dH, grid.dW, 4), np.uint8)
    for i, ch in enumerate((scale(hh, -20, -2), scale(hv, -28, -9), scale(hh - hv, 3, 13))):
        rgba[..., i] = np.nan_to_num(ch * 255).astype(np.uint8)
    rgba[..., 3] = np.where(valid, 255, 0)
    return rgba


def encode_cube(grid, stack_db, target_w=160, lo=-30.0, hi=-5.0):
    """(T, H, W) dB stack on the analysis grid -> coarse uint8 cube in the lat/lon display
    orientation (date-major, rows, cols), base64. 255 = no data. Used to 'play' a pixel."""
    stack_db = np.stack([grid.to_display(a, Resampling.average) for a in stack_db])
    t, h, w = stack_db.shape
    f = max(1, int(round(w / target_w)))
    h2, w2 = h // f, w // f
    s = stack_db[:, :h2 * f, :w2 * f].reshape(t, h2, f, w2, f)
    with np.errstate(invalid="ignore"), np.errstate(all="ignore"):
        import warnings
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            m = np.nanmean(np.nanmean(s, axis=4), axis=2)
    q = np.where(np.isfinite(m), np.clip((m - lo) / (hi - lo) * 254, 0, 254), 255).astype(np.uint8)
    return {"w": int(w2), "h": int(h2), "t": int(t), "lo": lo, "hi": hi,
            "b64": base64.b64encode(q.tobytes()).decode()}
