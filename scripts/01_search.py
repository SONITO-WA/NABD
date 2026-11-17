"""Step 1 - list every NISAR GCOV granule over a fire zone (no login needed).

Searches the PROVISIONAL and VALIDATED collections, keeps only products whose
frequency A has HH + HV, and keeps the newest version of each product.
Output: data/granules_<zone>.csv

    python scripts/01_search.py --zone avila
    python scripts/01_search.py --zone all
"""
import argparse
import csv
import re

import earthaccess

import config as C
from common import parse_granule, usable

FIELDS = ["granule", "collection", "date", "time_utc", "cycle", "track", "direction", "frame",
          "pol", "size_mb", "h5_url"]
VERSION_RE = re.compile(r"_(\d{3})$")


def search_zone(zone):
    rows, skipped = {}, []
    for short_name in C.GCOV_COLLECTIONS:
        for g in earthaccess.search_data(short_name=short_name, bounding_box=C.ZONES[zone]["bbox"], count=-1):
            name = g["umm"]["GranuleUR"]
            if not usable(name):
                skipped.append(name)
                continue
            info = parse_granule(name)
            h5 = next((u for u in g.data_links(access="external") if u.endswith(".h5")), "")
            key = VERSION_RE.sub("", name)                       # same product, other version
            size = getattr(g, "size", 0)                         # method in old earthaccess, number in new
            size = size() if callable(size) else size
            row = {"granule": name, "collection": short_name, **info,
                   "size_mb": round(float(size or 0)), "h5_url": h5}
            if key not in rows or name > rows[key]["granule"]:
                rows[key] = row
    out_rows = sorted(rows.values(), key=lambda r: (r["date"], r["time_utc"], r["granule"]))
    path = C.zone_paths(zone)["granules"]
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(out_rows)
    tracks = {}
    for r in out_rows:
        tracks.setdefault(f"{r['track']} {r['direction']}", set()).add(r["date"])
    print(f"{zone}: {len(out_rows)} usable granules -> {path}  ({len(skipped)} skipped: no HH+HV)")
    for t, d in sorted(tracks.items()):
        print(f"   track {t}: {len(d)} dates, {min(d)} -> {max(d)}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zone", default="all", choices=["all", *C.ZONES])
    a = ap.parse_args()
    for z in (C.ZONES if a.zone == "all" else [a.zone]):
        search_zone(z)


if __name__ == "__main__":
    main()
