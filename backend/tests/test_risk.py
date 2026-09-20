"""Risk-engine tests: commute, calibrated fixtures, swap, stress, and vibes."""

from __future__ import annotations

import dataclasses
import json
from types import MappingProxyType

import pytest

import config
from config import Settings
from data import DataContext, load_data_context, walk_between
from models import GradeRecord, Section
from risk import (
    NoteCollector,
    SectionDifficulty,
    analyze,
    apply_stress_delta,
    back_to_back_density,
    classify_commute,
    commute_factor,
    commute_transitions,
    commute_warnings,
    day_density,
    difficulty_load,
    displayed_severity,
    expected_gpa,
    extract_vibe_tags,
    grade_volatility,
    miss_week_stress,
    professor_vibes,
    risk_score_from_factors,
    section_stress_points,
    weighted_mean_sigma,
    workload_collision,
)
from tests.conftest import make_meeting, make_section


@pytest.fixture(scope="module")
def ctx() -> DataContext:
    return load_data_context(Settings())


def section(crn: str, building: str | None, days: list[str], start: int, end: int, **kw) -> Section:
    modality = kw.pop("modality", "f2f" if building else "online_sync")
    course_id = kw.pop("course_id", f"CS {crn[-4:]}")
    meeting_kw = {key: kw.pop(key) for key in ("room", "start_date", "end_date") if key in kw}
    return Section.model_validate(
        make_section(
            crn,
            course_id,
            [make_meeting(days, start, end, building, **meeting_kw)],
            modality=modality,
            **kw,
        )
    )


@pytest.mark.parametrize(
    ("gap", "raw", "verdict", "adjusted", "slack"),
    [
        (15, 18, "tight", 16, -1),  # PRD 10.2: raw 18, gap 15 -> tight after adjustment
        (25, 18, "comfortable", 16, 9),  # PRD 10.2: raw 18, gap 25 -> comfortable
        (18, 18, "comfortable", 16, 2),  # slack == WALK_COMFORT_SLACK_MIN -> comfortable
        (17, 18, "tight", 16, 1),  # slack just below the comfort threshold -> tight
        (11, 18, "tight", 16, -5),  # slack == -WALK_TIGHT_DEFICIT_MAX -> still tight
        (10, 18, "impossible", 16, -6),  # slack just below the tight floor -> impossible
        (0, 0, "tight", 0, 0),  # same building, back-to-back
        (2, 0, "comfortable", 0, 2),  # same building, two-minute room change
        (0, 1, "tight", 0, 0),  # adjustment floors at zero, never negative
        (10, 12, "tight", 10, 0),  # DEFAULT_WALK_MIN with a 10-minute gap -> slack 0
        (12, 12, "comfortable", 10, 2),  # DEFAULT_WALK_MIN with a 12-minute gap -> slack 2
    ],
)
def test_classify_commute_boundaries(
    gap: int, raw: int, verdict: str, adjusted: int, slack: int
) -> None:
    result = classify_commute(gap, raw)
    assert result.verdict == verdict
    assert result.adjusted_walk_min == adjusted == max(0, raw - config.WALK_OPTIMISM_MIN)
    assert result.slack_min == slack == gap - adjusted
    assert result.raw_walk_min == raw and result.gap_min == gap


def test_thresholds_come_from_config() -> None:
    boundary_gap = config.WALK_COMFORT_SLACK_MIN + (18 - config.WALK_OPTIMISM_MIN)
    assert classify_commute(boundary_gap, 18).verdict == "comfortable"
    assert classify_commute(boundary_gap - 1, 18).verdict == "tight"
    floor_gap = (18 - config.WALK_OPTIMISM_MIN) - config.WALK_TIGHT_DEFICIT_MAX
    assert classify_commute(floor_gap, 18).verdict == "tight"
    assert classify_commute(floor_gap - 1, 18).verdict == "impossible"


