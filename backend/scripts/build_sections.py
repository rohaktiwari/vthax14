"""Build ``sections.json`` from local YAML/CSV extracts (PRD 8.2).

Importing this module performs no I/O beyond what the caller requests.
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections.abc import Mapping, Sequence
from datetime import date
from pathlib import Path
from typing import Any

import yaml

import config
from data import _COURSE_LEVEL_FIELDS, _modality_violation
from models import (
    Section,
    instructor_key_or_none,
    normalize_full_name,
)
from scripts.common import Counts, PipelineError, dump_json, list_files, load_json, model_payload

_TIME_RE = re.compile(
    r"^(\d{1,2}):(\d{2})(?:\s*(am|pm))?$",
    re.IGNORECASE,
)
_MINUTES_RE = re.compile(r"^\d{1,4}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_days(raw: object) -> list[str]:
    """Longest-token day mapping so ``Th`` becomes ``R`` (PRD 8.2)."""
    if isinstance(raw, list):
        tokens = [str(item).strip() for item in raw if str(item).strip()]
        if all(token in config.WEEKDAY_ORDER for token in tokens):
            ordered = [day for day in config.WEEKDAY_ORDER if day in tokens]
            if len(ordered) != len(set(tokens)):
                raise ValueError(f"unknown weekday in {raw!r}")
            return ordered
        text = "".join(tokens)
    else:
        text = str(raw).strip()
    remaining = text.casefold()
    found: list[str] = []
    i = 0
    while i < len(remaining):
        ch = remaining[i]
        if not ch.isalnum():
            i += 1
            continue
        matched = False
        for token, weekday in config.DAY_NAME_TOKENS:
            if remaining.startswith(token, i):
                if weekday not in found:
                    found.append(weekday)
                i += len(token)
                matched = True
                break
        if not matched:
            raise ValueError(f"cannot parse weekday token in {text!r} at index {i}")
    if not found:
        raise ValueError(f"no weekdays in {text!r}")
    return [day for day in config.WEEKDAY_ORDER if day in found]


def parse_clock(raw: object) -> int:
    """Minutes from midnight. 12-hour times need AM/PM when otherwise ambiguous."""
    if isinstance(raw, int):
        if 0 <= raw < config.MINUTES_PER_DAY:
            return raw
        raise ValueError(f"minute value {raw} is out of range")
    text = str(raw).strip()
    if _MINUTES_RE.fullmatch(text) and ":" not in text:
        value = int(text)
        if 0 <= value < config.MINUTES_PER_DAY:
            return value
        raise ValueError(f"minute value {text!r} is out of range")
    match = _TIME_RE.fullmatch(text)
    if match is None:
        raise ValueError(f"unrecognized time {text!r}")
    hour = int(match.group(1))
    minute = int(match.group(2))
    meridiem = match.group(3)
    if minute >= 60:
        raise ValueError(f"unrecognized time {text!r}")
    if meridiem is None:
        if hour > 12 or hour == 0:
            if hour >= 24:
                raise ValueError(f"unrecognized time {text!r}")
            return hour * 60 + minute
        raise ValueError(f"ambiguous time {text!r}; supply AM/PM")
    if hour == 0 or hour > 12:
        raise ValueError(f"invalid 12-hour time {text!r}")
    hour12 = hour % 12
    if meridiem.lower() == "pm":
        hour12 += 12
    return hour12 * 60 + minute


def parse_building(raw: object) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    if text.casefold() in config.ONLINE_LOCATION_TOKENS:
        return None
    return text.upper()


def _as_date(raw: object) -> str:
    if isinstance(raw, date):
        return raw.isoformat()
    text = str(raw).strip()
    if not _DATE_RE.fullmatch(text):
        raise ValueError(f"dates must be YYYY-MM-DD, got {text!r}")
    return text


def _instructors(row: Mapping[str, Any]) -> list[str]:
    if "instructor_names" in row and row["instructor_names"] is not None:
        value = row["instructor_names"]
        if isinstance(value, str):
            return [part.strip() for part in value.split(";") if part.strip()]
        return [str(item).strip() for item in value if str(item).strip()]
    if row.get("instructor"):
        return [str(row["instructor"]).strip()]
    return []


def _course_id(row: Mapping[str, Any]) -> tuple[str, str, str]:
    course_id = str(row.get("course_id") or "").strip()
    subject = str(row.get("subject") or "").strip().upper()
    course_no = str(row.get("course_no") or "").strip()
    if course_id:
        parts = course_id.split()
        if len(parts) != 2:
            raise ValueError(f"course_id must be 'SUBJECT COURSE_NO', got {course_id!r}")
        subject = subject or parts[0].upper()
        course_no = course_no or parts[1]
        course_id = f"{subject} {course_no}"
        return subject, course_no, course_id
    if subject and course_no:
        return subject, course_no, f"{subject} {course_no}"
    raise ValueError("section needs course_id or subject+course_no")


def _meeting_from_mapping(raw: Mapping[str, Any], defaults: Mapping[str, Any]) -> dict[str, Any]:
    start_date = raw.get("start_date", defaults.get("start_date"))
    end_date = raw.get("end_date", defaults.get("end_date"))
    if start_date is None or end_date is None:
        raise ValueError("meeting is missing start_date/end_date")
    start_raw = raw["start"] if "start" in raw else raw.get("start_min")
    end_raw = raw["end"] if "end" in raw else raw.get("end_min")
    if start_raw is None or end_raw is None:
        raise ValueError("meeting is missing start/end (or start_min/end_min)")
    return {
        "days": parse_days(raw["days"]),
        "start_min": parse_clock(start_raw),
        "end_min": parse_clock(end_raw),
        "building": parse_building(raw.get("building")),
        "room": (str(raw["room"]).strip() if raw.get("room") not in (None, "") else None),
        "start_date": _as_date(start_date),
        "end_date": _as_date(end_date),
    }


def section_from_mapping(row: Mapping[str, Any], *, term_id: str) -> Section:
    subject, course_no, course_id = _course_id(row)
    meetings_raw = row.get("meetings") or []
    meetings = [_meeting_from_mapping(item, row) for item in meetings_raw]
    seats = row.get("seats") or {}
    seats_max = seats.get("max", row.get("seats_max"))
    seats_available = seats.get("available", row.get("seats_available"))
    if seats_max is None or seats_available is None:
        raise ValueError("seats.max and seats.available are required")
    payload = {
        "crn": str(row["crn"]).strip(),
        "term_id": str(row.get("term_id") or term_id).strip(),
        "course_id": course_id,
        "subject": subject,
        "course_no": course_no,
        "title": str(row["title"]).strip(),
        "credits": float(row["credits"]),
        "instructor_names": _instructors(row),
        "schedule_type": row.get("schedule_type", "Lecture"),
        "modality": row["modality"],
        "grade_mode": row.get("grade_mode", "standard"),
        "campus": row.get("campus", "Blacksburg"),
        "seats": {"max": int(seats_max), "available": int(seats_available)},
        "description": row.get("description"),
        "prereqs_text": row.get("prereqs_text"),
        "comments": row.get("comments"),
        "meetings": meetings,
        "meta": {
            "source": config.SECTION_META_SOURCE,
            "verified": bool(row.get("verified", False)),
            "confidence": row.get("confidence", "low"),
            "fetched_at": row.get("fetched_at"),
        },
    }
    return Section.model_validate(payload)


def _load_yaml_sections(path: Path, *, term_id: str) -> list[Section]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if payload is None:
        return []
    if not isinstance(payload, list):
        raise PipelineError(f"{path}: YAML root must be a list of section objects")
    sections = []
    for index, row in enumerate(payload):
        if not isinstance(row, dict):
            raise PipelineError(f"{path}: item {index} is not a mapping")
        try:
            sections.append(section_from_mapping(row, term_id=term_id))
        except Exception as exc:
            identity = row.get("crn", index)
            raise PipelineError(f"{path}: crn={identity}: {exc}") from exc
    return sections


def _load_csv_sections(path: Path, *, term_id: str) -> list[Section]:
    with path.open(encoding="utf-8", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = list(reader)
    grouped: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for number, row in enumerate(rows, start=2):
        crn = (row.get("crn") or "").strip()
        if not crn:
            raise PipelineError(f"{path}:{number}: missing crn")
        if crn not in grouped:
            grouped[crn] = dict(row)
            grouped[crn]["meetings"] = []
            order.append(crn)
        if (row.get("days") or "").strip():
            grouped[crn]["meetings"].append(row)
    sections = []
    for crn in order:
        try:
            sections.append(section_from_mapping(grouped[crn], term_id=term_id))
        except Exception as exc:
            raise PipelineError(f"{path}: crn={crn}: {exc}") from exc
    return sections


def load_raw_sections(input_dir: Path, *, term_id: str) -> list[Section]:
    files = list_files(input_dir, (".yaml", ".yml", ".csv"))
    sections: list[Section] = []
    for path in files:
        if path.suffix.lower() == ".csv":
            sections.extend(_load_csv_sections(path, term_id=term_id))
        else:
            sections.extend(_load_yaml_sections(path, term_id=term_id))
    return sections


def _sort_meetings(section: Section) -> Section:
    meetings = sorted(
        section.meetings,
        key=lambda meeting: (
            meeting.start_min,
            meeting.end_min,
            meeting.building or "",
            meeting.start_date.isoformat(),
        ),
    )
    return section.model_copy(update={"meetings": meetings})


def validate_sections(sections: Sequence[Section], buildings: Mapping[str, Any]) -> list[Section]:
    seen: set[str] = set()
    for section in sections:
        if section.crn in seen:
            raise PipelineError(f"duplicate CRN {section.crn}")
        seen.add(section.crn)
        rule = _modality_violation(section)
        if rule is not None:
            raise PipelineError(f"crn={section.crn}: {rule}")
        for index, meeting in enumerate(section.meetings):
            if meeting.building is not None and meeting.building not in buildings:
                raise PipelineError(
                    f"crn={section.crn} meeting[{index}]: unknown building code "
                    f"{meeting.building!r}"
                )
        if section.term_id != section.term_id.strip():
            raise PipelineError(f"crn={section.crn}: blank term_id")

    canonical: dict[str, Section] = {}
    for section in sections:
        reference = canonical.get(section.course_id)
        if reference is None:
            canonical[section.course_id] = section
            continue
        differing = [
            field
            for field in _COURSE_LEVEL_FIELDS
            if getattr(section, field) != getattr(reference, field)
        ]
        if differing:
            raise PipelineError(
                f"crn={section.crn}: course {section.course_id} metadata differs from "
                f"crn={reference.crn} in: {', '.join(differing)}"
            )

    names_by_key: dict[str, dict[str, str]] = {}
    for section in sections:
        for name in section.instructor_names:
            key = instructor_key_or_none(name)
            if key is None:
                continue
            names_by_key.setdefault(key, {}).setdefault(normalize_full_name(name), name.strip())
    collisions = {
        key: sorted(names.values()) for key, names in names_by_key.items() if len(names) > 1
    }
    if collisions:
        key, names = next(iter(sorted(collisions.items())))
        raise PipelineError(f"instructor-key collision on {key!r}: {', '.join(names)}")
    return [_sort_meetings(section) for section in sections]


def sort_sections(sections: Sequence[Section]) -> list[Section]:
    return sorted(sections, key=lambda section: (section.course_id, section.crn))


def build_sections(
    input_dir: Path,
    *,
    buildings_path: Path,
    term_id: str,
) -> tuple[list[Section], Counts]:
    counts = Counts()
    files = list_files(input_dir, (".yaml", ".yml", ".csv"))
    counts.files = len(files)
    buildings = load_json(buildings_path)
    if not isinstance(buildings, dict):
        raise PipelineError(f"{buildings_path}: buildings root must be an object")
    raw = load_raw_sections(input_dir, term_id=term_id)
    counts.read = len(raw)
    validated = validate_sections(raw, buildings)
    ordered = sort_sections(validated)
    counts.written = len(ordered)
    return ordered, counts


def write_sections(path: Path, sections: Sequence[Section]) -> None:
    dump_json(path, [model_payload(section) for section in sections])


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build sections.json from local YAML/CSV extracts")
    parser.add_argument("--input-dir", type=Path, default=config.RAW_SECTIONS_DIR)
    parser.add_argument(
        "--output", type=Path, default=config.DEFAULT_DATA_DIR / config.SECTIONS_FILE
    )
    parser.add_argument(
        "--buildings",
        type=Path,
        default=config.DEFAULT_DATA_DIR / config.BUILDINGS_FILE,
    )
    parser.add_argument("--term-id", default=config.DEFAULT_CATALOG_TERM_ID)
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        sections, counts = build_sections(
            args.input_dir, buildings_path=args.buildings, term_id=args.term_id
        )
        write_sections(args.output, sections)
    except PipelineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"wrote {args.output} ({counts.line()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
