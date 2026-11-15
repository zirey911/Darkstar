import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from darkstar_navigation import regional
from darkstar_navigation.main import app
from darkstar_navigation.terrain import terrain_path

client = TestClient(app)


@pytest.mark.skipif(not terrain_path().is_file(), reason="Requires prepared MOLA")
def test_mola_mesh_registration_relief_and_seam():
    for lat, lon in [(18.65, -133.8), (0, 179.9)]:
        response = client.post("/terrain/mesh", json={"lat": lat, "lon": lon, "span": 5.625})
        assert response.status_code == 200
        mesh = response.json()
        heights = mesh["heights"]
        assert max(len(heights), len(heights[0])) <= 193
        samples = [z for row in heights for z in row if z is not None]
        assert max(samples) > min(samples)
        assert mesh["display_stride"] == 1
        r, c = next(
            (r, c) for r, row in enumerate(heights) for c, z in enumerate(row) if z is not None
        )
        point = {
            "lat": mesh["lat0"] - r * mesh["step_lat"],
            "lon": (mesh["lon0"] + c * mesh["step_lon"] + 180) % 360 - 180,
        }
        inspected = client.post("/terrain/inspect", json=point).json()
        assert heights[r][c] == inspected["elevation_m"]
        assert mesh["source_cell_m"] > 3700
        if lon == -133.8:
            assert max(samples) > 21000


@pytest.mark.skipif(not regional.DEFAULT.is_file(), reason="Requires Jezero crop")
def test_ctx_native_window_and_missing_support(monkeypatch):
    body = {"lat": 18.447, "lon": 77.455, "span": 0.08789}
    response = client.post("/terrain/mesh", json=body)
    assert response.status_code == 200
    mesh = response.json()
    assert mesh["source_cell_m"] == 20
    assert mesh["display_stride"] >= 1
    assert max(len(mesh["heights"]), len(mesh["heights"][0])) <= 160
    assert all(v for row in mesh["faces_supported"] for pair in row for v in pair)
    real_window = regional.window

    def with_hole(*args):
        z, slope = real_window(*args)
        z = z.copy()
        z[1, 1] = np.nan
        return z, slope

    monkeypatch.setattr(regional, "window", with_hole)
    missing = client.post("/terrain/mesh", json=body).json()
    # A hole inside the coarse cell must disable its triangles, not erase valid corners.
    assert missing["display_stride"] == 2
    assert missing["heights"][0][0] == mesh["heights"][0][0]
    assert missing["heights"][1][1] == mesh["heights"][1][1]
    assert missing["faces_supported"][0][0] == [False, False]
    assert missing["faces_supported"][2][2] == [True, True]
    assert all(z is None or math.isfinite(z) for row in missing["heights"] for z in row)


def test_mesh_invalid_and_absent_data(monkeypatch, tmp_path):
    monkeypatch.setenv("DARKSTAR_TERRAIN_PATH", str(tmp_path / "absent.tif"))
    assert client.post("/terrain/mesh", json={"lat": 0, "lon": 0, "span": 12}).status_code == 503
    assert client.post("/terrain/mesh", json={"lat": 89, "lon": 0, "span": 12}).status_code == 422
    assert client.post("/terrain/mesh", json={"lat": 0, "lon": 0, "span": 360}).status_code == 422
