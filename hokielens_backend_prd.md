# HokieLens — Backend PRD (v2)

> **Audience:** AI-assisted implementation (Cursor).
> **Context:** 36-hour hackathon; backend-only scope. The frontend is a separate team's responsibility. This backend must provide a stable, documented API and committed data files.
> **Implementation rule:** Where implementation detail is not specified, choose the simplest deterministic implementation that satisfies this contract. Do not silently invent product behavior; document assumptions in code comments or the README.

---

## 0. Review Summary and v1 Corrections

The v1 concept and architecture are strong and appropriately scoped for a hackathon. The following issues were corrected in v2 because they could otherwise cause incompatible implementations or misleading results:

1. **Semester identity was missing.** The server now explicitly serves one configured catalog term, and every section carries `term_id`.
2. **Surname joins can silently merge different instructors.** The dataset may continue using surname keys for hackathon simplicity, but the loader now rejects surname collisions among distinct instructors.
3. **Team-taught sections were ambiguous.** The first instructor is explicitly the primary instructor used for grades, RMP difficulty, and risk calculations; all instructors remain searchable.
4. **Hybrid meeting validation was contradictory.** Building requirements are now enforced per meeting rather than per section modality.
5. **Risk weights and hard-coded maxima duplicated the same configuration.** Factor maxima are now derived from `W`, making `config.py` the single source of truth.
6. **Several formulas were underspecified.** Workload scaling, weighted standard deviation, expected-GPA aggregation, rounding, and confidence rules are now exact.
7. **Commute bands had an uncovered interval.** The adjusted-walk calculation and all verdict boundaries are now explicit.
8. **Stress behavior was internally inconsistent.** Stress now produces a base analysis plus a deterministic scenario penalty, rather than pretending to be a probabilistic model.
9. **Error response requirements conflicted.** Errors always use FastAPI's `detail` field, which may be a string or structured object when conflict details are required.
10. **`/health` conflicted with `/api/health`.** `/api/health` is canonical; `/health` is an optional compatibility alias and is not part of the frontend contract.
11. **Endpoint counting was inconsistent.** There are eight required endpoints when the demo endpoint is included.
12. **Course grouping assumed all sections had identical course metadata.** The loader now validates course-level consistency.
13. **Pipeline idempotency and timestamp behavior were unclear.** Scripts now use stable ordering, atomic writes, and replacement rather than append behavior.
14. **Google route-matrix batching was not implementable as arbitrary pair chunks.** The pipeline now sends one origin with chunks of later destinations and retains one alphabetical-direction result per unordered pair.
15. **“Vibes mining” had no deterministic algorithm.** A small, configured keyword/tag lexicon is now required.

---

## 1. Product Summary

Build a REST API that loads pre-collected Virginia Tech course, grade, professor-review, building, and walking data from local JSON files and serves:

1. Course and section search
2. Walking-time data between campus buildings
3. A transparent composite semester risk score from 0–100 for a set of sections
4. A before/after section-swap comparison
5. A deterministic “miss a week” stress scenario
6. Professor “vibes” derived from review tags/comments
7. Stable demo fixtures for frontend development

**Mission:** Registration says courses can be taken together; HokieLens estimates what taking them together actually costs.

This product is an explanatory planning aid, not a prediction of an individual student's grades or wellbeing.

---

## 2. Stack — Fixed

| Component | Choice |
|---|---|
| Language | Python 3.11+ |
| Framework | FastAPI + Uvicorn |
| Validation | Pydantic v2 |
| Storage | JSON files loaded into memory during startup |
| Pipeline HTTP client | `httpx` |
| Environment loading | `python-dotenv` |
| YAML parsing | `PyYAML` |
| Tests | `pytest` + FastAPI `TestClient` |
| CORS | All origins, methods, and headers; `allow_credentials=False` |
| Development command | `uvicorn main:app --reload` |
| Verification command | `uvicorn main:app` |

The running server makes **zero external network calls**. Third-party APIs are used only by manually invoked offline scripts. Their JSON outputs are committed.

Use FastAPI lifespan startup, not deprecated startup-event APIs, to load and validate data exactly once.

---

## 3. Repository Structure

```text
/
├─ main.py
├─ data.py
├─ models.py
├─ risk.py
├─ config.py
├─ README.md
├─ requirements.txt
├─ data/
│  ├─ sections.json
│  ├─ grade_records.json
│  ├─ rmp.json
│  ├─ buildings.json
│  ├─ walk_matrix.json
│  └─ raw/
│     ├─ sections/
│     ├─ udc/
│     ├─ rmp/
│     └─ seed/
├─ scripts/
│  ├─ build_sections.py
│  ├─ parse_udc.py
│  ├─ build_rmp.py
│  ├─ fetch_buildings.py
│  └─ fetch_walk_matrix.py
└─ tests/
   ├─ fixtures/
   │  ├─ schedule_easy.json
   │  ├─ schedule_brutal.json
   │  └─ swap_demo.json
   ├─ test_api.py
   ├─ test_loader.py
   └─ test_risk.py
```

