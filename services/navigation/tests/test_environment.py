import pytest
from fastapi.testclient import TestClient

from darkstar_navigation import environment
from darkstar_navigation.main import app

client = TestClient(app)


@pytest.mark.parametrize(
    "coordinate",
    [
        {"lat": 18.4447, "lon": 77.4508},
        {"lat": -5.37, "lon": 137.81},
        {"lat": 18.65, "lon": -133.8},
        {"lat": 90, "lon": 180},
    ],
)
def test_references_never_become_local_or_live_measurements(coordinate):
    response = client.post(
        "/terrain/environment",
        json={"locations": [{"label": "Selected location", "coordinate": coordinate}]},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["locations"][0]["current_conditions"].startswith("Unavailable")
    assert data["locations"][0]["historical_local_measurements"].startswith("Unavailable")
    records = {r["id"]: r for r in data["references"]}
    assert records["meda"]["date"] == "2024-04-27"
    assert records["meda"]["values"][2]["value"] is None  # No ground temperature in feed.
    assert records["rems"]["values"][2]["value"] == -84
    assert records["mastcam-tau"]["values"][0]["value"] == 0.591
    assert records["mastcam-tau"]["values"][1]["value"] == 0.030
    assert "review" in records["mastcam-tau"]["kind"]
    assert records["rad"]["date"] == "August 2012–June 2013"
    assert records["rad"]["values"][0]["unit"] == "mSv/day"
    assert len(data["warnings"]) == 4
    assert "no environmental model" in data["modeled_estimates"]
    assert "safety approval" in data["mission_effect"]
    assert "dose_estimate" not in data


def test_mission_locations_and_unavailable_reference(monkeypatch, tmp_path):
    payload = {
        "locations": [
            {"label": "Habitat", "coordinate": {"lat": 18.4447, "lon": 77.4508}},
            {"label": "Science destination", "coordinate": {"lat": 18.45, "lon": 77.46}},
        ]
    }
    data = client.post("/terrain/environment", json=payload).json()
    assert [p["label"] for p in data["locations"]] == ["Habitat", "Science destination"]
    monkeypatch.setattr(environment, "REFERENCE", tmp_path / "missing.json")
    assert client.post("/terrain/environment", json=payload).status_code == 503
    assert client.post("/terrain/environment", json={"locations": []}).status_code == 422
