"""Settings for NABD - L'ete de feu (NISAR L-band wildfire monitoring)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
WEB = ROOT / "web"
WEB_DATA = WEB / "data"

# Three fires of the July-August 2026 Mediterranean heat wave.
# fire_start / fire_end: official dates (start, "stabilised / contained").
ZONES = {
    "avila": {
        "name": "Ávila – Burgohondo (Espagne)",
        "country": "ES",
        # Burgohondo, Navaluenga, Valle de Iruelas, Casavieja, La Adrada, El Tiemblo, + Madrid Sierra Oeste edge
        "bbox": (-5.00, 40.20, -4.25, 40.55),        # west, south, east, north
        "pixel_m": 30.0,
        "crs": "EPSG:32630",
        "fire_start": "2026-07-22",
        "fire_end": "2026-08-06",
        "official_ha": 50000,
        "official_note": "≈50 000 ha en province d'Ávila ; 77 000 ha avec Madrid et Tolède",
        "ignition": [40.41, -4.79],                  # Burgohondo
        # the scar is split by the Burguillo reservoir (water is not counted): link patches up to 2.5 km apart
        "min_patch_ha": 20, "search_km": 15, "link_m": 2500,
    },
    "gironde": {
        "name": "Gironde – Saumos / Le Porge (France)",
        "country": "FR",
        "bbox": (-1.30, 44.65, -0.80, 45.05),
        "pixel_m": 30.0,
        "crs": "EPSG:32630",
        "fire_start": "2026-07-22",
        "fire_end": "2026-08-02",
        "official_ha": 42000,
        "official_note": "42 000 ha (préfecture de Gironde)",
        "ignition": [44.86, -0.97],                  # Saumos
        "min_patch_ha": 20, "search_km": 15, "link_m": 1000,
    },
    "sefrou": {
        "name": "Laânoussar – Sefrou (Maroc)",
        "country": "MA",
        # Middle Atlas cedar / holm-oak forest near Dayet Ifrah
        "bbox": (-5.10, 33.48, -4.80, 33.72),
        "pixel_m": 20.0,
        "crs": "EPSG:32630",
        "fire_start": "2026-07-31",
        "fire_end": "2026-08-07",
        "official_ha": 480,
        "official_note": "480 ha (Agence nationale des eaux et forêts)",
        "ignition": [33.57, -4.93],
        "min_patch_ha": 3, "search_km": 8, "link_m": 500,
    },
}


def zone_paths(zone: str) -> dict:
    return {
        "raw": DATA / "raw" / zone,
        "work": DATA / "work" / zone,
        "granules": DATA / f"granules_{zone}.csv",
        "layers": WEB_DATA / "layers" / zone,
        "json": DATA / "work" / f"{zone}.json",
    }


# NISAR L-band GCOV collections (provisional: released 20 Jul 2026; validated: from 21 Oct 2026 acquisitions)
GCOV_COLLECTIONS = {
    "NISAR_L2_GCOV_PROVISIONAL_V1": "C2854338529-ASF",
    "NISAR_L2_GCOV_V1": "C3622241360-ASF",
}
GCOV_VARIABLES = [
    "/science/LSAR/GCOV/grids/frequencyA/HHHH",
    "/science/LSAR/GCOV/grids/frequencyA/HVHV",
]

# --- fire analysis (all thresholds in dB)
# Tuned on the real 2026 NISAR passes (v2): the HV drop keeps deepening for 2-3 months after
# the fire (needles and leaves fall, burned trunks dry out), so the "after" picture uses every
# pass from 10 days to 4 months after the fire, and each pass is first calibrated against
# the unburned part of the scene (removes rain / calibration jumps such as +2 dB wet days).
SPECKLE_WINDOW = 5
EDGE_TRIM_PX = 6         # drop this many pixels along the border of each radar swath
PRE_WINDOW_DAYS = 75      # "before" = passes in the 75 days before the fire (same dry season)
PRE_MIN = 2               # at least this many "before" passes per orbit track
POST_DELAY_DAYS = 10      # "after" = passes from fire_end + 10 days ...
POST_WINDOW_DAYS = 120    # ... to fire_end + 120 days
OUTLIER_DB = 3.0          # a pass whose overall level jumps by more than this is discarded
SMOOTH_M = 45             # spatial smoothing of the change map (metres, Gaussian sigma)
VEG_HV_MIN = -22.0        # before the fire, HV above this = vegetation (excludes water, bare rock)
BURN_DHV = -1.0           # smoothed HV drop below this = burned
STEP_DHV = -1.2           # single-pass drop: 'already burned' on a pass during the fire
SEVERITY_DHV = (-1.0, -2.5, -4.0)   # low / moderate / high severity limits
PERIMETER_CLOSE_M = 200   # gaps narrower than this inside the scar belong to the fire perimeter
MIN_COVERAGE = 0.60       # passes covering less of the zone are flagged "partial"
