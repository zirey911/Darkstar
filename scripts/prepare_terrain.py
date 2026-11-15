"""Download the NASA PDS MOLA 16 ppd products and build a tiled, two-band GeoTIFF."""

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.request import urlopen

import numpy as np
import rasterio
from rasterio.transform import from_origin

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data/raw/mola16"
OUTPUT = ROOT / "data/processed/mola16.tif"
BASE = "https://pds-geosciences.wustl.edu/mgs/urn-nasa-pds-mgs_mola_topography_derived/meg016/"


def download(name):
    target = RAW / name
    if not target.exists():
        partial = target.with_suffix(target.suffix + ".part")
        with urlopen(BASE + name, timeout=60) as source, partial.open("wb") as dest:
            while chunk := source.read(1024 * 1024):
                dest.write(chunk)
        partial.replace(target)
    digest = hashlib.sha256()
    with target.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return {
        "file": name,
        "url": BASE + name,
        "sha256": digest.hexdigest(),
        "bytes": target.stat().st_size,
    }


def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT.exists():
        print(f"Already prepared: {OUTPUT}; remove it explicitly to rebuild.")
        return
    files = []
    for product in ("megt90n000eb", "megc90n000eb"):
        for extension in ("lbl", "xml", "img"):
            print(f"Retrieving {product}.{extension}", flush=True)
            files.append(download(f"{product}.{extension}"))
        label = (RAW / f"{product}.lbl").read_text()
        # These exact products are fixed-format PDS3 binary rasters, not RGB images.
        for key, expected in [
            ("LINES", "2880"),
            ("LINE_SAMPLES", "5760"),
            ("SAMPLE_BITS", "16"),
            ("SAMPLE_TYPE", "MSB_INTEGER"),
            ("MAP_RESOLUTION", "16.0"),
            ("A_AXIS_RADIUS", "3396.0"),
            ("WESTERNMOST_LONGITUDE", "0.0"),
            ("MAXIMUM_LATITUDE", "90.0"),
        ]:
            value = re.search(rf"^\s*{key}\s*=\s*(\S+)", label, re.MULTILINE)
            if not value or value[1] != expected:
                raise ValueError(
                    f"Unexpected {key} in {product}; inspect source metadata"
                )
        if (RAW / f"{product}.img").stat().st_size != 2880 * 5760 * 2:
            raise ValueError(
                "Incomplete MOLA download; remove the incomplete raw file and retry"
            )
    metadata = {
        "dataset": "NASA MGS MOLA MEGDR v2.0 (16 pixels/degree)",
        "source": "https://pds-geosciences.wustl.edu/missions/mgs/megdr.html",
        "prepared_utc": datetime.now(UTC).isoformat(),
        "files": files,
        "resolution_degrees": 1 / 16,
        "radius_m": 3396000,
        "coordinates": "IAU2000 planetocentric latitude, east-positive longitude",
        "elevation_datum": "Planetary radius minus GMM3 (mgm1025), degree/order 50 areoid",
        "elevation_units": "m",
        "source_nodata": None,
        "missing_policy": "Observation count <= 0 is unsupported; interpolated heights retained, not routed",
        "bands": ["median_topography_m", "observation_count"],
    }
    arrays = [
        np.memmap(RAW / f"{p}.img", mode="r", dtype=">i2", shape=(2880, 5760))
        for p in ("megt90n000eb", "megc90n000eb")
    ]
    partial = OUTPUT.with_suffix(".partial.tif")
    with rasterio.open(
        partial,
        "w",
        driver="GTiff",
        width=5760,
        height=2880,
        count=2,
        dtype="int16",
        tiled=True,
        blockxsize=256,
        blockysize=256,
        compress="deflate",
        transform=from_origin(0, 90, 1 / 16, 1 / 16),
        crs="+proj=longlat +R=3396000 +no_defs",
    ) as dst:
        # Window conversion bounds resident arrays; never load the whole planet.
        for _, window in dst.block_windows(1):
            r, c = window.toslices()
            for band, array in enumerate(arrays, 1):
                dst.write(np.asarray(array[r, c], dtype="int16"), band, window=window)
        dst.set_band_description(1, "Median topography, metres above MOLA areoid")
        dst.set_band_description(
            2, "MOLA observations per cell; zero means interpolated"
        )
        dst.update_tags(darkstar_provenance=json.dumps(metadata))
    partial.replace(OUTPUT)
    OUTPUT.with_suffix(".json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(f"Prepared {OUTPUT}", flush=True)


if __name__ == "__main__":
    main()
