"""Loader tests: strict/lenient startup and the amended fatal/warning split."""

from __future__ import annotations

import json

import pytest

import config
from config import Settings
from data import DataValidationError, load_data_context
from tests.conftest import Dataset


def test_strict_happy_path_counts_match_committed_files() -> None:
    ctx = load_data_context(Settings())

    sections = json.loads((config.DEFAULT_DATA_DIR / "sections.json").read_text("utf-8"))
    grades = json.loads((config.DEFAULT_DATA_DIR / "grade_records.json").read_text("utf-8"))
    buildings = json.loads((config.DEFAULT_DATA_DIR / "buildings.json").read_text("utf-8"))
    walk = json.loads((config.DEFAULT_DATA_DIR / "walk_matrix.json").read_text("utf-8"))

    assert ctx.term_id == config.DEFAULT_CATALOG_TERM_ID
    assert ctx.stats.sections == len(sections) == len(ctx.sections_by_crn)
    assert ctx.stats.grade_records == len(grades)
    assert ctx.stats.buildings == len(buildings)
    assert ctx.stats.walk_pairs == len(walk)
    assert ctx.stats.synthetic_rows == sum(
        1 for g in grades if g["meta"]["source"] == config.SYNTHETIC_SOURCE
    )
    assert ctx.stats.warnings == len(ctx.warnings)
    # Sections group by course and sort by CRN.
    for course_id, group in ctx.sections_by_course.items():
        assert all(s.course_id == course_id for s in group)
        assert [s.crn for s in group] == sorted(s.crn for s in group)


def test_wrong_term_is_fatal_in_strict_and_a_warning_in_lenient(dataset: Dataset) -> None:
    sections = dataset.load("sections.json")
    victim = sections[0]["crn"]
    sections[0]["term_id"] = "2027-spring"
    dataset.save("sections.json", sections)

    with pytest.raises(DataValidationError) as excinfo:
        load_data_context(dataset.settings())
    assert f"crn={victim}" in str(excinfo.value)
    assert "term_id" in str(excinfo.value)

    ctx = load_data_context(dataset.settings(lenient=True))
    assert victim not in ctx.sections_by_crn
    assert ctx.stats.sections == len(sections) - 1
    assert any(f"crn={victim}" in w and "section excluded" in w for w in ctx.warnings)
    assert ctx.stats.warnings == len(ctx.warnings)


def test_modality_rule_is_fatal_in_strict_and_excludes_in_lenient(dataset: Dataset) -> None:
    sections = dataset.load("sections.json")
    f2f = next(s for s in sections if s["modality"] == "f2f")
    f2f["meetings"][0]["building"] = None  # f2f meetings must have a building
    dataset.save("sections.json", sections)

    with pytest.raises(DataValidationError, match="modality f2f"):
        load_data_context(dataset.settings())

    ctx = load_data_context(dataset.settings(lenient=True))
    assert f2f["crn"] not in ctx.sections_by_crn


@pytest.mark.parametrize("lenient", [False, True])
def test_duplicate_crn_is_fatal_in_both_modes(dataset: Dataset, lenient: bool) -> None:
    sections = dataset.load("sections.json")
    sections.append(json.loads(json.dumps(sections[0])))
    dataset.save("sections.json", sections)

    with pytest.raises(DataValidationError, match="duplicate CRN"):
        load_data_context(dataset.settings(lenient=lenient))


@pytest.mark.parametrize("lenient", [False, True])
def test_unknown_building_is_fatal_in_both_modes(dataset: Dataset, lenient: bool) -> None:
    sections = dataset.load("sections.json")
    f2f = next(s for s in sections if s["modality"] == "f2f")
    f2f["meetings"][0]["building"] = "ZZZ"
    dataset.save("sections.json", sections)
    with pytest.raises(DataValidationError, match="unknown building code 'ZZZ'"):
        load_data_context(dataset.settings(lenient=lenient))

    # Restore sections; break a walk key instead.
    dataset.save(
        "sections.json",
        json.loads((config.DEFAULT_DATA_DIR / "sections.json").read_text("utf-8")),
    )
    walk = dataset.load("walk_matrix.json")
    walk["MCB|ZZZ"] = {"minutes": 1, "meters": 10, "source": "manual_override", "fetched_at": None}
    dataset.save("walk_matrix.json", walk)
    with pytest.raises(DataValidationError, match="unknown building code 'ZZZ'"):
        load_data_context(dataset.settings(lenient=lenient))


