"""Data loading, validation, and indexing (PRD 5.6, amended).

Everything is loaded exactly once at startup into an immutable :class:`DataContext`.
Validation runs in the PRD order. Failure classes:

* **Always fatal** (both modes): file parse/schema errors, duplicate section CRNs,
  unknown building codes in meetings or walk keys.
* **Fatal in strict mode, warning in lenient mode** (``HOKIELENS_LENIENT=1``):
  wrong ``term_id``, modality/meeting rules, course-level metadata inconsistency,
  duplicate grade-record identity, demo fixtures referencing unknown CRNs. In
  lenient mode the offending record is excluded (or, for demo fixtures, kept as
  committed) and boot continues.
* **Never fatal**: instructor-key collisions (warning + merged key + section
  data note), missing grade history, missing/unused RMP entries.

A hard failure raises :class:`DataValidationError` naming the file, the record
identity, and the violated rule.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from types import MappingProxyType
from typing import Any, TypeVar

from pydantic import TypeAdapter, ValidationError

import config
from config import Settings
from models import (
    BootStats,
    Building,
    BuildingsMatrixResponse,
    CourseGroup,
    CourseSearchResponse,
    DemoSchedule,
    DemoSchedulesResponse,
    DemoSwap,
    GradeRecord,
    RmpEntry,
    Section,
    WalkEntry,
    WalkSource,
    instructor_key_or_none,
    normalize_full_name,
)

logger = logging.getLogger("hokielens.data")

T = TypeVar("T")

_SECTIONS_ADAPTER = TypeAdapter(list[Section])
_GRADES_ADAPTER = TypeAdapter(list[GradeRecord])
_RMP_ADAPTER = TypeAdapter(dict[str, RmpEntry])
_BUILDINGS_ADAPTER = TypeAdapter(dict[str, Building])
_WALK_ADAPTER = TypeAdapter(dict[str, WalkEntry])
_DEMO_SCHEDULE_ADAPTER = TypeAdapter(DemoSchedule)
_DEMO_SWAP_ADAPTER = TypeAdapter(DemoSwap)

_COURSE_LEVEL_FIELDS = ("subject", "course_no", "title", "credits")


class DataValidationError(Exception):
    """A hard validation failure that must prevent startup."""

    def __init__(self, file: str, identity: str, rule: str) -> None:
        self.file = file
        self.identity = identity
        self.rule = rule
        super().__init__(f"{file}: {identity}: {rule}")


@dataclass(frozen=True)
class DataContext:
    """Immutable, fully indexed snapshot of every committed data file.

    Request handlers treat this object as read-only (PRD 9.9).
    """

    term_id: str
    lenient: bool
    sections: tuple[Section, ...]  # retained sections in file order
    sections_by_crn: Mapping[str, Section]
    sections_by_course: Mapping[str, tuple[Section, ...]]  # course_id -> sections by CRN
    grade_records: tuple[GradeRecord, ...]
    grades_by_course_instructor: Mapping[tuple[str, str], tuple[GradeRecord, ...]]
    grades_by_course: Mapping[str, tuple[GradeRecord, ...]]
    grades_by_instructor: Mapping[str, tuple[GradeRecord, ...]]
    rmp: Mapping[str, RmpEntry]
    buildings: Mapping[str, Building]
    walk: Mapping[str, WalkEntry]
    demo_schedules: DemoSchedulesResponse
    section_notes: Mapping[str, tuple[str, ...]]  # crn -> loader data notes
    instructor_keys: frozenset[str]  # unique non-TBA keys across all section instructors
    warnings: tuple[str, ...]
    stats: BootStats


# ---------------------------------------------------------------------------
# File parsing (PRD 5.6 step 1; always fatal)
# ---------------------------------------------------------------------------


def _display_path(path: Path) -> str:
    try:
        return path.resolve().relative_to(config.REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError(f"duplicate object key {key!r}")
        result[key] = value
    return result


def _read_json(path: Path) -> Any:
    shown = _display_path(path)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise DataValidationError(shown, "-", "file not found") from None
    except OSError as exc:
        raise DataValidationError(shown, "-", f"cannot read file: {exc}") from exc
    try:
        return json.loads(text, object_pairs_hook=_reject_duplicate_keys)
    except ValueError as exc:  # JSONDecodeError is a ValueError subclass
        raise DataValidationError(shown, "-", f"invalid JSON: {exc}") from exc


def _schema_error(
    path: Path, raw: Any, exc: ValidationError, id_field: str | None
) -> DataValidationError:
    errors = exc.errors()
    identity = "-"
    if errors and errors[0]["loc"]:
        head = errors[0]["loc"][0]
        if isinstance(raw, list) and isinstance(head, int):
            identity = f"index {head}"
            item = raw[head] if 0 <= head < len(raw) else None
            if id_field and isinstance(item, dict) and id_field in item:
                identity += f" ({id_field}={item[id_field]!r})"
        elif isinstance(raw, dict):
            identity = f"key {head!r}"
    shown_errors = [
        f"{'.'.join(str(part) for part in err['loc']) or '<root>'}: {err['msg']}"
        for err in errors[:5]
    ]
    rule = "schema violation: " + "; ".join(shown_errors)
    if len(errors) > 5:
        rule += f" (+{len(errors) - 5} more)"
    return DataValidationError(_display_path(path), identity, rule)


def _parse_file(path: Path, adapter: TypeAdapter[T], id_field: str | None = None) -> T:
    raw = _read_json(path)
    try:
        return adapter.validate_python(raw)
    except ValidationError as exc:
        raise _schema_error(path, raw, exc, id_field) from None


# ---------------------------------------------------------------------------
# Loader
# ---------------------------------------------------------------------------


def _modality_violation(section: Section) -> str | None:
    """Return the violated meeting/modality rule (PRD 5.1), or ``None``."""
    physical = [m for m in section.meetings if m.is_physical]
    online = [m for m in section.meetings if not m.is_physical]
    modality = section.modality
    if modality == "online_async":
        if physical:
            return "modality online_async requires building=null for every meeting"
        return None
    if not section.meetings:
        return f"modality {modality} requires at least one meeting"
    if modality == "f2f" and online:
        return "modality f2f requires every meeting to have a building"
    if modality == "online_sync" and physical:
        return "modality online_sync requires building=null for every meeting"
    if modality == "hybrid" and not physical:
        return "modality hybrid requires at least one physical meeting"
    return None


def load_data_context(settings: Settings) -> DataContext:
    """Load, validate, and index all data files. Raises :class:`DataValidationError`
    on any hard failure; never raises for warnings."""
    warnings: list[str] = []

    def warn(message: str) -> None:
        logger.warning(message)
        warnings.append(message)

    def violation(file: str, identity: str, rule: str, lenient_action: str) -> None:
        """Fatal in strict mode; a warning describing the fallback in lenient mode."""
        if settings.lenient:
            warn(f"{file}: {identity}: {rule}; {lenient_action}")
            return
        raise DataValidationError(file, identity, rule)

    data_dir = settings.data_dir
    fixtures_dir = settings.fixtures_dir
    sections_path = data_dir / config.SECTIONS_FILE
    grades_path = data_dir / config.GRADE_RECORDS_FILE
    rmp_path = data_dir / config.RMP_FILE
    buildings_path = data_dir / config.BUILDINGS_FILE
    walk_path = data_dir / config.WALK_MATRIX_FILE
    easy_path = fixtures_dir / config.DEMO_EASY_FILE
    brutal_path = fixtures_dir / config.DEMO_BRUTAL_FILE
    swap_path = fixtures_dir / config.DEMO_SWAP_FILE

    sections_file = _display_path(sections_path)
    grades_file = _display_path(grades_path)
    buildings_file = _display_path(buildings_path)
    walk_file = _display_path(walk_path)

    # 1. Parse every file against its schema (fatal in both modes).
    all_sections = _parse_file(sections_path, _SECTIONS_ADAPTER, id_field="crn")
    all_grades = _parse_file(grades_path, _GRADES_ADAPTER, id_field="crn")
    rmp = _parse_file(rmp_path, _RMP_ADAPTER)
    buildings = _parse_file(buildings_path, _BUILDINGS_ADAPTER)
    walk = _parse_file(walk_path, _WALK_ADAPTER)
    easy = _parse_file(easy_path, _DEMO_SCHEDULE_ADAPTER)
    brutal = _parse_file(brutal_path, _DEMO_SCHEDULE_ADAPTER)
    swap_demo = _parse_file(swap_path, _DEMO_SWAP_ADAPTER)

    for code in buildings:
        if not code.strip() or code != code.strip() or code != code.upper():
            raise DataValidationError(
                buildings_file, f"key {code!r}", "building keys must be nonblank uppercase codes"
            )
    for key in walk:
        parts = key.split(config.WALK_KEY_SEPARATOR)
        if len(parts) != 2 or not all(parts) or parts[0] >= parts[1]:
            raise DataValidationError(
                walk_file,
                f"key {key!r}",
                "walk keys must use the form CODE_A|CODE_B with CODE_A < CODE_B",
            )

    # 2. Duplicate section CRNs (fatal in both modes).
    seen_crns: set[str] = set()
    for section in all_sections:
        if section.crn in seen_crns:
            raise DataValidationError(sections_file, f"crn={section.crn}", "duplicate CRN")
        seen_crns.add(section.crn)

    # 3. Catalog term identity.
    retained: list[Section] = []
    for section in all_sections:
        if section.term_id != settings.catalog_term_id:
            violation(
                sections_file,
                f"crn={section.crn}",
                f"term_id {section.term_id!r} does not match CATALOG_TERM_ID "
                f"{settings.catalog_term_id!r}",
                "section excluded",
            )
            continue
        retained.append(section)

    # 4. Meeting/modality/building rules (per meeting, not per section modality).
    rule_ok: list[Section] = []
    for section in retained:
        rule = _modality_violation(section)
        if rule is not None:
            violation(sections_file, f"crn={section.crn}", rule, "section excluded")
            continue
        rule_ok.append(section)
    retained = rule_ok

    # 5. Unknown building codes in meetings and walk keys (fatal in both modes).
    for section in retained:
        for index, meeting in enumerate(section.meetings):
            if meeting.building is not None and meeting.building not in buildings:
                raise DataValidationError(
                    sections_file,
                    f"crn={section.crn} meeting[{index}]",
                    f"unknown building code {meeting.building!r}",
                )
    for key in walk:
        for code in key.split(config.WALK_KEY_SEPARATOR):
            if code not in buildings:
                raise DataValidationError(
                    walk_file, f"key {key!r}", f"unknown building code {code!r}"
                )

    # 6. Course-level metadata consistency (first section in file order is canonical).
    canonical: dict[str, Section] = {}
    consistent: list[Section] = []
    for section in retained:
        reference = canonical.get(section.course_id)
        if reference is None:
            canonical[section.course_id] = section
            consistent.append(section)
            continue
        differing = [
            field
            for field in _COURSE_LEVEL_FIELDS
            if getattr(section, field) != getattr(reference, field)
        ]
        if differing:
            violation(
                sections_file,
                f"crn={section.crn}",
                f"course {section.course_id} metadata differs from crn={reference.crn} "
                f"in: {', '.join(differing)}",
                "section excluded",
            )
            continue
        consistent.append(section)
    retained = consistent

    # 7. Instructor-key collisions: never fatal (amendment 2). Warn, keep the merged
    #    key, and attach a data note to every affected section.
    names_by_key: dict[str, dict[str, str]] = {}  # key -> {normalized full name: display}
    for section in retained:
        for name in section.instructor_names:
            key = instructor_key_or_none(name)
            if key is None:
                continue
            names_by_key.setdefault(key, {}).setdefault(normalize_full_name(name), name.strip())
    section_notes: dict[str, list[str]] = {}
    for key in sorted(names_by_key):
        names = names_by_key[key]
        if len(names) < 2:
            continue
        display_names = sorted(names.values())
        warn(
            f"{sections_file}: instructor key {key!r}: distinct instructor names share one "
            f"join key ({', '.join(display_names)}); merged under {key!r}"
        )
        note = (
            f"Instructor key '{key}' merges distinct instructor names "
            f"({', '.join(display_names)}); grade and RMP joins use the merged key."
        )
        for section in retained:
            if key in section.instructor_keys:
                section_notes.setdefault(section.crn, []).append(note)

    # 8. Duplicate grade-record identities (first occurrence wins in lenient mode).
    seen_identities: set[tuple[str, str, str, str, str]] = set()
    grades: list[GradeRecord] = []
    for index, record in enumerate(all_grades):
        if record.identity in seen_identities:
            violation(
                grades_file,
                f"index {index} identity={record.identity!r}",
                "duplicate grade-record identity",
                "duplicate record dropped",
            )
            continue
        seen_identities.add(record.identity)
        grades.append(record)

    # 9. Section courses without any grade record (warning).
    courses_with_grades = {record.course_id for record in grades}
    for course_id in sorted({section.course_id for section in retained}):
        if course_id not in courses_with_grades:
            warn(f"no grade records for section course {course_id}")

    # 10. RMP coverage (warnings).
    instructor_keys = frozenset(key for section in retained for key in section.instructor_keys)
    for key in sorted(instructor_keys):
        if key not in rmp:
            warn(f"no RMP entry for section instructor key {key!r}")
    for key in sorted(rmp):
        if key not in instructor_keys:
            warn(f"RMP key {key!r} is not used by any section")

    # 11. Demo fixtures must reference known CRNs (PRD 6.8; strict fatal, lenient warning).
    sections_by_crn = {section.crn: section for section in retained}

    def check_demo_crns(path: Path, crns: list[str]) -> None:
        for crn in crns:
            if crn not in sections_by_crn:
                violation(
                    _display_path(path),
                    f"crn={crn}",
                    "demo fixture references an unknown CRN",
                    "fixture kept as committed",
                )

    check_demo_crns(easy_path, easy.crns)
    check_demo_crns(brutal_path, brutal.crns)
    check_demo_crns(swap_path, [*swap_demo.current_crns, swap_demo.drop_crn, swap_demo.add_crn])

    # Indexes.
    course_groups: dict[str, list[Section]] = {}
    for section in retained:
        course_groups.setdefault(section.course_id, []).append(section)
    sections_by_course = {
        course_id: tuple(sorted(group, key=lambda s: s.crn))
        for course_id, group in sorted(course_groups.items())
    }
    by_course_instructor: dict[tuple[str, str], list[GradeRecord]] = {}
    by_course: dict[str, list[GradeRecord]] = {}
    by_instructor: dict[str, list[GradeRecord]] = {}
    for record in grades:
        by_course_instructor.setdefault((record.course_id, record.instructor), []).append(record)
        by_course.setdefault(record.course_id, []).append(record)
        by_instructor.setdefault(record.instructor, []).append(record)

    # 12. Deterministic boot stats.
    stats = BootStats(
        sections=len(retained),
        grade_records=len(grades),
        instructors=len(instructor_keys),
        buildings=len(buildings),
        walk_pairs=len(walk),
        synthetic_rows=sum(1 for record in grades if record.synthetic),
        warnings=len(warnings),
    )
    logger.info(
        "boot stats: term_id=%s lenient=%s sections=%d grade_records=%d instructors=%d "
        "buildings=%d walk_pairs=%d synthetic_rows=%d warnings=%d",
        settings.catalog_term_id,
        settings.lenient,
        stats.sections,
        stats.grade_records,
        stats.instructors,
        stats.buildings,
        stats.walk_pairs,
        stats.synthetic_rows,
        stats.warnings,
    )

    return DataContext(
        term_id=settings.catalog_term_id,
        lenient=settings.lenient,
        sections=tuple(retained),
        sections_by_crn=MappingProxyType(sections_by_crn),
        sections_by_course=MappingProxyType(sections_by_course),
        grade_records=tuple(grades),
        grades_by_course_instructor=MappingProxyType(
            {key: tuple(value) for key, value in by_course_instructor.items()}
        ),
        grades_by_course=MappingProxyType({key: tuple(value) for key, value in by_course.items()}),
        grades_by_instructor=MappingProxyType(
            {key: tuple(value) for key, value in by_instructor.items()}
        ),
        rmp=MappingProxyType(dict(rmp)),
        buildings=MappingProxyType(dict(buildings)),
        walk=MappingProxyType(dict(walk)),
        demo_schedules=DemoSchedulesResponse(brutal=brutal, easy=easy, swap_demo=swap_demo),
        section_notes=MappingProxyType({crn: tuple(notes) for crn, notes in section_notes.items()}),
        instructor_keys=instructor_keys,
        warnings=tuple(warnings),
        stats=stats,
    )


# ---------------------------------------------------------------------------
# Walk lookup (PRD 5.5) — pure function over DataContext
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class WalkLookup:
    """Resolved walking time between two building codes."""

    minutes: int
    source: WalkSource
    same_building: bool


def walk_key(code_a: str, code_b: str) -> str:
    """Canonical ``CODE_A|CODE_B`` key with ``CODE_A < CODE_B``; symmetric in its inputs."""
    first, second = sorted((code_a, code_b))
    return f"{first}{config.WALK_KEY_SEPARATOR}{second}"


def walk_between(ctx: DataContext, code_a: str, code_b: str) -> WalkLookup:
    """PRD 5.5 lookup rules.

    * Same building: zero minutes without requiring a matrix entry. The PRD defines
      no dedicated provenance for this case, so ``source`` is ``default_fallback``
      and ``same_building`` is ``True`` so callers can say "same building".
    * Committed pair (either direction): the matrix minutes and its source.
    * Missing pair: ``DEFAULT_WALK_MIN`` with source ``default_fallback``.
    """
    if code_a == code_b:
        return WalkLookup(minutes=0, source="default_fallback", same_building=True)
    entry = ctx.walk.get(walk_key(code_a, code_b))
    if entry is None:
        return WalkLookup(
            minutes=config.DEFAULT_WALK_MIN, source="default_fallback", same_building=False
        )
    return WalkLookup(minutes=entry.minutes, source=entry.source, same_building=False)


# ---------------------------------------------------------------------------
# Catalog queries (PRD 6.1, 6.2) — pure functions over DataContext
# ---------------------------------------------------------------------------


def _blank_to_none(value: str | None) -> str | None:
    """Strip surrounding whitespace; treat empty as omitted (PRD is silent on blanks)."""
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


def _course_matches_query(sections: tuple[Section, ...], needle: str) -> bool:
    """True when ``needle`` is a case-insensitive substring of course_id, title,
    or any instructor name."""
    folded = needle.casefold()
    first = sections[0]
    if folded in first.course_id.casefold() or folded in first.title.casefold():
        return True
    return any(
        folded in name.casefold() for section in sections for name in section.instructor_names
    )


def search_courses(
    ctx: DataContext,
    q: str | None,
    subject: str | None,
    limit: int,
) -> CourseSearchResponse:
    """Group matching sections into courses sorted by ``course_id`` (PRD 6.1).

    ``limit`` caps the number of course groups after sorting. A course is included
    when it passes the optional subject filter and, if ``q`` is present, when
    ``course_id``, ``title``, or any instructor name of any of its sections contains
    the query as a case-insensitive substring. All sections of a matching course
    are returned, sorted by CRN — not only the sections whose instructor matched.
    """
    needle = _blank_to_none(q)
    subject_filter = _blank_to_none(subject)
    subject_folded = None if subject_filter is None else subject_filter.casefold()

    courses: list[CourseGroup] = []
    # sections_by_course is already keyed in course_id order with sections by CRN.
    for sections in ctx.sections_by_course.values():
        first = sections[0]
        if subject_folded is not None and first.subject.casefold() != subject_folded:
            continue
        if needle is not None and not _course_matches_query(sections, needle):
            continue
        courses.append(
            CourseGroup(
                course_id=first.course_id,
                title=first.title,
                credits=first.credits,
                sections=list(sections),
            )
        )
        if len(courses) >= limit:
            break
    return CourseSearchResponse(courses=courses)


def buildings_matrix(ctx: DataContext, include_meta: bool) -> BuildingsMatrixResponse:
    """Committed buildings and walk pairs only; no synthesized fallback pairs (PRD 6.2).

    Keys are emitted in lexicographic order. Without metadata, ``walk`` maps each
    pair to minutes; with metadata it maps to the full ``WalkEntry`` objects.
    """
    buildings = {code: ctx.buildings[code] for code in sorted(ctx.buildings)}
    if include_meta:
        walk: dict[str, int | WalkEntry] = {key: ctx.walk[key] for key in sorted(ctx.walk)}
    else:
        walk = {key: ctx.walk[key].minutes for key in sorted(ctx.walk)}
    return BuildingsMatrixResponse(buildings=buildings, walk=walk)
