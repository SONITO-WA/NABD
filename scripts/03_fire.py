"""Step 3 - burn scar, severity, fire progression and recovery from NISAR L-band.

Physics: L-band HV backscatter (volume scattering) comes mostly from branches and
trunks. When a forest burns, HV collapses by several dB. Radar sees through smoke,
day and night, so every 12-day pass counts.

Per zone:
  1. every acquisition: mosaic adjacent frames, Lee filter, dB  ->  radar picture
  2. per orbit track: every pass is calibrated against the unburned part of the scene,
     then dHV = median(passes 10-120 days AFTER) - median(passes up to 75 days BEFORE).
     Tracks are averaged (several viewing geometries agreeing = robust result) and the
     map is lightly smoothed (45 m)
  3. burned = vegetation before (HV > -22 dB) and dHV < -1 dB; only the patches connected
     to the fire are kept; perimeter = scar with gaps < 200 m closed; severity classes
  4. progression: for each pass, which burned pixels had already dropped
  5. pulse: mean HV in the scar minus mean HV of intact forest, pass by pass
     (the difference cancels seasonal and calibration effects)

    python scripts/03_fire.py --zone avila
    python scripts/03_fire.py --zone all
"""
import argparse
import json
import warnings
from collections import defaultdict
from datetime import date, timedelta

import numpy as np
from pyproj import Transformer
from scipy import ndimage

import config as C
from common import Grid, acquisitions, db, encode_cube, lee_filter, radar_rgba, save_rgba

warnings.filterwarnings("ignore", category=RuntimeWarning)
SEV_COLORS = {1: (253, 224, 71), 2: (249, 115, 22), 3: (190, 18, 60)}       # low / moderate / high


def d(iso):
    return date.fromisoformat(iso)


def gsmooth(a, sigma):
    """Gaussian smoothing that ignores no-data pixels."""
    ok = np.isfinite(a)
    w = ndimage.gaussian_filter(ok.astype("float32"), sigma)
    out = ndimage.gaussian_filter(np.where(ok, a, 0).astype("float32"), sigma) / np.maximum(w, 1e-3)
    out[~ok] = np.nan
    return out


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def connected_fire(core, grid, z):
    """Keep the fire, not every change in the zone (clear-cuts, harvests, lakes):
    start from the biggest patch near the reported ignition point, then add every patch
    within link_m of what is already kept (spot fires, fragmented fronts)."""
    lab, n = ndimage.label(core)
    if n == 0:
        return core
    idx = np.arange(1, n + 1)
    sizes = ndimage.sum(core, lab, idx) * grid.px_ha
    big = sizes >= z.get("min_patch_ha", 3)
    tf = Transformer.from_crs("EPSG:4326", grid.crs, always_xy=True)
    x, y = tf.transform(z["ignition"][1], z["ignition"][0])
    col, row = ~grid.T * (x, y)
    rr, cc = np.ogrid[:core.shape[0], :core.shape[1]]
    dist_km = np.hypot(rr - row, cc - col) * grid.p / 1000
    near = ndimage.minimum(dist_km, lab, idx) <= z.get("search_km", 10)
    cand = np.where(big & near)[0]
    if cand.size == 0:
        cand = np.where(big)[0]
    if cand.size == 0:
        return np.zeros_like(core)
    keep = np.zeros(n + 1, bool)
    keep[idx[cand[np.argmax(sizes[cand])]]] = True
    link = z.get("link_m", 1000)
    while True:
        gap_m = ndimage.distance_transform_edt(~keep[lab]) * grid.p   # distance to what is kept
        touched = np.unique(lab[(gap_m <= link) & core])
        new = [l for l in touched if l and not keep[l] and big[l - 1]]
        if not new:
            break
        keep[new] = True
    return keep[lab]


def ramp(t, stops):
    stops = np.asarray(stops, float)
    t = np.clip(np.nan_to_num(t), 0, 1) * (len(stops) - 1)
    i = np.minimum(t.astype(int), len(stops) - 2)
    f = (t - i)[..., None]
    return (stops[i] * (1 - f) + stops[i + 1] * f).astype(np.uint8)