def test_walk_lookup_rules(ctx: DataContext) -> None:
    assert walk_between(ctx, "MCB", "WHI").minutes == 18
    assert walk_between(ctx, "WHI", "MCB") == walk_between(ctx, "MCB", "WHI")  # symmetric
    assert walk_between(ctx, "MCB", "WHI").source == "manual_override"
    same = walk_between(ctx, "MCB", "MCB")
    assert (same.minutes, same.same_building) == (0, True)

    trimmed = dataclasses.replace(
        ctx, walk=MappingProxyType({k: v for k, v in ctx.walk.items() if k != "GBJ|WHI"})
    )
    missing = walk_between(trimmed, "WHI", "GBJ")
    assert missing.minutes == config.DEFAULT_WALK_MIN
    assert missing.source == "default_fallback"
    assert missing.same_building is False


def test_transition_applies_optimism_adjustment_exactly_once(ctx: DataContext) -> None:
    first = section("90001", "MCB", ["M"], 610, 660)
    second = section("90012", "WHI", ["M"], 675, 725)
    transitions = commute_transitions([first, second], ctx)
    assert len(transitions) == 1
    warning = commute_warnings(transitions)[0]
    assert warning.walk_min == 18
    assert warning.adjusted_walk_min == 18 - config.WALK_OPTIMISM_MIN == 16
    assert warning.gap_min == 15
    assert warning.verdict == "tight"
    assert warning.source == "manual_override"
    assert (warning.from_.crn, warning.from_.building, warning.from_.ends) == (
        "90001",
        "MCB",
        "11:00",
    )
    assert (warning.to.crn, warning.to.building, warning.to.starts) == ("90012", "WHI", "11:15")
    assert "manual override" in warning.detail and "Google" not in warning.detail
    assert f"{config.WALK_OPTIMISM_MIN}-minute optimism adjustment" in warning.detail
    assert "16 minutes" in warning.detail and "15 minutes" in warning.detail


def test_online_meetings_are_not_endpoints_and_break_adjacency(ctx: DataContext) -> None:
    physical_a = section("90001", "MCB", ["M"], 600, 650)
    online = section("90008", None, ["M"], 660, 700)  # online_sync, building=null
    physical_c = section("90012", "WHI", ["M"], 710, 760)
    asynchronous = Section.model_validate(
        make_section("90004", "ENGL 1106", [], modality="online_async")
    )

    assert commute_transitions([physical_a, online, physical_c, asynchronous], ctx) == []
    direct = commute_transitions([physical_a, physical_c], ctx)
    assert [(t.from_section.crn, t.to_section.crn) for t in direct] == [("90001", "90012")]
    assert direct[0].classification.gap_min == 60
    assert direct[0].classification.verdict == "comfortable"
    assert commute_warnings(direct) == []  # comfortable transitions are omitted
    # A hybrid section's online meeting is likewise never an endpoint.
    hybrid = Section.model_validate(
        make_section(
            "90005",
            "PHYS 2305",
            [make_meeting(["M"], 660, 700, None), make_meeting(["T"], 840, 915, "WHI")],
            modality="hybrid",
        )
    )
    assert commute_transitions([physical_a, hybrid, physical_c], ctx) == []


def test_transitions_require_overlapping_date_ranges(ctx: DataContext) -> None:
    first_half = section("90001", "MCB", ["M"], 600, 650, end_date="2026-10-09")
    second_half = section("90012", "WHI", ["M"], 655, 705, start_date="2026-10-10")
    assert commute_transitions([first_half, second_half], ctx) == []
    touching = section("90012", "WHI", ["M"], 655, 705, start_date="2026-10-09")  # inclusive
    assert len(commute_transitions([first_half, touching], ctx)) == 1


def test_warnings_sort_by_weekday_start_then_crn_and_are_deterministic(ctx: DataContext) -> None:
    trimmed = dataclasses.replace(
        ctx, walk=MappingProxyType({k: v for k, v in ctx.walk.items() if k != "GBJ|WHI"})
    )
    sections = [
        section("90020", "WHI", ["W"], 700, 750),  # W: GBJ -> WHI missing pair (12 default)
        section("90021", "GBJ", ["W"], 640, 690),  # gap 10, adjusted 10 -> slack 0 -> tight
        section("90022", "MCB", ["M", "F"], 600, 650),
        section("90023", "WHI", ["M", "F"], 655, 705),  # gap 5, adjusted 16 -> impossible
        section(
            "90024", "TORG", ["M"], 706, 756
        ),  # WHI -> TORG 15: gap 1 -> slack -12 -> impossible
    ]
    warnings = commute_warnings(commute_transitions(sections, trimmed))
    assert [(w.day, w.from_.crn, w.to.crn, w.verdict) for w in warnings] == [
        ("M", "90022", "90023", "impossible"),
        ("M", "90023", "90024", "impossible"),
        ("W", "90021", "90020", "tight"),
        ("F", "90022", "90023", "impossible"),
    ]
    fallback = warnings[2]
    assert (fallback.walk_min, fallback.adjusted_walk_min, fallback.source) == (
        config.DEFAULT_WALK_MIN,
        config.DEFAULT_WALK_MIN - config.WALK_OPTIMISM_MIN,
        "default_fallback",
    )
    assert "default fallback" in fallback.detail and "Google" not in fallback.detail
    repeated = commute_warnings(commute_transitions(list(reversed(sections)), trimmed))
    assert [w.model_dump(by_alias=True) for w in repeated] == [
        w.model_dump(by_alias=True) for w in warnings
    ]


