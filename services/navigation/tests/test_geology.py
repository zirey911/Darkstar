import json
from urllib.error import URLError
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient

from darkstar_navigation import geology
from darkstar_navigation.main import app

client = TestClient(app)


def test_geology_queries_mars_crs_preserves_source_attributes_and_missing_data(monkeypatch):
    urls = []

    def read(url):
        urls.append(url)
        return json.dumps(
            {
                "features": [
                    {
                        "attributes": {
                            "Unit": "HNt",
                            "UnitDesc": "Hesperian and Noachian transition unit",
                        }
                    }
                ]
            }
        ).encode()

    geology.query_units.cache_clear()
    monkeypatch.setattr(geology, "read_remote", read)
    response = client.post("/terrain/geology-inspect", json={"lat": 18.4447, "lon": 77.4508})
    assert response.status_code == 200
    assert response.json()["units"][0]["unit"] == "HNt"
    assert "inSR=104971" in urls[0]
    xy = parse_qs(urlsplit(urls[0]).query)["geometry"][0].split(",")
    assert list(map(float, xy)) == pytest.approx([77.4508, 18.4447])
    geology.query_units.cache_clear()
    monkeypatch.setattr(geology, "read_remote", lambda _: b'{"features":[]}')
    assert client.post("/terrain/geology-inspect", json={"lat": 90, "lon": 0}).json()["units"] == []
    geology.query_units.cache_clear()

    def failed(_):
        raise URLError("offline")

    monkeypatch.setattr(geology, "read_remote", failed)
    assert client.post("/terrain/geology-inspect", json={"lat": 0, "lon": 0}).status_code == 503


def test_native_tile_grid_and_unavailable_images(monkeypatch):
    geology.tile_bytes.cache_clear()
    monkeypatch.setattr(geology, "read_remote", lambda _: b"not an image")
    assert client.get("/terrain/geology/6/28/45").status_code == 503
    assert client.get("/terrain/geology/2/0/0").status_code == 404
    assert client.get("/terrain/geology/7/57/91").status_code == 404
    monkeypatch.setattr(geology, "read_remote", lambda _: b"\x89PNG\r\n\x1a\nfixture")
    assert client.get("/terrain/geology/2/1/2").headers["content-type"] == "image/png"
    geology.tile_bytes.cache_clear()
