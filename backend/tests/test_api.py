"""API tests: health, catalog, stub and real analyze, commute, swap, stress, vibes, OpenAPI."""

from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

import config
from config import Settings
from data import DataValidationError
from main import create_app
from models import (
    AnalyzeResponse,
    BuildingsMatrixResponse,
    ConflictErrorDetail,
    CourseSearchResponse,
    DemoSchedulesResponse,
    HealthResponse,
    Section,
    StressResponse,
    SwapResponse,
    VibesResponse,
    WalkEntry,
)
from risk import analyze as analyze_schedule
from schedule import find_meeting_conflicts
from tests.conftest import (
    COMMUTE_TEST_SECTIONS,
    IMPOSSIBLE_CRN,
    TIGHT_CRN,
    Dataset,
    make_meeting,
    make_section,
)

EIGHT_ENDPOINTS = {
    ("get", "/api/courses/search"),
    ("get", "/api/buildings/matrix"),
    ("post", "/api/analyze"),
    ("post", "/api/swap"),
    ("post", "/api/stress"),
    ("get", "/api/professors/{surname}/vibes"),
    ("get", "/api/health"),
    ("get", "/api/demo/schedules"),
}


@pytest.fixture
def strict_client() -> Iterator[TestClient]:
    with TestClient(create_app(Settings())) as client:
        yield client


@pytest.fixture
def stub_client() -> Iterator[TestClient]:
    with TestClient(create_app(Settings(stub_analyze=True))) as client:
        yield client


@pytest.fixture
def commute_client(commute_dataset: Dataset) -> Iterator[TestClient]:
    """Stub-enabled app over the committed catalog plus tight/impossible/overlap sections."""
    with TestClient(create_app(commute_dataset.settings(stub_analyze=True))) as client:
        yield client


def _demo(client: TestClient) -> DemoSchedulesResponse:
    return DemoSchedulesResponse.model_validate(client.get("/api/demo/schedules").json())


def _first_crn_in(client: TestClient, course_id: str) -> str:
    """CRN of the lowest-numbered section of ``course_id`` from the loaded context."""
    return client.app.state.ctx.sections_by_course[course_id][0].crn


def test_all_eight_endpoints_return_declared_success_models(strict_client: TestClient) -> None:
    settings = strict_client.app.state.settings
    assert settings.stub_analyze is False
    assert settings.lenient is False
    demo = _demo(strict_client)
    surname = next(iter(strict_client.app.state.ctx.rmp))

    search = strict_client.get("/api/courses/search", params={"q": "cs", "limit": 20})
    matrix = strict_client.get("/api/buildings/matrix")
    analyzed = strict_client.post("/api/analyze", json={"crns": demo.easy.crns})
    swapped = strict_client.post("/api/swap", json=demo.swap_demo.model_dump())
    stressed = strict_client.post(
        "/api/stress", json={"crns": demo.easy.crns, "scenario": "miss_week", "week": 8}
    )
    vibes = strict_client.get(f"/api/professors/{surname}/vibes")
    health = strict_client.get("/api/health")
    schedules = strict_client.get("/api/demo/schedules")

    assert search.status_code == 200
    CourseSearchResponse.model_validate(search.json())
    assert matrix.status_code == 200
    BuildingsMatrixResponse.model_validate(matrix.json())
    assert analyzed.status_code == 200
    analysis = AnalyzeResponse.model_validate(analyzed.json())
    assert not any(note.startswith("STUB:") for note in analysis.meta.data_notes)
    assert swapped.status_code == 200
    SwapResponse.model_validate(swapped.json())
    assert stressed.status_code == 200
    StressResponse.model_validate(stressed.json())
    assert vibes.status_code == 200
    VibesResponse.model_validate(vibes.json())
    assert health.status_code == 200
    HealthResponse.model_validate(health.json())
    assert schedules.status_code == 200
    DemoSchedulesResponse.model_validate(schedules.json())


def test_stub_analyze_still_validates_as_analyze_response(stub_client: TestClient) -> None:
    assert stub_client.app.state.settings.stub_analyze is True
    crns = _demo(stub_client).easy.crns
    response = stub_client.post("/api/analyze", json={"crns": crns})
    assert response.status_code == 200
    body = AnalyzeResponse.model_validate(response.json())
    assert any(note.startswith("STUB:") for note in body.meta.data_notes)


def test_health_matches_loaded_context(strict_client: TestClient) -> None:
    response = strict_client.get("/api/health")
    assert response.status_code == 200
    health = HealthResponse.model_validate(response.json())

    ctx = strict_client.app.state.ctx
    assert health.status == "ok"
    assert health.term_id == ctx.term_id == config.DEFAULT_CATALOG_TERM_ID
    assert health.sections == ctx.stats.sections == len(ctx.sections)
    assert health.grade_records == ctx.stats.grade_records == len(ctx.grade_records)
    assert health.instructors == ctx.stats.instructors == len(ctx.instructor_keys)
    assert health.buildings == ctx.stats.buildings == len(ctx.buildings)
    assert health.walk_pairs == ctx.stats.walk_pairs == len(ctx.walk)
    assert health.synthetic_rows == ctx.stats.synthetic_rows
    assert health.warnings == ctx.stats.warnings == len(ctx.warnings)