def test_commute_factor_points_and_cap(ctx: DataContext) -> None:
    tight_pair = [
        section("90001", "MCB", ["M"], 610, 660),
        section("90012", "WHI", ["M"], 675, 725),
    ]
    tight = commute_factor(commute_transitions(tight_pair, ctx))
    assert tight.type == "commute"
    assert tight.max_severity == config.factor_max_severity("commute")
    assert tight.severity == config.COMMUTE_TRANSITION_POINTS["tight"]
    assert tight.affected_crns == ["90001", "90012"]

    chain = [
        section("90030", "MCB", ["M", "T", "W"], 600, 650),
        section("90031", "WHI", ["M", "T", "W"], 655, 705),  # impossible on three days: 21 points
    ]
    capped = commute_factor(commute_transitions(chain, ctx))
    assert capped.severity == config.factor_max_severity("commute") == 20.0
    assert "impossible" in capped.detail

    calm = commute_factor(commute_transitions([section("90001", "MCB", ["M"], 610, 660)], ctx))
    assert (calm.severity, calm.affected_crns) == (0.0, [])


def _fixture_sections(ctx: DataContext, filename: str) -> list[Section]:
    payload = json.loads((config.DEFAULT_FIXTURES_DIR / filename).read_text(encoding="utf-8"))
    crns = payload["crns"] if "crns" in payload else payload["current_crns"]
    return [ctx.sections_by_crn[crn] for crn in crns]


def _assert_factor_invariants(analysis) -> None:
    assert [f.type for f in analysis.factors] == list(config.FACTOR_ORDER)
    for factor in analysis.factors:
        assert factor.max_severity == config.factor_max_severity(factor.type)
        assert 0 <= factor.severity <= factor.max_severity
        assert factor.severity == round(factor.severity, 1)
    assert analysis.risk_score == risk_score_from_factors(analysis.factors)
    assert config.RISK_SCORE_MIN <= analysis.risk_score <= config.RISK_SCORE_MAX


def test_easy_and_brutal_fixture_bands(ctx: DataContext) -> None:
    easy = analyze(_fixture_sections(ctx, config.DEMO_EASY_FILE), ctx)
    brutal = analyze(_fixture_sections(ctx, config.DEMO_BRUTAL_FILE), ctx)
    lo, hi = config.EASY_FIXTURE_RISK_BAND
    assert lo <= easy.risk_score <= hi, easy.risk_score
    lo, hi = config.BRUTAL_FIXTURE_RISK_BAND
    assert lo <= brutal.risk_score <= hi, brutal.risk_score
    assert easy.risk_score == config.EASY_FIXTURE_EXPECTED_SCORE
    assert brutal.risk_score == config.BRUTAL_FIXTURE_EXPECTED_SCORE
    assert brutal.risk_score > easy.risk_score
    _assert_factor_invariants(easy)
    _assert_factor_invariants(brutal)
    assert sum(1 for f in brutal.factors if f.severity > 0) >= 3


def test_displayed_severities_reproduce_score_and_maxima_come_from_w(ctx: DataContext) -> None:
    for filename in (config.DEMO_EASY_FILE, config.DEMO_BRUTAL_FILE, config.DEMO_SWAP_FILE):
        analysis = analyze(_fixture_sections(ctx, filename), ctx)
        _assert_factor_invariants(analysis)
        total = sum(factor.severity for factor in analysis.factors)
        assert analysis.risk_score == round(min(100, max(0, total)))


