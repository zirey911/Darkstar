"""Focused EVA accounting and installed Jezero integration."""

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from darkstar_navigation import marswalk as module
from darkstar_navigation.main import app
from darkstar_navigation.regional import DEFAULT

client = TestClient(app)
PAYLOAD = {
    "start": {"lat": 18.4447, "lon": 77.4508},
    "end": {"lat": 18.45, "lon": 77.46},
    "objective": "Photograph layers",
}


def test_roundtrip_units_reserves_and_constraints(monkeypatch):
    calls = []

    def route(request):
        calls.append(request)
        return {
            "profile": [],
            "distance_m": 1000,
            "ascent_m": 10,
            "descent_m": 5,
            "dataset": "fixture",
            "dataset_id": "test",
            "nominal_cell_m": 20,
            "snapping_m": {"start": 0, "end": 0},
            "max_terrain_slope_deg": 4,
            "fallback_reason": None,
        }

    monkeypatch.setattr(module, "calculate_route", route)
    response = client.post("/terrain/marswalk", json=PAYLOAD)
    assert response.status_code == 200
    data = response.json()
    assert len(calls) == 2
    assert calls[1].start == calls[0].end and calls[1].end == calls[0].start
    assert all(c.optimization == "distance" and c.max_slope_deg == 15 for c in calls)
    assert data["total_minutes"] == 90  # 2 km / 2 km/h plus 30 min work
    assert data["resources"]["oxygen_kg"]["used"] == pytest.approx(0.2)
    assert data["resources"]["power_wh"]["used"] == 350
    assert data["resources"]["power_wh"]["required_capacity"] == pytest.approx(350 / 0.75)
    assert data["within_budgets"]
    data = client.post(
        "/terrain/marswalk",
        json={**PAYLOAD, "oxygen_kg": 0.2, "power_wh": 300, "duration_limit_minutes": 60},
    ).json()
    assert not data["within_budgets"]
    assert not data["within_duration"]
    assert not data["resources"]["oxygen_kg"]["sufficient"]
    assert not data["resources"]["power_wh"]["sufficient"]


def test_failed_return_and_invalid_inputs(monkeypatch):
    def blocked(_):
        raise HTTPException(422, "Unsupported terrain")

    monkeypatch.setattr(module, "calculate_route", blocked)
    result = client.post("/terrain/marswalk", json=PAYLOAD)
    assert result.status_code == 422
    assert "Outbound route unavailable" in result.json()["detail"]

    def return_blocked(request):
        if request.start.lat == PAYLOAD["end"]["lat"]:
            raise HTTPException(422, "Return slope unsupported")
        return {
            "profile": [],
            "distance_m": 1000,
            "ascent_m": 0,
            "descent_m": 0,
            "dataset": "fixture",
            "dataset_id": "test",
            "nominal_cell_m": 20,
            "snapping_m": {"start": 10, "end": 10},
            "max_terrain_slope_deg": 4,
            "fallback_reason": None,
        }

    monkeypatch.setattr(module, "calculate_route", return_blocked)
    result = client.post("/terrain/marswalk", json=PAYLOAD)
    assert result.status_code == 422
    assert "Return route unavailable" in result.json()["detail"]
    assert "legs" not in result.json()
    for field, value in (("speed_kmh", 0), ("reserve_fraction", 1), ("objective", " ")):
        assert client.post("/terrain/marswalk", json={**PAYLOAD, field: value}).status_code == 422


@pytest.mark.skipif(not DEFAULT.is_file(), reason="Jezero DEM not installed")
def test_installed_jezero_roundtrip():
    response = client.post("/terrain/marswalk", json=PAYLOAD)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["within_budgets"]
    assert 1200 < data["distance_m"] < 1600
    for leg in data["legs"]:
        assert leg["dataset_id"] == "jezero-ctx20"
        assert leg["nominal_cell_m"] == pytest.approx(20)
        assert len(leg["profile"]) > 20
        assert leg["max_terrain_slope_deg"] <= 15
