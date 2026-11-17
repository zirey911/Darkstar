"""HTTP smoke check against the running Linux container; no LLM key required."""
import json
import time
from urllib.request import Request, urlopen

BASE = "http://127.0.0.1:10000"
for attempt in range(30):
    try:
        with urlopen(BASE + "/health", timeout=3) as response:
            assert json.load(response)["status"] == "ok"
        break
    except OSError:
        if attempt == 29:
            raise
        time.sleep(2)
for start, end, dataset in [
    ({"lat": 60, "lon": 30}, {"lat": 61, "lon": 32}, "mola16"),
    ({"lat": 18.4446, "lon": 77.4509}, {"lat": 18.45, "lon": 77.46}, "jezero-ctx20"),
]:
    request = Request(BASE + "/terrain/route", data=json.dumps({"start": start, "end": end}).encode(), headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=60) as response:
        route = json.load(response)
        assert route["dataset_id"] == dataset
        assert route["distance_m"] > 0 and len(route["profile"]) > 1
        print(dataset, route["distance_m"], "metres")
print("Health and both real-data routes passed")