def run(zone):
    z, paths, grid = C.ZONES[zone], C.zone_paths(zone), Grid(zone)
    for k in ("layers", "work"):
        paths[k].mkdir(parents=True, exist_ok=True)
    for old in [*paths["layers"].glob("*.png"), *paths["layers"].glob("*.webp")]:
        old.unlink()
    acqs = acquisitions(zone)
    if not acqs:
        print(f"[{zone}] no data in {paths['raw']} - run 02_download.py (or 00_make_demo.py)")
        return
    f0, f1 = d(z["fire_start"]), d(z["fire_end"])
    print(f"[{zone}] {len(acqs)} acquisitions, fire {f0} -> {f1}")

    # 1. every acquisition ------------------------------------------------------------
    hh_s, hv_s, recs = [], [], []
    for a in acqs:
        hh = db(lee_filter(grid.mosaic(a["HH"]), C.SPECKLE_WINDOW))
        hv = db(lee_filter(grid.mosaic(a["HV"]), C.SPECKLE_WINDOW))
        rim = ~ndimage.binary_erosion(np.isfinite(hv) & np.isfinite(hh), iterations=C.EDGE_TRIM_PX)
        hh[rim], hv[rim] = np.nan, np.nan                               # swath edges are unreliable
        cov = float(np.isfinite(hv).mean())
        key = f"{a['date']}_{a['track']}"
        save_rgba(paths["layers"] / f"radar_{key}.webp", radar_rgba(grid, hh, hv), max_w=1400)
        when = "before" if d(a["date"]) < f0 else ("during" if d(a["date"]) <= f1 else "after")
        recs.append({k: a[k] for k in ("date", "time_utc", "track", "direction", "cycle")} |
                    {"key": key, "coverage": round(cov, 3), "partial": cov < C.MIN_COVERAGE,
                     "phase": when, "granules": a["granules"],
                     "radar": f"data/layers/{zone}/radar_{key}.webp"})
        hh_s.append(hh)
        hv_s.append(hv)
        print(f"   {a['date']} trk {a['track']} ({len(a['HH'])} frame(s)) cover {cov:.0%} {when}")

    # 2. before / after per track ---------------------------------------------------------
    by_track = defaultdict(list)
    for i, r in enumerate(recs):
        if not r["partial"]:
            by_track[r["track"]].append(i)
    sig = C.SMOOTH_M / grid.p

    def change(stable):
        """Per track: calibrate each pass on the stable (unburned) area, then
        dHV = median(after passes) - median(before passes)."""
        out, used, off = {}, {}, {}
        for trk, idx in by_track.items():
            med = {i: float(np.nanmedian(hv_s[i][stable & np.isfinite(hv_s[i])])) for i in idx}
            ref = float(np.median(list(med.values())))
            good = [i for i in idx if abs(med[i] - ref) < C.OUTLIER_DB]
            pre = [i for i in good if f0 - timedelta(days=C.PRE_WINDOW_DAYS) <= d(recs[i]["date"]) < f0]
            if len(pre) < C.PRE_MIN:                                    # fall back to the last passes before
                pre = [i for i in good if d(recs[i]["date"]) < f0][-4:]
            post = [i for i in good if f1 + timedelta(days=C.POST_DELAY_DAYS) <= d(recs[i]["date"])
                    <= f1 + timedelta(days=C.POST_WINDOW_DAYS)]
            if len(pre) < C.PRE_MIN or not post:
                continue
            for i in idx:
                off[i] = med[i]
            pre_n = np.nanmedian(np.stack([hv_s[i] - med[i] for i in pre]), 0)
            post_n = np.nanmedian(np.stack([hv_s[i] - med[i] for i in post]), 0)
            out[trk] = {"dhv": post_n - pre_n, "pre_n": pre_n,
                        "pre": np.nanmedian(np.stack([hv_s[i] for i in pre]), 0), "pre_i": pre, "post_i": post}
            used[trk] = {"before": [recs[i]["date"] for i in pre], "after": [recs[i]["date"] for i in post],
                         "direction": recs[idx[0]]["direction"],
                         "discarded": [recs[i]["date"] for i in idx if i not in good]}
        return out, used, off

    every = np.ones(hv_s[0].shape, bool)
    tr, used, off = change(every)                                       # pass 1: whole scene as reference
    if not tr:
        print(f"[{zone}] not enough acquisitions before AND after the fire on any track")
        return
    rough = gsmooth(np.nanmean(np.stack([v["dhv"] for v in tr.values()]), 0), sig) < C.BURN_DHV
    stable = ~ndimage.binary_dilation(rough, iterations=max(5, int(500 / grid.p)))
    tr, used, off = change(stable)                                      # pass 2: unburned area as reference
    dhv_raw = np.nanmean(np.stack([v["dhv"] for v in tr.values()]), 0)
    dhv = gsmooth(dhv_raw, sig)
    pre_hv = np.nanmean(np.stack([v["pre"] for v in tr.values()]), 0)
    agree = np.sum(np.stack([gsmooth(v["dhv"], sig) < C.BURN_DHV for v in tr.values()]), 0)
    for t_, v in used.items():
        print(f"   track {t_}: {len(v['before'])} before, {len(v['after'])} after"
              + (f", discarded {v['discarded']}" if v["discarded"] else ""))

    # 3. burn scar, perimeter & severity ---------------------------------------------------
    veg = pre_hv > C.VEG_HV_MIN
    core = veg & (dhv < C.BURN_DHV)
    core = ndimage.binary_opening(core, iterations=1)                   # thin seams / roads
    core = ndimage.binary_closing(core, iterations=2)
    core = ndimage.binary_fill_holes(core) & np.isfinite(dhv)
    burn = connected_fire(core, grid, z)
    r = max(1, int(round(C.PERIMETER_CLOSE_M / grid.p)))
    perim = ndimage.binary_closing(np.pad(burn, r), structure=disk(r))[r:-r, r:-r]
    perim = ndimage.binary_fill_holes(perim) & np.isfinite(dhv)
    lo, mid, hi = C.SEVERITY_DHV
    sev = np.zeros(burn.shape, np.uint8)
    sev[burn] = 1
    sev[burn & (dhv < mid)] = 2
    sev[burn & (dhv < hi)] = 3
    area = {k: round(float((sev == v).sum() * grid.px_ha)) for k, v in (("low", 1), ("moderate", 2), ("high", 3))}
    area_ha = int(perim.sum() * grid.px_ha)
    detected_ha = int(burn.sum() * grid.px_ha)
    control = veg & ~ndimage.binary_dilation(perim, iterations=max(3, int(600 / grid.p))) & np.isfinite(dhv)
    outside = ndimage.binary_dilation(np.pad(~np.isfinite(dhv), 1, constant_values=True), iterations=3)[1:-1, 1:-1]
    edge = perim & outside                                              # scar cut by the edge of the data
    print(f"   burned: perimeter {area_ha:,} ha, detected {detected_ha:,} ha "
          f"(official {z['official_ha']:,} ha) | {area}" + ("  [scar cut by the edge of the zone]" if edge.sum() / 3 * grid.p > 2000 else ""))
    grid.save_tif(paths["work"] / "dHV_dB.tif", dhv)
    grid.save_tif(paths["work"] / "severity.tif", sev, "uint8")

    # 4. progression + 5. pulse ----------------------------------------------------------
    pre_n_t = {t_: v["pre_n"] for t_, v in tr.items()}
    bad = {i for i, r_ in enumerate(recs) if any(r_["date"] in u["discarded"] and r_["track"] == t_
                                                for t_, u in used.items())}
    first_seen = np.full(burn.shape, -1, np.int16)
    for i, r_ in enumerate(recs):
        trk = r_["track"]
        scar_v, ctrl_v = hv_s[i][burn], hv_s[i][control]
        r_["scar_hv"] = round(float(np.nanmean(scar_v)), 2) if np.isfinite(scar_v).any() else None
        r_["control_hv"] = round(float(np.nanmean(ctrl_v)), 2) if np.isfinite(ctrl_v).any() else None
        r_["contrast"] = (round(r_["scar_hv"] - r_["control_hv"], 2)
                          if r_["scar_hv"] is not None and r_["control_hv"] is not None else None)
        if i in bad:                                                    # calibration jump: not plotted
            r_["outlier"] = True
            r_["contrast"] = r_["burned_frac"] = None
            continue
        if trk in pre_n_t and i in off:
            step = gsmooth(hv_s[i] - off[i] - pre_n_t[trk], sig)
            dropped = burn & (step < C.STEP_DHV)
            valid = burn & np.isfinite(step)
            r_["burned_frac"] = round(float(dropped.sum() / max(1, valid.sum())), 3)
            if r_["phase"] == "during" and not r_["partial"]:              # caught while still burning
                first_seen[(first_seen < 0) & dropped] = i
        else:
            r_["burned_frac"] = None
    left = burn & (first_seen < 0)                                      # the rest burned before the
    if left.any():                                                      # first pass after the fire
        firsts = [i for i, r_ in enumerate(recs) if r_["phase"] == "after" and not r_["partial"] and i not in bad]
        if firsts:
            first_seen[left] = firsts[0]

    # layers --------------------------------------------------------------------------------
    L = paths["layers"]
    dsev = grid.to_display(sev.astype("float32"))
    rgba = np.zeros((grid.dH, grid.dW, 4), np.uint8)
    for v, col in SEV_COLORS.items():
        rgba[dsev == v] = (*col, 235)
    save_rgba(L / "severity.png", rgba)

    ddhv = grid.to_display(np.where(veg, dhv, np.nan))
    t = (np.clip(ddhv, -8, 4) + 8) / 12                               # -8 dB .. +4 dB
    rgba = np.zeros((grid.dH, grid.dW, 4), np.uint8)
    rgba[..., :3] = ramp(t, [[127, 29, 29], [234, 88, 12], [253, 230, 138], [241, 245, 249], [56, 189, 248]])
    rgba[..., 3] = np.where(np.isfinite(ddhv), 215, 0)
    save_rgba(L / "dhv.png", rgba)

    dfs = grid.to_display(np.where(first_seen >= 0, first_seen, np.nan).astype("float32"))
    seen_idx = sorted({int(i) for i in np.unique(first_seen) if i >= 0})
    prog_legend = []
    rgba = np.zeros((grid.dH, grid.dW, 4), np.uint8)
    palette = [[254, 240, 138], [251, 191, 36], [249, 115, 22], [220, 38, 38], [136, 19, 55], [76, 5, 25]]
    big = [i for i in seen_idx if (first_seen == i).sum() * grid.px_ha >= max(2.0, 0.01 * area_ha)]
    rest_ha = 0
    for i in seen_idx:
        ha = int((first_seen == i).sum() * grid.px_ha)
        if i in big:
            col = palette[min(big.index(i), len(palette) - 1)]
            prog_legend.append({"date": recs[i]["date"], "track": recs[i]["track"],
                                "color": "#%02x%02x%02x" % tuple(col), "ha": ha})
        else:
            col, rest_ha = [148, 163, 184], rest_ha + ha               # stragglers: grey
        rgba[dfs == i] = (*col, 235)
    if rest_ha:
        prog_legend.append({"date": None, "track": None, "color": "#94a3b8", "ha": rest_ha})
    save_rgba(L / "progression.png", rgba)

    # before / after composites from the primary track for the swipe view
    primary = max(used, key=lambda k: len(by_track[k]))
    pb = [i for i in by_track[primary] if recs[i]["date"] in used[primary]["before"]]
    pa = [i for i in by_track[primary] if recs[i]["date"] in used[primary]["after"]]
    save_rgba(L / "before.webp", max_w=1600, rgba=radar_rgba(grid, np.nanmedian(np.stack([hh_s[i] for i in pb]), 0),
                                            np.nanmedian(np.stack([hv_s[i] for i in pb]), 0)))
    save_rgba(L / "after.webp", max_w=1600, rgba=radar_rgba(grid, np.nanmedian(np.stack([hh_s[i] for i in pa]), 0),
                                           np.nanmedian(np.stack([hv_s[i] for i in pa]), 0)))

    # sound cube: HV relative to intact forest of the same pass
    rel = np.stack([hv_s[i] - (recs[i]["control_hv"] if recs[i]["control_hv"] is not None else np.nan)
                    for i in range(len(recs))])
    cube = {**encode_cube(grid, rel, lo=-12.0, hi=6.0), "keys": [r["key"] for r in recs]}

    rows, cols = np.where(grid.to_display(perim.astype("float32")) > 0.5)
    w, s_, e, n = grid.bbox
    if rows.size:
        pad = max(8, int(0.15 * max(np.ptp(rows), np.ptp(cols))))
        r0, r1 = max(0, rows.min() - pad), min(grid.dH - 1, rows.max() + pad)
        c0, c1 = max(0, cols.min() - pad), min(grid.dW - 1, cols.max() + pad)
        lat = lambda r: n - (n - s_) * r / grid.dH
        lon = lambda c: w + (e - w) * c / grid.dW
        focus = [[lat(r1), lon(c0)], [lat(r0), lon(c1)]]
    else:
        focus = grid.leaflet_bounds

    out = {
        "zone": zone, "focus": focus, "name": z["name"], "country": z["country"], "bounds": grid.leaflet_bounds,
        "pixel_m": grid.p, "fire_start": z["fire_start"], "fire_end": z["fire_end"],
        "ignition": z["ignition"], "official_ha": z["official_ha"], "official_note": z["official_note"],
        "demo": any(a.get("demo") for a in acqs),
        "acquisitions": recs, "tracks_used": used, "primary_track": primary,
        "burn": {"area_ha": area_ha, "detected_ha": detected_ha, "by_severity_ha": area,
                 "touches_edge": bool(edge.sum() / 3 * grid.p > 2000), "method": "v2",
                 "mean_dhv": round(float(np.nanmean(dhv[burn])), 2) if burn.any() else None,
                 "tracks_agree_pct": round(float(np.mean(agree[burn] >= 2) * 100), 1) if burn.any() and len(tr) > 1 else None,
                 "forest_ha": int(veg.sum() * grid.px_ha)},
        "layers": {"severity": f"data/layers/{zone}/severity.png", "dhv": f"data/layers/{zone}/dhv.png",
                   "progression": f"data/layers/{zone}/progression.png",
                   "before": f"data/layers/{zone}/before.webp", "after": f"data/layers/{zone}/after.webp"},
        "progression": prog_legend,
        "cube": cube,
    }
    paths["json"].write_text(json.dumps(out), encoding="utf-8")
    print(f"   -> {paths['json'].name}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", default="all", choices=["all", *C.ZONES])
    a = ap.parse_args()
    for zone in (C.ZONES if a.zone == "all" else [a.zone]):
        run(zone)
    print("Next: python scripts/04_export.py")


if __name__ == "__main__":
    main()
