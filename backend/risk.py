"""Risk engine (PRD 7): pure functions, no FastAPI imports.

:func:`analyze` scores a validated, request-ordered list of sections against the
immutable :class:`data.DataContext`:

* PRD 7.3 shared instructor difficulty (RMP or ``DEFAULT_DIFFICULTY`` + note)
* PRD 7.4 ``workload_collision``, 7.5 ``back_to_back_density``, 7.6 ``commute``,
  7.7 ``grade_volatility``, 7.8 ``difficulty_load`` — always all five, in
  ``config.FACTOR_ORDER``, each clamped to ``100 * W[factor]`` and rounded to one
  decimal (PRD 7.2)
* ``risk_score = round(clamp(sum(displayed severities), 0, 100))`` computed on the
  exact decimal sum of the displayed values, so the factors reproduce the score
* PRD 6.5 miss-week stress: per-section points, section cap, uplift cap, 100-point
  clamp; week is echoed only
* PRD 6.6 professor vibes: same instructor-key normalization as the loader,
  RMP/grade aggregation, lexicon tags, synthetic-low confidence

Every list is deterministically ordered (request order, configured factor order,
weekday/start/CRN for commutes, first-insertion order for deduplicated notes).
Nothing here branches on fixture names or CRNs; calibration lives in ``config.py``
and the committed data (PRD 10.4).
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from decimal import ROUND_HALF_EVEN, Decimal
from itertools import pairwise

import config
from data import DataContext, WalkLookup, walk_between
from models import (
    AnalysisMeta,
    AnalyzeResponse,
    CommuteFrom,
    CommuteTo,
    CommuteVerdict,
    CommuteWarning,
    Confidence,
    ExpectedGpa,
    GpaExclusion,
    GradeRecord,
    Meeting,
    RiskFactor,
    RmpEntry,
    Section,
    StressImpact,
    StressMeta,
    StressPenalty,
    StressResponse,
    StressScenario,
    VibesGradeStats,
    VibesResponse,
    VibesRmp,
    Weekday,
    normalize_instructor_key,
)
from schedule import dates_overlap, format_hhmm, weekday_index, weekday_timeline

WORKLOAD_FACTOR = "workload_collision"
DENSITY_FACTOR = "back_to_back_density"
COMMUTE_FACTOR = "commute"
VOLATILITY_FACTOR = "grade_volatility"
DIFFICULTY_FACTOR = "difficulty_load"

_SEVERITY_QUANTUM = Decimal("0.1")


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------


class NoteCollector:
    """Ordered, deduplicated ``meta.data_notes`` accumulator."""

    def __init__(self, initial: Iterable[str] = ()) -> None:
        self._notes: list[str] = []
        for note in initial:
            self.add(note)

    def add(self, note: str) -> None:
        if note not in self._notes:
            self._notes.append(note)

    def as_list(self) -> list[str]:
        return list(self._notes)


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def displayed_severity(raw: float, factor: str) -> float:
    """PRD 7.2: clamp to ``100 * W[factor]`` then round to one decimal."""
    clamped = clamp(raw, 0.0, config.factor_max_severity(factor))
    return float(Decimal(repr(clamped)).quantize(_SEVERITY_QUANTUM, rounding=ROUND_HALF_EVEN))


def risk_score_from_factors(factors: Sequence[RiskFactor]) -> int:
    """PRD 7.2: ``round(clamp(sum(displayed severities), 0, 100))`` on the exact
    decimal sum of the one-decimal values (half-even, like Python's ``round``)."""
    total = sum((Decimal(repr(factor.severity)) for factor in factors), Decimal(0))
    clamped = max(Decimal(config.RISK_SCORE_MIN), min(Decimal(config.RISK_SCORE_MAX), total))
    return int(clamped.quantize(Decimal(1), rounding=ROUND_HALF_EVEN))


def weighted_mean_sigma(records: Sequence[GradeRecord]) -> tuple[float, float]:
    """Enrollment-weighted mean GPA and weighted *population* standard deviation."""
    total_weight = sum(record.graded_enrollment for record in records)
    mean = sum(record.graded_enrollment * record.gpa for record in records) / total_weight
    variance = (
        sum(record.graded_enrollment * (record.gpa - mean) ** 2 for record in records)
        / total_weight
    )
    return mean, math.sqrt(variance)


def _format_credits(credits: float) -> str:
    return f"{credits:g}"


def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return singular if count == 1 else (plural or singular + "s")


def _ordered_unique(values: Iterable[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value not in seen:
            seen.append(value)
    return seen


# ---------------------------------------------------------------------------
# PRD 7.3 — shared instructor difficulty
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SectionDifficulty:
    section: Section
    difficulty: float
    from_rmp: bool


def section_difficulties(
    sections: Sequence[Section], ctx: DataContext, notes: NoteCollector
) -> list[SectionDifficulty]:
    """Primary-instructor RMP difficulty, else ``DEFAULT_DIFFICULTY`` with one note."""
    result: list[SectionDifficulty] = []
    default = config.DEFAULT_DIFFICULTY
    for section in sections:
        key = section.primary_instructor_key
        entry = ctx.rmp.get(key) if key is not None else None
        if entry is not None:
            result.append(SectionDifficulty(section, entry.difficulty, True))
            continue
        if key is None:
            notes.add(
                f"{section.course_id} (CRN {section.crn}) has no primary instructor; "
                f"using the default difficulty {default:.1f}."
            )
        else:
            notes.add(
                f"No RMP entry for instructor '{key}'; using the default difficulty "
                f"{default:.1f} for their selected section(s)."
            )
        result.append(SectionDifficulty(section, default, False))
    return result


# ---------------------------------------------------------------------------
# PRD 7.4 — Factor 1: workload_collision
# ---------------------------------------------------------------------------


def workload_collision(difficulties: Sequence[SectionDifficulty]) -> RiskFactor:
    heavy = [item for item in difficulties if item.difficulty >= config.HARD_DIFFICULTY]
    heavy_credits = sum(item.section.credits for item in heavy)
    count_ratio = min(1.0, len(heavy) / config.WORKLOAD_HEAVY_SECTIONS_FULL)
    credit_ratio = min(1.0, heavy_credits / config.WORKLOAD_HEAVY_CREDITS_FULL)
    max_severity = config.factor_max_severity(WORKLOAD_FACTOR)
    raw = max_severity * count_ratio * credit_ratio

    course_ids = _ordered_unique(item.section.course_id for item in heavy)
    if not heavy:
        detail = (
            f"No heavy-workload sections (no primary-instructor difficulty of at least "
            f"{config.HARD_DIFFICULTY:.1f})."
        )
    elif len(course_ids) == len(heavy):
        detail = (
            f"{len(heavy)} heavy-workload {_plural(len(heavy), 'course')} "
            f"({_format_credits(heavy_credits)} credits): {', '.join(course_ids)}"
        )
    else:
        detail = (
            f"{len(heavy)} heavy-workload sections across {len(course_ids)} "
            f"{_plural(len(course_ids), 'course')} ({_format_credits(heavy_credits)} credits): "
            f"{', '.join(course_ids)}"
        )
    return RiskFactor(
        type=WORKLOAD_FACTOR,
        severity=displayed_severity(raw, WORKLOAD_FACTOR),
        max_severity=max_severity,
        detail=detail,
        affected_crns=[item.section.crn for item in heavy],
    )


# ---------------------------------------------------------------------------
# PRD 7.5 — Factor 2: back_to_back_density
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class DayDensity:
    day: str
    contact_hours: float
    tight_pairs: int
    longest_block_hours: float
    score: float
    crns: tuple[str, ...]


def day_density(sections: Sequence[Section], day: str) -> DayDensity:
    """One weekday's PRD 7.5 statistics over every synchronous meeting."""
    timeline = weekday_timeline(sections, day)
    contact_min = sum(entry.meeting.end_min - entry.meeting.start_min for entry in timeline)
    tight_pairs = 0
    longest_block_min = 0
    block_start: int | None = None
    block_end = 0
    previous = None
    for entry in timeline:
        meeting = entry.meeting
        connected = False
        if previous is not None and dates_overlap(previous.meeting, meeting):
            gap = meeting.start_min - previous.meeting.end_min
            connected = 0 <= gap <= config.DENSITY_TIGHT_GAP_MAX_MIN
        if connected:
            tight_pairs += 1
            block_end = max(block_end, meeting.end_min)
        else:
            if block_start is not None:
                longest_block_min = max(longest_block_min, block_end - block_start)
            block_start, block_end = meeting.start_min, meeting.end_min
        previous = entry
    if block_start is not None:
        longest_block_min = max(longest_block_min, block_end - block_start)

    contact_hours = contact_min / 60
    longest_block_hours = longest_block_min / 60
    score = (
        max(0.0, contact_hours - config.DENSITY_FREE_CONTACT_HOURS)
        + config.DENSITY_TIGHT_PAIR_POINTS * tight_pairs
        + (config.DENSITY_BLOCK_POINTS if longest_block_hours >= config.DENSITY_BLOCK_HOURS else 0)
    )
    return DayDensity(
        day=day,
        contact_hours=contact_hours,
        tight_pairs=tight_pairs,
        longest_block_hours=longest_block_hours,
        score=score,
        crns=tuple(_ordered_unique(entry.section.crn for entry in timeline)),
    )


def back_to_back_density(sections: Sequence[Section]) -> RiskFactor:
    days = [day_density(sections, day) for day in config.WEEKDAY_ORDER]
    weekly_total = sum(day.score for day in days)
    max_severity = config.factor_max_severity(DENSITY_FACTOR)
    raw = max_severity * min(1.0, weekly_total / config.DENSITY_FULL_SCORE)

    busiest = max(days, key=lambda day: (day.score, -weekday_index(day.day)))
    if not any(day.crns for day in days):
        detail = "No synchronous meetings."
    else:
        prefix = "Densest day" if weekly_total > 0 else "No dense weekday; heaviest is"
        detail = (
            f"{prefix} {busiest.day}: {busiest.contact_hours:.1f} contact hours, "
            f"{busiest.tight_pairs} tight {_plural(busiest.tight_pairs, 'gap')} "
            f"(\u2264{config.DENSITY_TIGHT_GAP_MAX_MIN} min), longest unbroken block "
            f"{busiest.longest_block_hours:.1f} h; weekly density score {weekly_total:.1f}."
        )
    affected_days = [day for day in days if day.score > 0]
    ordered_crns = [section.crn for section in sections]
    affected = [crn for crn in ordered_crns if any(crn in day.crns for day in affected_days)]
    return RiskFactor(
        type=DENSITY_FACTOR,
        severity=displayed_severity(raw, DENSITY_FACTOR),
        max_severity=max_severity,
        detail=detail,
        affected_crns=affected,
    )


# ---------------------------------------------------------------------------
# Commute classification (PRD 7.6)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CommuteClassification:
    raw_walk_min: int
    adjusted_walk_min: int
    gap_min: int
    slack_min: int
    verdict: CommuteVerdict


def classify_commute(gap_min: int, raw_walk_min: int) -> CommuteClassification:
    """Classify one transition (PRD 7.6).

    ``adjusted_walk = max(0, raw_walk - WALK_OPTIMISM_MIN)`` — the two-minute optimism
    adjustment is applied here and nowhere else — and ``slack = gap - adjusted_walk``.

    * ``comfortable`` when ``slack >= WALK_COMFORT_SLACK_MIN``
    * ``tight`` when ``-WALK_TIGHT_DEFICIT_MAX <= slack < WALK_COMFORT_SLACK_MIN``
    * ``impossible`` when ``slack < -WALK_TIGHT_DEFICIT_MAX``
    """
    adjusted = max(0, raw_walk_min - config.WALK_OPTIMISM_MIN)
    slack = gap_min - adjusted
    verdict: CommuteVerdict
    if slack >= config.WALK_COMFORT_SLACK_MIN:
        verdict = "comfortable"
    elif slack >= -config.WALK_TIGHT_DEFICIT_MAX:
        verdict = "tight"
    else:
        verdict = "impossible"
    return CommuteClassification(
        raw_walk_min=raw_walk_min,
        adjusted_walk_min=adjusted,
        gap_min=gap_min,
        slack_min=slack,
        verdict=verdict,
    )


@dataclass(frozen=True)
class CommuteTransition:
    day: Weekday
    from_section: Section
    from_meeting: Meeting
    to_section: Section
    to_meeting: Meeting
    walk: WalkLookup
    classification: CommuteClassification


def commute_transitions(sections: Sequence[Section], ctx: DataContext) -> list[CommuteTransition]:
    """Adjacent physical meetings per weekday (PRD 7.6).

    The weekday timeline contains every synchronous meeting. Only consecutive pairs
    in which *both* meetings are physical and whose date ranges overlap form a
    transition, so an intervening online meeting breaks physical adjacency and no
    walk is inferred through it. Results sort by weekday, start time, then CRN.
    """
    transitions: list[CommuteTransition] = []
    for day in config.WEEKDAY_ORDER:
        timeline = weekday_timeline(sections, day)
        for previous, following in pairwise(timeline):
            building_from = previous.meeting.building
            building_to = following.meeting.building
            if building_from is None or building_to is None:
                continue
            if not dates_overlap(previous.meeting, following.meeting):
                continue
            walk = walk_between(ctx, building_from, building_to)
            gap_min = following.meeting.start_min - previous.meeting.end_min
            transitions.append(
                CommuteTransition(
                    day=day,  # type: ignore[arg-type]
                    from_section=previous.section,
                    from_meeting=previous.meeting,
                    to_section=following.section,
                    to_meeting=following.meeting,
                    walk=walk,
                    classification=classify_commute(gap_min, walk.minutes),
                )
            )
    transitions.sort(
        key=lambda t: (
            weekday_index(t.day),
            t.from_meeting.start_min,
            t.to_meeting.start_min,
            t.from_section.crn,
            t.to_section.crn,
        )
    )
    return transitions


def _article(number: int) -> str:
    """Indefinite article: "an" before 8, 11, 18, and 80-89 (leading vowel sound)."""
    if number in (8, 11, 18) or 80 <= number <= 89:
        return "an"
    return "a"


def transition_detail(transition: CommuteTransition) -> str:
    """Human-readable explanation naming the actual walk source (PRD 7.6)."""
    classification = transition.classification
    building_from = transition.from_meeting.building
    building_to = transition.to_meeting.building
    if transition.walk.same_building:
        walk_text = f"{building_from} → {building_to} is the same building (0-minute walk)"
    else:
        label = config.WALK_SOURCE_LABELS[transition.walk.source]
        if transition.walk.source == "default_fallback":
            label = f"{label}; no committed matrix entry"
        walk_text = (
            f"{building_from} → {building_to} is {_article(classification.raw_walk_min)} "
            f"{classification.raw_walk_min}-minute walk ({label})"
        )
    return (
        f"{walk_text}; the risk classifier uses {classification.adjusted_walk_min} minutes "
        f"after the {config.WALK_OPTIMISM_MIN}-minute optimism adjustment, and the schedule "
        f"provides {classification.gap_min} minutes."
    )


def transition_warning(transition: CommuteTransition) -> CommuteWarning:
    classification = transition.classification
    return CommuteWarning(
        day=transition.day,
        from_=CommuteFrom(
            crn=transition.from_section.crn,
            building=transition.from_meeting.building or "",
            ends=format_hhmm(transition.from_meeting.end_min),
        ),
        to=CommuteTo(
            crn=transition.to_section.crn,
            building=transition.to_meeting.building or "",
            starts=format_hhmm(transition.to_meeting.start_min),
        ),
        walk_min=classification.raw_walk_min,
        adjusted_walk_min=classification.adjusted_walk_min,
        gap_min=classification.gap_min,
        verdict=classification.verdict,
        source=transition.walk.source,
        detail=transition_detail(transition),
    )


def commute_warnings(transitions: Sequence[CommuteTransition]) -> list[CommuteWarning]:
    """Only ``tight`` and ``impossible`` transitions, in transition order (PRD 6.3)."""
    return [
        transition_warning(transition)
        for transition in transitions
        if transition.classification.verdict in config.COMMUTE_WARNING_VERDICTS
    ]


def commute_factor(transitions: Sequence[CommuteTransition]) -> RiskFactor:
    """Factor 3 severity: ``min(max_severity, sum(transition points))`` (PRD 7.6)."""
    max_severity = config.factor_max_severity(COMMUTE_FACTOR)
    points = sum(
        config.COMMUTE_TRANSITION_POINTS[transition.classification.verdict]
        for transition in transitions
    )
    severity = displayed_severity(min(max_severity, points), COMMUTE_FACTOR)

    flagged = [
        transition
        for transition in transitions
        if transition.classification.verdict in config.COMMUTE_WARNING_VERDICTS
    ]
    affected: list[str] = []
    for transition in flagged:
        for crn in (transition.from_section.crn, transition.to_section.crn):
            if crn not in affected:
                affected.append(crn)
    if flagged:
        impossible = sum(1 for t in flagged if t.classification.verdict == "impossible")
        tight = len(flagged) - impossible
        weekdays = sorted({t.day for t in flagged}, key=weekday_index)
        detail = (
            f"{impossible} impossible and {tight} tight walking transition(s) on "
            f"{', '.join(weekdays)}."
        )
    else:
        detail = "No tight or impossible walking transitions."
    return RiskFactor(
        type=COMMUTE_FACTOR,
        severity=severity,
        max_severity=max_severity,
        detail=detail,
        affected_crns=affected,
    )


# ---------------------------------------------------------------------------
# PRD 7.7 — Factor 4: grade_volatility
# ---------------------------------------------------------------------------


def instructor_records(section: Section, ctx: DataContext) -> tuple[GradeRecord, ...]:
    """Grade records matching ``(course_id, primary_instructor_key)``; empty for TBA."""
    key = section.primary_instructor_key
    if key is None:
        return ()
    return ctx.grades_by_course_instructor.get((section.course_id, key), ())


def _note_synthetic(records: Iterable[GradeRecord], course_id: str, notes: NoteCollector) -> None:
    if any(record.synthetic for record in records):
        notes.add(f"{course_id} grade data is synthetic and representative.")


def grade_volatility(
    sections: Sequence[Section], ctx: DataContext, notes: NoteCollector
) -> RiskFactor:
    eligible: list[tuple[Section, float]] = []
    for section in sections:
        if section.grade_mode != "standard":
            continue
        records = instructor_records(section, ctx)
        if len(records) < config.VOLATILITY_MIN_RECORDS:
            key = section.primary_instructor_key
            reason = (
                "no primary instructor"
                if key is None
                else f"only {len(records)} of the {config.VOLATILITY_MIN_RECORDS} grade records "
                f"required for instructor '{key}'"
            )
            notes.add(
                f"{section.course_id} (CRN {section.crn}): {reason}; "
                f"excluded from grade volatility."
            )
            continue
        _, sigma = weighted_mean_sigma(records)
        _note_synthetic(records, section.course_id, notes)
        eligible.append((section, sigma))

    max_severity = config.factor_max_severity(VOLATILITY_FACTOR)
    if not eligible:
        return RiskFactor(
            type=VOLATILITY_FACTOR,
            severity=0.0,
            max_severity=max_severity,
            detail=(
                f"No section has at least {config.VOLATILITY_MIN_RECORDS} instructor-specific "
                f"grade records; volatility not assessed."
            ),
            affected_crns=[],
        )
    total_credits = sum(section.credits for section, _ in eligible)
    combined_sigma = sum(section.credits * sigma for section, sigma in eligible) / total_credits
    raw = max_severity * min(1.0, combined_sigma / config.VOLATILITY_MAX_SIGMA)
    parts = ", ".join(f"{section.course_id} (\u03c3 {sigma:.2f})" for section, sigma in eligible)
    detail = (
        f"Credit-weighted grade volatility \u03c3 {combined_sigma:.2f} across {len(eligible)} "
        f"{_plural(len(eligible), 'section')} with instructor history: {parts}"
    )
    return RiskFactor(
        type=VOLATILITY_FACTOR,
        severity=displayed_severity(raw, VOLATILITY_FACTOR),
        max_severity=max_severity,
        detail=detail,
        affected_crns=[section.crn for section, _ in eligible],
    )


# ---------------------------------------------------------------------------
# PRD 7.8 — Factor 5: difficulty_load
# ---------------------------------------------------------------------------


def difficulty_load(difficulties: Sequence[SectionDifficulty]) -> RiskFactor:
    total_credits = sum(item.section.credits for item in difficulties)
    mean_difficulty = (
        sum(item.section.credits * item.difficulty for item in difficulties) / total_credits
    )
    max_severity = config.factor_max_severity(DIFFICULTY_FACTOR)
    raw = max_severity * clamp(
        (mean_difficulty - config.DIFFICULTY_LOAD_BASELINE) / config.DIFFICULTY_LOAD_RANGE,
        0.0,
        1.0,
    )
    defaulted = sum(1 for item in difficulties if not item.from_rmp)
    detail = (
        f"Credit-weighted instructor difficulty {mean_difficulty:.2f}/5 across "
        f"{_format_credits(total_credits)} credits"
    )
    if defaulted:
        detail += (
            f" ({defaulted} {_plural(defaulted, 'section')} at the default "
            f"{config.DEFAULT_DIFFICULTY:.1f})"
        )
    return RiskFactor(
        type=DIFFICULTY_FACTOR,
        severity=displayed_severity(raw, DIFFICULTY_FACTOR),
        max_severity=max_severity,
        detail=detail + ".",
        affected_crns=[
            item.section.crn
            for item in difficulties
            if item.difficulty > config.DIFFICULTY_LOAD_BASELINE
        ],
    )


# ---------------------------------------------------------------------------
# PRD 7.9 — expected GPA
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class GpaEvidence:
    section: Section
    records: tuple[GradeRecord, ...]
    instructor_specific: bool
    mean: float
    sigma: float

    @property
    def distinct_terms(self) -> int:
        return len({(record.academic_year, record.term) for record in self.records})

    @property
    def synthetic_only(self) -> bool:
        return all(record.synthetic for record in self.records)


def expected_gpa(
    sections: Sequence[Section], ctx: DataContext, notes: NoteCollector
) -> ExpectedGpa:
    excluded: list[GpaExclusion] = []
    evidence: list[GpaEvidence] = []
    for section in sections:
        if config.PASS_FAIL_EXCLUDE_FROM_GPA and section.grade_mode == "pass_fail":
            excluded.append(GpaExclusion(crn=section.crn, reason="pass_fail"))
            continue
        records = instructor_records(section, ctx)
        instructor_specific = bool(records)
        if not records:
            records = ctx.grades_by_course.get(section.course_id, ())
            if records:
                key = section.primary_instructor_key
                who = (
                    "no primary instructor" if key is None else f"no history for instructor '{key}'"
                )
                notes.add(
                    f"{section.course_id} (CRN {section.crn}): {who}; expected GPA uses all "
                    f"{len(records)} {section.course_id} {_plural(len(records), 'record')}."
                )
        if not records:
            excluded.append(GpaExclusion(crn=section.crn, reason="no_grade_history"))
            continue
        mean, sigma = weighted_mean_sigma(records)
        _note_synthetic(records, section.course_id, notes)
        evidence.append(GpaEvidence(section, tuple(records), instructor_specific, mean, sigma))

    if not evidence:
        return ExpectedGpa(
            range=None, mean=None, confidence="low", n_students=0, n_terms=0, excluded=excluded
        )

    total_credits = sum(item.section.credits for item in evidence)
    mean = sum(item.section.credits * item.mean for item in evidence) / total_credits
    combined_sigma = math.sqrt(
        sum(item.section.credits * item.sigma**2 for item in evidence) / total_credits
    )
    half_width = max(config.GPA_MIN_HALF_WIDTH, combined_sigma)
    low = clamp(mean - half_width, config.GPA_SCALE_MIN, config.GPA_SCALE_MAX)
    high = clamp(mean + half_width, config.GPA_SCALE_MIN, config.GPA_SCALE_MAX)

    unique_records = {record.identity: record for item in evidence for record in item.records}
    n_students = sum(record.graded_enrollment for record in unique_records.values())
    n_terms = len({(record.academic_year, record.term) for record in unique_records.values()})

    confidence: Confidence
    if (
        all(item.instructor_specific for item in evidence)
        and all(item.distinct_terms >= config.GPA_HIGH_MIN_TERMS_PER_SECTION for item in evidence)
        and n_students >= config.GPA_HIGH_MIN_STUDENTS
    ):
        confidence = "high"
    elif n_students >= config.GPA_MEDIUM_MIN_STUDENTS:
        confidence = "medium"  # every eligible section has some history by construction
    else:
        confidence = "low"
    if any(item.synthetic_only for item in evidence):
        confidence = "low"

    return ExpectedGpa(
        range=(
            round(low, config.GPA_DISPLAY_DECIMALS),
            round(high, config.GPA_DISPLAY_DECIMALS),
        ),
        mean=round(mean, config.GPA_DISPLAY_DECIMALS),
        confidence=confidence,
        n_students=n_students,
        n_terms=n_terms,
        excluded=excluded,
    )


# ---------------------------------------------------------------------------
# PRD 7 — full analysis
# ---------------------------------------------------------------------------


def analyze(sections: list[Section], ctx: DataContext) -> AnalyzeResponse:
    """Score ``sections`` (request order) against ``ctx``."""
    notes = NoteCollector(
        sorted({note for section in sections for note in ctx.section_notes.get(section.crn, ())})
    )
    difficulties = section_difficulties(sections, ctx, notes)
    transitions = commute_transitions(sections, ctx)
    computed = {
        WORKLOAD_FACTOR: workload_collision(difficulties),
        DENSITY_FACTOR: back_to_back_density(sections),
        COMMUTE_FACTOR: commute_factor(transitions),
        VOLATILITY_FACTOR: grade_volatility(sections, ctx, notes),
        DIFFICULTY_FACTOR: difficulty_load(difficulties),
    }
    factors = [computed[name] for name in config.FACTOR_ORDER]
    gpa = expected_gpa(sections, ctx, notes)
    return AnalyzeResponse(
        risk_score=risk_score_from_factors(factors),
        sections=list(sections),
        factors=factors,
        commute_warnings=commute_warnings(transitions),
        expected_gpa=gpa,
        meta=AnalysisMeta(term_id=ctx.term_id, data_notes=notes.as_list(), heuristic=True),
    )


# ---------------------------------------------------------------------------
# PRD 6.5 — miss-a-week stress (does not mutate the base analysis)
# ---------------------------------------------------------------------------


def stress_impact(points: int) -> StressImpact:
    """PRD 6.5: 1–3 low, 4–6 medium, 7–10 high. Zero-point sections are omitted."""
    if points <= config.STRESS_IMPACT_LOW_MAX:
        return "low"
    if points <= config.STRESS_IMPACT_MEDIUM_MAX:
        return "medium"
    return "high"


def _stress_reason(hard: bool, heavy_credits: bool, lab_or_recitation: bool) -> str:
    """Deterministic catch-up sentence; the PRD specifies impact, not wording."""
    clauses: list[str] = []
    if hard:
        clauses.append("high instructor difficulty")
    if heavy_credits:
        clauses.append("four or more credits")
    if lab_or_recitation:
        clauses.append("a lab or recitation meeting type")
    if len(clauses) == 1:
        body = clauses[0]
        verb = "increases"
    elif len(clauses) == 2:
        body = f"{clauses[0]} and {clauses[1]}"
        verb = "increase"
    else:
        body = f"{clauses[0]}, {clauses[1]}, and {clauses[2]}"
        verb = "increase"
    return f"{body[0].upper()}{body[1:]} {verb} catch-up cost."


def section_stress_points(item: SectionDifficulty) -> tuple[int, StressImpact, str]:
    """Per-section miss-week points, capped at ``STRESS_SECTION_POINTS_CAP`` once."""
    section = item.section
    hard = item.difficulty >= config.HARD_DIFFICULTY
    heavy_credits = section.credits >= config.STRESS_HIGH_CREDIT_MIN
    lab_or_recitation = section.schedule_type in config.STRESS_LAB_RECITATION_TYPES
    points = 0
    if hard:
        points += config.STRESS_HARD_DIFFICULTY_POINTS
    if heavy_credits:
        points += config.STRESS_HIGH_CREDIT_POINTS
    if lab_or_recitation:
        points += config.STRESS_LAB_RECITATION_POINTS
    points = min(points, config.STRESS_SECTION_POINTS_CAP)
    if points <= 0:
        return 0, "low", ""
    return points, stress_impact(points), _stress_reason(hard, heavy_credits, lab_or_recitation)


def miss_week_penalties(sections: Sequence[Section], ctx: DataContext) -> list[StressPenalty]:
    """Positive-point penalties in request order. Difficulty matches analyze."""
    difficulties = section_difficulties(sections, ctx, NoteCollector())
    penalties: list[StressPenalty] = []
    for item in difficulties:
        points, impact, reason = section_stress_points(item)
        if points <= 0:
            continue
        penalties.append(
            StressPenalty(
                crn=item.section.crn,
                course_id=item.section.course_id,
                points=points,
                impact=impact,
                reason=reason,
            )
        )
    return penalties


def apply_stress_delta(original_risk: int, points_sum: int) -> tuple[int, int]:
    """``(stressed_risk, returned_delta)`` after the uplift cap and 100-point clamp."""
    raw_delta = min(config.STRESS_MAX_UPLIFT, max(0, points_sum))
    stressed = min(config.RISK_SCORE_MAX, original_risk + raw_delta)
    return stressed, stressed - original_risk


def miss_week_stress(
    analysis: AnalyzeResponse,
    sections: Sequence[Section],
    ctx: DataContext,
    week: int,
) -> StressResponse:
    """Base analysis plus a deterministic miss-week penalty (PRD 6.5).

    ``week`` is echoed only; it does not change points. Caps apply once each:
    per-section ``STRESS_SECTION_POINTS_CAP``, then ``STRESS_MAX_UPLIFT`` on the
    sum, then ``RISK_SCORE_MAX`` on ``original_risk + delta``. Returned ``delta``
    is ``stressed_risk - original_risk`` after the 100-point clamp.
    """
    penalties = miss_week_penalties(sections, ctx)
    stressed, delta = apply_stress_delta(
        analysis.risk_score, sum(item.points for item in penalties)
    )
    return StressResponse(
        analysis=analysis,
        scenario=StressScenario(type="miss_week", week=week),
        original_risk=analysis.risk_score,
        stressed_risk=stressed,
        delta=delta,
        penalties=penalties,
        meta=StressMeta(heuristic=True, note=config.STRESS_HEURISTIC_NOTE),
    )


# ---------------------------------------------------------------------------
# PRD 6.6 — professor vibes
# ---------------------------------------------------------------------------


def _round_gpa(value: float) -> float:
    return round(value, config.GPA_DISPLAY_DECIMALS)


def _round_percent(value: float) -> float:
    return round(value, config.PERCENT_DISPLAY_DECIMALS)


def extract_vibe_tags(entry: RmpEntry) -> list[str]:
    """Canonical tags in lexicon order, capped at ``MAX_VIBE_TAGS``."""
    blobs = [tag.casefold() for tag in entry.tags] + [
        comment.casefold() for comment in entry.comments
    ]
    emitted: list[str] = []
    for canonical, phrases in config.VIBE_TAG_LEXICON.items():
        if any(any(phrase.casefold() in blob for blob in blobs) for phrase in phrases):
            emitted.append(canonical)
            if len(emitted) >= config.MAX_VIBE_TAGS:
                break
    return emitted


def _vibes_confidence(rmp: RmpEntry | None, records: Sequence[GradeRecord]) -> Confidence:
    has_rmp = rmp is not None
    has_grades = bool(records)
    rmp_synthetic = has_rmp and rmp.meta.synthetic
    grades_synthetic = has_grades and all(record.synthetic for record in records)
    if (
        (has_rmp or has_grades)
        and (not has_rmp or rmp_synthetic)
        and (not has_grades or grades_synthetic)
    ):
        return "low"

    n_records = len(records)
    non_synthetic_rmp = has_rmp and not rmp_synthetic
    n_reviews = rmp.n_reviews if non_synthetic_rmp else 0
    if (
        non_synthetic_rmp
        and n_reviews >= config.VIBES_HIGH_MIN_REVIEWS
        and n_records >= config.VIBES_HIGH_MIN_GRADE_RECORDS
    ):
        return "high"
    if (non_synthetic_rmp and n_reviews >= config.VIBES_MEDIUM_MIN_REVIEWS) or (
        n_records >= config.VIBES_MEDIUM_MIN_GRADE_RECORDS
    ):
        return "medium"
    return "low"


def _empty_grade_stats() -> VibesGradeStats:
    return VibesGradeStats(avg_gpa=None, volatility=None, n_sections=0, n_students=0, a_rate=None)


def _grade_stats(records: Sequence[GradeRecord]) -> VibesGradeStats:
    if not records:
        return _empty_grade_stats()
    mean, sigma = weighted_mean_sigma(records)
    n_students = sum(record.graded_enrollment for record in records)
    a_rate = sum(record.graded_enrollment * record.dist["A"] for record in records) / n_students
    return VibesGradeStats(
        avg_gpa=_round_gpa(mean),
        volatility=_round_gpa(sigma),
        n_sections=len(records),
        n_students=n_students,
        a_rate=_round_percent(a_rate),
    )


def professor_vibes(ctx: DataContext, surname: str) -> VibesResponse | None:
    """Aggregate RMP + grade vibes for a normalized instructor key.

    Returns ``None`` when the key is in neither RMP nor grade records (HTTP 404).
    Partial data is a 200 with null RMP or empty grade stats plus notes.
    """
    key = normalize_instructor_key(surname)
    if not key:
        return None
    rmp_entry = ctx.rmp.get(key)
    records = ctx.grades_by_instructor.get(key, ())
    if rmp_entry is None and not records:
        return None

    notes = NoteCollector()
    rmp_payload: VibesRmp | None = None
    tags: list[str] = []
    if rmp_entry is None:
        notes.add(f"No RateMyProfessors entry for instructor '{key}'.")
    else:
        rmp_payload = VibesRmp(
            score=rmp_entry.score,
            difficulty=rmp_entry.difficulty,
            n_reviews=rmp_entry.n_reviews,
            would_take_again=rmp_entry.would_take_again,
        )
        tags = extract_vibe_tags(rmp_entry)
        if rmp_entry.meta.synthetic:
            notes.add(
                f"RateMyProfessors data for instructor '{key}' is synthetic and representative."
            )
    if not records:
        notes.add(f"No grade records for instructor '{key}'.")
        stats = _empty_grade_stats()
    else:
        stats = _grade_stats(records)
        if all(record.synthetic for record in records):
            notes.add(f"Grade data for instructor '{key}' is synthetic and representative.")

    return VibesResponse(
        instructor=key,
        rmp=rmp_payload,
        tags=tags,
        grade_stats=stats,
        confidence=_vibes_confidence(rmp_entry, records),
        data_notes=notes.as_list(),
    )
