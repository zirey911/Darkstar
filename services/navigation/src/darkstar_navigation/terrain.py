"""Windowed MOLA terrain analysis and bounded regional A*; never uses Earth CRS."""

import heapq
import json
import math
import os
from functools import lru_cache
from pathlib import Path
from time import monotonic
from typing import Literal

import numpy as np
import rasterio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from rasterio.windows import Window

from darkstar_navigation import regional
from darkstar_navigation.guide_context import capture

router = APIRouter(prefix="/terrain", tags=["terrain"])
RADIUS = 3396000.0  # Spherical mapping radius in the MOLA product labels, metres.
STEP = 1 / 16
WIDTH, HEIGHT = 5760, 2880
ROOT = Path(__file__).resolve().parents[4]
DIRECTIONS = [(r, c) for r in (-1, 0, 1) for c in (-1, 0, 1) if r or c]


class Coordinate(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


class RoverProfile(BaseModel):
    """Hypothetical scenario parameters, not specifications of a NASA rover."""

    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    mass_kg: float = Field(default=200, gt=0, le=100000)
    rolling_resistance: float = Field(default=0.05, ge=0, le=1)
    drivetrain_efficiency: float = Field(default=0.7, gt=0, le=1)
    max_slope_deg: float = Field(default=15, gt=0, le=35)
    energy_capacity_wh: float = Field(default=1000, gt=0, le=10000000)


def edge_energy(distance_m, dz_m, rover):
    """Quasi-static traction: electrical joules and dissipated brake joules.

    Rolling work = Crr*m*g*cos(theta)*ds = Crr*m*g*horizontal_distance.
    Gravity assists descent. Excess downhill work becomes heat, never battery charge.
    """
    work = rover.mass_kg * 3.71 * (rover.rolling_resistance * distance_m + dz_m)
    return max(0.0, work) / rover.drivetrain_efficiency, max(0.0, -work)


class RouteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)
    start: Coordinate
    end: Coordinate
    max_slope_deg: float = Field(default=15, gt=0, le=35)
    optimization: Literal["distance", "energy"] = "distance"
    rover: RoverProfile = Field(default_factory=RoverProfile)
    compare: bool = False
    # Legacy request fields retained for compatibility; no longer affect optimization.
    slope_weight: float = Field(default=2, ge=0, le=20)
    energy_weight: float = Field(default=1, ge=0, le=20)
    rolling_resistance: float = Field(default=0.05, ge=0, le=1)


def distance(lat1, lon1, lat2, lon2, radius=RADIUS):
    """Great-circle surface distance on the product's Mars mapping sphere (metres)."""
    a, b = math.radians(lat1), math.radians(lat2)
    dlat, dlon = b - a, math.radians(lon2 - lon1)
    h = math.sin(dlat / 2) ** 2 + math.cos(a) * math.cos(b) * math.sin(dlon / 2) ** 2
    return 2 * radius * math.asin(min(1, math.sqrt(max(0, h))))


def terrain_path():
    return Path(os.getenv("DARKSTAR_TERRAIN_PATH", str(ROOT / "data/processed/mola16.tif")))


def source_info():
    path = terrain_path()
    if not path.is_file():
        raise HTTPException(503, "MOLA terrain unavailable. Run scripts/prepare_terrain.py.")
    return path, path.stat().st_mtime_ns, path.stat().st_size


def check_raster(src):
    if (
        src.width != WIDTH
        or src.height != HEIGHT
        or src.count != 2
        or not src.transform.almost_equals(rasterio.transform.from_origin(0, 90, STEP, STEP))
        or not src.crs
        or not src.crs.is_geographic
        or "3396000" not in src.crs.to_wkt()
    ):
        raise ValueError("Expected the prepared MOLA 16 ppd raster, not an arbitrary DEM")