def test_workload_collision_formula() -> None:
    def item(crn: str, credits: float, difficulty: float, course_id: str = "CS 3114"):
        from risk import SectionDifficulty

        return SectionDifficulty(
            section(crn, "MCB", ["M"], 600, 650, course_id=course_id, credits=credits),
            difficulty,
            True,
        )

    none = workload_collision([item("1", 3, 3.0)])
    assert none.severity == 0.0 and none.affected_crns == []

    two = workload_collision([item("1", 3, 3.6), item("2", 3, 3.8, "CS 2505")])
    expected = config.factor_max_severity("workload_collision") * (2 / 3) * (6 / 15)
    assert two.severity == displayed_severity(expected, "workload_collision") == 8.0
    assert two.affected_crns == ["1", "2"]

    full = workload_collision(
        [item("1", 5, 4.0, "CS 1"), item("2", 5, 4.0, "CS 2"), item("3", 5, 4.0, "CS 3")]
    )
    assert full.severity == config.factor_max_severity("workload_collision") == 30.0


def test_back_to_back_density_formula() -> None:
    packed = [
        section("1", "MCB", ["M"], 600, 700),
        section("2", "WHI", ["M"], 705, 800),
        section("3", "TORG", ["M"], 805, 900),
    ]
    monday = day_density(packed, "M")
    contact = (100 + 95 + 95) / 60
    assert monday.tight_pairs == 2
    assert monday.longest_block_hours == pytest.approx(5.0)
    expected_score = (
        max(0.0, contact - config.DENSITY_FREE_CONTACT_HOURS)
        + config.DENSITY_TIGHT_PAIR_POINTS * 2
        + config.DENSITY_BLOCK_POINTS
    )
    assert monday.score == pytest.approx(expected_score)
    factor = back_to_back_density(packed)
    raw = config.factor_max_severity("back_to_back_density") * min(1.0, expected_score / 15)
    assert factor.severity == displayed_severity(raw, "back_to_back_density")
    assert factor.detail.startswith("Densest day M")

    isolated = [section("1", "MCB", ["M"], 600, 650)]
    quiet = back_to_back_density(isolated)
    assert quiet.severity == 0.0


def test_weighted_volatility_matches_hand_calculation() -> None:
    def record(gpa: float, enrollment: int, crn: str) -> GradeRecord:
        dist = {k: 0.0 for k in config.GRADE_KEYS}
        dist["A"] = 50.0
        dist["B"] = 50.0
        return GradeRecord.model_validate(
            {
                "academic_year": "2025-26",
                "term": "Fall",
                "subject": "CS",
                "course_no": "3114",
                "course_id": "CS 3114",
                "course_title": "Data Structures and Algorithms",
                "instructor": "lovelace",
                "gpa": gpa,
                "dist": dist,
                "withdraws": 0,
                "graded_enrollment": enrollment,
                "crn": crn,
                "credits": 3,
                "meta": {"source": "synthetic_filler", "confidence": "low"},
            }
        )

    records = [record(4.0, 100, "1"), record(2.0, 300, "2")]
    mean, sigma = weighted_mean_sigma(records)
    # mu = (400 + 600) / 400 = 2.5; var = (100*2.25 + 300*0.25)/400 = 0.75; sigma = sqrt(0.75)
    assert mean == pytest.approx(2.5)
    assert sigma == pytest.approx(0.75**0.5)


def test_grade_volatility_requires_three_instructor_records(ctx: DataContext) -> None:
    notes = NoteCollector()
    engl = ctx.sections_by_crn["90004"]  # TBA, no history
    factor = grade_volatility([engl], ctx, notes)
    assert factor.severity == 0.0
    assert any("excluded from grade volatility" in n for n in notes.as_list())


def test_difficulty_load_formula_includes_pass_fail() -> None:
    from risk import SectionDifficulty

    items = [
        SectionDifficulty(section("1", "MCB", ["M"], 600, 650, credits=3), 4.5, True),
        SectionDifficulty(
            section(
                "2",
                None,
                ["T"],
                600,
                650,
                credits=3,
                modality="online_sync",
                grade_mode="pass_fail",
            ),
            2.5,
            True,
        ),
    ]
    factor = difficulty_load(items)
    mean = (3 * 4.5 + 3 * 2.5) / 6  # 3.5
    raw = config.factor_max_severity("difficulty_load") * ((mean - 2.5) / 2.0)
    assert factor.severity == displayed_severity(raw, "difficulty_load")
    assert factor.affected_crns == ["1"]  # only above the 2.5 baseline