The server must never import anything from `scripts/`.

---

## 4. Global Data and Serialization Rules

- The server represents one registration catalog snapshot configured by `CATALOG_TERM_ID`, defaulting to `2026-fall`.
- JSON output is UTF-8 and deterministic.
- Pipeline outputs must use stable sorting:
  - sections by `(course_id, crn)`
  - grade records by `(course_id, instructor, academic_year, term, crn)`
  - object keys alphabetically
- Dates use ISO `YYYY-MM-DD` strings in files and Pydantic `date` values internally.
- Timestamps use timezone-aware ISO 8601 values.
- Date ranges are inclusive.
- User-visible times use zero-padded 24-hour `HH:MM` formatting.
- Numeric API conventions:
  - risk scores: integer
  - factor severities: one decimal place
  - GPAs and volatility: two decimal places
  - percentages: one decimal place
- All response list ordering is deterministic.
- The exact selected section order in an analysis response follows request CRN order. Factors use configured factor order. Commutes sort by weekday, start time, then CRN.

### 4.1 Provenance models

Do not force unrelated records into one overly rigid `Meta` type. Define explicit Pydantic metadata models with these shared fields where applicable:

```json
{
  "source": "source_identifier",
  "confidence": "high",
  "verified": true,
  "fetched_at": "2026-09-19T20:00:00Z"
}
```

Allowed confidence values are `high`, `medium`, and `low`, although individual data-file schemas may permit only a subset. `fetched_at` may be absent for hand-maintained or generated files when no meaningful fetch time exists.

---

## 5. Data Files

### 5.1 `sections.json`

Array of `Section` objects:

| Field | Type | Required | Rules |
|---|---:|:---:|---|
| `crn` | string | yes | Unique within the configured catalog term |
| `term_id` | string | yes | Must equal `CATALOG_TERM_ID` |
| `course_id` | string | yes | Normalized as `SUBJECT NUMBER`, e.g. `CS 2104` |
| `subject` | string | yes | Uppercase |
| `course_no` | string | yes | String, not integer |
| `title` | string | yes | Nonblank |
| `credits` | number | yes | Greater than zero |
| `instructor_names` | string[] | yes | Primary instructor first; may be empty for TBA |
| `schedule_type` | enum | yes | `Lecture`, `Lab`, `Recitation`, `Independent Study` |
| `modality` | enum | yes | `f2f`, `hybrid`, `online_sync`, `online_async` |
| `grade_mode` | enum | yes | `standard`, `pass_fail` |
| `campus` | string | yes | Literal `Blacksburg` |
| `seats` | object | yes | `{max:int, available:int}`; both nonnegative and available ≤ max |
| `description` | string | no | |
| `prereqs_text` | string | no | Raw text; never parsed |
| `comments` | string | no | |
| `meetings` | Meeting[] | yes | See meeting rules |
| `meta` | object | yes | `source="banner_class_search"`, `verified`, `confidence`, optional `fetched_at` |

For the same `course_id`, `subject`, `course_no`, `title`, and `credits` must be identical across sections. The loader errors on inconsistency. Variable-credit courses are outside the hackathon dataset.

The primary instructor is `instructor_names[0]`. It is the only instructor used for risk, grade-history, and expected-GPA joins. All instructor names participate in search and RMP coverage warnings.

Instructor join key:

```text
last whitespace-delimited token, lowercased, punctuation removed
```

Examples: `Olatunde Emebo` → `emebo`; `Jane Smith-Jones` → `smithjones`.

The loader must fail if two distinct normalized full names in the section dataset produce the same instructor join key. TBA values and empty instructor lists are excluded from instructor joins.

#### Meeting

```json
{
  "days": ["M", "W", "F"],
  "start_min": 805,
  "end_min": 855,
  "building": "MCB",
  "room": "126",
  "start_date": "2026-08-24",
  "end_date": "2026-12-16"
}
```

Rules:

- `days` is a nonempty unique subset of `M,T,W,R,F,S,U`.
- `0 <= start_min < end_min <= 1440`.
- `start_date <= end_date`.
- A meeting with a non-null building is physical; a meeting with a null building is online or location-unspecified.
- `f2f`: every meeting must have a building.
- `online_sync` and `online_async`: every meeting must have `building=null`.
- `hybrid`: physical and online meetings are both allowed, but at least one meeting must be physical.
- `online_async` may have zero meetings. Every other modality must have at least one meeting.
- Every non-null building code must exist in `buildings.json`.