@router.get("/metadata")
def metadata():
    path, _, _ = source_info()
    try:
        with rasterio.open(path) as src:
            check_raster(src)
            provenance = json.loads(src.tags()["darkstar_provenance"])
    except (rasterio.errors.RasterioError, ValueError, KeyError):
        raise HTTPException(
            503, "Invalid MOLA raster or provenance. Rebuild terrain data."
        ) from None
    region = regional.region_info()
    return {
        "regions": [regional.public_info(region)] if region else [],
        "provenance": provenance,
        "routing_limit_km": 600,
        "routing_latitude_limit": 80,
        "nominal_cell_m": math.radians(STEP) * RADIUS,
        "imagery": {
            "name": "NASA Viking MDIM 2.1 colorized global mosaic",
            "source": "https://trek.nasa.gov/mars/",
            "source_resolution_m": 232,
        },
    }


def slopes(elevation, north, west, step=STEP, step_lon=None, radius=RADIUS):
    """Central differences in metres; unsupported neighbours invalidate the gradient."""
    dy = radius * math.radians(step)
    lat = north - (np.arange(elevation.shape[0]) + 0.5) * step
    dx = radius * math.radians(step_lon or step) * np.cos(np.radians(lat))[:, None]
    dzdy, dzdx = np.gradient(elevation, dy, axis=0), np.gradient(elevation, axis=1) / dx
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    slope[~np.isfinite(elevation)] = np.nan
    # Boundary slopes lack a centred stencil; exclude them rather than extrapolate.
    slope[[0, -1], :] = np.nan
    slope[:, [0, -1]] = np.nan
    return slope


@lru_cache(maxsize=8)
def read_region(path, modified, size, r0, r1, c0, c1):
    """Cache bounded immutable elevation/slope arrays; key invalidates on source changes."""
    del modified, size
    with rasterio.open(path) as src:
        check_raster(src)
        pieces = []
        cursor = c0
        while cursor < c1:
            column = cursor % WIDTH
            length = min(c1 - cursor, WIDTH - column)
            pieces.append(src.read(window=Window(column, r0, length, r1 - r0)))
            cursor += length
        data = np.concatenate(pieces, axis=2)
        provenance = json.loads(src.tags()["darkstar_provenance"])
    elevation = data[0].astype("float64")
    supported = (data[1] > 0) & (elevation >= -8177) & (elevation <= 21171)
    elevation[~supported] = np.nan
    slope = slopes(elevation, 90 - r0 * STEP, c0 * STEP)
    elevation.flags.writeable = False
    slope.flags.writeable = False
    return elevation, slope, provenance


def astar(
    elevation,
    slope,
    start,
    end,
    north,
    west,
    request,
    allowed=None,
    step=STEP,
    deadline=None,
    step_lon=None,
    radius=RADIUS,
):
    """8-connected A*, no corner cutting, admissible spherical distance heuristic."""
    rows, cols = elevation.shape
    slope_limit = min(request.max_slope_deg, request.rover.max_slope_deg)
    usable = np.isfinite(slope) & np.isfinite(elevation) & (slope <= slope_limit)
    if allowed is not None:
        usable &= allowed
    if not usable[start] or not usable[end]:
        return None
    step_lon = step_lon or step
    latitudes = north - (np.arange(rows) + 0.5) * step

    def coordinate(cell):
        return latitudes[cell[0]], west + (cell[1] + 0.5) * step_lon

    def heuristic(cell):
        horizontal = distance(*coordinate(cell), *coordinate(end), radius=radius)
        if request.optimization == "energy":
            return edge_energy(horizontal, float(elevation[end] - elevation[cell]), request.rover)[
                0
            ]
        return horizontal

    # Every cell in a row shares edge geometry, so avoid repeated trig in the search.
    lengths = {}
    for row in range(rows):
        for dr, dc in DIRECTIONS:
            if 0 <= row + dr < rows:
                lengths[row, dr, dc] = distance(
                    latitudes[row], 0, latitudes[row + dr], dc * step_lon, radius=radius
                )
    queue = [(heuristic(start), 0.0, start)]
    costs = {start: 0.0}
    parents = {}
    expanded = 0
    while queue:
        _, cost, cell = heapq.heappop(queue)
        if cost != costs.get(cell):
            continue
        expanded += 1
        if expanded % 512 == 0 and deadline and monotonic() > deadline:
            raise HTTPException(422, "Regional search budget exceeded. Choose closer endpoints.")
        if cell == end:
            path = [cell]
            while cell in parents:
                cell = parents[cell]
                path.append(cell)
            return list(reversed(path))
        row, col = cell
        for dr, dc in DIRECTIONS:
            nxt = row + dr, col + dc
            if not (0 <= nxt[0] < rows and 0 <= nxt[1] < cols and usable[nxt]):
                continue
            if dr and dc and (not usable[row + dr, col] or not usable[row, col + dc]):
                continue
            length = lengths[row, dr, dc]
            dz = float(elevation[nxt] - elevation[cell])
            grade = abs(dz) / length
            if math.degrees(math.atan(grade)) > slope_limit:
                continue
            edge = (
                edge_energy(length, dz, request.rover)[0]
                if request.optimization == "energy"
                else math.hypot(length, dz)
            )
            candidate = cost + edge
            if candidate < costs.get(nxt, math.inf):
                costs[nxt] = candidate
                parents[nxt] = cell
                heapq.heappush(queue, (candidate + heuristic(nxt), candidate, nxt))
    return None