def test_lenient_boot_reports_accumulated_warning_count(dataset: Dataset) -> None:
    sections = dataset.load("sections.json")
    sections[0]["term_id"] = "1999-fall"
    dataset.save("sections.json", sections)

    with (
        pytest.raises(DataValidationError),
        TestClient(create_app(dataset.settings())),
    ):
        pass

    with TestClient(create_app(dataset.settings(lenient=True))) as client:
        health = HealthResponse.model_validate(client.get("/api/health").json())
        ctx = client.app.state.ctx
        assert ctx.lenient is True
        assert health.sections == len(sections) - 1
        assert health.warnings == len(ctx.warnings)
        assert any("section excluded" in w for w in ctx.warnings)


def test_stub_analyze_has_final_shape_and_is_deterministic(stub_client: TestClient) -> None:
    demo = DemoSchedulesResponse.model_validate(stub_client.get("/api/demo/schedules").json())
    crns = demo.brutal.crns
    assert config.MIN_ANALYZE_CRNS <= len(crns) <= config.MAX_ANALYZE_CRNS

    first = stub_client.post("/api/analyze", json={"crns": crns})
    second = stub_client.post("/api/analyze", json={"crns": crns})
    assert first.status_code == 200, first.text
    assert first.json() == second.json()  # identical request -> identical response

    analysis = AnalyzeResponse.model_validate(first.json())
    assert [s.crn for s in analysis.sections] == crns  # request order
    assert [f.type for f in analysis.factors] == list(config.FACTOR_ORDER)
    for factor in analysis.factors:
        assert factor.max_severity == config.factor_max_severity(factor.type)
        assert 0 <= factor.severity <= factor.max_severity
        assert factor.severity == round(factor.severity, 1)
    assert analysis.risk_score == round(sum(f.severity for f in analysis.factors))
    assert config.RISK_SCORE_MIN <= analysis.risk_score <= config.RISK_SCORE_MAX
    assert analysis.meta.term_id == config.DEFAULT_CATALOG_TERM_ID
    assert analysis.meta.heuristic is True
    assert any("STUB" in note for note in analysis.meta.data_notes)
    for warning in analysis.commute_warnings:
        assert warning.verdict in {"tight", "impossible"}
        assert warning.source in {"google_routes", "manual_override", "default_fallback"}
    # Serialized JSON uses the contract alias "from", not the Python name "from_".
    if first.json()["commute_warnings"]:
        assert "from" in first.json()["commute_warnings"][0]

    easy = stub_client.post("/api/analyze", json={"crns": demo.easy.crns})
    assert easy.status_code == 200
    excluded = {e.crn for e in AnalyzeResponse.model_validate(easy.json()).expected_gpa.excluded}
    ctx = stub_client.app.state.ctx
    assert excluded == {
        c for c in demo.easy.crns if ctx.sections_by_crn[c].grade_mode == "pass_fail"
    }


def test_stub_analyze_rejects_unknown_crns_with_string_detail(stub_client: TestClient) -> None:
    known = next(iter(stub_client.app.state.ctx.sections_by_crn))
    response = stub_client.post("/api/analyze", json={"crns": [known, "00000"]})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)
    assert "00000" in response.json()["detail"]


def test_request_validation_errors_use_string_detail(stub_client: TestClient) -> None:
    too_few = stub_client.post("/api/analyze", json={"crns": ["90001"]})
    assert too_few.status_code == 422
    assert isinstance(too_few.json()["detail"], str)

    duplicates = stub_client.post("/api/analyze", json={"crns": ["90001", "90001"]})
    assert duplicates.status_code == 422
    assert "duplicate" in duplicates.json()["detail"].lower()


def test_analyze_without_stub_flag_runs_the_real_engine(strict_client: TestClient) -> None:
    crns = strict_client.get("/api/demo/schedules").json()["easy"]["crns"]
    response = strict_client.post("/api/analyze", json={"crns": crns})
    assert response.status_code == 200
    body = AnalyzeResponse.model_validate(response.json())
    assert not any(note.startswith("STUB:") for note in body.meta.data_notes)
    expected = analyze_schedule(
        [strict_client.app.state.ctx.sections_by_crn[c] for c in crns],
        strict_client.app.state.ctx,
    )
    assert response.json() == json.loads(expected.model_dump_json(by_alias=True))


# ---------------------------------------------------------------------------
# Block 3: schedule validation, commute warnings, swap
# ---------------------------------------------------------------------------