There is no exam data anywhere in the system.

### 5.2 `grade_records.json`

Array of `GradeRecord` objects:

| Field | Type | Rules |
|---|---:|---|
| `academic_year` | string | Format `YYYY-YY`, e.g. `2025-26` |
| `term` | enum | `Fall`, `Spring`, `Winter`, `Summer I`, `Summer II` |
| `subject`, `course_no`, `course_id`, `course_title` | string | Normalized consistently with sections |
| `instructor` | string | Normalized lowercase instructor join key |
| `gpa` | float | `0.0 <= gpa <= 4.0` |
| `dist` | object | Exactly `A,A-,B+,B,B-,C+,C,C-,D+,D,D-,F` |
| `withdraws` | int | Nonnegative |
| `graded_enrollment` | int | Positive |
| `crn` | string | Historical identifier; not a section join key |
| `credits` | number | Greater than zero |
| `meta` | object | Source and confidence |

Distribution values are percentages in `[0,100]` and must sum to `100 ± 1.0` to permit source rounding.

Record identity is `(course_id, instructor, academic_year, term, crn)`. Duplicate identities are a loader error.

Join current sections to grades on `(course_id, primary_instructor_key)`. If that has no records, expected GPA may fall back to all instructors for the same `course_id`; grade-volatility risk does not use the fallback.

### 5.3 `rmp.json`

Object keyed by normalized instructor join key:

```json
{
  "emebo": {
    "full_name": "Olatunde Emebo",
    "score": 4.2,
    "difficulty": 3.1,
    "n_reviews": 87,
    "would_take_again": 78.0,
    "tags": ["Tough Grader", "Lecture Heavy"],
    "comments": ["curves the final generously", "exams are exactly like the homework"],
    "meta": {
      "source": "rmp",
      "confidence": "high",
      "fetched_at": "2026-09-19T20:00:00Z"
    }
  }
}
```

Validation:

- `score` and `difficulty` are in `[1,5]`.
- `n_reviews` is nonnegative.
- `would_take_again` is null or in `[0,100]`.
- Tags and comments are deduplicated while preserving first occurrence.
- Unmatched RMP keys and section instructors without RMP entries produce warnings, not errors.

### 5.4 `buildings.json`

Object keyed by uppercase building code:

```json
{
  "MCB": {
    "name": "McBryde Hall",
    "place_id": "ChIJ…",
    "lat": 37.2293,
    "lng": -80.4232,
    "address": "250 Drillfield Dr, Blacksburg, VA",
    "verified": true,
    "source": "google_places",
    "fetched_at": "2026-09-19T20:00:00Z"
  }
}
```

`source` is `google_places`, `geocode`, or `manual_fix`.

### 5.5 `walk_matrix.json`

Object keyed by alphabetical unordered building pair:

```json
{
  "MCB|WHI": {
    "minutes": 18,
    "meters": 1400,
    "source": "google_routes",
    "fetched_at": "2026-09-19T20:00:00Z"
  }
}
```

Rules:

- Key format is `CODE_A|CODE_B`, where `CODE_A < CODE_B` lexicographically.
- Both codes must exist in `buildings.json`.
- `minutes` and `meters` are nonnegative integers.
- Same-building lookup returns zero without requiring a matrix entry.
- Missing different-building pairs return `DEFAULT_WALK_MIN` and source `default_fallback` at runtime.
- Lookup is symmetric.

### 5.6 Loader behavior

Load all files into one immutable `DataContext`, build indexes once, then run validations in this order:

1. Parse all files against Pydantic schemas; malformed data is an error.
2. Reject duplicate section CRNs.
3. Reject a section whose `term_id` differs from `CATALOG_TERM_ID`.
4. Enforce meeting/modality/building rules.
5. Reject unknown building codes in meetings and walk keys.
6. Reject course-level metadata inconsistencies.
7. Reject instructor-key collisions among distinct section instructor names.
8. Reject duplicate grade-record identities.
9. Warn for each section course without any grade record.
10. Warn for section instructors without RMP and RMP keys unused by sections.
11. Log deterministic boot stats.

Boot stats:

- section count
- grade-record count
- unique non-TBA instructor-key count
- building count
- walk-pair count
- synthetic grade-record count
- warning count

A warning must never prevent startup. A hard validation failure must prevent startup and include the file, record identity, and violated rule.

---

## 6. API Contract

Base path: `/api`.

All normal responses are JSON. Errors use:

```json
{"detail": "human-readable message"}
```

When machine-readable conflict information is required, `detail` may be an object:

```json
{
  "detail": {
    "code": "meeting_overlap",
    "message": "Selected sections overlap",
    "conflicts": []
  }
}
```

Unknown routes use FastAPI defaults. All documented routes must have explicit request and response Pydantic models so the OpenAPI document is usable as the frontend contract.