def find_path(
    elevation, slope, start, end, north, west, request, step=STEP, step_lon=None, radius=RADIUS
):
    step_lon = step_lon or step
    deadline = monotonic() + 12
    # Conservative 4x4 grid is a guide only; final route always checks original cells.
    factor = 4
    rows, cols = elevation.shape
    coarse_used = False
    if rows * cols > 12000:
        cr, cc = rows // factor, cols // factor
        blocks = elevation[: cr * factor, : cc * factor].reshape(cr, factor, cc, factor)
        coarse_z = blocks.mean(axis=(1, 3))
        coarse_s = (
            slope[: cr * factor, : cc * factor].reshape(cr, factor, cc, factor).max(axis=(1, 3))
        )
        cs, ce = tuple(v // factor for v in start), tuple(v // factor for v in end)
        if cs[0] < cr and cs[1] < cc and ce[0] < cr and ce[1] < cc:
            guide = astar(
                coarse_z,
                coarse_s,
                cs,
                ce,
                north,
                west,
                request,
                step=step * factor,
                step_lon=step_lon * factor,
                radius=radius,
                deadline=deadline,
            )
            if guide:
                allowed = np.zeros_like(elevation, dtype=bool)
                for r, c in guide:
                    allowed[
                        max(0, (r - 2) * factor) : min(rows, (r + 3) * factor),
                        max(0, (c - 2) * factor) : min(cols, (c + 3) * factor),
                    ] = True
                path = astar(
                    elevation,
                    slope,
                    start,
                    end,
                    north,
                    west,
                    request,
                    step=step,
                    step_lon=step_lon,
                    radius=radius,
                    allowed=allowed,
                    deadline=deadline,
                )
                if path:
                    return path, True
    return astar(
        elevation,
        slope,
        start,
        end,
        north,
        west,
        request,
        deadline=deadline,
        step=step,
        step_lon=step_lon,
        radius=radius,
    ), coarse_used


@router.post("/route")
@capture("route")
def route(request: RouteRequest):
    result = calculate_route(request)
    if request.compare:
        other = "energy" if request.optimization == "distance" else "distance"
        keys = (
            "optimization",
            "distance_m",
            "ascent_m",
            "descent_m",
            "energy_wh",
            "braking_loss_j",
            "max_terrain_slope_deg",
            "effective_max_slope_deg",
            "within_energy_capacity",
            "dataset",
            "nominal_cell_m",
            "coarse_to_fine",
        )
        result["comparisons"] = [{k: result[k] for k in keys}]
        try:
            alternative = calculate_route(
                request.model_copy(update={"optimization": other, "compare": False})
            )
            result["comparisons"].append({k: alternative[k] for k in keys})
        except HTTPException as exc:
            result["comparison_error"] = f"{other} comparison unavailable: {exc.detail}"
    return result


def calculate_route(request: RouteRequest):
    start, end = request.start, request.end
    if max(abs(start.lat), abs(end.lat)) > 80:
        raise HTTPException(422, "Routing beyond ±80° is unsupported.")
    if distance(start.lat, start.lon, end.lat, end.lon) > 600000:
        raise HTTPException(422, "Choose endpoints within 600 km for regional routing.")
    west_lon = start.lon % 360
    east_lon = west_lon + ((end.lon - start.lon + 180) % 360 - 180)
    if abs(east_lon - west_lon) > 12:
        raise HTTPException(422, "Longitude span exceeds the 12° regional limit.")
    region = regional.region_info()
    detailed = None
    fallback = "No installed detailed DEM at both endpoints; reduced-accuracy MOLA route."
    if region and regional.contains(region, start) and regional.contains(region, end):
        detailed = regional.routing_grid(region, start, end)
        fallback = "Detailed endpoint elevation/slope unavailable; reduced-accuracy MOLA route."
    step = step_lon = STEP
    radius = RADIUS
    dataset_id = "mola16"
    if detailed is not None:
        z, slope, first, last, north, west = detailed
        step, step_lon, radius = region["step"], region["step_lon"], region["radius_m"]
        provenance = regional.public_info(region)
        dataset_id = region["id"]
        fallback = None
    else:
        padding = 1.0
        r0 = max(0, math.floor((90 - max(start.lat, end.lat) - padding) / STEP))
        r1 = min(HEIGHT, math.ceil((90 - min(start.lat, end.lat) + padding) / STEP))
        c0 = math.floor((min(west_lon, east_lon) - padding) / STEP)
        c1 = math.ceil((max(west_lon, east_lon) + padding) / STEP)
        path, modified, size = source_info()
        try:
            z, slope, provenance = read_region(str(path), modified, size, r0, r1, c0, c1)
        except (rasterio.errors.RasterioError, ValueError, KeyError):
            raise HTTPException(503, "Cannot read terrain. Rebuild MOLA data.") from None
        first = math.floor((90 - start.lat) / STEP) - r0, math.floor(west_lon / STEP) - c0
        last = math.floor((90 - end.lat) / STEP) - r0, math.floor(east_lon / STEP) - c0
        north, west = 90 - r0 * STEP, c0 * STEP
    slope_limit = min(request.max_slope_deg, request.rover.max_slope_deg)
    for name, cell in [("Start", first), ("Destination", last)]:
        if not np.isfinite(slope[cell]):
            raise HTTPException(
                422,
                f"{name} has unsupported terrain slopes. {fallback or 'Detailed DEM gap.'}",
            )
        if slope[cell] > slope_limit:
            raise HTTPException(422, f"{name} exceeds the selected vehicle slope limit.")
    if first == last:
        raise HTTPException(
            422,
            f"Endpoints share a {dataset_id} cell. Select points farther apart. {fallback or ''}",
        )
    cells, refined = find_path(
        z, slope, first, last, north, west, request, step=step, step_lon=step_lon, radius=radius
    )
    if not cells:
        raise HTTPException(
            422,
            "No route within the regional window and slope limit. "
            f"Missing observations may block it. A route may exist elsewhere. {fallback or ''}",
        )
    profile = []
    total = ascent = descent = energy_j = braking_j = 0.0
    max_edge_slope = 0.0
    for i, (row, col) in enumerate(cells):
        lat = north - (row + 0.5) * step
        lon = (west + (col + 0.5) * step_lon + 180) % 360 - 180
        elevation = float(z[row, col])
        if i:
            prev = profile[-1]
            length = distance(prev["lat"], prev["lon"], lat, lon, radius=radius)
            dz = elevation - prev["elevation_m"]
            total += math.hypot(length, dz)
            electrical, braking = edge_energy(length, dz, request.rover)
            energy_j += electrical
            braking_j += braking
            ascent += max(0, dz)
            descent += max(0, -dz)
            max_edge_slope = max(max_edge_slope, math.degrees(math.atan2(abs(dz), length)))
        profile.append(
            {
                "lat": lat,
                "lon": lon,
                "elevation_m": elevation,
                "distance_m": total,
                "slope_deg": float(slope[row, col]),
            }
        )
    return {
        "profile": profile,
        "distance_m": total,
        "ascent_m": ascent,
        "descent_m": descent,
        "optimization": request.optimization,
        "energy_j": energy_j,
        "energy_wh": energy_j / 3600,
        "braking_loss_j": braking_j,
        "energy_capacity_fraction": energy_j / (3600 * request.rover.energy_capacity_wh),
        "within_energy_capacity": energy_j <= 3600 * request.rover.energy_capacity_wh,
        "rover": request.rover.model_dump(),
        "effective_max_slope_deg": slope_limit,
        "optimization_cost": energy_j if request.optimization == "energy" else total,
        "max_edge_slope_deg": max_edge_slope,
        "max_terrain_slope_deg": max(float(slope[cell]) for cell in cells),
        "snapping_m": {
            "start": distance(
                start.lat, start.lon, profile[0]["lat"], profile[0]["lon"], radius=radius
            ),
            "end": distance(
                end.lat, end.lon, profile[-1]["lat"], profile[-1]["lon"], radius=radius
            ),
        },
        "dataset_id": dataset_id,
        "dataset": provenance["dataset"],
        "fallback_reason": fallback,
        "resolution_degrees": step,
        "nominal_cell_m": math.radians(step) * radius,
        "coarse_to_fine": refined,
        "region_shape": list(z.shape),
        "unsupported_fraction": float(np.mean(~np.isfinite(slope))),
        "provenance": provenance,
        "parameters": request.model_dump(),
        "limitations": [
            "Regional grid route, not a validated vehicle path. Sub-cell hazards are unresolved.",
            "Endpoints snap to DEM cell centres; distance excludes those unvalidated connections.",
            "Missing cells/stencils are blocked; datasets are not blended.",
            "Search margin is 320 m for CTX, 1° for MOLA; refinement need not be globally optimal.",
            "Traction energy only; no regeneration, slip, turns, heating or electronics.",
            "Hypothetical rover; capacity is a traction-only budget, not mission range.",
        ],
    }


@lru_cache(maxsize=128)
def image_tile(zoom, row, col):
    from urllib.request import urlopen

    url = (
        "https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m"
        f"/1.0.0/default/default028mm/{zoom}/{row}/{col}.jpg"
    )
    with urlopen(url, timeout=10) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000 or not data.startswith(b"\xff\xd8"):
        raise ValueError("Invalid imagery tile")
    return data


@router.get("/tiles/{zoom}/{row}/{col}")
def tile(zoom: int, row: int, col: int):
    from urllib.error import URLError

    from fastapi import Response

    if not 0 <= zoom <= 7 or not 0 <= row < 2**zoom or not 0 <= col < 2 ** (zoom + 1):
        raise HTTPException(404, "Tile outside the Mars imagery grid.")
    try:
        return Response(
            image_tile(zoom, row, col),
            media_type="image/jpeg",
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except (URLError, TimeoutError, ValueError):
        raise HTTPException(502, "NASA Mars Trek imagery unavailable. Try again later.") from None


# V01 catalog item 30c4acfe36284b1784bf07d5d73f9e4d; fixed host, no arbitrary URLs.
@lru_cache(maxsize=128)
def ctx_image_tile(zoom, row, col):
    from urllib.request import urlopen

    url = f"https://astro.arcgis.com/arcgis/rest/services/OnMars/CTX1/MapServer/tile/{zoom}/{row}/{col}"
    with urlopen(url, timeout=10) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError("Oversized CTX tile")
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return data, "image/png"
    if data.startswith(b"\xff\xd8"):
        return data, "image/jpeg"
    raise ValueError("Invalid CTX tile")


@router.get("/ctx/{zoom}/{row}/{col}")
def ctx_tile(zoom: int, row: int, col: int):
    from urllib.error import URLError

    from fastapi import Response

    # Level 12 samples ~5.09 m N-S. Higher server levels oversample the 5 m mosaic.
    if not 0 <= zoom <= 12 or not 0 <= row < 2**zoom or not 0 <= col < 2 ** (zoom + 1):
        raise HTTPException(404, "Tile outside the CTX grid.")
    try:
        data, media_type = ctx_image_tile(zoom, row, col)
        return Response(
            data, media_type=media_type, headers={"Cache-Control": "public, max-age=86400"}
        )
    except (URLError, TimeoutError, ValueError):
        raise HTTPException(502, "CTX imagery unavailable; retain the coarse basemap.") from None


@router.post("/inspect")
@capture("location")
def inspect_point(point: Coordinate):
    region = regional.region_info()
    fallback = "Outside installed detailed coverage; reduced-accuracy MOLA elevation."
    if region and regional.contains(region, point):
        result = regional.inspection(region, point)
        if result is not None:
            return result
        fallback = "Detailed DEM has nodata here; reduced-accuracy MOLA elevation."
    path, modified, size = source_info()
    row = min(HEIGHT - 1, math.floor((90 - point.lat) / STEP))
    col = math.floor((point.lon % 360) / STEP)
    try:
        with rasterio.open(path) as src:
            check_raster(src)
            height, count = src.read(window=Window(col, row, 1, 1))[:, 0, 0]
        r0, r1 = max(0, row - 1), min(HEIGHT, row + 2)
        _, slope, _ = read_region(str(path), modified, size, r0, r1, col - 1, col + 2)
        grade = slope[row - r0, 1]
    except (rasterio.errors.RasterioError, ValueError, KeyError):
        raise HTTPException(503, "Cannot inspect MOLA data. Rebuild terrain data.") from None
    valid = -8177 <= height <= 21171
    return {
        "coordinate": point.model_dump(),
        "cell_centre": {
            "lat": 90 - (row + 0.5) * STEP,
            "lon": ((col + 0.5) * STEP + 180) % 360 - 180,
        },
        "elevation_m": int(height) if valid else None,
        "observations": max(0, int(count)),
        "support": "observed"
        if valid and count > 0
        else "interpolated"
        if valid
        else "unavailable",
        "slope_deg": float(grade) if np.isfinite(grade) else None,
        "routing_supported": bool(abs(point.lat) <= 80 and np.isfinite(grade)),
        "resolution_degrees": STEP,
        "nominal_cell_m": math.radians(STEP) * RADIUS,
        "datum": "MOLA areoid (GMM3)",
        "dataset": "NASA MGS MOLA MEGDR 16 ppd",
        "dataset_id": "mola16",
        "fallback_reason": fallback,
    }


@lru_cache(maxsize=64)
def topography_tile(path, modified, size, zoom, row, col):
    """Render a bounded numeric MOLA window; no inferred heights from imagery."""
    from rasterio.io import MemoryFile

    del modified, size
    span = 180 / 2**zoom
    window = Window(((-180 + col * span) % 360) / STEP, row * span / STEP, span / STEP, span / STEP)
    with rasterio.Env(GDAL_CACHEMAX=32 * 1024 * 1024), rasterio.open(path) as src:
        check_raster(src)
        data = src.read(
            window=window, out_shape=(2, 256, 256), resampling=rasterio.enums.Resampling.nearest
        )
    height = data[0]
    levels = [-8177, -4000, 0, 4000, 10000, 21171]
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
    rgb = np.stack([np.interp(height, levels, colours[:, band]) for band in range(3)])
    rgb[:, data[1] <= 0] *= 0.45
    rgb[:, (height < -8177) | (height > 21171)] = 20
    with MemoryFile() as memory:
        with memory.open(
            driver="PNG",
            width=256,
            height=256,
            count=3,
            dtype="uint8",
            transform=rasterio.transform.from_origin(0, 256, 1, 1),
        ) as dst:
            dst.write(rgb.astype("uint8"))
        return memory.read()


@router.get("/topography/{zoom}/{row}/{col}")
def topography(zoom: int, row: int, col: int):
    from fastapi import Response

    if not 0 <= zoom <= 7 or not 0 <= row < 2**zoom or not 0 <= col < 2 ** (zoom + 1):
        raise HTTPException(404, "Tile outside the Mars topography grid.")
    path, modified, size = source_info()
    try:
        return Response(
            topography_tile(str(path), modified, size, zoom, row, col),
            media_type="image/png",
            headers={"Cache-Control": "no-cache"},
        )
    except (rasterio.errors.RasterioError, ValueError):
        raise HTTPException(503, "MOLA topography unavailable. Rebuild terrain data.") from None


@router.get("/region-map")
def region_map():
    from fastapi import Response

    info = regional.region_info()
    if not info:
        raise HTTPException(404, "No detailed DEM installed.")
    try:
        return Response(
            regional.relief_image(info["path"], info["modified"], info["size"]),
            media_type="image/png",
            headers={"Cache-Control": "no-cache"},
        )
    except (rasterio.errors.RasterioError, ValueError):
        raise HTTPException(503, "Regional topography unavailable.") from None
