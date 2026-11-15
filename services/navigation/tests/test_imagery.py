from io import BytesIO
from urllib.error import URLError

from fastapi.testclient import TestClient

from darkstar_navigation.main import app
from darkstar_navigation.terrain import ctx_image_tile


def test_ctx_formats_failures_and_bounds(monkeypatch):
    client = TestClient(app)
    ctx_image_tile.cache_clear()
    for header, mime in [(b"\x89PNG\r\n\x1a\n", "image/png"), (b"\xff\xd8", "image/jpeg")]:

        def fetch(url, timeout, header=header):
            assert url.endswith("/CTX1/MapServer/tile/12/1623/1051")
            return BytesIO(header + b"fixture")

        monkeypatch.setattr("urllib.request.urlopen", fetch)
        response = client.get("/terrain/ctx/12/1623/1051")
        assert response.status_code == 200
        assert response.headers["content-type"] == mime
        ctx_image_tile.cache_clear()

    def unavailable(*args, **kwargs):
        raise URLError("offline")

    monkeypatch.setattr("urllib.request.urlopen", unavailable)
    assert client.get("/terrain/ctx/12/1623/1051").status_code == 502
    assert client.get("/terrain/ctx/13/0/0").status_code == 404
    assert client.get("/terrain/ctx/12/4096/0").status_code == 404
    assert client.get("/terrain/ctx/12/0/8192").status_code == 404