def test_expected_gpa_exclusions_fallback_and_synthetic_confidence(ctx: DataContext) -> None:
    notes = NoteCollector()
    pf = ctx.sections_by_crn["90008"]
    tba = ctx.sections_by_crn["90004"]
    cs = ctx.sections_by_crn["90001"]
    gpa = expected_gpa([pf, tba, cs], ctx, notes)
    reasons = {e.crn: e.reason for e in gpa.excluded}
    assert reasons[pf.crn] == "pass_fail"
    assert reasons[tba.crn] == "no_grade_history"
    assert gpa.mean is not None and cs.crn not in reasons
    assert gpa.confidence == "low"  # synthetic-only history
    assert any("synthetic" in n.lower() for n in notes.as_list())

    empty = expected_gpa([pf, tba], ctx, NoteCollector())
    assert empty.mean is None and empty.range is None and empty.confidence == "low"


def test_pass_fail_is_excluded_from_expected_gpa_not_treated_as_zero(ctx: DataContext) -> None:
    pf = ctx.sections_by_crn["90008"]
    cs = ctx.sections_by_crn["90001"]
    with_pf = expected_gpa([cs, pf], ctx, NoteCollector())
    without = expected_gpa([cs], ctx, NoteCollector())
    assert pf.grade_mode == "pass_fail"
    assert any(e.crn == pf.crn and e.reason == "pass_fail" for e in with_pf.excluded)
    assert all(e.crn != cs.crn for e in with_pf.excluded)
    assert with_pf.mean == without.mean
    assert with_pf.mean is not None and with_pf.mean > 0
    # A zero-grade treatment of pass/fail would pull the mean toward 0.
    pulled = (without.mean * cs.credits + 0.0 * pf.credits) / (cs.credits + pf.credits)
    assert with_pf.mean != round(pulled, config.GPA_DISPLAY_DECIMALS)


def test_swap_demo_exact_scores_delta_and_independent_analyze(ctx: DataContext) -> None:
    demo = json.loads((config.DEFAULT_FIXTURES_DIR / config.DEMO_SWAP_FILE).read_text("utf-8"))
    before = analyze([ctx.sections_by_crn[c] for c in demo["current_crns"]], ctx)
    after_crns = [demo["add_crn"] if c == demo["drop_crn"] else c for c in demo["current_crns"]]
    after = analyze([ctx.sections_by_crn[c] for c in after_crns], ctx)
    assert before.risk_score == config.SWAP_DEMO_BEFORE_SCORE
    assert after.risk_score == config.SWAP_DEMO_AFTER_SCORE
    assert after.risk_score - before.risk_score == (
        config.SWAP_DEMO_AFTER_SCORE - config.SWAP_DEMO_BEFORE_SCORE
    )
    assert before.risk_score - after.risk_score >= config.SWAP_DEMO_MIN_IMPROVEMENT
    _assert_factor_invariants(before)
    _assert_factor_invariants(after)
    again_before = analyze([ctx.sections_by_crn[c] for c in demo["current_crns"]], ctx)
    again_after = analyze([ctx.sections_by_crn[c] for c in after_crns], ctx)
    assert before.model_dump(mode="json") == again_before.model_dump(mode="json")
    assert after.model_dump(mode="json") == again_after.model_dump(mode="json")