### 6.1 `GET /api/courses/search`

Query parameters:

- `q`: optional case-insensitive substring matched against `course_id`, `title`, and every instructor name
- `subject`: optional case-insensitive exact subject match
- `limit`: number of course groups, default 20, minimum 1, maximum 100

Response:

```json
{
  "courses": [
    {
      "course_id": "CS 2104",
      "title": "Introduction to Problem Solving in Computer Science",
      "credits": 3,
      "sections": []
    }
  ]
}
```

Results sort by `course_id`; sections sort by CRN. Empty matches return `{"courses":[]}`. Do not expose waitlist or parent-section fields that were not collected.

### 6.2 `GET /api/buildings/matrix`

Query parameter:

- `include_meta`: boolean, default `false`

Without metadata:

```json
{
  "buildings": {},
  "walk": {"MCB|WHI": 18}
}
```

With metadata, `walk` contains the full objects from `walk_matrix.json`. This endpoint returns committed matrix entries only; it does not synthesize every possible fallback pair.

### 6.3 `POST /api/analyze`

Request:

```json
{"crns":["83522","83545","87236","90418","91682"]}
```

Validation:

- 2–12 CRNs are required.
- Duplicate CRNs are rejected.
- Unknown CRNs are rejected.
- Meeting overlaps are rejected only when weekday, time interval, and inclusive date ranges overlap.
- Meetings that touch exactly at an endpoint do not overlap.

Domain validation failures return HTTP 422. Meeting-overlap errors include all conflicts with CRNs, weekday, and overlap interval.

Response:

```json
{
  "risk_score": 74,
  "sections": [],
  "factors": [
    {
      "type": "workload_collision",
      "severity": 22.0,
      "max_severity": 30.0,
      "detail": "3 heavy-workload courses: CS 3114, CS 2505, MATH 2534",
      "affected_crns": ["83522","83545","87236"]
    }
  ],
  "commute_warnings": [
    {
      "day": "T",
      "from": {"crn":"83522","building":"MCB","ends":"14:15"},
      "to": {"crn":"83545","building":"WHI","starts":"14:30"},
      "walk_min": 18,
      "adjusted_walk_min": 16,
      "gap_min": 15,
      "verdict": "tight",
      "source": "google_routes",
      "detail": "MCB → WHI is an 18-minute walk; the risk classifier uses 16 minutes after the 2-minute optimism adjustment, and the schedule provides 15 minutes."
    }
  ],
  "expected_gpa": {
    "range": [2.90,3.40],
    "mean": 3.15,
    "confidence": "medium",
    "n_students": 340,
    "n_terms": 6,
    "excluded": [{"crn":"83515","reason":"pass_fail"}]
  },
  "meta": {
    "term_id": "2026-fall",
    "data_notes": ["CS 2505 grade data is synthetic and representative."],
    "heuristic": true
  }
}
```

`commute_warnings` contains only `tight` and `impossible` transitions. Comfortable transitions are tested through the commute-classification function but omitted from the warning list.

### 6.4 `POST /api/swap`

Request:

```json
{
  "current_crns": ["83522","83545","87236"],
  "drop_crn": "83545",
  "add_crn": "83601"
}
```

Validation:

- `current_crns` follows analyze validation before the swap.
- `drop_crn` must occur exactly once in `current_crns`.
- `add_crn` must be known, must differ from `drop_crn`, and must not already be selected.
- The resulting schedule must satisfy analyze validation.
- Invalid swap operations return HTTP 400; an invalid resulting schedule returns HTTP 422 with conflict details.

Response:

```json
{
  "before": {},
  "after": {},
  "delta": -16,
  "summary": {
    "risk": "74 → 58",
    "resolved_warnings": 2,
    "new_warnings": 0
  }
}
```

`delta = after.risk_score - before.risk_score`.

Warning identity for resolved/new counts is `(day, from.crn, to.crn, verdict)`. The `before` and `after` objects must exactly equal independent analyze calls for the corresponding CRN lists.

### 6.5 `POST /api/stress`

Request:

```json
{"crns":["83522","83545"],"scenario":"miss_week","week":8}
```

- `scenario` currently accepts only `miss_week`.
- `week` is an integer from 1–16.
- CRN validation is identical to analyze.

Response:

```json
{
  "analysis": {},
  "scenario": {"type":"miss_week","week":8},
  "original_risk": 74,
  "stressed_risk": 88,
  "delta": 14,
  "penalties": [
    {
      "crn": "83522",
      "course_id": "CS 3114",
      "points": 8,
      "impact": "high",
      "reason": "High instructor difficulty and four credits increase catch-up cost."
    }
  ],
  "meta": {
    "heuristic": true,
    "note": "This scenario is a deterministic planning heuristic, not a prediction."
  }
}
```

