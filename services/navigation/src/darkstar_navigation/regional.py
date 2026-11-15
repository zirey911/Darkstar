"""One native CTX DEM crop; bounded reads, explicit support and no MOLA blending."""

import json
import math
import os
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from fastapi import HTTPException
from rasterio.crs import CRS
from rasterio.warp import transform_bounds
from rasterio.windows import Window

DEFAULT = Path(__file__).resolve().parents[4] / "data/processed/jezero_ctx20.tif"


def region_info():
    path = Path(os.getenv("DARKSTAR_REGIONAL_PATH", str(DEFAULT)))
    if not path.is_file():
        return None
    try:
        return describe(str(path), path.stat().st_mtime_ns, path.stat().st_size)
    except (rasterio.errors.RasterioError, ValueError, KeyError):
        raise HTTPException(
            503, "Regional DEM metadata invalid. Re-run prepare_jezero.py."
        ) from None


@lru_cache(maxsize=2)
def describe(path, modified, size):
    with rasterio.open(path) as src:
        info = json.loads(src.tags()["darkstar_region"])
        if (
            info["id"] != "jezero-ctx20"
            or src.res != (20, 20)
            or src.count != 1
            or src.crs.to_dict().get("proj") != "eqc"
            or src.crs.to_dict().get("R") != 3396190
        ):
            raise ValueError("Unexpected regional raster")
        geo = CRS.from_proj4("+proj=longlat +R=3396190 +no_defs")
        west, south, east, north = transform_bounds(src.crs, geo, *src.bounds)
        return info | {
            "path": path,
            "modified": modified,
            "size": size,
            "bounds": [west, south, east, north],
            "step": (north - south) / src.height,
            "step_lon": (east - west) / src.width,
            "width": src.width,
            "height": src.height,
        }


def public_info(info):
    return {k: v for k, v in info.items() if k not in {"path", "modified", "size"}}


def contains(info, point):
    west, south, east, north = info["bounds"]
    return west <= point.lon < east and south < point.lat <= north


def cell(info, point):
    west, _, _, north = info["bounds"]
    return (
        min(info["height"] - 1, math.floor((north - point.lat) / info["step"])),
        min(info["width"] - 1, math.floor((point.lon - west) / info["step_lon"])),
    )


@lru_cache(maxsize=8)
def read_window(path, modified, size, r0, r1, c0, c1, step, step_lon, radius, north):
    from darkstar_navigation.terrain import slopes

    del modified, size
    try:
        with rasterio.open(path) as src:
            z = src.read(1, window=Window(c0, r0, c1 - c0, r1 - r0), masked=True)
            z = z.astype("float64").filled(np.nan)
    except rasterio.errors.RasterioError:
        raise HTTPException(503, "Regional DEM read failed; data is unavailable.") from None
    z[~np.isfinite(z)] = np.nan
    slope = slopes(z, north, 0, step=step, step_lon=step_lon, radius=radius)
    z.flags.writeable = slope.flags.writeable = False
    return z, slope


def window(info, r0, r1, c0, c1):
    north = info["bounds"][3] - r0 * info["step"]
    return read_window(
        info["path"],
        info["modified"],
        info["size"],
        r0,
        r1,
        c0,
        c1,
        info["step"],
        info["step_lon"],
        info["radius_m"],
        north,
    )


def inspection(info, point):
    row, col = cell(info, point)
    r0, r1 = max(0, row - 1), min(info["height"], row + 2)
    c0, c1 = max(0, col - 1), min(info["width"], col + 2)
    z, slope = window(info, r0, r1, c0, c1)
    elevation, grade = z[row - r0, col - c0], slope[row - r0, col - c0]
    if not np.isfinite(elevation):
        return None
    return {
        "coordinate": point.model_dump(),
        "cell_centre": {
            "lat": info["bounds"][3] - (row + 0.5) * info["step"],
            "lon": info["bounds"][0] + (col + 0.5) * info["step_lon"],
        },
        "elevation_m": float(elevation),
        "observations": None,
        "support": "stereo-derived",
        "slope_deg": float(grade) if np.isfinite(grade) else None,
        "routing_supported": bool(np.isfinite(grade)),
        "resolution_degrees": info["step"],
        "nominal_cell_m": 20,
        "datum": info["elevation_datum"],
        "dataset": info["dataset"],
        "dataset_id": info["id"],
        "fallback_reason": None,
        "provenance": public_info(info),
    }


def routing_grid(info, start, end):
    first, last = cell(info, start), cell(info, end)
    r0, r1 = max(0, min(first[0], last[0]) - 16), min(info["height"], max(first[0], last[0]) + 17)
    c0, c1 = max(0, min(first[1], last[1]) - 16), min(info["width"], max(first[1], last[1]) + 17)
    if (r1 - r0) * (c1 - c0) > 180000:
        raise HTTPException(
            422, "Detailed route window exceeds 180000 cells. Select closer endpoints."
        )
    z, slope = window(info, r0, r1, c0, c1)
    first = first[0] - r0, first[1] - c0
    last = last[0] - r0, last[1] - c0
    if not np.isfinite(slope[first]) or not np.isfinite(slope[last]):
        return None
    return (
        z,
        slope,
        first,
        last,
        info["bounds"][3] - r0 * info["step"],
        info["bounds"][0] + c0 * info["step_lon"],
    )


@lru_cache(maxsize=2)
def relief_image(path, modified, size):
    """One cropped regional display tile; alpha preserves the source's nodata holes."""
    from rasterio.io import MemoryFile

    del modified, size
    with rasterio.open(path) as src:
        z = src.read(1, masked=True)
    levels = [-3000, -2800, -2600, -2400, -2200, -2000]
    colours = np.array(
        [
            [30, 50, 97],
            [39, 112, 139],
            [91, 151, 139],
            [211, 176, 104],
            [183, 94, 68],
            [247, 233, 208],
        ]
    )
    height = z.filled(-3000)
    rgb = np.stack([np.interp(height, levels, colours[:, band]) for band in range(3)])
    alpha = np.where(np.ma.getmaskarray(z) | ~np.isfinite(height), 0, 255)
    rgba = np.concatenate([rgb, alpha[None]], axis=0).astype("uint8")
    with MemoryFile() as memory:
        with memory.open(
            driver="PNG",
            width=z.shape[1],
            height=z.shape[0],
            count=4,
            dtype="uint8",
            transform=rasterio.transform.from_origin(0, z.shape[0], 1, 1),
        ) as dst:
            dst.write(rgba)
        return memory.read()
