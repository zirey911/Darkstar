import math

import numpy as np
import pytest
import rasterio
from fastapi.testclient import TestClient
from rasterio.crs import CRS
from rasterio.warp import transform

from darkstar_navigation import regional
from darkstar_navigation.main import app
from darkstar_navigation.terrain import slopes

client = TestClient(app)
START = {"lat": 18.4447, "lon": 77.4508}
END = {"lat": 18.45, "lon": 77.46}


def test_anisotropic_grid_slopes_use_mars_metres():
    radius = 3396190
    dy = math.degrees(20 / radius)
    dx = dy / math.cos(math.radians(18.4663))
    z = np.tile(np.arange(7) * 2.0, (7, 1))
    slope = slopes(z, 18.4663 + 3.5 * dy, 0, step=dy, step_lon=dx, radius=radius)
    assert slope[3, 3] == pytest.approx(math.degrees(math.atan(0.1)))


@pytest.mark.skipif(not regional.DEFAULT.is_file(), reason="Run prepare_jezero.py")
def test_real_ctx_inspection_registration_route_and_display():
    point = client.post("/terrain/inspect", json=START).json()
    assert point["dataset_id"] == "jezero-ctx20"
    assert point["nominal_cell_m"] == 20
    assert point["observations"] is None  # Stereo does not have MOLA observation counts.
    with rasterio.open(regional.DEFAULT) as src:
        geographic = CRS.from_proj4("+proj=longlat +R=3396190 +no_defs")
        x, y = transform(geographic, src.crs, [START["lon"]], [START["lat"]])
        r, c = src.index(x[0], y[0])
        expected = src.read(1, window=rasterio.windows.Window(c, r, 1, 1))[0, 0]
        assert point["elevation_m"] == float(expected)
    result = client.post("/terrain/route", json={"start": START, "end": END})
    assert result.status_code == 200, result.text
    route = result.json()
    assert route["dataset_id"] == "jezero-ctx20"
    assert route["nominal_cell_m"] == pytest.approx(20)
    assert route["fallback_reason"] is None
    assert 600 < route["distance_m"] < 800
    assert route["max_terrain_slope_deg"] <= 15
    assert route["snapping_m"]["start"] < 15
    assert len(route["profile"]) > 20
    assert client.get("/terrain/region-map").content.startswith(b"\x89PNG")


def test_missing_regional_file_falls_back_explicitly(monkeypatch, tmp_path):
    monkeypatch.setenv("DARKSTAR_REGIONAL_PATH", str(tmp_path / "absent.tif"))
    if not (regional.DEFAULT.parent / "mola16.tif").exists():
        pytest.skip("MOLA is not installed")
    result = client.post("/terrain/inspect", json={"lat": 60, "lon": 30}).json()
    assert result["dataset_id"] == "mola16"
    assert "reduced-accuracy" in result["fallback_reason"]
    assert client.get("/terrain/metadata").json()["regions"] == []


@pytest.mark.skipif(not regional.DEFAULT.is_file(), reason="Run prepare_jezero.py")
def test_detailed_hole_remains_missing_and_fallback_is_labeled(monkeypatch, tmp_path):
    target = tmp_path / "hole.tif"
    with rasterio.open(regional.DEFAULT) as src:
        profile = src.profile
        tags = src.tags()
        z = src.read(1)
        x, y = transform(
            CRS.from_proj4("+proj=longlat +R=3396190"), src.crs, [START["lon"]], [START["lat"]]
        )
        r, c = src.index(x[0], y[0])
        z[r - 1 : r + 2, c - 1 : c + 2] = src.nodata
    with rasterio.open(target, "w", **profile) as dst:
        dst.write(z, 1)
        dst.update_tags(**tags)
    monkeypatch.setenv("DARKSTAR_REGIONAL_PATH", str(target))
    result = client.post("/terrain/inspect", json=START).json()
    assert result["dataset_id"] == "mola16"
    assert "nodata" in result["fallback_reason"]
    response = client.post("/terrain/route", json={"start": START, "end": END})
    assert response.status_code == 422  # Tiny endpoints share a coarse MOLA cell.
    assert "reduced-accuracy" in response.json()["detail"]