The base `analysis` is exactly the normal analyze response. Stress does not mutate its factors.

For each selected section, use primary-instructor difficulty, defaulting to `DEFAULT_DIFFICULTY`:

```text
points = 0
if difficulty >= HARD_DIFFICULTY: points += 5
if credits >= 4: points += 3
if schedule_type in {Lab, Recitation}: points += 2
points = min(points, 10)
```

Only sections with positive points appear in `penalties`.

```text
delta = min(STRESS_MAX_UPLIFT, sum(points))
stressed_risk = min(100, original_risk + delta)
actual delta returned = stressed_risk - original_risk
```

Impact levels: `low` for 1–3, `medium` for 4–6, and `high` for 7–10.

The requested week is echoed for the what-if narrative but does not alter points because the backend has no assignment-calendar data.

### 6.6 `GET /api/professors/{surname}/vibes`

Normalize the path value with the same instructor-key function used by the loader.

Return 404 only when the key exists in neither RMP nor grade records. Partial data returns 200 with null RMP fields or empty grade stats plus notes.

```json
{
  "instructor": "emebo",
  "rmp": {
    "score": 4.2,
    "difficulty": 3.1,
    "n_reviews": 87,
    "would_take_again": 78.0
  },
  "tags": ["curves","exams match homework"],
  "grade_stats": {
    "avg_gpa": 3.10,
    "volatility": 0.40,
    "n_sections": 5,
    "n_students": 340,
    "a_rate": 34.2
  },
  "confidence": "high",
  "data_notes": []
}
```

Grade statistics use all grade records for the instructor key:

- `avg_gpa`: enrollment-weighted mean GPA
- `volatility`: enrollment-weighted population standard deviation of record GPAs
- `n_sections`: number of grade records
- `n_students`: sum of graded enrollment
- `a_rate`: enrollment-weighted `dist["A"]`, not `A + A-`

#### Deterministic vibe tags

`config.py` contains an ordered mapping from canonical tag to keyword phrases. Search normalized RMP tags and comments case-insensitively. Emit a canonical tag when any configured phrase appears. Preserve configured tag order and emit at most `MAX_VIBE_TAGS`. Do not use an LLM or network call at runtime.

Confidence:

- `high`: non-synthetic RMP with at least 20 reviews and at least 3 grade records
- `medium`: either non-synthetic RMP with at least 5 reviews or at least 3 grade records
- `low`: otherwise, or when all available data is synthetic

### 6.7 `GET /api/health`

```json
{
  "status": "ok",
  "term_id": "2026-fall",
  "sections": 36,
  "grade_records": 210,
  "instructors": 22,
  "buildings": 15,
  "walk_pairs": 105,
  "synthetic_rows": 140,
  "warnings": 3
}
```

`synthetic_rows` means synthetic grade records only. `/health` may exist as an undocumented alias, but frontend code must use `/api/health`.

### 6.8 `GET /api/demo/schedules`

Response:

```json
{
  "brutal": {"crns":[],"label":"The wall of pain"},
  "easy": {"crns":[],"label":"Balanced schedule"},
  "swap_demo": {
    "current_crns":[],
    "drop_crn":"83545",
    "add_crn":"83601"
  }
}
```

Load this data from committed fixtures, validate referenced CRNs during startup, and never hardcode demo CRNs in route code.

---

## 7. Risk Engine

`risk.py` contains pure functions and no FastAPI imports.

```python
analyze(sections: list[Section], ctx: DataContext) -> Analysis
```

### 7.1 Configuration

```python
W = {
    "workload_collision": 0.30,
    "back_to_back_density": 0.25,
    "commute": 0.20,
    "grade_volatility": 0.15,
    "difficulty_load": 0.10,
}
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
```

Validate at import/test time that the weights sum to 1.0. Factor maximum severity is `100 * W[factor_name]`; do not separately hardcode maxima.

### 7.2 Score and rounding

Each factor returns a raw severity, detail, affected CRNs, and notes. Clamp each raw severity to its configured maximum, round it to one decimal for the response, and calculate:

```text
risk_score = round(clamp(sum(response factor severities), 0, 100))
```

This ensures the displayed factor values reproduce the displayed score. Always return all five factors, including zero-severity factors, so the response is structurally stable and omissions are not mistaken for bugs.

### 7.3 Shared instructor difficulty

For each section, use the primary instructor's RMP difficulty. If there is no primary instructor or no matching RMP entry, use `DEFAULT_DIFFICULTY` and append one deduplicated data note.

### 7.4 Factor 1 — `workload_collision`

A section is heavy when its effective difficulty is at least `HARD_DIFFICULTY`.

