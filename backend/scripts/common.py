"""Shared pipeline helpers: atomic JSON I/O, summaries, CLI path defaults.

Importing this module performs no file writes, network calls, or dotenv loading.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import config

_REPO_ROOT = Path(__file__).resolve().parents[1]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))


class PipelineError(Exception):
    """Fatal pipeline failure; CLIs print the message and exit nonzero."""


@dataclass
class Counts:
    """Deterministic read/write/skip/warn counters for CLI summaries."""

    read: int = 0
    written: int = 0
    skipped: int = 0
    warned: int = 0
    files: int = 0
    extras: dict[str, int] = field(default_factory=dict)

    def bump(self, name: str, amount: int = 1) -> None:
        self.extras[name] = self.extras.get(name, 0) + amount

    def line(self) -> str:
        parts = [
            f"files={self.files}",
            f"read={self.read}",
            f"written={self.written}",
            f"skipped={self.skipped}",
            f"warned={self.warned}",
        ]
        for key in sorted(self.extras):
            parts.append(f"{key}={self.extras[key]}")
        return " ".join(parts)


def atomic_write_text(path: Path, text: str) -> None:
    """Replace ``path`` via a sibling temp file (never append)."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8", newline="\n")
    tmp.replace(path)


def dump_json(path: Path, payload: Any) -> None:
    """UTF-8 JSON with sorted keys, configured indent, and a trailing newline."""
    text = json.dumps(
        payload,
        indent=config.PIPELINE_JSON_INDENT,
        sort_keys=True,
        ensure_ascii=False,
    )
    if not text.endswith("\n"):
        text += "\n"
    atomic_write_text(path, text)


def load_json(path: Path) -> Any:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise PipelineError(f"{path}: cannot read file: {exc}") from exc
    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise PipelineError(f"{path}: invalid JSON: {exc}") from exc


def list_files(directory: Path, suffixes: tuple[str, ...]) -> list[Path]:
    """Lexicographic files with the given suffixes; missing dir is empty."""
    if not directory.is_dir():
        return []
    wanted = tuple(s.lower() for s in suffixes)
    files = [
        path for path in directory.iterdir() if path.is_file() and path.suffix.lower() in wanted
    ]
    return sorted(files, key=lambda path: path.name.lower())


def model_payload(model: Any) -> dict[str, Any]:
    return model.model_dump(mode="json")


def google_api_key(environ: Mapping[str, str] | None = None) -> str | None:
    """Process-environment key only. Never reads ``.env`` and never logs the value."""
    env = os.environ if environ is None else environ
    raw = env.get(config.ENV_GOOGLE_MAPS_API_KEY)
    if raw is None:
        return None
    key = raw.strip()
    return key or None
