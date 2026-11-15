"""Prepare and validate NASA DEMs inside the navigation service at build time."""

import runpy
import shutil
import sys
from pathlib import Path

SERVICE = Path(__file__).resolve().parent
ROOT = SERVICE.parents[1]
OUTPUT = SERVICE / "data/processed"


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for script, filename in (
        ("prepare_terrain.py", "mola16.tif"),
        ("prepare_jezero.py", "jezero_ctx20.tif"),
    ):
        source = ROOT / "data/processed" / filename
        if not source.is_file():
            # Reuse the existing provenance-preserving download/windowing scripts.
            runpy.run_path(str(ROOT / "scripts" / script), run_name="__main__")
        shutil.copy2(source, OUTPUT / filename)
    sys.path.insert(0, str(SERVICE / "src"))
    import rasterio

    from darkstar_navigation.regional import describe
    from darkstar_navigation.terrain import check_raster

    with rasterio.open(OUTPUT / "mola16.tif") as src:
        check_raster(src)
        if not src.tags().get("darkstar_provenance"):
            raise ValueError("Missing MOLA provenance")
    path = OUTPUT / "jezero_ctx20.tif"
    describe(str(path), path.stat().st_mtime_ns, path.stat().st_size)
    print(
        "Validated bundled MOLA and Jezero DEMs:",
        sum(p.stat().st_size for p in OUTPUT.glob("*.tif")),
        "bytes",
    )


if __name__ == "__main__":
    main()
