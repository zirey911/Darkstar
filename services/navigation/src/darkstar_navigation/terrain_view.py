"""Bounded native DEM samples for visualization only; no routing changes."""

import math

import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import Field

from darkstar_navigation import regional
from darkstar_navigation.terrain import (
    HEIGHT,
    RADIUS,
    STEP,
    Coordinate,
    read_region,
    source_info,
)

router = APIRouter(prefix="/terrain", tags=["terrain"])


class ViewRequest(Coordinate):
    span: float = Field(default=12, ge=0.02, le=12)


@router.post("/mesh")
def mesh(request: ViewRequest):
    if abs(request.lat) > 85:
        raise HTTPException(422, "3D patches support latitudes within ±85°. Use the 2D polar map.")
    info = regional.region_info()
    if info and regional.contains(info, request):
        span = request.span
        west, south, east, north = info["bounds"]
        r0 = max(0, math.floor((north - request.lat - span / 4) / info["step"]))
        r1 = min(info["height"], math.ceil((north - request.lat + span / 4) / info["step"]))
        c0 = max(0, math.floor((request.lon - span / 2 - west) / info["step_lon"]))
        c1 = min(info["width"], math.ceil((request.lon + span / 2 - west) / info["step_lon"]))
        z, _ = regional.window(info, r0, r1, c0, c1)
        lat0 = north - (r0 + 0.5) * info["step"]
        lon0 = west + (c0 + 0.5) * info["step_lon"]
        dy, dx, radius = info["step"], info["step_lon"], info["radius_m"]
        dataset, resolution = info["dataset"], info["source_resolution_m"]
        source = info["source"]
        note = "Clipped to installed CTX footprint. Nodata is omitted; datasets are not blended."
    else:
        # Do not manufacture sub-cell geometry when the map is zoomed beyond MOLA detail.
        span = max(0.5, request.span)
        r0 = max(0, math.floor((90 - request.lat - span / 4) / STEP))
        r1 = min(HEIGHT, math.ceil((90 - request.lat + span / 4) / STEP))
        c0 = math.floor((request.lon - span / 2) / STEP)
        c1 = math.ceil((request.lon + span / 2) / STEP)
        path, modified, size = source_info()
        try:
            z, _, _ = read_region(str(path), modified, size, r0, r1, c0, c1)
        except (OSError, ValueError, KeyError):
            raise HTTPException(503, "MOLA visualization data unavailable.") from None
        lat0, lon0 = 90 - (r0 + 0.5) * STEP, (c0 + 0.5) * STEP
        dy = dx = STEP
        radius = RADIUS
        dataset, resolution = "NASA MGS MOLA MEGDR 16 ppd", math.radians(STEP) * RADIUS
        source = "https://pds-geosciences.wustl.edu/missions/mgs/megdr.html"
        note = "MOLA fallback. Zero-count/interpolated bins are omitted; zoom cannot add detail."
    # Retain native MOLA vertices: isolated unsupported bins must not erase entire
    # coarse blocks. CTX stays bounded to ~160 vertices/axis for CPU rendering.
    stride = 1 if dataset.startswith("NASA MGS MOLA") else max(1, math.ceil(max(z.shape) / 160))
    sampled = z[::stride, ::stride].copy()
    # Support belongs to faces, not neighboring vertices. Each coarse triangle
    # checks ALL native samples in its footprint, including its boundary.
    faces_supported = []
    for r in range(sampled.shape[0] - 1):
        row = []
        for c in range(sampled.shape[1] - 1):
            block = np.isfinite(
                z[r * stride : (r + 1) * stride + 1, c * stride : (c + 1) * stride + 1]
            )
            rr, cc = np.indices(block.shape)
            row.append([bool(block[rr + cc <= stride].all()), bool(block[rr + cc >= stride].all())])
        faces_supported.append(row)
    if min(sampled.shape) < 2 or not np.isfinite(sampled).any():
        raise HTTPException(422, "No supported 3D elevation samples here. Pan or zoom out.")
    return {
        "dataset": dataset,
        "source": source,
        "source_cell_m": resolution,
        "display_stride": stride,
        "display_cell_m": resolution * stride,
        "radius_m": radius,
        "lat0": lat0,
        "lon0": lon0,
        "step_lat": dy * stride,
        "step_lon": dx * stride,
        "faces_supported": faces_supported,
        "heights": [[float(v) if np.isfinite(v) else None for v in row] for row in sampled],
        "note": note,
    }