def test_analyze_swap_stress_dumps_are_deterministic(ctx: DataContext) -> None:
    easy = _fixture_sections(ctx, config.DEMO_EASY_FILE)
    first = analyze(easy, ctx)
    second = analyze(easy, ctx)
    assert first.model_dump_json(by_alias=True) == second.model_dump_json(by_alias=True)

    demo = json.loads((config.DEFAULT_FIXTURES_DIR / config.DEMO_SWAP_FILE).read_text("utf-8"))
    before = analyze([ctx.sections_by_crn[c] for c in demo["current_crns"]], ctx)
    after_crns = [demo["add_crn"] if c == demo["drop_crn"] else c for c in demo["current_crns"]]
    after = analyze([ctx.sections_by_crn[c] for c in after_crns], ctx)
    assert after.risk_score - before.risk_score == (
        config.SWAP_DEMO_AFTER_SCORE - config.SWAP_DEMO_BEFORE_SCORE
    )
    assert before.model_dump_json(by_alias=True) == analyze(
        [ctx.sections_by_crn[c] for c in demo["current_crns"]], ctx
    ).model_dump_json(by_alias=True)
    assert after.model_dump_json(by_alias=True) == analyze(
        [ctx.sections_by_crn[c] for c in after_crns], ctx
    ).model_dump_json(by_alias=True)

    stressed_a = miss_week_stress(first, easy, ctx, week=8)
    stressed_b = miss_week_stress(analyze(easy, ctx), easy, ctx, week=8)
    assert stressed_a.model_dump_json(by_alias=True) == stressed_b.model_dump_json(by_alias=True)
    assert first.risk_score == config.EASY_FIXTURE_EXPECTED_SCORE
    assert stressed_a.original_risk == config.EASY_FIXTURE_EXPECTED_SCORE
    assert stressed_a.stressed_risk == config.EASY_STRESS_STRESSED_SCORE
    assert stressed_a.delta == config.EASY_STRESS_DELTA


def _stress_item(
    crn: str,
    *,
    credits: float,
    difficulty: float,
    schedule_type: str = "Lecture",
    grade_mode: str = "standard",
    course_id: str = "CS 3114",
) -> SectionDifficulty:
    return SectionDifficulty(
        section(
            crn,
            "MCB",
            ["M"],
            600,
            650,
            course_id=course_id,
            credits=credits,
            schedule_type=schedule_type,
            grade_mode=grade_mode,
            modality="online_sync" if grade_mode == "pass_fail" else "f2f",
        ),
        difficulty,
        True,
    )


@pytest.mark.parametrize(
    ("difficulty", "credits", "schedule_type", "points", "impact"),
    [
        (config.HARD_DIFFICULTY - 0.1, 3, "Lecture", 0, "low"),
        (config.HARD_DIFFICULTY, 3, "Lecture", 5, "medium"),
        (config.HARD_DIFFICULTY + 0.1, 3, "Lecture", 5, "medium"),
        (3.0, config.STRESS_HIGH_CREDIT_MIN - 0.5, "Lecture", 0, "low"),
        (3.0, config.STRESS_HIGH_CREDIT_MIN, "Lecture", 3, "low"),
        (3.0, 3, "Lab", 2, "low"),
        (3.0, 3, "Recitation", 2, "low"),
        (3.0, 3, "Independent Study", 0, "low"),
        (config.HARD_DIFFICULTY, 4, "Lecture", 8, "high"),
        (config.HARD_DIFFICULTY, 4, "Lab", 10, "high"),
        (config.HARD_DIFFICULTY, 5, "Recitation", 10, "high"),
    ],
)
def test_stress_penalty_formula_boundaries(
    difficulty: float, credits: float, schedule_type: str, points: int, impact: str
) -> None:
    got_points, got_impact, reason = section_stress_points(
        _stress_item("1", credits=credits, difficulty=difficulty, schedule_type=schedule_type)
    )
    assert (got_points, got_impact) == (points, impact)
    if points == 0:
        assert reason == ""
    else:
        assert "catch-up cost" in reason


def test_stress_section_cap_is_applied_once() -> None:
    points, impact, _ = section_stress_points(
        _stress_item("1", credits=5, difficulty=5.0, schedule_type="Lab")
    )
    uncapped = (
        config.STRESS_HARD_DIFFICULTY_POINTS
        + config.STRESS_HIGH_CREDIT_POINTS
        + config.STRESS_LAB_RECITATION_POINTS
    )
    assert uncapped == config.STRESS_SECTION_POINTS_CAP == points == 10
    assert impact == "high"


