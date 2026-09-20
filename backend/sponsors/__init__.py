"""Optional sponsor integrations.

``sponsors.identity`` and ``sponsors.chat`` are imported by ``uvicorn main:app``.
Chat is off unless ``HOKIELENS_GEMINI=1`` and ``GEMINI_API_KEY`` are set; the
eight planner routes still make no outbound calls. Live ANS registration stays
an opt-in CLI.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def configure_stdio() -> None:
    """Keep CLI demos from crashing on Windows cp1252 consoles."""
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            reconfigure(errors="replace")


def load_local_env() -> None:
    """Fill unset process env from backend/.env. Never logs values. Skipped in pytest."""
    if os.environ.get("PYTEST_CURRENT_TEST") or "pytest" in sys.modules:
        return
    if not _ENV_PATH.is_file():
        return
    for raw in _ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            os.environ.setdefault(key, value.strip())