def test_analyze_overlap_returns_structured_422(commute_client: TestClient) -> None:
    math = _first_crn_in(commute_client, "MATH 2534")  # MWF 670-720 WHI
    response = commute_client.post("/api/analyze", json={"crns": [math, TIGHT_CRN]})
    assert response.status_code == 422
    detail = ConflictErrorDetail.model_validate(response.json()["detail"])
    assert detail.code == "meeting_overlap"
    assert detail.message == config.MEETING_OVERLAP_MESSAGE
    assert [(c.day, c.crns, c.start, c.end) for c in detail.conflicts] == [
        ("M", [math, TIGHT_CRN], "11:15", "12:00"),
        ("W", [math, TIGHT_CRN], "11:15", "12:00"),
        ("F", [math, TIGHT_CRN], "11:15", "12:00"),
    ]
    # Ordinary request-shape errors keep the established string detail.
    assert isinstance(
        commute_client.post("/api/analyze", json={"crns": [math]}).json()["detail"], str
    )


def test_overlap_requires_shared_day_time_and_dates(commute_client: TestClient) -> None:
    cs3114 = _first_crn_in(commute_client, "CS 3114")  # MWF 610-660
    math = _first_crn_in(commute_client, "MATH 2534")  # MWF 670-720: a gap, not an overlap
    assert commute_client.post("/api/analyze", json={"crns": [cs3114, math]}).status_code == 200

    def build(crn: str, days: list[str], start: int, end: int, **dates: str) -> Section:
        return Section.model_validate(
            make_section(crn, f"CS {crn}", [make_meeting(days, start, end, "MCB", **dates)])
        )

    base = build("1001", ["T"], 600, 660)
    assert find_meeting_conflicts([base, build("1002", ["T"], 660, 720)]) == []  # touching
    assert find_meeting_conflicts([base, build("1003", ["W"], 600, 660)]) == []  # other day
    later_dates = build("1004", ["T"], 600, 660, start_date="2026-12-10", end_date="2026-12-16")
    assert find_meeting_conflicts([base, later_dates]) == []  # disjoint date ranges
    conflicts = find_meeting_conflicts([base, build("1005", ["R", "T"], 630, 700)])
    assert [(c.day, c.crns, c.start, c.end) for c in conflicts] == [
        ("T", ["1001", "1005"], "10:30", "11:00")
    ]


def test_validation_errors_precede_analysis_when_stub_disabled(dataset: Dataset) -> None:
    sections = dataset.load("sections.json")
    sections.extend(COMMUTE_TEST_SECTIONS)
    dataset.save("sections.json", sections)
    with TestClient(create_app(dataset.settings())) as client:  # stub off
        math = _first_crn_in(client, "MATH 2534")
        overlap = client.post("/api/analyze", json={"crns": [math, TIGHT_CRN]})
        assert overlap.status_code == 422
        assert overlap.json()["detail"]["code"] == "meeting_overlap"
        unknown = client.post("/api/analyze", json={"crns": [math, "00000"]})
        assert unknown.status_code == 422
        valid = client.post("/api/analyze", json={"crns": [math, _first_crn_in(client, "CS 3114")]})
        assert valid.status_code == 200
        AnalyzeResponse.model_validate(valid.json())


def test_analyze_returns_real_commute_warnings(commute_client: TestClient) -> None:
    cs3114 = _first_crn_in(commute_client, "CS 3114")  # MWF 610-660 MCB

    tight = AnalyzeResponse.model_validate(
        commute_client.post("/api/analyze", json={"crns": [cs3114, TIGHT_CRN]}).json()
    )
    assert [(w.day, w.verdict) for w in tight.commute_warnings] == [
        ("M", "tight"),
        ("W", "tight"),
        ("F", "tight"),
    ]
    first = tight.commute_warnings[0]
    assert (first.from_.crn, first.from_.building, first.from_.ends) == (cs3114, "MCB", "11:00")
    assert (first.to.crn, first.to.building, first.to.starts) == (TIGHT_CRN, "WHI", "11:15")
    assert (first.walk_min, first.adjusted_walk_min, first.gap_min) == (18, 16, 15)
    assert first.source == "manual_override"
    commute = next(f for f in tight.factors if f.type == "commute")
    assert commute.severity == 3 * config.COMMUTE_TRANSITION_POINTS["tight"]
    assert tight.risk_score == round(sum(f.severity for f in tight.factors))

    impossible = AnalyzeResponse.model_validate(
        commute_client.post("/api/analyze", json={"crns": [cs3114, IMPOSSIBLE_CRN]}).json()
    )
    assert {w.verdict for w in impossible.commute_warnings} == {"impossible"}
    assert impossible.commute_warnings[0].gap_min == 5

    brutal = AnalyzeResponse.model_validate(
        commute_client.post("/api/analyze", json={"crns": _demo(commute_client).brutal.crns}).json()
    )
    assert brutal.commute_warnings
    assert {w.verdict for w in brutal.commute_warnings} <= {"tight", "impossible"}
    assert next(f for f in brutal.factors if f.type == "commute").severity > 0


