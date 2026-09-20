"""Shared test helpers: a mutable, temp-directory copy of the committed dataset."""

from __future__ import annotations

import json
import shutil
import socket
from pathlib import Path
from typing import Any

import pytest

import config
from config import Settings


@pytest.fixture(autouse=True)
def _block_non_loopback_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail tests that try to open a non-loopback TCP connection."""
    real_connect = socket.socket.connect

    def connect(self: socket.socket, address: object) -> object:
        host = address[0] if isinstance(address, tuple) else address
        if isinstance(host, bytes):
            host = host.decode()
        if host not in {"127.0.0.1", "::1", "localhost", "0.0.0.0", "::"}:
            raise RuntimeError(f"non-loopback network blocked during tests: {host!r}")
        return real_connect(self, address)

    monkeypatch.setattr(socket.socket, "connect", connect)


class Dataset:
    """Temp copy of ``data/`` and ``tests/fixtures/`` that tests may mutate freely."""

    def __init__(self, root: Path) -> None:
        self.data_dir = root / "data"
        self.fixtures_dir = root / "fixtures"
        shutil.copytree(
            config.DEFAULT_DATA_DIR, self.data_dir, ignore=shutil.ignore_patterns("raw")
        )
        shutil.copytree(config.DEFAULT_FIXTURES_DIR, self.fixtures_dir)

    def load(self, name: str) -> Any:
        return json.loads((self.data_dir / name).read_text(encoding="utf-8"))

    def save(self, name: str, payload: Any) -> None:
        (self.data_dir / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def load_fixture(self, name: str) -> Any:
        return json.loads((self.fixtures_dir / name).read_text(encoding="utf-8"))

    def save_fixture(self, name: str, payload: Any) -> None:
        (self.fixtures_dir / name).write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def settings(self, **overrides: Any) -> Settings:
        return Settings(data_dir=self.data_dir, fixtures_dir=self.fixtures_dir, **overrides)


@pytest.fixture
def dataset(tmp_path: Path) -> Dataset:
    return Dataset(tmp_path)


TERM_START = "2026-08-24"
TERM_END = "2026-12-09"


def make_meeting(
    days: list[str],
    start_min: int,
    end_min: int,
    building: str | None,
    *,
    room: str | None = None,
    start_date: str = TERM_START,
    end_date: str = TERM_END,
) -> dict[str, Any]:
    return {
        "days": days,
        "start_min": start_min,
        "end_min": end_min,
        "building": building,
        "room": room,
        "start_date": start_date,
        "end_date": end_date,
    }


def make_section(
    crn: str,
    course_id: str,
    meetings: list[dict[str, Any]],
    *,
    title: str = "Placeholder Course",
    credits: float = 3,
    instructor_names: list[str] | None = None,
    modality: str = "f2f",
    grade_mode: str = "standard",
    schedule_type: str = "Lecture",
    term_id: str = config.DEFAULT_CATALOG_TERM_ID,
) -> dict[str, Any]:
    """Schema-valid section dict for tests (same shape as data/sections.json)."""
    subject, course_no = course_id.split(" ")
    return {
        "crn": crn,
        "term_id": term_id,
        "course_id": course_id,
        "subject": subject,
        "course_no": course_no,
        "title": title,
        "credits": credits,
        "instructor_names": ["Ada Lovelace"] if instructor_names is None else instructor_names,
        "schedule_type": schedule_type,
        "modality": modality,
        "grade_mode": grade_mode,
        "campus": "Blacksburg",
        "seats": {"max": 30, "available": 5},
        "description": None,
        "prereqs_text": None,
        "comments": None,
        "meetings": meetings,
        "meta": {
            "source": "banner_class_search",
            "verified": False,
            "confidence": "low",
            "fetched_at": None,
        },
    }


# Sections layered onto the committed catalog for commute/overlap API tests. The
# committed placeholder data has no tight, impossible, or overlapping pairs on its own.
# CRN 90001 (CS 3114) meets MWF 610-660 in MCB; MCB|WHI is an 18-minute walk.
TIGHT_CRN = "90012"  # MWF 675-725 WHI: gap 15, adjusted 16 -> slack -1 -> tight
IMPOSSIBLE_CRN = "90013"  # MWF 665-715 WHI: gap 5, adjusted 16 -> slack -11 -> impossible
COMMUTE_TEST_SECTIONS = [
    make_section(
        TIGHT_CRN,
        "CS 3214",
        [make_meeting(["M", "W", "F"], 675, 725, "WHI", room="240")],
        title="Computer Systems",
    ),
    make_section(
        IMPOSSIBLE_CRN,
        "CS 3304",
        [make_meeting(["M", "W", "F"], 665, 715, "WHI", room="250")],
        title="Comparative Languages",
    ),
]


@pytest.fixture
def commute_dataset(dataset: Dataset) -> Dataset:
    sections = dataset.load("sections.json")
    sections.extend(json.loads(json.dumps(COMMUTE_TEST_SECTIONS)))
    dataset.save("sections.json", sections)
    return dataset
