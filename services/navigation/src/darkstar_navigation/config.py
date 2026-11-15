"""Load the backend's small KEY=VALUE file without overriding process settings."""

import os
import re
from pathlib import Path

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_environment(path: Path = ENV_FILE) -> None:
    if not path.is_file():
        return
    for number, raw in enumerate(path.read_text().splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        key, separator, value = line.partition("=")
        key, value = key.strip(), value.strip()
        if not separator or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
            raise ValueError(f"Invalid backend environment setting on line {number}")
        if value.startswith(('"', "'")):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError(f"Unclosed environment value on line {number}")
            value = value[1:-1]
        os.environ.setdefault(key, value)