def test_swap_matches_independent_analyze_and_delta(stub_client: TestClient) -> None:
    swap_demo = _demo(stub_client).swap_demo
    body = swap_demo.model_dump()
    response = stub_client.post("/api/swap", json=body)
    assert response.status_code == 200, response.text
    swap = SwapResponse.model_validate(response.json())

    before = stub_client.post("/api/analyze", json={"crns": swap_demo.current_crns}).json()
    after_crns = [
        swap_demo.add_crn if crn == swap_demo.drop_crn else crn for crn in swap_demo.current_crns
    ]
    after = stub_client.post("/api/analyze", json={"crns": after_crns}).json()
    assert response.json()["before"] == before
    assert response.json()["after"] == after
    assert [s.crn for s in swap.after.sections] == after_crns  # replaced at the same index
    assert swap.delta == swap.after.risk_score - swap.before.risk_score
    assert swap.summary.risk == f"{swap.before.risk_score} → {swap.after.risk_score}"
    before_ids = {(w.day, w.from_.crn, w.to.crn, w.verdict) for w in swap.before.commute_warnings}
    after_ids = {(w.day, w.from_.crn, w.to.crn, w.verdict) for w in swap.after.commute_warnings}
    assert swap.summary.resolved_warnings == len(before_ids - after_ids)
    assert swap.summary.new_warnings == len(after_ids - before_ids)
    assert response.json() == stub_client.post("/api/swap", json=body).json()


def test_real_engine_swap_matches_independent_analyze(strict_client: TestClient) -> None:
    swap_demo = _demo(strict_client).swap_demo
    body = swap_demo.model_dump()
    response = strict_client.post("/api/swap", json=body)
    assert response.status_code == 200, response.text
    swap = SwapResponse.model_validate(response.json())
    before = strict_client.post("/api/analyze", json={"crns": swap_demo.current_crns}).json()
    after_crns = [
        swap_demo.add_crn if crn == swap_demo.drop_crn else crn for crn in swap_demo.current_crns
    ]
    after = strict_client.post("/api/analyze", json={"crns": after_crns}).json()
    assert response.json()["before"] == before
    assert response.json()["after"] == after
    assert swap.delta == swap.after.risk_score - swap.before.risk_score
    assert not any(n.startswith("STUB:") for n in swap.before.meta.data_notes)


def test_swap_counts_resolved_and_new_warnings(commute_client: TestClient) -> None:
    cs3114 = _first_crn_in(commute_client, "CS 3114")
    engl = _first_crn_in(commute_client, "ENGL 1106")  # async, no commute

    resolved = SwapResponse.model_validate(
        commute_client.post(
            "/api/swap",
            json={"current_crns": [cs3114, TIGHT_CRN], "drop_crn": TIGHT_CRN, "add_crn": engl},
        ).json()
    )
    assert len(resolved.before.commute_warnings) == 3
    assert resolved.after.commute_warnings == []
    assert (resolved.summary.resolved_warnings, resolved.summary.new_warnings) == (3, 0)
    assert resolved.delta == resolved.after.risk_score - resolved.before.risk_score

    introduced = SwapResponse.model_validate(
        commute_client.post(
            "/api/swap",
            json={"current_crns": [cs3114, engl], "drop_crn": engl, "add_crn": IMPOSSIBLE_CRN},
        ).json()
    )
    assert (introduced.summary.resolved_warnings, introduced.summary.new_warnings) == (0, 3)
    assert {w.verdict for w in introduced.after.commute_warnings} == {"impossible"}


def test_swap_invalid_operations_return_400_even_without_stub(strict_client: TestClient) -> None:
    demo = _demo(strict_client).swap_demo
    current = demo.current_crns
    cases = {
        "drop not selected": {
            "current_crns": current,
            "drop_crn": "00000",
            "add_crn": demo.add_crn,
        },
        "add unknown": {"current_crns": current, "drop_crn": demo.drop_crn, "add_crn": "00000"},
        "add equals drop": {
            "current_crns": current,
            "drop_crn": demo.drop_crn,
            "add_crn": demo.drop_crn,
        },
        "add already selected": {
            "current_crns": current,
            "drop_crn": demo.drop_crn,
            "add_crn": next(c for c in current if c != demo.drop_crn),
        },
    }
    for name, body in cases.items():
        response = strict_client.post("/api/swap", json=body)
        assert response.status_code == 400, (name, response.text)
        assert isinstance(response.json()["detail"], str)

    # Request-shape problems keep the established 422 string detail.
    too_few = strict_client.post(
        "/api/swap",
        json={"current_crns": [current[0]], "drop_crn": current[0], "add_crn": demo.add_crn},
    )
    assert too_few.status_code == 422 and isinstance(too_few.json()["detail"], str)

    # A valid swap without the stub flag runs the real engine.
    valid = strict_client.post("/api/swap", json=demo.model_dump())
    assert valid.status_code == 200
    SwapResponse.model_validate(valid.json())


