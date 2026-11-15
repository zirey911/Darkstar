"""Read-only USGS SIM 3292 geology hosted by Esri; no inferred classifications."""

import json
from functools import lru_cache
from urllib.error import URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException, Response

from darkstar_navigation.terrain import Coordinate

router = APIRouter(prefix="/terrain")
FEATURES = (
    "https://services.arcgis.com/nzS0F0zdNLvs7nc8/ArcGIS/rest/services/"
    "Mars_Geology_feature_layer/FeatureServer/0"
)
TILES = (
    "https://tiles.arcgis.com/tiles/nzS0F0zdNLvs7nc8/arcgis/rest/services/"
    "Mars_geology_All_layers_100pct/MapServer"
)
SOURCE = "https://pubs.usgs.gov/sim/3292/"


def read_remote(url):
    with urlopen(url, timeout=10) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError("Oversized geology response")
    return data


@lru_cache(maxsize=256)
def tile_bytes(level, row, col):
    data = read_remote(f"{TILES}/tile/{level}/{row}/{col}")
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Geology tile unavailable")
    return data


@router.get("/geology/{level}/{row}/{col}")
def geology_tile(level: int, row: int, col: int):
    # Native geographic cache origin (-180, +180), NOT the imagery origin (-180,+90).
    if (
        not 2 <= level <= 6
        or not 2 ** (level - 2) <= row < 3 * 2 ** (level - 2)
        or not 0 <= col < 2**level
    ):
        raise HTTPException(404, "Outside the geology tile grid")
    try:
        return Response(
            tile_bytes(level, row, col),
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except (URLError, OSError, ValueError):
        raise HTTPException(503, "Geology tile unavailable from the public map service.") from None


@lru_cache(maxsize=256)
def query_units(lat, lon):
    params = urlencode(
        {
            "f": "json",
            "geometry": f"{lon},{lat}",
            "geometryType": "esriGeometryPoint",
            "inSR": 104971,
            "spatialRel": "esriSpatialRelIntersects",
            "outFields": "Unit,UnitDesc",
            "returnGeometry": "false",
        }
    )
    data = json.loads(read_remote(f"{FEATURES}/query?{params}"))
    if "error" in data or "features" not in data or data.get("exceededTransferLimit"):
        raise ValueError("Incomplete geology response")
    return [
        {"unit": f["attributes"].get("Unit"), "description": f["attributes"].get("UnitDesc")}
        for f in data["features"]
    ]


@router.post("/geology-inspect")
def geology_inspect(point: Coordinate):
    try:
        units = query_units(point.lat, (point.lon + 180) % 360 - 180)
    except (URLError, OSError, ValueError, KeyError, TypeError):
        raise HTTPException(
            503, "Geological information unavailable from the public service."
        ) from None
    return {
        "coordinate": point.model_dump(),
        "units": units,
        "dataset": "USGS SIM 3292 — Tanaka et al. (2014)",
        "source": SOURCE,
        "service": FEATURES,
        "scale": "1:20,000,000",
        "coverage": "Global Mars",
        "note": "Regional mapped units, not outcrop identification or a hazard map. "
        "Multiple units may meet at boundaries; an empty result is unavailable, "
        "not a classification.",
    }
