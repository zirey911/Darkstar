import math

import numpy as np
import pytest
from fastapi.testclient import TestClient

from darkstar_navigation.main import app
from darkstar_navigation.terrain import (
    RADIUS,
    STEP,
    RouteRequest,
    astar,
    distance,
    find_path,
    slopes,
    terrain_path,
)

client = TestClient(app)


def scenario(**kwargs):
    return RouteRequest(start={"lat": 60, "lon": 30}, end={"lat": 61, "lon": 32}, **kwargs)


def test_mars_distances_and_longitude_wrap():
    assert distance(0, 0, 0, 1) == pytest.approx(math.pi * RADIUS / 180)
    assert distance(0, 179.5, 0, -179.5) == pytest.approx(distance(0, 0, 0, 1))
    assert distance(60, 0, 60, 1) == pytest.approx(distance(0, 0, 0, 1) / 2, rel=1e-4)


def test_planar_gradient_and_missing_stencil():
    spacing = RADIUS * math.radians(STEP)
    z = np.tile(np.arange(9) * spacing * 0.1, (9, 1))
    slope = slopes(z, 4.5 * STEP, 0)
    assert slope[4, 4] == pytest.approx(math.degrees(math.atan(0.1)))
    z[4, 4] = np.nan
    slope = slopes(z, 4.5 * STEP, 0)
    assert np.isnan(slope[4, 4]) and np.isnan(slope[4, 5])


def test_eight_direction_route_and_no_corner_cutting():
    z = np.zeros((7, 7))
    slope = np.zeros_like(z)
    path = astar(z, slope, (1, 1), (5, 5), 60, 30, scenario())
    assert path == [(i, i) for i in range(1, 6)]
    slope[:] = np.nan
    slope[1, 1] = slope[2, 2] = 0
    assert astar(z, slope, (1, 1), (2, 2), 60, 30, scenario()) is None


def test_edge_and_cell_slope_limits():
    z = np.zeros((7, 7))
    z[:, 3:] = 10000
    slope = np.zeros_like(z)
    assert astar(z, slope, (3, 1), (3, 5), 60, 30, scenario()) is None
    z[:] = 0
    slope[:, 3] = 30
    assert astar(z, slope, (3, 1), (3, 5), 60, 30, scenario(max_slope_deg=15)) is None
    assert astar(
        z, slope, (3, 1), (3, 5), 60, 30, scenario(max_slope_deg=35, rover={"max_slope_deg": 35})
    )


def test_coarse_guide_refines_to_adjacent_native_cells():
    z = np.zeros((128, 128))
    path, coarse = find_path(z, z.copy(), (8, 8), (120, 120), 60, 30, scenario())
    assert coarse
    assert path[0] == (8, 8) and path[-1] == (120, 120)
    assert all(
        max(abs(a - b) for a, b in zip(p, q, strict=True)) == 1
        for p, q in zip(path, path[1:], strict=False)
    )


def test_unavailable_and_unsupported_requests(monkeypatch, tmp_path):
    monkeypatch.setenv("DARKSTAR_TERRAIN_PATH", str(tmp_path / "absent.tif"))
    assert client.get("/terrain/metadata").status_code == 503
    assert client.post("/terrain/route", json=scenario().model_dump()).status_code == 503
    body = scenario().model_dump()
    body["end"] = {"lat": 89, "lon": 32}
    assert client.post("/terrain/route", json=body).status_code == 422
    body["end"] = {"lat": -60, "lon": -120}
    assert client.post("/terrain/route", json=body).status_code == 422