```text
heavy_count_ratio = min(1, heavy_section_count / 3)
heavy_credit_ratio = min(1, total_heavy_credits / 15)
severity = max_severity * heavy_count_ratio * heavy_credit_ratio
```

A course represented by multiple required components is counted by selected section because each component consumes time. Detail names unique course IDs; `affected_crns` contains all heavy section CRNs.

### 7.5 Factor 2 — `back_to_back_density`

Build the recurring weekly schedule by weekday. Include all synchronous meetings, whether physical or online. Only compare meetings whose date ranges overlap.

For each weekday:

- contact hours = sum of meeting durations in hours
- tight pair = adjacent meetings with a gap from 0 through 10 minutes
- unbroken block = a maximal run of meetings connected by gaps of at most 10 minutes; block duration runs from the first start through the last end

```text
day_score = max(0, contact_hours - 4)
          + 2 * tight_pair_count
          + (3 if longest_unbroken_block_hours >= 3 else 0)
severity = max_severity * min(1, sum(day_score across weekdays) / 15)
```

Use the weekday with the largest score in the detail. Ties follow `M,T,W,R,F,S,U` order.

### 7.6 Factor 3 — `commute`

For each weekday, order physical meetings by start time and inspect adjacent physical meetings whose date ranges overlap. Online meetings are not commute endpoints and break physical adjacency; do not infer a walk “through” an intervening online meeting.

```text
raw_walk = matrix minutes, zero for same building, or DEFAULT_WALK_MIN
adjusted_walk = max(0, raw_walk - WALK_OPTIMISM_MIN)
slack = gap - adjusted_walk
```

Classification:

- `comfortable` when `slack >= WALK_COMFORT_SLACK_MIN`
- `tight` when `-WALK_TIGHT_DEFICIT_MAX <= slack < WALK_COMFORT_SLACK_MIN`
- `impossible` when `slack < -WALK_TIGHT_DEFICIT_MAX`

Points per transition:

- impossible: 7
- tight: 3.5
- comfortable: 0

```text
severity = min(max_severity, sum(transition points))
```

Warnings return both raw and adjusted walk minutes. Detail must name the actual source (`google_routes`, `manual_override`, or `default_fallback`) and must not claim Google provenance for non-Google values.

### 7.7 Factor 4 — `grade_volatility`

For each standard-grade section, select grade records matching `(course_id, primary_instructor_key)`. Require at least three records; otherwise the section contributes no volatility and generates a note.

For record GPA values `x_i` weighted by `graded_enrollment w_i`, use weighted population variance:

```text
mu = sum(w_i * x_i) / sum(w_i)
variance = sum(w_i * (x_i - mu)^2) / sum(w_i)
sigma = sqrt(variance)
```

Combine per-section sigma values with current-section credits as weights:

```text
combined_sigma = sum(section_credits * sigma) / sum(credits of eligible sections)
severity = max_severity * min(1, combined_sigma / VOLATILITY_MAX_SIGMA)
```

If no sections are eligible, severity is zero.

### 7.8 Factor 5 — `difficulty_load`

Include all selected sections, including pass/fail sections:

```text
mean_difficulty = sum(credits * difficulty) / sum(credits)
severity = max_severity * clamp((mean_difficulty - 2.5) / 2.0, 0, 1)
```

### 7.9 Expected GPA

Pass/fail sections are excluded and listed with reason `pass_fail`.

For each remaining section:

1. Use grade records matching `(course_id, primary_instructor_key)`.
2. If missing, fall back to all records for `course_id` and add a note.
3. If still missing, exclude with reason `no_grade_history`.
4. Calculate enrollment-weighted mean and weighted population sigma.

Overall mean is current-credit-weighted across eligible sections.

Combine uncertainty as weighted root-mean-square sigma:

```text
combined_sigma = sqrt(sum(credits * sigma^2) / sum(credits))
half_width = max(0.15, combined_sigma)
range = [clamp(mean - half_width, 0, 4), clamp(mean + half_width, 0, 4)]
```

This guarantees a minimum total range width of approximately 0.30 except at GPA scale boundaries.

Evidence counts use the union of historical record identities used by eligible sections, preventing the same record from being double-counted:

- `n_students`: sum of graded enrollment over unique evidence records
- `n_terms`: count of distinct `(academic_year, term)` values over unique evidence records

Confidence:

- `high`: every eligible section has instructor-specific history, every eligible section has at least five distinct terms, and total unique evidence enrollment is at least 500
- `medium`: every eligible section has some history and total unique evidence enrollment is at least 150
- `low`: otherwise
- any eligible section supported only by synthetic records caps confidence at `low`
- if no sections are eligible, confidence is `low`, mean/range are null, and exclusions explain why

Synthetic records may be used, but the response must identify affected course IDs in `meta.data_notes`.

