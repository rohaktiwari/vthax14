"""Build ``rmp.json`` from human-pasted ``data/raw/rmp/*.txt`` files (PRD 8.3)."""

from __future__ import annotations

import argparse
import sys
from collections.abc import Sequence
from pathlib import Path

import config
from models import RmpEntry, Section, normalize_instructor_key
from scripts.common import Counts, PipelineError, dump_json, list_files, load_json, model_payload

_RECORD_SEPARATOR = "---"


def _parse_block(text: str, *, filename: str, synthetic: bool) -> RmpEntry:
    fields: dict[str, str] = {}
    comments: list[str] = []
    tags: list[str] = []
    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.lower().startswith("comment:"):
            comments.append(line.split(":", 1)[1].strip())
            continue
        if ":" not in line:
            raise PipelineError(f"{filename}: line {number}: expected 'field: value'")
        key, value = line.split(":", 1)
        key = key.strip().casefold()
        value = value.strip()
        if key in {"tag", "tags"}:
            parts = [part.strip() for part in value.replace("|", ";").split(";") if part.strip()]
            tags.extend(parts)
            continue
        if key in {"name", "full_name"}:
            fields["full_name"] = value
        else:
            fields[key] = value
    if "full_name" not in fields:
        raise PipelineError(f"{filename}: missing name/full_name")
    source = config.SYNTHETIC_SOURCE if synthetic else config.RMP_PASTE_SOURCE
    confidence = "low" if synthetic else config.RMP_PASTE_CONFIDENCE
    payload = {
        "full_name": fields["full_name"],
        "score": float(fields["score"]),
        "difficulty": float(fields["difficulty"]),
        "n_reviews": int(float(fields.get("n_reviews", "0"))),
        "would_take_again": (
            None if not fields.get("would_take_again") else float(fields["would_take_again"])
        ),
        "tags": tags,
        "comments": comments,
        "meta": {
            "source": source,
            "confidence": confidence,
            "verified": None,
            "fetched_at": None,
        },
    }
    return RmpEntry.model_validate(payload)


def parse_rmp_text(text: str, *, filename: str, synthetic: bool) -> list[RmpEntry]:
    chunks = [chunk.strip() for chunk in text.split(f"\n{_RECORD_SEPARATOR}\n")]
    if len(chunks) == 1:
        chunks = [chunk.strip() for chunk in text.split(f"\n{_RECORD_SEPARATOR}")]
    records = []
    for chunk in chunks:
        if not chunk or set(chunk) <= {"-", " ", "\n"}:
            continue
        records.append(_parse_block(chunk, filename=filename, synthetic=synthetic))
    return records


def merge_rmp(entries: Sequence[RmpEntry]) -> dict[str, RmpEntry]:
    merged: dict[str, RmpEntry] = {}
    for entry in entries:
        key = normalize_instructor_key(entry.full_name)
        if not key:
            raise PipelineError(f"cannot normalize instructor name {entry.full_name!r}")
        existing = merged.get(key)
        if existing is None:
            merged[key] = entry
            continue
        if model_payload(existing) == model_payload(entry):
            continue
        raise PipelineError(
            f"conflicting duplicate RMP key {key!r}: {existing.full_name!r} vs {entry.full_name!r}"
        )
    return dict(sorted(merged.items()))


def parse_rmp_dir(
    input_dir: Path, *, synthetic: bool = False
) -> tuple[dict[str, RmpEntry], Counts]:
    counts = Counts()
    files = list_files(input_dir, (".txt",))
    counts.files = len(files)
    collected: list[RmpEntry] = []
    for path in files:
        parsed = parse_rmp_text(
            path.read_text(encoding="utf-8"), filename=path.name, synthetic=synthetic
        )
        counts.read += len(parsed)
        collected.extend(parsed)
        print(f"{path.name}: accepted={len(parsed)}")
    merged = merge_rmp(collected)
    counts.written = len(merged)
    counts.bump("duplicates_dropped", len(collected) - len(merged))
    return merged, counts


def unmatched_section_instructors(rmp: dict[str, RmpEntry], sections_path: Path) -> list[str]:
    payload = load_json(sections_path)
    sections = [Section.model_validate(item) for item in payload]
    keys: list[str] = []
    seen: set[str] = set()
    for section in sections:
        for key in section.instructor_keys:
            if key not in rmp and key not in seen:
                seen.add(key)
                keys.append(key)
    return keys


def write_rmp(path: Path, entries: dict[str, RmpEntry]) -> None:
    dump_json(path, {key: model_payload(entry) for key, entry in entries.items()})


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build rmp.json from pasted RateMyProfessors text")
    parser.add_argument("--input-dir", type=Path, default=config.RAW_RMP_DIR)
    parser.add_argument("--output", type=Path, default=config.DEFAULT_DATA_DIR / config.RMP_FILE)
    parser.add_argument(
        "--sections",
        type=Path,
        default=config.DEFAULT_DATA_DIR / config.SECTIONS_FILE,
    )
    parser.add_argument("--synthetic", action="store_true")
    parser.add_argument(
        "--report-unmatched",
        action="store_true",
        help="print section instructor keys missing from the generated RMP map",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="replace existing output entirely (default already replaces generated keys)",
    )
    args = parser.parse_args(list(argv) if argv is not None else None)
    try:
        entries, counts = parse_rmp_dir(args.input_dir, synthetic=args.synthetic)
        if args.output.exists() and not args.force:
            existing = load_json(args.output)
            if isinstance(existing, dict):
                for key, raw in existing.items():
                    entry = RmpEntry.model_validate(raw)
                    if entry.meta.source == "manual_override" and key not in entries:
                        entries[key] = entry
                        counts.bump("preserved_manual")
                entries = dict(sorted(entries.items()))
        write_rmp(args.output, entries)
        if args.report_unmatched and args.sections.exists():
            missing = unmatched_section_instructors(entries, args.sections)
            print(f"unmatched section instructors: {len(missing)}")
            for key in missing:
                print(f"  {key}")
    except PipelineError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    print(f"wrote {args.output} ({counts.line()})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