@pytest.mark.skipif(
    not terrain_path().is_file(), reason="Run scripts/prepare_terrain.py for real-data test"
)
def test_real_mola_route_and_seam():
    import rasterio

    meta = client.get("/terrain/metadata")
    assert meta.status_code == 200
    assert meta.json()["provenance"]["files"][0]["sha256"]
    for start, end in [
        ({"lat": 60, "lon": 30}, {"lat": 61, "lon": 32}),
        ({"lat": 60, "lon": 179}, {"lat": 61, "lon": -179}),
        ({"lat": 60.01, "lon": 30.001}, {"lat": 59.99, "lon": 30.04}),
    ]:
        body = scenario().model_dump() | {"start": start, "end": end}
        response = client.post("/terrain/route", json=body)
        assert response.status_code == 200, response.text
        route = response.json()
        assert route["distance_m"] > 0
        assert route["max_terrain_slope_deg"] <= body["max_slope_deg"]
        assert route["max_edge_slope_deg"] <= body["max_slope_deg"]
        assert route["distance_m"] == route["profile"][-1]["distance_m"]
        assert all(math.isfinite(p["elevation_m"]) for p in route["profile"])
        with rasterio.open(terrain_path()) as src:
            for name, selected, vertex in [
                ("start", start, route["profile"][0]),
                ("end", end, route["profile"][-1]),
            ]:
                row, col = src.index(selected["lon"] % 360, selected["lat"])
                lon, lat = src.xy(row, col)
                assert vertex["lat"] == pytest.approx(lat)
                assert vertex["lon"] == pytest.approx((lon + 180) % 360 - 180)
                assert abs(vertex["lat"] - selected["lat"]) <= STEP / 2
                assert abs((vertex["lon"] - selected["lon"] + 180) % 360 - 180) <= STEP / 2
                assert route["snapping_m"][name] == pytest.approx(
                    distance(selected["lat"], selected["lon"], vertex["lat"], vertex["lon"])
                )
        if start["lat"] == 60.01:
            assert {p["lon"] for p in route["profile"]} == {30.03125}



def test_energy_can_favour_a_longer_flat_path():
    z = np.zeros((7, 9))
    z[3, 4] = 500
    slope = np.zeros_like(z)
    direct = astar(z, slope, (3, 1), (3, 7), 0, 30, scenario(slope_weight=0, energy_weight=0))
    efficient = astar(
        z,
        slope,
        (3, 1),
        (3, 7),
        0,
        30,
        scenario(optimization="energy", rover={"rolling_resistance": 0}),
    )
    assert (3, 4) in direct
    assert (3, 4) not in efficient


@pytest.mark.skipif(not terrain_path().is_file(), reason="Requires prepared MOLA")
def test_inspection_and_numerical_topography():
    from darkstar_navigation.terrain import Coordinate, inspect_point

    response = client.post("/terrain/inspect", json={"lat": 60, "lon": 30})
    assert response.status_code == 200
    point = response.json()
    assert point["support"] == "observed"
    assert point["observations"] > 0
    assert point["elevation_m"] is not None
    assert point["routing_supported"]
    assert inspect_point(Coordinate(lat=90, lon=180))["routing_supported"] is False
    image = client.get("/terrain/topography/0/0/0")
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/png"
    assert image.content.startswith(b"\x89PNG\r\n\x1a\n")
    assert client.get("/terrain/topography/0/1/0").status_code == 404


@pytest.mark.skipif(not terrain_path().is_file(), reason="Requires prepared MOLA")
def test_olympus_and_prime_meridian_raster_registration():
    import rasterio
    from rasterio.windows import Window

    # Public display 226.20 E maps to signed API -133.80, same native raster cell.
    with rasterio.open(terrain_path()) as src:
        for latitude, east in [(18.65, 226.20), (0, 359.99), (0, 0), (0, 0.01), (0, 360)]:
            signed = (east + 180) % 360 - 180
            response = client.post("/terrain/inspect", json={"lat": latitude, "lon": signed})
            assert response.status_code == 200
            result = response.json()
            row, col = src.index(east % 360, latitude)
            height = src.read(1, window=Window(col, row, 1, 1))[0, 0]
            assert result["elevation_m"] == int(height)
            x, y = src.xy(row, col)
            assert result["cell_centre"]["lon"] % 360 == pytest.approx(x)
            assert result["cell_centre"]["lat"] == pytest.approx(y)
            if east == 226.20:
                assert (row, col) == (1141, 3619)
                assert height > 18000  # Summit-region elevation, not an imagery-derived height.