def test_swap_rejects_conflicting_result_with_structured_422(commute_client: TestClient) -> None:
    cs3114 = _first_crn_in(commute_client, "CS 3114")
    math = _first_crn_in(commute_client, "MATH 2534")  # MWF 670-720 WHI, overlaps TIGHT_CRN
    response = commute_client.post(
        "/api/swap", json={"current_crns": [cs3114, math], "drop_crn": cs3114, "add_crn": TIGHT_CRN}
    )
    assert response.status_code == 422
    detail = ConflictErrorDetail.model_validate(response.json()["detail"])
    assert detail.code == "meeting_overlap"
    assert [(c.day, c.crns) for c in detail.conflicts] == [
        ("M", [TIGHT_CRN, math]),
        ("W", [TIGHT_CRN, math]),
        ("F", [TIGHT_CRN, math]),
    ]

    # An invalid *current* schedule fails analyze validation first (422 as well).
    current_conflict = commute_client.post(
        "/api/swap", json={"current_crns": [math, TIGHT_CRN], "drop_crn": math, "add_crn": cs3114}
    )
    assert current_conflict.status_code == 422
    assert current_conflict.json()["detail"]["code"] == "meeting_overlap"


def test_demo_schedules_come_from_fixtures_and_reference_known_crns(
    strict_client: TestClient,
) -> None:
    response = strict_client.get("/api/demo/schedules")
    assert response.status_code == 200
    demo = DemoSchedulesResponse.model_validate(response.json())
    ctx = strict_client.app.state.ctx
    referenced = [
        *demo.easy.crns,
        *demo.brutal.crns,
        *demo.swap_demo.current_crns,
        demo.swap_demo.drop_crn,
        demo.swap_demo.add_crn,
    ]
    assert referenced and all(crn in ctx.sections_by_crn for crn in referenced)
    # Body is exactly the typed object loaded at startup — not assembled in the route.
    assert demo.model_dump() == ctx.demo_schedules.model_dump()
    on_disk = DemoSchedulesResponse.model_validate(
        {
            "easy": json.loads(
                (config.DEFAULT_FIXTURES_DIR / config.DEMO_EASY_FILE).read_text("utf-8")
            ),
            "brutal": json.loads(
                (config.DEFAULT_FIXTURES_DIR / config.DEMO_BRUTAL_FILE).read_text("utf-8")
            ),
            "swap_demo": json.loads(
                (config.DEFAULT_FIXTURES_DIR / config.DEMO_SWAP_FILE).read_text("utf-8")
            ),
        }
    )
    assert demo.model_dump() == on_disk.model_dump()


def test_search_groups_sorts_filters_and_limits(strict_client: TestClient) -> None:
    ctx = strict_client.app.state.ctx
    empty = strict_client.get("/api/courses/search", params={"limit": 100})
    assert empty.status_code == 200
    all_courses = CourseSearchResponse.model_validate(empty.json())
    ids = [c.course_id for c in all_courses.courses]
    assert ids == sorted(ctx.sections_by_course)
    for group in all_courses.courses:
        expected = ctx.sections_by_course[group.course_id]
        assert [s.crn for s in group.sections] == [s.crn for s in expected]
        assert group.title == expected[0].title
        assert group.credits == expected[0].credits

    limited = CourseSearchResponse.model_validate(
        strict_client.get("/api/courses/search", params={"limit": 2}).json()
    )
    assert [c.course_id for c in limited.courses] == ids[:2]

    cs = CourseSearchResponse.model_validate(
        strict_client.get("/api/courses/search", params={"subject": "cs"}).json()
    )
    assert cs.courses and all(c.course_id.startswith("CS ") for c in cs.courses)
    assert [c.course_id for c in cs.courses] == sorted(c.course_id for c in cs.courses)

    none = CourseSearchResponse.model_validate(
        strict_client.get("/api/courses/search", params={"q": "no-such-course-zzzz"}).json()
    )
    assert none.courses == []

    # course_id substring, case-insensitive
    by_id = CourseSearchResponse.model_validate(
        strict_client.get("/api/courses/search", params={"q": "cs 3114"}).json()
    )
    assert [c.course_id for c in by_id.courses] == ["CS 3114"]

    # title substring
    sample = next(iter(ctx.sections_by_course.values()))[0]
    token = sample.title.split()[0]
    by_title = CourseSearchResponse.model_validate(
        strict_client.get("/api/courses/search", params={"q": token}).json()
    )
    assert any(c.course_id == sample.course_id for c in by_title.courses)

    # instructor name substring; matching course still returns every section
    named = next(s for s in ctx.sections if s.instructor_names)
    instructor_token = named.instructor_names[0].split()[-1]
    by_instructor = CourseSearchResponse.model_validate(
        strict_client.get("/api/courses/search", params={"q": instructor_token}).json()
    )
    hit = next(c for c in by_instructor.courses if c.course_id == named.course_id)
    assert [s.crn for s in hit.sections] == [s.crn for s in ctx.sections_by_course[named.course_id]]

    # subject + q together; blank q is treated as omitted
    combined = CourseSearchResponse.model_validate(
        strict_client.get("/api/courses/search", params={"q": "  ", "subject": "MATH"}).json()
    )
    assert [c.course_id for c in combined.courses] == [
        cid for cid in ids if cid.startswith("MATH ")
    ]

    identical = strict_client.get("/api/courses/search", params={"q": "data", "limit": 5})
    assert (
        identical.json()
        == strict_client.get("/api/courses/search", params={"q": "data", "limit": 5}).json()
    )


