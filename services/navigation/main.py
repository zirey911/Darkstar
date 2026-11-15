"""Vercel ASGI entrypoint; keep the existing source-layout app and local CLI."""

import os
import sys
from pathlib import Path

SERVICE = Path(__file__).resolve().parent
sys.path.insert(0, str(SERVICE / "src"))
# Bundled service-local data is read-only at runtime. Local CLI defaults stay intact.
if os.getenv("VERCEL") or (SERVICE / "data/processed/mola16.tif").is_file():
    os.environ.setdefault("DARKSTAR_TERRAIN_PATH", str(SERVICE / "data/processed/mola16.tif"))
    os.environ.setdefault(
        "DARKSTAR_REGIONAL_PATH", str(SERVICE / "data/processed/jezero_ctx20.tif")
    )

from darkstar_navigation.main import app  # noqa: E402, F401
