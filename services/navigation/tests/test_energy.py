"""Focused units, directional costs, optimality and real-data energy accounting."""

import math

import numpy as np
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from darkstar_navigation.main import app
from darkstar_navigation.regional import DEFAULT
from darkstar_navigation.terrain import (
    RADIUS,
    Coordinate,
    RouteRequest,
    RoverProfile,
    astar,
    distance,
    edge_energy,
    slopes,
)


def test_energy_units_and_nonregenerative_descent():
    rover = RoverProfile(mass_kg=100, rolling_resistance=0.1, drivetrain_efficiency=0.5)
    assert edge_energy(100, 0, rover) == pytest.approx((7420, 0))
    assert edge_energy(100, 10, rover) == pytest.approx((14840, 0))
    assert edge_energy(100, -5, rover) == pytest.approx((3710, 0))
    assert edge_energy(100, -20, rover) == pytest.approx((0, 3710))
    assert edge_energy(100, 10, rover.model_copy(update={"mass_kg": 200}))[0] == 29680
    for values in (
        {"mass_kg": -1},
        {"drivetrain_efficiency": 0},
        {"energy_capacity_wh": 0},
        {"rolling_resistance": float("nan")},
    ):
        with pytest.raises(ValidationError):
            RoverProfile(**values)


def test_energy_detour_cost_and_admissible_bound():
    # A gentle 500 m hill on kilometre-spaced synthetic terrain; all source slopes apply.
    z = np.zeros((7, 9))
    z[3, 4] = 500
    step = 1 / 16
    north = 3.5 * step
    slope = slopes(z, north, 0)
    request = RouteRequest(start=Coordinate(lat=0, lon=0), end=Coordinate(lat=0, lon=1))
    paths = [
        astar(z, slope, (3, 1), (3, 7), north, 0, request.model_copy(update={"optimization": mode}))
        for mode in ("distance", "energy")
    ]

    def cost(path):
        length = energy = 0
        for (r, c), (rr, cc) in zip(path, path[1:], strict=False):
            d = distance(
                north - (r + 0.5) * step,
                (c + 0.5) * step,
                north - (rr + 0.5) * step,
                (cc + 0.5) * step,
            )
            dz = z[rr, cc] - z[r, c]
            length += math.hypot(d, dz)
            energy += edge_energy(d, dz, request.rover)[0]
        return length, energy

    direct, efficient = map(cost, paths)
    assert efficient[0] > direct[0]
    assert efficient[1] < direct[1]
    # The remaining-work heuristic is bounded by each complete path's cost.
    bound = edge_energy(RADIUS * math.radians(6 * step), 0, request.rover)[0]
    assert bound <= min(direct[1], efficient[1]) + 1e-6
    assert paths[0] != paths[1]


@pytest.mark.skipif(not DEFAULT.is_file(), reason="Prepare Jezero CTX")
def test_real_route_energy_profile_and_comparison():
    client = TestClient(app)
    response = client.post(
        "/terrain/route",
        json={
            "start": {"lat": 18.4447, "lon": 77.4508},
            "end": {"lat": 18.45, "lon": 77.46},
            "optimization": "energy",
            "compare": True,
            "rover": {"energy_capacity_wh": 0.001},
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    rover = RoverProfile(**result["rover"])
    energy = braking = length = 0
    for a, b in zip(result["profile"], result["profile"][1:], strict=False):
        d = distance(
            a["lat"], a["lon"], b["lat"], b["lon"], radius=result["provenance"]["radius_m"]
        )
        dz = b["elevation_m"] - a["elevation_m"]
        e, heat = edge_energy(d, dz, rover)
        energy += e
        braking += heat
        length += math.hypot(d, dz)
    assert result["energy_j"] == pytest.approx(energy)
    assert result["energy_wh"] == pytest.approx(energy / 3600)
    assert result["braking_loss_j"] == pytest.approx(braking)
    assert result["distance_m"] == pytest.approx(length)
    assert result["optimization_cost"] == pytest.approx(energy)
    assert result["within_energy_capacity"] is False
    rows = {row["optimization"]: row for row in result["comparisons"]}
    assert rows["energy"]["energy_wh"] <= rows["distance"]["energy_wh"] + 1e-8
    assert rows["distance"]["distance_m"] <= rows["energy"]["distance_m"] + 1e-8
    assert result["dataset_id"] == "jezero-ctx20"