def test_search_rejects_out_of_range_limit(strict_client: TestClient) -> None:
    too_small = strict_client.get("/api/courses/search", params={"limit": 0})
    too_large = strict_client.get("/api/courses/search", params={"limit": 101})
    assert too_small.status_code == 422
    assert too_large.status_code == 422
    assert isinstance(too_small.json()["detail"], str)


def test_matrix_minutes_and_include_meta(strict_client: TestClient) -> None:
    ctx = strict_client.app.state.ctx
    minutes = strict_client.get("/api/buildings/matrix")
    assert minutes.status_code == 200
    body = BuildingsMatrixResponse.model_validate(minutes.json())
    assert list(body.buildings) == sorted(ctx.buildings)
    assert set(body.buildings) == set(ctx.buildings)
    assert list(body.walk) == sorted(ctx.walk)
    assert set(body.walk) == set(ctx.walk)
    for key, value in body.walk.items():
        assert value == ctx.walk[key].minutes
        assert isinstance(minutes.json()["walk"][key], int)

    meta = strict_client.get("/api/buildings/matrix", params={"include_meta": True})
    assert meta.status_code == 200
    meta_body = BuildingsMatrixResponse.model_validate(meta.json())
    assert list(meta_body.walk) == sorted(ctx.walk)
    for key, value in meta_body.walk.items():
        assert isinstance(value, WalkEntry)
        assert value == ctx.walk[key]
    raw_walk = meta.json()["walk"]
    sample_key = next(iter(raw_walk))
    assert set(raw_walk[sample_key]) == {"minutes", "meters", "source", "fetched_at"}

    # Default (omitted include_meta) equals explicit false; no synthesized pairs.
    assert (
        minutes.json()
        == strict_client.get("/api/buildings/matrix", params={"include_meta": False}).json()
    )
    assert len(body.walk) == ctx.stats.walk_pairs


def test_lenient_missing_demo_crn_is_warning_and_still_served(dataset: Dataset) -> None:
    easy = dataset.load_fixture("schedule_easy.json")
    easy["crns"].append("00000")
    dataset.save_fixture("schedule_easy.json", easy)

    with TestClient(create_app(dataset.settings(lenient=True))) as client:
        health = HealthResponse.model_validate(client.get("/api/health").json())
        demo = DemoSchedulesResponse.model_validate(client.get("/api/demo/schedules").json())
        ctx = client.app.state.ctx
        assert "00000" in demo.easy.crns
        assert any("crn=00000" in w and "fixture kept as committed" in w for w in ctx.warnings)
        assert health.warnings == len(ctx.warnings)
        assert health.warnings >= 1


