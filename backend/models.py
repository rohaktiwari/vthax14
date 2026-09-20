"""Pydantic models: data-file schemas (PRD 5) and the API contract (PRD 6).

Contract rule: request/response models are the frontend contract. Fields may be
added later but are never renamed once checked in.

Schema rule: anything enforced by a model in this module is a *schema* rule and is
fatal in both strict and lenient mode (PRD 5.6 step 1). Cross-record and cross-file
rules live in ``data.py``.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

import config

# ---------------------------------------------------------------------------
# Shared enums / scalar types
# ---------------------------------------------------------------------------

Confidence = Literal["high", "medium", "low"]
Weekday = Literal["M", "T", "W", "R", "F", "S", "U"]
ScheduleType = Literal["Lecture", "Lab", "Recitation", "Independent Study"]
Modality = Literal["f2f", "hybrid", "online_sync", "online_async"]
GradeMode = Literal["standard", "pass_fail"]
Term = Literal["Fall", "Spring", "Winter", "Summer I", "Summer II"]
BuildingSource = Literal["google_places", "geocode", "manual_fix"]
# Committed walk entries carry one of these two sources; ``default_fallback`` only
# ever appears at runtime for pairs missing from the matrix.
WalkFileSource = Literal["google_routes", "manual_override"]
WalkSource = Literal["google_routes", "manual_override", "default_fallback"]
FactorType = Literal[
    "workload_collision",
    "back_to_back_density",
    "commute",
    "grade_volatility",
    "difficulty_load",
]
CommuteVerdict = Literal["comfortable", "tight", "impossible"]
GpaExclusionReason = Literal["pass_fail", "no_grade_history"]
StressImpact = Literal["low", "medium", "high"]
StressScenarioType = Literal["miss_week"]


def _require_nonblank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


NonBlankStr = Annotated[str, AfterValidator(_require_nonblank)]


# ---------------------------------------------------------------------------
# Instructor normalization (shared by loader, models, and pipeline scripts)
# ---------------------------------------------------------------------------


def normalize_instructor_key(name: str) -> str:
    """Instructor join key: last whitespace-delimited token, lowercased, punctuation removed.

    ``"Olatunde Emebo" -> "emebo"``, ``"Jane Smith-Jones" -> "smithjones"``.
    Returns ``""`` for blank input.
    """
    tokens = name.split()
    if not tokens:
        return ""
    last = tokens[-1].lower()
    return "".join(ch for ch in last if not unicodedata.category(ch).startswith("P"))


def is_tba_instructor(name: str) -> bool:
    """True for "to be announced" placeholders that never participate in joins."""
    return name.strip().lower() in config.TBA_INSTRUCTOR_TOKENS


def instructor_key_or_none(name: str) -> str | None:
    """Join key for ``name`` or ``None`` when the name is TBA/blank."""
    if is_tba_instructor(name):
        return None
    key = normalize_instructor_key(name)
    return key or None


def normalize_full_name(name: str) -> str:
    """Whitespace-collapsed, case-folded full name used to decide whether two
    instructor strings denote the same person for collision detection."""
    return " ".join(name.split()).casefold()


# ---------------------------------------------------------------------------
# Base classes
# ---------------------------------------------------------------------------


class HokieModel(BaseModel):
    """Base for contract models: unknown fields are rejected."""

    model_config = ConfigDict(extra="forbid")


class FrozenModel(HokieModel):
    """Base for data-file records held in the immutable ``DataContext``."""

    model_config = ConfigDict(extra="forbid", frozen=True)


# ---------------------------------------------------------------------------
# Provenance models (PRD 4.1)
# ---------------------------------------------------------------------------


class SectionMeta(FrozenModel):
    source: Literal["banner_class_search"]
    verified: bool
    confidence: Confidence
    fetched_at: AwareDatetime | None = None


class GradeMeta(FrozenModel):
    source: NonBlankStr
    confidence: Confidence
    verified: bool | None = None
    fetched_at: AwareDatetime | None = None

    @property
    def synthetic(self) -> bool:
        return self.source == config.SYNTHETIC_SOURCE


class RmpMeta(FrozenModel):
    source: NonBlankStr
    confidence: Confidence
    verified: bool | None = None
    fetched_at: AwareDatetime | None = None

    @property
    def synthetic(self) -> bool:
        return self.source == config.SYNTHETIC_SOURCE


# ---------------------------------------------------------------------------
# sections.json (PRD 5.1)
# ---------------------------------------------------------------------------


class Meeting(FrozenModel):
    days: list[Weekday] = Field(min_length=1)
    start_min: int = Field(ge=0)
    end_min: int = Field(le=config.MINUTES_PER_DAY)
    building: str | None  # uppercase code, or null for online/location-unspecified
    room: str | None = None
    start_date: date
    end_date: date

    @field_validator("days")
    @classmethod
    def _unique_days(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value):
            raise ValueError("days must not repeat")
        return value

    @field_validator("building")
    @classmethod
    def _nonblank_building(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("building must be a code or null, not blank")
        return value

    @model_validator(mode="after")
    def _check_ranges(self) -> Meeting:
        if not self.start_min < self.end_min:
            raise ValueError("start_min must be less than end_min")
        if self.start_date > self.end_date:
            raise ValueError("start_date must not be after end_date")
        return self

    @property
    def is_physical(self) -> bool:
        return self.building is not None


class Seats(FrozenModel):
    max: int = Field(ge=0)
    available: int = Field(ge=0)

    @model_validator(mode="after")
    def _available_within_max(self) -> Seats:
        if self.available > self.max:
            raise ValueError("seats.available must not exceed seats.max")
        return self


class Section(FrozenModel):
    crn: NonBlankStr
    term_id: NonBlankStr
    course_id: NonBlankStr
    subject: NonBlankStr
    course_no: NonBlankStr
    title: NonBlankStr
    credits: float = Field(gt=0)
    instructor_names: list[NonBlankStr]
    schedule_type: ScheduleType
    modality: Modality
    grade_mode: GradeMode
    campus: Literal["Blacksburg"]
    seats: Seats
    description: str | None = None
    prereqs_text: str | None = None
    comments: str | None = None
    meetings: list[Meeting]
    meta: SectionMeta

    @field_validator("subject")
    @classmethod
    def _uppercase_subject(cls, value: str) -> str:
        if value != value.upper():
            raise ValueError("subject must be uppercase")
        return value

    @model_validator(mode="after")
    def _course_id_matches_parts(self) -> Section:
        expected = f"{self.subject} {self.course_no}"
        if self.course_id != expected:
            raise ValueError(f"course_id must equal 'SUBJECT COURSE_NO' ({expected!r})")
        return self

    @property
    def primary_instructor_name(self) -> str | None:
        return self.instructor_names[0] if self.instructor_names else None

    @property
    def primary_instructor_key(self) -> str | None:
        """Join key of ``instructor_names[0]``; ``None`` for TBA or empty lists."""
        name = self.primary_instructor_name
        return None if name is None else instructor_key_or_none(name)

    @property
    def instructor_keys(self) -> tuple[str, ...]:
        """Deduplicated join keys of every non-TBA instructor, in listed order."""
        keys: list[str] = []
        for name in self.instructor_names:
            key = instructor_key_or_none(name)
            if key is not None and key not in keys:
                keys.append(key)
        return tuple(keys)


# ---------------------------------------------------------------------------
# grade_records.json (PRD 5.2)
# ---------------------------------------------------------------------------

_ACADEMIC_YEAR_RE = re.compile(r"(\d{4})-(\d{2})")


class GradeRecord(FrozenModel):
    academic_year: str
    term: Term
    subject: NonBlankStr
    course_no: NonBlankStr
    course_id: NonBlankStr
    course_title: NonBlankStr
    instructor: NonBlankStr  # normalized join key
    gpa: float = Field(ge=0.0, le=4.0)
    dist: dict[str, float]
    withdraws: int = Field(ge=0)
    graded_enrollment: int = Field(gt=0)
    crn: NonBlankStr  # historical identifier, never a section join key
    credits: float = Field(gt=0)
    meta: GradeMeta

    @field_validator("academic_year")
    @classmethod
    def _academic_year_format(cls, value: str) -> str:
        match = _ACADEMIC_YEAR_RE.fullmatch(value)
        if match is None:
            raise ValueError("academic_year must use the format YYYY-YY, e.g. 2025-26")
        start_year = int(match.group(1))
        if (start_year + 1) % 100 != int(match.group(2)):
            raise ValueError("academic_year must span consecutive years, e.g. 2025-26")
        return value

    @field_validator("instructor")
    @classmethod
    def _normalized_instructor(cls, value: str) -> str:
        if normalize_instructor_key(value) != value:
            raise ValueError(
                "instructor must be a normalized join key "
                "(lowercase last-name token without punctuation)"
            )
        return value

    @field_validator("dist")
    @classmethod
    def _distribution(cls, value: dict[str, float]) -> dict[str, float]:
        expected = set(config.GRADE_KEYS)
        if set(value) != expected:
            raise ValueError(f"dist must contain exactly the keys {list(config.GRADE_KEYS)}")
        for key, pct in value.items():
            if not 0.0 <= pct <= 100.0:
                raise ValueError(f"dist[{key!r}] must be a percentage within [0, 100]")
        total = sum(value.values())
        if abs(total - 100.0) > config.DIST_SUM_TOLERANCE:
            raise ValueError(
                f"dist must sum to 100 +/- {config.DIST_SUM_TOLERANCE}, got {total:.2f}"
            )
        return value

    @model_validator(mode="after")
    def _course_id_matches_parts(self) -> GradeRecord:
        expected = f"{self.subject} {self.course_no}"
        if self.course_id != expected:
            raise ValueError(f"course_id must equal 'SUBJECT COURSE_NO' ({expected!r})")
        return self

    @property
    def identity(self) -> tuple[str, str, str, str, str]:
        return (self.course_id, self.instructor, self.academic_year, self.term, self.crn)

    @property
    def synthetic(self) -> bool:
        return self.meta.synthetic


# ---------------------------------------------------------------------------
# rmp.json (PRD 5.3)
# ---------------------------------------------------------------------------


def _dedupe_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


class RmpEntry(FrozenModel):
    full_name: NonBlankStr
    score: float = Field(ge=1.0, le=5.0)
    difficulty: float = Field(ge=1.0, le=5.0)
    n_reviews: int = Field(ge=0)
    would_take_again: float | None = Field(default=None, ge=0.0, le=100.0)
    tags: list[str] = Field(default_factory=list)
    comments: list[str] = Field(default_factory=list)
    meta: RmpMeta

    @field_validator("tags", "comments")
    @classmethod
    def _dedupe(cls, value: list[str]) -> list[str]:
        return _dedupe_preserving_order(value)


# ---------------------------------------------------------------------------
# buildings.json (PRD 5.4) and walk_matrix.json (PRD 5.5)
# ---------------------------------------------------------------------------


class Building(FrozenModel):
    name: NonBlankStr
    place_id: str | None = None
    lat: float = Field(ge=-90.0, le=90.0)
    lng: float = Field(ge=-180.0, le=180.0)
    address: str | None = None
    verified: bool
    source: BuildingSource
    fetched_at: AwareDatetime | None = None


class WalkEntry(FrozenModel):
    minutes: int = Field(ge=0)
    meters: int = Field(ge=0)
    source: WalkFileSource
    fetched_at: AwareDatetime | None = None


# ---------------------------------------------------------------------------
# Demo fixtures (PRD 6.8; files live in tests/fixtures/)
# ---------------------------------------------------------------------------


class DemoSchedule(FrozenModel):
    crns: list[NonBlankStr]
    label: NonBlankStr


class DemoSwap(FrozenModel):
    current_crns: list[NonBlankStr]
    drop_crn: NonBlankStr
    add_crn: NonBlankStr


# ---------------------------------------------------------------------------
# Boot statistics (PRD 5.6) and GET /api/health (PRD 6.7)
# ---------------------------------------------------------------------------


class BootStats(HokieModel):
    sections: int
    grade_records: int
    instructors: int  # unique non-TBA instructor join keys
    buildings: int
    walk_pairs: int
    synthetic_rows: int  # synthetic grade records only
    warnings: int


class HealthResponse(HokieModel):
    status: Literal["ok"]
    term_id: str
    sections: int
    grade_records: int
    instructors: int
    buildings: int
    walk_pairs: int
    synthetic_rows: int
    warnings: int


# ---------------------------------------------------------------------------
# GET /api/courses/search (PRD 6.1)
# ---------------------------------------------------------------------------


class CourseSearchQuery(BaseModel):
    """Query parameters. Unknown query parameters are ignored."""

    model_config = ConfigDict(extra="ignore")

    q: str | None = Field(
        default=None,
        description=(
            "Case-insensitive substring matched against course_id, title, and instructor names"
        ),
    )
    subject: str | None = Field(default=None, description="Case-insensitive exact subject match")
    limit: int = Field(
        default=config.SEARCH_DEFAULT_LIMIT,
        ge=config.SEARCH_MIN_LIMIT,
        le=config.SEARCH_MAX_LIMIT,
        description="Maximum number of course groups",
    )


class CourseGroup(HokieModel):
    course_id: str
    title: str
    credits: float
    sections: list[Section]


class CourseSearchResponse(HokieModel):
    courses: list[CourseGroup]


# ---------------------------------------------------------------------------
# GET /api/buildings/matrix (PRD 6.2)
# ---------------------------------------------------------------------------


class BuildingsMatrixQuery(BaseModel):
    """Query parameters. Unknown query parameters are ignored."""

    model_config = ConfigDict(extra="ignore")

    include_meta: bool = Field(
        default=False, description="Return full walk_matrix.json objects instead of minutes"
    )


class BuildingsMatrixResponse(HokieModel):
    buildings: dict[str, Building]
    walk: dict[str, int | WalkEntry]  # minutes by default; WalkEntry objects with include_meta


# ---------------------------------------------------------------------------
# POST /api/analyze (PRD 6.3)
# ---------------------------------------------------------------------------


def _reject_duplicate_crns(value: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: list[str] = []
    for crn in value:
        if crn in seen and crn not in duplicates:
            duplicates.append(crn)
        seen.add(crn)
    if duplicates:
        raise ValueError(f"duplicate CRNs are not allowed: {', '.join(duplicates)}")
    return value


CrnList = Annotated[
    list[NonBlankStr],
    Field(min_length=config.MIN_ANALYZE_CRNS, max_length=config.MAX_ANALYZE_CRNS),
    AfterValidator(_reject_duplicate_crns),
]


class AnalyzeRequest(HokieModel):
    crns: CrnList


class RiskFactor(HokieModel):
    type: FactorType
    severity: float  # one decimal place, clamped to max_severity
    max_severity: float  # always 100 * W[type]
    detail: str
    affected_crns: list[str]


class CommuteFrom(HokieModel):
    crn: str
    building: str
    ends: str  # HH:MM


class CommuteTo(HokieModel):
    crn: str
    building: str
    starts: str  # HH:MM


class CommuteWarning(HokieModel):
    model_config = ConfigDict(extra="forbid", validate_by_name=True, validate_by_alias=True)

    day: Weekday
    from_: CommuteFrom = Field(alias="from")
    to: CommuteTo
    walk_min: int
    adjusted_walk_min: int
    gap_min: int
    verdict: CommuteVerdict  # the warning list only ever contains tight/impossible
    source: WalkSource
    detail: str


class GpaExclusion(HokieModel):
    crn: str
    reason: GpaExclusionReason


class ExpectedGpa(HokieModel):
    range: tuple[float, float] | None
    mean: float | None
    confidence: Confidence
    n_students: int
    n_terms: int
    excluded: list[GpaExclusion]


class AnalysisMeta(HokieModel):
    term_id: str
    data_notes: list[str]
    heuristic: bool = True


class AnalyzeResponse(HokieModel):
    risk_score: int
    sections: list[Section]  # request CRN order
    factors: list[RiskFactor]  # configured factor order; always all five
    commute_warnings: list[CommuteWarning]  # tight/impossible only; day, start, CRN order
    expected_gpa: ExpectedGpa
    meta: AnalysisMeta


# ---------------------------------------------------------------------------
# POST /api/swap (PRD 6.4)
# ---------------------------------------------------------------------------


class SwapRequest(HokieModel):
    current_crns: CrnList
    drop_crn: NonBlankStr
    add_crn: NonBlankStr


class SwapSummary(HokieModel):
    risk: str  # e.g. "74 -> 58" rendered as "74 → 58"
    resolved_warnings: int
    new_warnings: int


class SwapResponse(HokieModel):
    before: AnalyzeResponse
    after: AnalyzeResponse
    delta: int  # after.risk_score - before.risk_score
    summary: SwapSummary


# ---------------------------------------------------------------------------
# POST /api/stress (PRD 6.5)
# ---------------------------------------------------------------------------


class StressRequest(HokieModel):
    crns: CrnList
    scenario: StressScenarioType
    week: int = Field(ge=config.STRESS_WEEK_MIN, le=config.STRESS_WEEK_MAX)


class StressScenario(HokieModel):
    type: StressScenarioType
    week: int


class StressPenalty(HokieModel):
    crn: str
    course_id: str
    points: int
    impact: StressImpact
    reason: str


class StressMeta(HokieModel):
    heuristic: bool = True
    note: str


class StressResponse(HokieModel):
    analysis: AnalyzeResponse
    scenario: StressScenario
    original_risk: int
    stressed_risk: int
    delta: int
    penalties: list[StressPenalty]
    meta: StressMeta


# ---------------------------------------------------------------------------
# GET /api/professors/{surname}/vibes (PRD 6.6)
# ---------------------------------------------------------------------------


class VibesRmp(HokieModel):
    score: float
    difficulty: float
    n_reviews: int
    would_take_again: float | None


class VibesGradeStats(HokieModel):
    avg_gpa: float | None
    volatility: float | None
    n_sections: int
    n_students: int
    a_rate: float | None


class VibesResponse(HokieModel):
    instructor: str  # normalized join key
    rmp: VibesRmp | None  # null when the instructor has no RMP entry
    tags: list[str]
    grade_stats: VibesGradeStats  # zero counts / null stats when no grade records
    confidence: Confidence
    data_notes: list[str]


# ---------------------------------------------------------------------------
# GET /api/demo/schedules (PRD 6.8)
# ---------------------------------------------------------------------------


class DemoSchedulesResponse(HokieModel):
    brutal: DemoSchedule
    easy: DemoSchedule
    swap_demo: DemoSwap


# ---------------------------------------------------------------------------
# Error contract (PRD 6)
# ---------------------------------------------------------------------------


class MeetingConflict(HokieModel):
    crns: list[str]  # the two conflicting CRNs
    day: Weekday
    start: str  # HH:MM start of the overlapping interval
    end: str  # HH:MM end of the overlapping interval


class ConflictErrorDetail(HokieModel):
    code: Literal["meeting_overlap"]
    message: str
    conflicts: list[MeetingConflict]


class ErrorResponse(HokieModel):
    """Every error body: ``detail`` is a human-readable string, or a structured
    object when machine-readable conflict information is required."""

    detail: str | ConflictErrorDetail
