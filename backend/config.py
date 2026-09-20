"""HokieLens configuration: the single source of truth for weights and constants.

Rules (PRD 7.1, PRD 4, and the delivery amendments):

* ``W`` holds the risk-factor weights. They must sum to 1.0; this is checked at
  import time so a bad edit fails loudly before the server boots.
* A factor's maximum severity is always ``100 * W[factor]`` and is obtained via
  :func:`factor_max_severity`. Maxima are never hardcoded a second time.
* Runtime settings come from plain environment variables read through
  :meth:`Settings.from_env`. The running server never reads ``.env`` files or
  API keys. ``python-dotenv`` is never imported (standing no-dotenv rule).
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

# ---------------------------------------------------------------------------
# Backend package layout (paths resolve relative to this file, not the CWD)
# ---------------------------------------------------------------------------

REPO_ROOT: Path = Path(__file__).resolve().parent
DEFAULT_DATA_DIR: Path = REPO_ROOT / "data"
DEFAULT_FIXTURES_DIR: Path = REPO_ROOT / "tests" / "fixtures"

SECTIONS_FILE = "sections.json"
GRADE_RECORDS_FILE = "grade_records.json"
RMP_FILE = "rmp.json"
BUILDINGS_FILE = "buildings.json"
WALK_MATRIX_FILE = "walk_matrix.json"

DEMO_EASY_FILE = "schedule_easy.json"
DEMO_BRUTAL_FILE = "schedule_brutal.json"
DEMO_SWAP_FILE = "swap_demo.json"

DEFAULT_CATALOG_TERM_ID = "2026-fall"

# ---------------------------------------------------------------------------
# Risk engine weights and constants (PRD 7.1)
# ---------------------------------------------------------------------------

W: Mapping[str, float] = {
    "workload_collision": 0.30,
    "back_to_back_density": 0.25,
    "commute": 0.20,
    "grade_volatility": 0.15,
    "difficulty_load": 0.10,
}

# Configured factor order: the analyze response always lists factors in this order.
FACTOR_ORDER: tuple[str, ...] = tuple(W)

HARD_DIFFICULTY = 3.5
DEFAULT_DIFFICULTY = 3.0
DEFAULT_WALK_MIN = 12
WALK_OPTIMISM_MIN = 2
WALK_COMFORT_SLACK_MIN = 2
WALK_TIGHT_DEFICIT_MAX = 5
VOLATILITY_MAX_SIGMA = 0.8
STRESS_MAX_UPLIFT = 30
PASS_FAIL_EXCLUDE_FROM_GPA = True
MAX_VIBE_TAGS = 6

# Display precision (PRD 4). Risk scores are integers; factor severities are
# one decimal. GPAs/volatility are two decimals; percentages are one decimal.
GPA_DISPLAY_DECIMALS = 2
PERCENT_DISPLAY_DECIMALS = 1

RISK_SCORE_MIN = 0
RISK_SCORE_MAX = 100

WEIGHT_SUM_TOLERANCE = 1e-9

# ---------------------------------------------------------------------------
# Factor 1 — workload_collision (PRD 7.4)
# ---------------------------------------------------------------------------

# heavy_count_ratio = min(1, heavy_sections / 3); heavy_credit_ratio = min(1, heavy_credits / 15)
WORKLOAD_HEAVY_SECTIONS_FULL = 3
WORKLOAD_HEAVY_CREDITS_FULL = 15.0

# ---------------------------------------------------------------------------
# Factor 2 — back_to_back_density (PRD 7.5)
# ---------------------------------------------------------------------------

DENSITY_FREE_CONTACT_HOURS = 4.0  # day_score += max(0, contact_hours - 4)
DENSITY_TIGHT_GAP_MAX_MIN = 10  # adjacent meetings 0..10 minutes apart are a tight pair
DENSITY_TIGHT_PAIR_POINTS = 2.0
DENSITY_BLOCK_HOURS = 3.0  # an unbroken block of at least 3 hours adds DENSITY_BLOCK_POINTS
DENSITY_BLOCK_POINTS = 3.0
DENSITY_FULL_SCORE = 15.0  # severity = max_severity * min(1, weekly_total / 15)

# ---------------------------------------------------------------------------
# Factor 4 — grade_volatility (PRD 7.7)
# ---------------------------------------------------------------------------

VOLATILITY_MIN_RECORDS = 3  # instructor-specific records required per section

# ---------------------------------------------------------------------------
# Factor 5 — difficulty_load (PRD 7.8)
# ---------------------------------------------------------------------------

DIFFICULTY_LOAD_BASELINE = 2.5  # severity = max * clamp((mean - 2.5) / 2.0, 0, 1)
DIFFICULTY_LOAD_RANGE = 2.0

# ---------------------------------------------------------------------------
# Expected GPA (PRD 7.9)
# ---------------------------------------------------------------------------

GPA_SCALE_MIN = 0.0
GPA_SCALE_MAX = 4.0
GPA_MIN_HALF_WIDTH = 0.15  # half_width = max(0.15, combined_sigma)
GPA_HIGH_MIN_TERMS_PER_SECTION = 5
GPA_HIGH_MIN_STUDENTS = 500
GPA_MEDIUM_MIN_STUDENTS = 150

# ---------------------------------------------------------------------------
# Calibration bands and exact fixture scores (PRD 10.2 / 10.4) — asserted by
# tests against the committed demo fixtures. These are acceptance criteria,
# not API response fields, and production code must not branch on them.
#
# 2026-09-19: W and the PRD 7.4–7.8 formula constants were left at their
# specified values. The calibrated synthetic catalog was packed so a realistic
# "easy" schedule (one heavy CS, discrete math across campus 10 minutes later,
# one pass/fail) lands in 25–45 and the "brutal" stack (that pair plus a third
# tight MWF hop and a tight TR physics follow-on, plus ≥3 instructor grade
# records per course) lands in 65–85. Exact scores below are the current
# committed outputs; they change only if a PRD-required data correction lands.
# risk.py never branches on fixture names.
# ---------------------------------------------------------------------------

EASY_FIXTURE_RISK_BAND = (25, 45)
BRUTAL_FIXTURE_RISK_BAND = (65, 85)
EASY_FIXTURE_EXPECTED_SCORE = 41
BRUTAL_FIXTURE_EXPECTED_SCORE = 84
SWAP_DEMO_MIN_IMPROVEMENT = 10  # swap_demo must lower risk by at least this much
SWAP_DEMO_BEFORE_SCORE = 49
SWAP_DEMO_AFTER_SCORE = 19
EASY_STRESS_STRESSED_SCORE = 46  # week-8 miss_week on schedule_easy
EASY_STRESS_DELTA = 5

# ---------------------------------------------------------------------------
# Commute classification (PRD 7.6)
# ---------------------------------------------------------------------------

# Points per transition by verdict; the commute factor is min(max_severity, sum).
COMMUTE_TRANSITION_POINTS: Mapping[str, float] = {
    "comfortable": 0.0,
    "tight": 3.5,
    "impossible": 7.0,
}

# Only these verdicts are returned in ``commute_warnings``; comfortable transitions
# are classified but omitted from the warning list.
COMMUTE_WARNING_VERDICTS: tuple[str, ...] = ("tight", "impossible")

# Human-readable provenance labels for commute ``detail`` strings. Non-Google
# values must never be described as Google data.
WALK_SOURCE_LABELS: Mapping[str, str] = {
    "google_routes": "Google Routes",
    "manual_override": "manual override",
    "default_fallback": "default fallback",
}

# ---------------------------------------------------------------------------
# Schedule validation and swap (PRD 6.3, 6.4)
# ---------------------------------------------------------------------------

MEETING_OVERLAP_CODE = "meeting_overlap"
MEETING_OVERLAP_MESSAGE = "Selected sections overlap"

# ``summary.risk`` in the swap response, e.g. "74 → 58".
SWAP_RISK_SUMMARY_FORMAT = "{before} → {after}"


def factor_max_severity(factor: str) -> float:
    """Return the maximum severity for ``factor``: ``100 * W[factor]`` (PRD 7.1)."""
    return RISK_SCORE_MAX * W[factor]


def validate_weights(weights: Mapping[str, float] = W) -> None:
    """Fail loudly unless the weights are positive and sum to 1.0."""
    if not weights:
        raise ValueError("W must define at least one risk factor")
    for name, weight in weights.items():
        if weight <= 0:
            raise ValueError(f"W[{name!r}] must be positive, got {weight}")
    total = sum(weights.values())
    if abs(total - 1.0) > WEIGHT_SUM_TOLERANCE:
        raise ValueError(f"risk weights W must sum to 1.0, got {total}")


validate_weights()

# ---------------------------------------------------------------------------
# API contract constants (PRD 6)
# ---------------------------------------------------------------------------

MIN_ANALYZE_CRNS = 2
MAX_ANALYZE_CRNS = 12

SEARCH_DEFAULT_LIMIT = 20
SEARCH_MIN_LIMIT = 1
SEARCH_MAX_LIMIT = 100

STRESS_WEEK_MIN = 1
STRESS_WEEK_MAX = 16
STRESS_SCENARIO_MISS_WEEK = "miss_week"
STRESS_HARD_DIFFICULTY_POINTS = 5
STRESS_HIGH_CREDIT_POINTS = 3
STRESS_HIGH_CREDIT_MIN = 4.0
STRESS_LAB_RECITATION_POINTS = 2
STRESS_LAB_RECITATION_TYPES: frozenset[str] = frozenset({"Lab", "Recitation"})
STRESS_SECTION_POINTS_CAP = 10
STRESS_IMPACT_LOW_MAX = 3  # 1–3 low; 4–6 medium; 7–10 high
STRESS_IMPACT_MEDIUM_MAX = 6
STRESS_HEURISTIC_NOTE = "This scenario is a deterministic planning heuristic, not a prediction."

# Ordered canonical tag -> keyword phrases (PRD 6.6). A tag is emitted when any
# phrase appears as a case-insensitive substring of an individual RMP tag or
# comment. Configured order is preserved; at most MAX_VIBE_TAGS tags are emitted.
VIBE_TAG_LEXICON: Mapping[str, tuple[str, ...]] = {
    "curves": ("curves", "curve"),
    "exams match homework": (
        "exams match homework",
        "exams mirror the homework",
        "exams match the homework",
    ),
    "tough grader": ("tough grader",),
    "lots of reading": ("get ready to read", "lots of reading"),
    "lecture heavy": ("lecture heavy",),
    "test heavy": ("test heavy",),
    "caring": ("caring",),
    "clear grading": ("clear grading criteria", "clear grading"),
    "inspirational": ("inspirational",),
    "rigorous": ("expects rigor", "rigor"),
}

VIBES_HIGH_MIN_REVIEWS = 20
VIBES_HIGH_MIN_GRADE_RECORDS = 3
VIBES_MEDIUM_MIN_REVIEWS = 5
VIBES_MEDIUM_MIN_GRADE_RECORDS = 3
VIBES_NOT_FOUND_DETAIL = "No professor data for instructor key '{key}'"

# ---------------------------------------------------------------------------
# Data conventions (PRD 4, 5)
# ---------------------------------------------------------------------------

WEEKDAY_ORDER: tuple[str, ...] = ("M", "T", "W", "R", "F", "S", "U")
GRADE_KEYS: tuple[str, ...] = ("A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F")
DIST_SUM_TOLERANCE = 1.0  # distribution percentages must sum to 100 +/- this
MINUTES_PER_DAY = 1440

# walk_matrix.json keys are ``CODE_A|CODE_B`` with ``CODE_A < CODE_B`` (PRD 5.5).
WALK_KEY_SEPARATOR = "|"

# Grade/RMP records whose ``meta.source`` equals this value are synthetic filler
# (emitted by ``parse_udc.py --synthetic``) and are counted as ``synthetic_rows``.
SYNTHETIC_SOURCE = "synthetic_filler"

# Instructor names equal to one of these tokens (case-insensitive, stripped) are
# "to be announced" and are excluded from every instructor join (PRD 5.1).
TBA_INSTRUCTOR_TOKENS: frozenset[str] = frozenset({"tba"})

# ---------------------------------------------------------------------------
# Offline pipeline (PRD 8). The server never imports scripts/ or these paths.
# ---------------------------------------------------------------------------

RAW_DIR = DEFAULT_DATA_DIR / "raw"
RAW_UDC_DIR = RAW_DIR / "udc"
RAW_SECTIONS_DIR = RAW_DIR / "sections"
RAW_RMP_DIR = RAW_DIR / "rmp"
RAW_SEED_DIR = RAW_DIR / "seed"
BUILDINGS_SEED_FILE = "buildings_seed.json"

PIPELINE_JSON_INDENT = 2
UDC_SOURCE = "udc_vt_edu"
UDC_CONFIDENCE = "high"
UDC_COLUMNS: tuple[str, ...] = (
    "Year",
    "Term",
    "Subject",
    "CourseNo",
    "Title",
    "Instructor",
    "GPA",
    "A",
    "A-",
    "B+",
    "B",
    "B-",
    "C+",
    "C",
    "C-",
    "D+",
    "D",
    "D-",
    "F",
    "Withdraws",
    "GradedEnrollment",
    "CRN",
    "Credits",
)
UDC_COLUMN_COUNT = len(UDC_COLUMNS)

# Longest-token day mapping (PRD 8.2). Tried longest-first so "Th" → R.
DAY_NAME_TOKENS: tuple[tuple[str, str], ...] = tuple(
    sorted(
        (
            ("thursday", "R"),
            ("saturday", "S"),
            ("wednesday", "W"),
            ("tuesday", "T"),
            ("monday", "M"),
            ("friday", "F"),
            ("sunday", "U"),
            ("thurs", "R"),
            ("tues", "T"),
            ("thur", "R"),
            ("wed", "W"),
            ("mon", "M"),
            ("tue", "T"),
            ("fri", "F"),
            ("sat", "S"),
            ("sun", "U"),
            ("thu", "R"),
            ("th", "R"),
            ("tu", "T"),
            ("sa", "S"),
            ("su", "U"),
            ("m", "M"),
            ("t", "T"),
            ("w", "W"),
            ("r", "R"),
            ("f", "F"),
            ("s", "S"),
            ("u", "U"),
        ),
        key=lambda item: (-len(item[0]), item[0]),
    )
)

ONLINE_LOCATION_TOKENS: frozenset[str] = frozenset(
    {"", "-", "online", "web", "www", "async", "arranged", "arr", "tba", "n/a", "na"}
)

SECTION_META_SOURCE = "banner_class_search"
RMP_PASTE_SOURCE = "rmp_paste"
RMP_PASTE_CONFIDENCE = "medium"

ENV_GOOGLE_MAPS_API_KEY = "GOOGLE_MAPS_API_KEY"
GOOGLE_HTTP_TIMEOUT_SEC = 10.0
GOOGLE_HTTP_RETRIES = 1
CAMPUS_CENTER_LAT = 37.2295
CAMPUS_CENTER_LNG = -80.4210
BUILDING_FLAG_RADIUS_KM = 1.5
ROUTES_MATRIX_MAX_ELEMENTS = 25  # destinations per one-origin request
GOOGLE_PLACES_FIND_URL = "https://maps.googleapis.com/maps/api/place/findplacefromtext/json"
GOOGLE_ROUTES_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"
BLACKSBURG_QUERY_SUFFIX = ", Blacksburg VA"

# ---------------------------------------------------------------------------
# Environment flags (read from os.environ only; never from .env)
# ---------------------------------------------------------------------------

ENV_CATALOG_TERM_ID = "CATALOG_TERM_ID"
ENV_LENIENT = "HOKIELENS_LENIENT"
ENV_STUB_ANALYZE = "HOKIELENS_STUB_ANALYZE"

_TRUE_TOKENS = frozenset({"1", "true", "yes", "on"})
_FALSE_TOKENS = frozenset({"0", "false", "no", "off"})


def parse_bool_flag(name: str, raw: str | None, default: bool = False) -> bool:
    """Parse a boolean environment flag.

    Accepted (case-insensitive): ``1/true/yes/on`` and ``0/false/no/off``.
    An unset or empty value yields ``default``. Anything else raises ``ValueError``
    so a typo cannot silently enable or disable a mode.
    """
    if raw is None:
        return default
    token = raw.strip().lower()
    if token == "":
        return default
    if token in _TRUE_TOKENS:
        return True
    if token in _FALSE_TOKENS:
        return False
    raise ValueError(
        f"{name}={raw!r} is not a boolean flag; use 1/0, true/false, yes/no, or on/off"
    )


@dataclass(frozen=True)
class Settings:
    """Immutable runtime settings.

    ``data_dir`` and ``fixtures_dir`` are not environment-configurable; tests pass
    them explicitly through :func:`main.create_app`.
    """

    catalog_term_id: str = DEFAULT_CATALOG_TERM_ID
    lenient: bool = False
    stub_analyze: bool = False
    data_dir: Path = DEFAULT_DATA_DIR
    fixtures_dir: Path = DEFAULT_FIXTURES_DIR

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> Settings:
        """Build settings from environment variables (defaults: strict, stub off)."""
        env = os.environ if environ is None else environ
        term_id = (env.get(ENV_CATALOG_TERM_ID) or "").strip() or DEFAULT_CATALOG_TERM_ID
        return cls(
            catalog_term_id=term_id,
            lenient=parse_bool_flag(ENV_LENIENT, env.get(ENV_LENIENT), default=False),
            stub_analyze=parse_bool_flag(
                ENV_STUB_ANALYZE, env.get(ENV_STUB_ANALYZE), default=False
            ),
        )