def test_openapi_documents_all_eight_endpoints_with_typed_responses(
    strict_client: TestClient,
) -> None:
    spec = strict_client.get("/openapi.json").json()
    documented = {
        (method, path)
        for path, methods in spec["paths"].items()
        for method in methods
        if path.startswith("/api/")
    }
    assert documented == EIGHT_ENDPOINTS
    search_params = {
        p["name"]
        for p in spec["paths"]["/api/courses/search"]["get"]["parameters"]
        if p.get("in") == "query"
    }
    assert search_params == {"q", "subject", "limit"}
    matrix_params = {
        p["name"]
        for p in spec["paths"]["/api/buildings/matrix"]["get"]["parameters"]
        if p.get("in") == "query"
    }
    assert matrix_params == {"include_meta"}
    for path in ("/api/courses/search", "/api/buildings/matrix", "/api/demo/schedules"):
        schema = spec["paths"][path]["get"]["responses"]["200"]["content"]["application/json"][
            "schema"
        ]
        assert "$ref" in schema
    for path, methods in spec["paths"].items():
        for operation in methods.values():
            success = operation["responses"]["200"]
            assert "$ref" in success["content"]["application/json"]["schema"], path

    def _ref(method: str, path: str) -> str:
        return spec["paths"][path][method]["responses"]["200"]["content"]["application/json"][
            "schema"
        ]["$ref"]

    assert _ref("get", "/api/courses/search").endswith("/CourseSearchResponse")
    assert _ref("get", "/api/buildings/matrix").endswith("/BuildingsMatrixResponse")
    assert _ref("post", "/api/analyze").endswith("/AnalyzeResponse")
    assert _ref("post", "/api/swap").endswith("/SwapResponse")
    assert _ref("post", "/api/stress").endswith("/StressResponse")
    assert _ref("get", "/api/professors/{surname}/vibes").endswith("/VibesResponse")
    assert _ref("get", "/api/health").endswith("/HealthResponse")
    assert _ref("get", "/api/demo/schedules").endswith("/DemoSchedulesResponse")
    assert "404" in spec["paths"]["/api/professors/{surname}/vibes"]["get"]["responses"]
    assert "422" in spec["paths"]["/api/stress"]["post"]["responses"]
    assert "501" not in spec["paths"]["/api/stress"]["post"]["responses"]
    assert "501" not in spec["paths"]["/api/professors/{surname}/vibes"]["get"]["responses"]


# ---------------------------------------------------------------------------
# Block 5: stress and vibes
# ---------------------------------------------------------------------------


def test_stress_matches_independent_analyze_and_is_deterministic(strict_client: TestClient) -> None:
    demo = _demo(strict_client)
    body = {"crns": demo.easy.crns, "scenario": "miss_week", "week": 8}
    first = strict_client.post("/api/stress", json=body)
    second = strict_client.post("/api/stress", json=body)
    assert first.status_code == 200
    assert first.json() == second.json()
    stressed = StressResponse.model_validate(first.json())
    analyzed = strict_client.post("/api/analyze", json={"crns": demo.easy.crns}).json()
    assert first.json()["analysis"] == analyzed
    assert stressed.original_risk == stressed.analysis.risk_score
    assert stressed.delta == stressed.stressed_risk - stressed.original_risk
    assert stressed.stressed_risk == min(100, stressed.original_risk + stressed.delta)
    assert stressed.scenario.type == "miss_week" and stressed.scenario.week == 8
    assert stressed.meta.heuristic is True
    assert stressed.meta.note == config.STRESS_HEURISTIC_NOTE
    lo, hi = config.EASY_FIXTURE_RISK_BAND
    assert lo <= stressed.original_risk <= hi
    assert stressed.original_risk == config.EASY_FIXTURE_EXPECTED_SCORE
    assert stressed.stressed_risk == config.EASY_STRESS_STRESSED_SCORE
    assert stressed.delta == config.EASY_STRESS_DELTA


def test_stress_brutal_hits_the_100_point_clamp(strict_client: TestClient) -> None:
    crns = _demo(strict_client).brutal.crns
    stressed = StressResponse.model_validate(
        strict_client.post(
            "/api/stress", json={"crns": crns, "scenario": "miss_week", "week": 16}
        ).json()
    )
    lo, hi = config.BRUTAL_FIXTURE_RISK_BAND
    assert lo <= stressed.original_risk <= hi
    raw = min(config.STRESS_MAX_UPLIFT, sum(p.points for p in stressed.penalties))
    assert stressed.stressed_risk == min(100, stressed.original_risk + raw)
    assert all(1 <= p.points <= config.STRESS_SECTION_POINTS_CAP for p in stressed.penalties)
    assert [p.crn for p in stressed.penalties] == [
        crn for crn in crns if crn in {p.crn for p in stressed.penalties}
    ]


def test_stress_week_bounds_and_invalid_requests(strict_client: TestClient) -> None:
    crns = _demo(strict_client).easy.crns
    for week in (config.STRESS_WEEK_MIN, config.STRESS_WEEK_MAX):
        response = strict_client.post(
            "/api/stress", json={"crns": crns, "scenario": "miss_week", "week": week}
        )
        assert response.status_code == 200
        assert StressResponse.model_validate(response.json()).scenario.week == week
    for week in (0, 17):
        bad = strict_client.post(
            "/api/stress", json={"crns": crns, "scenario": "miss_week", "week": week}
        )
        assert bad.status_code == 422
        assert isinstance(bad.json()["detail"], str)
    unknown_scenario = strict_client.post(
        "/api/stress", json={"crns": crns, "scenario": "exam_week", "week": 8}
    )
    assert unknown_scenario.status_code == 422
    unknown_crn = strict_client.post(
        "/api/stress", json={"crns": [crns[0], "00000"], "scenario": "miss_week", "week": 8}
    )
    assert unknown_crn.status_code == 422
    assert "Unknown CRNs" in unknown_crn.json()["detail"]