---

## 8. Pipeline Scripts

General requirements for every script:

- Offline only; never imported by the server.
- Use deterministic normalization and stable output ordering.
- Replace output files atomically through a temporary file; never append.
- Re-running with the same local input must not create duplicate records.
- Print a concise summary and exit nonzero on unrecoverable configuration or validation errors.
- Preserve manually overridden records unless `--force` explicitly permits replacement.
- Never print API keys.

### 8.1 `parse_udc.py`

Input: every `.txt` file in `data/raw/udc/`.

Accept pipe-delimited Markdown rows or tab-delimited rows with 23 columns:

`Year, Term, Subject, CourseNo, Title, Instructor, GPA, A, A-, B+, B, B-, C+, C, C-, D+, D, D-, F, Withdraws, GradedEnrollment, CRN, Credits`.

Behavior:

- Skip blank lines, Markdown separator rows, and recognized headers.
- Normalize Unicode minus characters to ASCII `-`.
- Normalize instructor keys with the shared normalization function.
- Default metadata to `source=udc_vt_edu`, `confidence=high`.
- `--synthetic` changes metadata to `source=synthetic_filler`, `confidence=low`.
- Log malformed rows with filename and line number and continue.
- Deduplicate by grade-record identity; conflicting duplicates are fatal.
- Print per-file accepted/skipped counts and grand totals.

### 8.2 `build_sections.py`

Input: YAML or CSV files in `data/raw/sections/`.

- Normalize 12-hour times to minutes from midnight.
- Normalize day strings to arrays using longest-token matching so `Th` can map to `R` if present in source material.
- Require explicit AM/PM when a raw range would otherwise be ambiguous.
- Attach `term_id` and provenance.
- Validate against the same Pydantic models and loader cross-file rules before atomically writing `sections.json`.
- Fail fast on duplicate CRNs, unknown buildings, ambiguous times, or instructor-key collisions.

### 8.3 `build_rmp.py`

Input: human-pasted files in `data/raw/rmp/*.txt` using a documented simple format in the README.

- Emit `rmp.json` keyed by normalized instructor key.
- Preserve raw source tags/comments and provenance.
- Reject conflicting duplicate keys.
- Optionally print unmatched section instructors after generation.

### 8.4 `fetch_buildings.py`

Input:

```json
[{"code":"MCB","search":"McBryde Hall"}]
```

from `data/raw/seed/buildings_seed.json`.

- Read `GOOGLE_MAPS_API_KEY` from `.env`.
- Use an explicit timeout.
- Query `"{search}, Blacksburg VA"`.
- Write candidates with `verified=false` by default.
- Flag candidates when the returned name does not contain the seed search's first normalized word or the coordinates are more than 1.5 km from `(37.2295,-80.4210)`.
- Preserve existing `manual_fix` entries unless `--force` is used.
- A human sets `verified=true` after review.

### 8.5 `fetch_walk_matrix.py`

Read verified entries from `buildings.json` and build every unordered pair.

For each origin code at sorted index `i`, request destinations with later indexes only, chunking destinations so the API request stays within the configured matrix-element limit. With one origin, request element count equals destination count. Retain the result under the alphabetical key.

CLI:

- `--all`: fetch all missing eligible pairs
- `--only MCB,WHI`: fetch exactly one pair
- `--dry-run`: print request count and route-matrix element count; make no calls and write nothing
- `--force`: permit replacing non-manual existing entries

Requirements:

- `travelMode=WALK`
- Round duration upward to whole minutes
- Never replace `manual_override` unless `--force`
- Preserve successful existing entries by default
- Log failed API elements and leave those pairs absent so runtime fallback remains possible

Both Google scripts hard-fail clearly when `GOOGLE_MAPS_API_KEY` is absent. The server never loads `.env` or reads the key.

---

## 9. Non-Functional Requirements

1. **Determinism:** Identical committed data files and request bodies produce identical API responses.
2. **Boot performance:** Less than 2 seconds for the target dataset on a typical hackathon laptop.
3. **Analyze performance:** Less than 100 ms for eight sections after startup loading.
4. **Partial data:** Missing RMP, grade history, or walk pairs must degrade to documented defaults/notes and never cause a 500.
5. **Contract stability:** Request and response Pydantic models are the frontend contract. Changes require coordination.
6. **No runtime network:** Demo must work with networking disabled.
7. **Explainability:** Displayed factors must add to the displayed risk score within the documented rounding rule.
8. **Logging:** Startup counts and validation warnings use Python logging, not `print`; pipeline CLIs may print summaries.
9. **Read-only runtime:** Request handlers do not mutate loaded data or write files.
10. **Safe defaults:** CORS allows wildcard origins only with credentials disabled.

---

## 10. Testing and Calibration

