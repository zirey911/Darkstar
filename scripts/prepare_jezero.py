"""Read one native-resolution Jezero CTX window via HTTP range requests."""

import hashlib
import json
import math
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import Request, urlopen
from xml.etree import ElementTree

import rasterio
from rasterio.crs import CRS
from rasterio.warp import transform_bounds
from rasterio.windows import Window, from_bounds

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (
    "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/"
    "CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif"
)
CATALOG = "https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic"
OUTPUT = ROOT / "data/processed/jezero_ctx20.tif"
BOUNDS = (77.38, 18.36, 77.62, 18.54)


def main():
    if OUTPUT.exists():
        print(f"Already prepared: {OUTPUT}")
        return
    raw = ROOT / "data/raw/jezero"
    raw.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(SOURCE.replace(".tif", ".xml"), timeout=30) as response:
        label = response.read()
    root = ElementTree.fromstring(label)
    identifier = root.findtext(".//{*}logical_identifier")
    if identifier != "urn:nasa:pds:mars2020_ctx_basemap_2021:data:m20_ctxdem_mosaic":
        raise ValueError("Unexpected PDS numerical DEM product")
    (raw / "M20_JezeroCrater_CTXDEM_20m.xml").write_bytes(label)
    with urlopen(Request(SOURCE, method="HEAD"), timeout=30) as response:
        etag, size = (
            response.headers.get("ETag"),
            response.headers.get("Content-Length"),
        )
    geographic = CRS.from_proj4("+proj=longlat +R=3396190 +no_defs")
    with (
        rasterio.Env(
            GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
            CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
            GDAL_HTTP_TIMEOUT=60,
            GDAL_CACHEMAX=32 * 1024 * 1024,
        ),
        rasterio.open(SOURCE) as src,
    ):
        if src.count != 1 or src.dtypes[0] != "float32" or src.res != (20, 20):
            raise ValueError("Unexpected DEM layout")
        projected = transform_bounds(geographic, src.crs, *BOUNDS)
        window = from_bounds(*projected, src.transform)
        left, top = math.floor(window.col_off), math.floor(window.row_off)
        right = math.ceil(window.col_off + window.width)
        bottom = math.ceil(window.row_off + window.height)
        window = Window(left, top, right - left, bottom - top)
        if window.width * window.height > 500000:
            raise ValueError("Crop exceeds download/memory budget")
        transform = src.window_transform(window)
        native_bounds = rasterio.windows.bounds(window, src.transform)
        bounds = transform_bounds(src.crs, geographic, *native_bounds)
        metadata = {
            "id": "jezero-ctx20",
            "dataset": "Jezero CTX DEM (Mars 2020, PDS v1.0)",
            "source": SOURCE,
            "catalog": CATALOG,
            "pds_identifier": identifier,
            "source_size_bytes": int(size),
            "source_etag": etag,
            "label_sha256": hashlib.sha256(label).hexdigest(),
            "prepared_utc": datetime.now(UTC).isoformat(),
            "source_window": [left, top, right - left, bottom - top],
            "bounds": list(bounds),
            "source_resolution_m": 20,
            "radius_m": 3396190,
            "crs_wkt": src.crs.to_wkt(),
            "coordinate_system": "Mars 2000 sphere, planetocentric, east-positive",
            "elevation_units": "m",
            "elevation_datum": "CTX stereo DEM localized vertically to MOLA",
            "nodata": src.nodata,
            "missing_policy": "Source nodata masked; no gap filling or mixed-dataset routes",
            "processing": "Native pixel-aligned crop, no elevation resampling",
        }
        # The source is scanline-striped: only requested rows/blocks are fetched.
        data = src.read(1, window=window)
        profile = src.profile | {
            "width": int(window.width),
            "height": int(window.height),
            "transform": transform,
            "tiled": True,
            "blockxsize": 256,
            "blockysize": 256,
            "compress": "deflate",
        }
        partial = OUTPUT.with_suffix(".partial.tif")
        with rasterio.open(partial, "w", **profile) as dst:
            dst.write(data, 1)
            dst.update_tags(darkstar_region=json.dumps(metadata))
    partial.replace(OUTPUT)
    metadata["crop_sha256"] = hashlib.sha256(OUTPUT.read_bytes()).hexdigest()
    OUTPUT.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(
        json.dumps(
            {
                "file": str(OUTPUT),
                "bytes": OUTPUT.stat().st_size,
                "bounds": bounds,
                "shape": data.shape,
            }
        )
    )


if __name__ == "__main__":
    main()