@pytest.mark.parametrize("lenient", [False, True])
def test_schema_error_is_fatal_in_both_modes(dataset: Dataset, lenient: bool) -> None:
    grades = dataset.load("grade_records.json")
    grades[0]["dist"]["A"] += 25  # distribution no longer sums to 100 +/- 1
    dataset.save("grade_records.json", grades)

    with pytest.raises(DataValidationError, match="schema violation"):
        load_data_context(dataset.settings(lenient=lenient))


def test_instructor_key_collision_is_never_fatal_and_annotates_sections(dataset: Dataset) -> None:
    sections = dataset.load("sections.json")
    same_course = [s for s in sections if s["course_id"] == "CS 3114"]
    assert len(same_course) >= 2
    same_course[0]["instructor_names"] = ["Ada Lovelace"]
    same_course[1]["instructor_names"] = ["Linda Lovelace"]  # same join key "lovelace"
    dataset.save("sections.json", sections)

    ctx = load_data_context(dataset.settings())  # strict mode must still boot
    assert any("instructor key 'lovelace'" in w for w in ctx.warnings)
    for section in same_course:
        notes = ctx.section_notes[section["crn"]]
        assert any("merges distinct instructor names" in note for note in notes)
    assert "lovelace" in ctx.instructor_keys


@pytest.mark.parametrize("lenient", [False, True])
@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("days", ["M", "X"]),  # unknown weekday token
        ("days", ["M", "M"]),  # repeated weekday
        ("days", []),  # no weekdays
        ("start_min", 660),  # start_min == end_min (610-660 section)
        ("end_min", 1441),  # past midnight
        ("start_date", "2026-12-31"),  # start_date after end_date
        ("start_date", "08/24/2026"),  # not ISO
    ],
)
def test_malformed_meeting_data_is_schema_fatal_in_both_modes(
    dataset: Dataset, lenient: bool, field: str, value: object
) -> None:
    sections = dataset.load("sections.json")
    f2f = next(s for s in sections if s["crn"] == "90001")
    f2f["meetings"][0][field] = value
    dataset.save("sections.json", sections)

    with pytest.raises(DataValidationError, match="schema violation") as excinfo:
        load_data_context(dataset.settings(lenient=lenient))
    assert "crn='90001'" in str(excinfo.value)


@pytest.mark.parametrize(
    ("modality", "buildings", "rule"),
    [
        ("f2f", [None], "modality f2f requires every meeting"),
        ("f2f", [], "modality f2f requires at least one meeting"),
        ("online_sync", ["MCB"], "modality online_sync requires building=null"),
        ("online_sync", [], "modality online_sync requires at least one meeting"),
        ("online_async", ["MCB"], "modality online_async requires building=null"),
        ("hybrid", [None, None], "modality hybrid requires at least one physical"),
        ("hybrid", [], "modality hybrid requires at least one meeting"),
    ],
)
def test_modality_building_rules_strict_fatal_lenient_excluded(
    dataset: Dataset, modality: str, buildings: list[str | None], rule: str
) -> None:
    sections = dataset.load("sections.json")
    victim = next(s for s in sections if s["crn"] == "90001")
    template = victim["meetings"][0]
    victim["modality"] = modality
    victim["meetings"] = [
        {
            **template,
            "building": building,
            "room": None,
            "start_min": 600 + 100 * i,
            "end_min": 650 + 100 * i,
        }
        for i, building in enumerate(buildings)
    ]
    dataset.save("sections.json", sections)

    with pytest.raises(DataValidationError, match=rule):
        load_data_context(dataset.settings())
    ctx = load_data_context(dataset.settings(lenient=True))
    assert "90001" not in ctx.sections_by_crn
    assert any("crn=90001" in w and "section excluded" in w for w in ctx.warnings)