### 10.1 Loader tests

Each rule needs a passing and failing fixture where applicable:

- malformed file/schema
- duplicate CRN
- wrong catalog term
- modality/meeting building rules, including valid hybrid mixed meetings
- unknown section building
- unknown walk-key building
- inconsistent course metadata
- instructor-key collision
- duplicate grade identity
- invalid grade distribution sum
- unmatched RMP warnings
- missing grade-history warnings
- successful empty/minimal datasets

### 10.2 Risk tests

- Easy fixture risk band: 25–45
- Brutal fixture risk band: 65–85
- All five factors always present
- Displayed severities reproduce risk score
- Swap lowers risk by at least 10 and `delta = after - before`
- Swap `before` and `after` equal independent analyze calls
- Raw MCB→WHI walk 18 and gap 15 classifies as tight after optimism adjustment
- Raw walk 18 and gap 25 classifies as comfortable and is omitted from warnings
- Impossible commute boundary test
- Same-building walk is zero
- Missing matrix pair uses `DEFAULT_WALK_MIN` and reports `default_fallback`
- Pass/fail section is excluded from expected GPA
- Instructor-specific GPA fallback and no-history exclusion
- Synthetic-only evidence caps confidence at low
- Weighted volatility calculation against hand-calculated values
- Meeting overlap checks dates as well as weekday/time
- Touching meetings are not overlaps
- Stress penalty, cap, and 100-point clamp

### 10.3 API tests

- Response-model validation for all eight required endpoints
- Structured 422 overlap error
- Search filtering, grouping, sorting, and limit behavior
- Matrix `include_meta` variants
- Vibes with RMP only, grades only, both, and neither
- Health counts match context indexes
- Demo fixtures reference valid CRNs
- CORS preflight succeeds without credentials

### 10.4 Calibration

Tune only `config.py` constants until fixture bands pass. Record the final rationale in comments next to constants. Do not introduce fixture-specific conditions into `risk.py`.

Calibration fixtures are product examples, not statistical validation. README must state that risk values are heuristics.

---

## 11. Delivery Order

1. Create Pydantic models, loader, empty valid data files, FastAPI lifespan, `/api/health`, and tests for startup.
2. Implement all request/response models and a temporary fixture-backed `/api/analyze` so the frontend receives the final contract during hour one.
3. Implement search, matrix, and demo endpoints.
4. Implement pure schedule validation, commute classification, and swap.
5. Replace temporary analysis logic with the real risk engine without changing response models.
6. Implement stress and vibes.
7. Implement local parsing/build scripts first, then Google scripts when credentials are available.
8. Add/calibrate fixtures and complete tests.
9. Remove all temporary hardcoded analysis behavior and verify the acceptance checklist offline.

Temporary fake behavior must be isolated behind an explicit development setting such as `HOKIELENS_STUB_ANALYZE=1`, default off, and must be absent or disabled in the final demo configuration.

---

## 12. Out of Scope

- Database, ORM, or migrations
- Authentication, accounts, saved schedules, or server-side persistence
- Frontend, HTML, or templates
- Runtime scraping or network calls
- Banner automation or VT SSO
- Exam data
- Bus/transit, weather, or elevation
- DARS/HokieAudit degree-progress logic
- Live seat updates, polling, or WebSockets
- Personalized grade prediction
- Docker or deployment infrastructure beyond `requirements.txt` and README instructions

---

## 13. Acceptance Criteria

- [ ] `uvicorn main:app` boots with committed files and `/api/health` reports real counts.
- [ ] All eight endpoints conform to explicit Pydantic request/response contracts.
- [ ] OpenAPI renders every contract without unresolved or untyped response bodies.
- [ ] Brutal fixture scores 65–85 with at least three nonzero itemized factors.
- [ ] Easy fixture scores 25–45.
- [ ] Displayed factor severities reproduce the displayed risk score.
- [ ] Every commute warning reports raw walk, adjusted walk, gap, verdict, and actual source.
- [ ] Swap before/after outputs exactly match independent analyze calls and delta uses `after - before`.
- [ ] Stress is clearly labeled heuristic and follows the exact penalty formula.
- [ ] Expected-GPA evidence counts do not double-count historical records.
- [ ] Missing RMP, grades, and matrix pairs produce defaults/notes rather than 500 errors.
- [ ] Provenance is present, synthetic grade rows are labeled, and health/startup stats count them consistently.
- [ ] No request handler imports pipeline code, reads API keys, writes files, or makes network calls.
- [ ] Pipeline scripts are rerunnable without duplicate accumulation and preserve manual overrides.
- [ ] Demo works with networking disabled.
- [ ] All tests pass.
- [ ] README documents setup, commands, environment variables, data limitations, heuristic status, and the canonical `/api` routes.