def test_stress_uplift_cap_and_100_point_clamp() -> None:
    raw_sum = 6 * config.STRESS_SECTION_POINTS_CAP
    assert raw_sum > config.STRESS_MAX_UPLIFT
    stressed, delta = apply_stress_delta(50, raw_sum)
    assert (stressed, delta) == (80, config.STRESS_MAX_UPLIFT)
    clamped, clamped_delta = apply_stress_delta(95, raw_sum)
    assert clamped == config.RISK_SCORE_MAX == 100
    assert clamped_delta == 5
    exact, exact_delta = apply_stress_delta(70, config.STRESS_MAX_UPLIFT)
    assert (exact, exact_delta) == (100, 30)
    below, below_delta = apply_stress_delta(70, config.STRESS_MAX_UPLIFT - 1)
    assert (below, below_delta) == (99, 29)
    at_ceiling, zero = apply_stress_delta(100, raw_sum)
    assert (at_ceiling, zero) == (100, 0)


def test_stress_pass_fail_is_scored_but_excluded_from_embedded_gpa(ctx: DataContext) -> None:
    pf = ctx.sections_by_crn["90008"]
    cs = ctx.sections_by_crn["90001"]
    analysis = analyze([cs, pf], ctx)
    stressed = miss_week_stress(analysis, [cs, pf], ctx, week=8)
    assert stressed.analysis.expected_gpa.excluded
    assert any(
        e.reason == "pass_fail" and e.crn == pf.crn for e in stressed.analysis.expected_gpa.excluded
    )
    assert pf.crn not in {p.crn for p in stressed.penalties}  # default 3.0 lecture, 3 credits
    hard_pf = section_stress_points(
        _stress_item(
            "9",
            credits=4,
            difficulty=4.0,
            schedule_type="Lab",
            grade_mode="pass_fail",
            course_id="HNFE 1004",
        )
    )
    assert hard_pf[0] == 10


def test_stress_week_is_echoed_and_does_not_change_points(ctx: DataContext) -> None:
    sections = _fixture_sections(ctx, config.DEMO_EASY_FILE)
    analysis = analyze(sections, ctx)
    first = miss_week_stress(analysis, sections, ctx, week=config.STRESS_WEEK_MIN)
    last = miss_week_stress(analysis, sections, ctx, week=config.STRESS_WEEK_MAX)
    assert first.scenario.week == 1 and last.scenario.week == 16
    assert first.penalties == last.penalties
    assert first.stressed_risk == last.stressed_risk
    assert first.analysis == analysis


def test_professor_vibes_known_instructor_and_normalization(ctx: DataContext) -> None:
    by_key = professor_vibes(ctx, "lovelace")
    by_name = professor_vibes(ctx, "Ada Lovelace")
    by_case = professor_vibes(ctx, "LOVELACE")
    assert by_key is not None and by_key == by_name == by_case
    assert by_key.instructor == "lovelace"
    assert by_key.rmp is not None
    assert by_key.rmp.difficulty == ctx.rmp["lovelace"].difficulty
    assert by_key.grade_stats.n_sections == len(ctx.grades_by_instructor["lovelace"])
    assert by_key.confidence == "low"  # placeholder rows are synthetic
    assert "exams match homework" in by_key.tags
    assert "tough grader" in by_key.tags
    assert by_key.tags == extract_vibe_tags(ctx.rmp["lovelace"])
    assert by_key.tags == list(dict.fromkeys(by_key.tags))
    assert len(by_key.tags) <= config.MAX_VIBE_TAGS


def test_professor_vibes_unknown_and_partial_data(ctx: DataContext) -> None:
    assert professor_vibes(ctx, "nobody") is None
    assert professor_vibes(ctx, "curie") is None  # teaches, but no RMP and no grades
    hopper = professor_vibes(ctx, "hopper")
    assert hopper is not None and hopper.rmp is not None
    assert hopper.grade_stats.avg_gpa is not None
    records = ctx.grades_by_instructor["hopper"]
    mean, sigma = weighted_mean_sigma(records)
    n_students = sum(r.graded_enrollment for r in records)
    a_rate = sum(r.graded_enrollment * r.dist["A"] for r in records) / n_students
    assert hopper.grade_stats.avg_gpa == round(mean, config.GPA_DISPLAY_DECIMALS)
    assert hopper.grade_stats.volatility == round(sigma, config.GPA_DISPLAY_DECIMALS)
    assert hopper.grade_stats.a_rate == round(a_rate, config.PERCENT_DISPLAY_DECIMALS)
    assert hopper.grade_stats.n_students == n_students