def test_stress_overlap_uses_shared_structured_422(commute_client: TestClient) -> None:
    math = _first_crn_in(commute_client, "MATH 2534")
    response = commute_client.post(
        "/api/stress",
        json={"crns": [math, TIGHT_CRN], "scenario": "miss_week", "week": 8},
    )
    assert response.status_code == 422
    detail = ConflictErrorDetail.model_validate(response.json()["detail"])
    assert detail.code == "meeting_overlap"


def test_vibes_known_instructor_normalization_and_determinism(strict_client: TestClient) -> None:
    first = strict_client.get("/api/professors/lovelace/vibes")
    second = strict_client.get("/api/professors/Ada Lovelace/vibes")
    third = strict_client.get("/api/professors/LOVELACE/vibes")
    assert first.status_code == second.status_code == third.status_code == 200
    assert first.json() == second.json() == third.json()
    body = VibesResponse.model_validate(first.json())
    assert body.instructor == "lovelace"
    assert body.rmp is not None
    assert body.grade_stats.n_sections > 0
    assert body.confidence == "low"
    ctx = strict_client.app.state.ctx
    assert body.rmp.difficulty == ctx.rmp["lovelace"].difficulty


def test_vibes_unknown_instructor_is_404(strict_client: TestClient) -> None:
    response = strict_client.get("/api/professors/nobody/vibes")
    assert response.status_code == 404
    assert isinstance(response.json()["detail"], str)
    assert "nobody" in response.json()["detail"]
    curie = strict_client.get("/api/professors/curie/vibes")
    assert curie.status_code == 404  # teaches a section, but no RMP and no grades


def test_vibes_merged_key_collision_is_identical(dataset: Dataset) -> None:
    sections = dataset.load("sections.json")
    same_course = [s for s in sections if s["course_id"] == "CS 3114"]
    same_course[0]["instructor_names"] = ["Ada Lovelace"]
    same_course[1]["instructor_names"] = ["Linda Lovelace"]
    dataset.save("sections.json", sections)
    with TestClient(create_app(dataset.settings())) as client:
        ada = client.get("/api/professors/Ada Lovelace/vibes")
        linda = client.get("/api/professors/Linda Lovelace/vibes")
        key = client.get("/api/professors/lovelace/vibes")
        assert ada.status_code == linda.status_code == key.status_code == 200
        assert ada.json() == linda.json() == key.json()
        VibesResponse.model_validate(ada.json())


def test_vibes_partial_rmp_only_and_grades_only(dataset: Dataset) -> None:
    rmp = dataset.load("rmp.json")
    rmp["nightingale"] = {
        "full_name": "Florence Nightingale",
        "score": 4.1,
        "difficulty": 2.2,
        "n_reviews": 12,
        "would_take_again": 90.0,
        "tags": ["Caring"],
        "comments": ["curves generously"],
        "meta": {
            "source": "synthetic_filler",
            "confidence": "low",
            "verified": False,
            "fetched_at": None,
        },
    }
    dataset.save("rmp.json", rmp)
    grades = dataset.load("grade_records.json")
    template = json.loads(json.dumps(grades[0]))
    template["instructor"] = "curie"
    template["course_id"] = "HNFE 1004"
    template["subject"] = "HNFE"
    template["course_no"] = "1004"
    template["course_title"] = "Foods, Nutrition and Exercise"
    template["crn"] = "89000"
    dataset.save("grade_records.json", grades + [template])

    with TestClient(create_app(dataset.settings())) as client:
        rmp_only = VibesResponse.model_validate(
            client.get("/api/professors/nightingale/vibes").json()
        )
        assert rmp_only.rmp is not None and rmp_only.rmp.n_reviews == 12
        assert rmp_only.grade_stats.n_sections == 0
        assert rmp_only.grade_stats.avg_gpa is None
        assert any("No grade records" in n for n in rmp_only.data_notes)
        assert "caring" in rmp_only.tags and "curves" in rmp_only.tags

        grades_only = VibesResponse.model_validate(client.get("/api/professors/curie/vibes").json())
        assert grades_only.rmp is None
        assert grades_only.tags == []
        assert grades_only.grade_stats.n_sections == 1
        assert any("No RateMyProfessors" in n for n in grades_only.data_notes)

    real_source = dataset.load("rmp.json")
    real_source["hopper"]["meta"]["source"] = "rmp"
    dataset.save("rmp.json", real_source)
    with TestClient(create_app(dataset.settings())) as hop_client:
        hop = VibesResponse.model_validate(hop_client.get("/api/professors/hopper/vibes").json())
        assert hop.confidence in {"medium", "high"}
        assert hop.rmp is not None
        if hop.rmp.n_reviews >= config.VIBES_HIGH_MIN_REVIEWS and hop.grade_stats.n_sections >= 3:
            assert hop.confidence == "high"