def test_valid_hybrid_and_online_sections_load(dataset: Dataset) -> None:
    ctx = load_data_context(dataset.settings())
    hybrid = next(s for s in ctx.sections if s.modality == "hybrid")
    assert {m.is_physical for m in hybrid.meetings} == {True, False}
    online_async = next(s for s in ctx.sections if s.modality == "online_async")
    assert online_async.meetings == []
    online_sync = next(s for s in ctx.sections if s.modality == "online_sync")
    assert online_sync.meetings and all(not m.is_physical for m in online_sync.meetings)


def test_demo_fixture_unknown_crn_strict_fatal_lenient_kept(dataset: Dataset) -> None:
    easy = dataset.load_fixture("schedule_easy.json")
    easy["crns"].append("00000")
    dataset.save_fixture("schedule_easy.json", easy)

    with pytest.raises(DataValidationError, match="crn=00000"):
        load_data_context(dataset.settings())

    ctx = load_data_context(dataset.settings(lenient=True))
    assert "00000" in ctx.demo_schedules.easy.crns  # kept as committed
    assert any("crn=00000" in w and "fixture kept as committed" in w for w in ctx.warnings)


def test_settings_from_env_default_to_strict_real_engine() -> None:
    settings = Settings.from_env({})
    assert settings.lenient is False
    assert settings.stub_analyze is False
    assert Settings().lenient is False
    assert Settings().stub_analyze is False


def test_demo_fixture_crns_exist_in_strict_catalog() -> None:
    ctx = load_data_context(Settings())
    demo = ctx.demo_schedules
    referenced = [
        *demo.easy.crns,
        *demo.brutal.crns,
        *demo.swap_demo.current_crns,
        demo.swap_demo.drop_crn,
        demo.swap_demo.add_crn,
    ]
    missing = [crn for crn in referenced if crn not in ctx.sections_by_crn]
    assert missing == []


def test_course_level_metadata_inconsistency_strict_fatal_lenient_excluded(
    dataset: Dataset,
) -> None:
    sections = dataset.load("sections.json")
    group = [s for s in sections if s["course_id"] == "CS 3114"]
    assert len(group) >= 2
    canonical_crn = group[0]["crn"]
    victim = group[1]
    victim["title"] = "A different title"
    dataset.save("sections.json", sections)

    with pytest.raises(DataValidationError, match="metadata differs") as excinfo:
        load_data_context(dataset.settings())
    assert f"crn={victim['crn']}" in str(excinfo.value)
    assert f"crn={canonical_crn}" in str(excinfo.value)
    assert "title" in str(excinfo.value)

    ctx = load_data_context(dataset.settings(lenient=True))
    assert victim["crn"] not in ctx.sections_by_crn
    assert canonical_crn in ctx.sections_by_crn
    assert any(f"crn={victim['crn']}" in w and "section excluded" in w for w in ctx.warnings)


def test_duplicate_grade_identity_strict_fatal_lenient_dropped(dataset: Dataset) -> None:
    grades = dataset.load("grade_records.json")
    duplicate = json.loads(json.dumps(grades[0]))
    grades.append(duplicate)
    dataset.save("grade_records.json", grades)
    identity = (
        duplicate["course_id"],
        duplicate["instructor"],
        duplicate["academic_year"],
        duplicate["term"],
        duplicate["crn"],
    )

    with pytest.raises(DataValidationError, match="duplicate grade-record identity"):
        load_data_context(dataset.settings())

    ctx = load_data_context(dataset.settings(lenient=True))
    assert ctx.stats.grade_records == len(grades) - 1
    matching = [
        r
        for r in ctx.grade_records
        if (
            r.course_id,
            r.instructor,
            r.academic_year,
            r.term,
            r.crn,
        )
        == identity
    ]
    assert len(matching) == 1
    assert any("duplicate record dropped" in w for w in ctx.warnings)
