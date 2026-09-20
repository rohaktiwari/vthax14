"""Parse local UDC grade tables into ``grade_records.json`` (PRD 8.1).

Input: ``.txt`` files in ``data/raw/udc/`` (pipe-delimited Markdown or tab-delimited
23-column rows). Importing this module does not read files, write output, or
touch the network.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Iterable, Sequence
from pathlib import Path

from pydantic import ValidationError

import config
from models import GradeRecord, normalize_instructor_key
from scripts.common import Counts, PipelineError, dump_json, list_files, model_payload

_MINUS_TRANSLATION = str.maketrans(
    {
        "\u2212": "-",
        "\u2013": "-",
        "\u2014": "-",
        "\ufe58": "-",
        "\uff0d": "-",
    }
)

_TERM_ALIASES = {
    "fall": "Fall",
    "spring": "Spring",
    "winter": "Winter",
    "summer i": "Summer I",
    "summer 1": "Summer I",
    "summeri": "Summer I",
    "summer ii": "Summer II",
    "summer 2": "Summer II",
    "summerii": "Summer II",
}


def _normalize_minuses(text: str) -> str:
    return text.translate(_MINUS_TRANSLATION)


def _is_blank(line: str) -> bool:
    return not line.strip()


def _is_separator(line: str) -> bool:
    stripped = line.strip().replace("|", "").replace(":", "").replace(" ", "")
    return bool(stripped) and set(stripped) <= {"-"}


def _is_header(cells: Sequence[str]) -> bool:
    if len(cells) != config.UDC_COLUMN_COUNT:
        return False
    expected = [name.casefold() for name in config.UDC_COLUMNS]
    got = [cell.strip().casefold().replace(" ", "") for cell in cells]
    return got == [name.replace(" ", "") for name in expected]


def _split_row(line: str) -> list[str] | None:
    raw = _normalize_minuses(line).rstrip("\n")
    if "|" in raw:
        cells = [part.strip() for part in raw.split("|")]
        if cells and cells[0] == "":
            cells = cells[1:]
        if cells and cells[-1] == "":
            cells = cells[:-1]
        return cells
    if "\t" in raw:
        return [part.strip() for part in raw.split("\t")]
    return None


def _academic_year(value: str) -> str:
    token = value.strip()
    parts = token.split("-")
    if len(parts) == 2 and len(parts[0]) == 4 and len(parts[1]) == 4:
        start, end = int(parts[0]), int(parts[1])
        if end != start + 1:
            raise ValueError(f"academic year {token!r} is not consecutive")
        return f"{start}-{(end % 100):02d}"
    return token


def _term(value: str) -> str:
    key = " ".join(value.strip().lower().split())
    if key in _TERM_ALIASES:
        return _TERM_ALIASES[key]
    return value.strip()


def _cells_to_record(cells: Sequence[str], *, synthetic: bool) -> GradeRecord:
    if len(cells) != config.UDC_COLUMN_COUNT:
        raise ValueError(f"expected {config.UDC_COLUMN_COUNT} columns, got {len(cells)}")
    year, term, subject, course_no, title, instructor, gpa_s = cells[:7]
    dist_cells = cells[7:19]
    withdraws_s, enrollment_s, crn, credits_s = cells[19:]
    key = normalize_instructor_key(instructor)
    if not key:
        raise ValueError("instructor is blank after normalization")
    dist = {name: float(raw) for name, raw in zip(config.GRADE_KEYS, dist_cells, strict=True)}
    meta_source = config.SYNTHETIC_SOURCE if synthetic else config.UDC_SOURCE
    meta_confidence = "low" if synthetic else config.UDC_CONFIDENCE
    return GradeRecord.model_validate(
        {
            "academic_year": _academic_year(year),
            "term": _term(term),
            "subject": subject.strip().upper(),
            "course_no": course_no.strip(),
            "course_id": f"{subject.strip().upper()} {course_no.strip()}",
            "course_title": title.strip(),
            "instructor": key,
            "gpa": float(gpa_s),
            "dist": dist,
            "withdraws": int(float(withdraws_s)),
            "graded_enrollment": int(float(enrollment_s)),
            "crn": crn.strip(),
            "credits": float(credits_s),
            "meta": {
                "source": meta_source,
                "confidence": meta_confidence,
                "verified": None,
                "fetched_at": None,
            },
        }
    )


def parse_udc_text(
    text: str, *, filename: str, synthetic: bool, counts: Counts
) -> list[GradeRecord]:
    """Parse one UDC file. Malformed rows are skipped and counted; they are not silent."""
    records: list[GradeRecord] = []
    for number, raw_line in enumerate(text.splitlines(), start=1):
        counts.read += 1
        if _is_blank(raw_line) or _is_separator(raw_line):
            counts.skipped += 1
            counts.bump("blank_or_separator")
            continue
        cells = _split_row(raw_line)
        if cells is None:
            counts.skipped += 1
            counts.bump("malformed")
            counts.warned += 1
            print(f"{filename}:{number}: neither pipe- nor tab-delimited; skipped", file=sys.stderr)
            continue
        if _is_header(cells):
            counts.skipped += 1
            counts.bump("header")
            continue
        try:
            records.append(_cells_to_record(cells, synthetic=synthetic))
        except (TypeError, ValueError, ValidationError) as exc:
            counts.skipped += 1
            counts.bump("malformed")
            counts.warned += 1
            print(f"{filename}:{number}: {exc}; skipped", file=sys.stderr)
    return records


def _dedupe(records: Iterable[GradeRecord]) -> list[GradeRecord]:
    by_identity: dict[tuple[str, str, str, str, str], GradeRecord] = {}
    order: list[tuple[str, str, str, str, str]] = []
    for record in records:
        identity = record.identity
        existing = by_identity.get(identity)
        if existing is None:
            by_identity[identity] = record
            order.append(identity)
            continue
        if model_payload(existing) == model_payload(record):
            continue
        raise PipelineError(
            f"conflicting duplicate grade identity {identity!r}: "
            f"existing CRN {existing.crn} disagrees with incoming CRN {record.crn}"
        )
    return [by_identity[identity] for identity in order]


def sort_grade_records(records: Sequence[GradeRecord]) -> list[GradeRecord]:
    return sorted(
        records,
        key=lambda rec: (rec.course_id, rec.instructor, rec.academic_year, rec.term, rec.crn),
    )


def parse_udc_dir(input_dir: Path, *, synthetic: bool = False) -> tuple[list[GradeRecord], Counts]:
    counts = Counts()
    collected: list[GradeRecord] = []
    files = list_files(input_dir, (".txt",))
    counts.files = len(files)
    for path in files:
        text = path.read_text(encoding="utf-8")
        before_skip = counts.skipped
        before_read = counts.read
        parsed = parse_udc_text(text, filename=path.name, synthetic=synthetic, counts=counts)
        accepted = len(parsed)
        collected.extend(parsed)
        print(
            f"{path.name}: accepted={accepted} "
            f"skipped={counts.skipped - before_skip} lines={counts.read - before_read}"
        )
    unique = _dedupe(collected)
    counts.bump("duplicates_dropped", len(collected) - len(unique))
    ordered = sort_grade_records(unique)
    counts.written = len(ordered)
    return ordered, counts


def write_grade_records(path: Path, records: Sequence[GradeRecord]) -> None:
    dump_json(path, [model_payload(record) for record in records])


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Parse local UDC grade tables into grade_records.json"
    )
    parser.add_argument("--input-dir", type=Path, default=config.RAW_UDC_DIR)
    parser.add_argument(
        "--output", type=Path, default=config.DEFAULT_DATA_DIR / config.GRADE_RECORDS_FILE
    )
    parser.add_argument(
        "--synthetic",
        action="store_true",
        help="mark rows as synthetic_filler / low confidence",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        records, counts = parse_udc_dir(args.input_dir, synthetic=args.synthetic)
        write_grade_records(args.output, records)
    except PipelineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"wrote {args.output} ({counts.line()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
