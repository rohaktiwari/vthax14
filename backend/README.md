# HokieLens Backend

REST API that loads pre-collected Virginia Tech course, grade, professor-review,
building, and walking data from committed JSON files and serves course search,
walking-time data, a transparent 0–100 semester risk score, section-swap
comparisons, a "miss a week" stress scenario, professor vibes, and stable demo
fixtures. Backend only; the frontend is a separate project that consumes the
`/api` contract published in this server's OpenAPI document.

Registration says courses can be taken together; HokieLens estimates what taking
them together actually costs. **Every risk, stress, GPA, and vibes value is a
deterministic planning heuristic, not a prediction of any individual student's
grades or wellbeing.**

## Implementation status

Delivery follows PRD section 11. **Blocks 1–8 are complete** (final audit).
`HOKIELENS_STUB_ANALYZE` remains an optional compatibility path, default **off**.

| Area | Status |
|---|---|
| Pydantic data models (`models.py`) for all five data files + demo fixtures | done |
| Loader with PRD 5.6 validation order, strict/lenient modes, boot stats (`data.py`) | done |
| `config.py` constants (`W`, thresholds) and env-flag parsing without dotenv | done |
| FastAPI lifespan: load + validate once, typed `DataContext` on `app.state.ctx` | done |
| `GET /api/health` with real counts and accumulated warning count | done |
| `GET /api/courses/search` grouping, matching, sorting, filtering, limit | done |
| `GET /api/buildings/matrix` committed pairs, `include_meta` variants | done |
| `GET /api/demo/schedules` served from committed fixture files | done |
| Explicit request/response contracts for all eight endpoints (OpenAPI) | done |
| Schedule validation for analyze/swap: unknown CRNs, structured overlap 422 (`schedule.py`) | done |
| Commute classification (PRD 7.6) reused by the analyze path | done |
| `POST /api/swap`: 400/422 validation, independent before/after, `delta`, summary | done |
| `POST /api/analyze` real risk engine (`risk.analyze`) | done (default) |
| `HOKIELENS_STUB_ANALYZE=1` compatibility path (same `AnalyzeResponse` contract) | optional; default off |
| `POST /api/stress` miss-week penalty on the shared analysis path | done |
| `GET /api/professors/{surname}/vibes` RMP + grade aggregation | done |
| Pipeline scripts (`scripts/parse_udc`, `build_sections`, `build_rmp`) | done (offline) |
| Optional Google Places/Routes CLIs | dry-run default; live fetch is `--allow-network` opt-in |
| Calibrated committed catalog + trimmed acceptance suite | done |
| Final audit (this block) | done |

Committed data under `data/` are a **small calibrated synthetic catalog**
(fictional CRNs `9000x`, fictional instructors, `synthetic_filler` grade and RMP
rows, unverified `manual_fix` buildings). They are not real Banner, UDC, RMP, or
Google data. The catalog is sufficient to boot in strict mode and exercise every
endpoint. `data/raw/` holds the offline pipeline inputs that regenerate
`sections.json`, `grade_records.json`, and `rmp.json` byte-identically.
Buildings and walk times remain hand-maintained (`manual_fix` /
`manual_override`); they are not overwritten by Google scripts.

## Setup

Requirements: Python 3.11+ (tested on 3.14), no database, no network at runtime.

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1        # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
```

## Run

All commands run from this directory (`backend/`, the directory containing
`main.py`). Data paths resolve relative to this package, not the current
directory.

```powershell
uvicorn main:app --reload           # development
uvicorn main:app                    # verification (strict, real engine)
$env:HOKIELENS_LENIENT = "0"; $env:HOKIELENS_STUB_ANALYZE = "0"; uvicorn main:app
$env:HOKIELENS_LENIENT = "1"; uvicorn main:app
$env:HOKIELENS_STUB_ANALYZE = "1"; uvicorn main:app   # stub analyze still validates
python -m pytest -q                 # tests (non-loopback TCP is blocked)
python -m ruff check .
python -m ruff format --check .
python -m compileall main.py config.py data.py models.py risk.py schedule.py stub_analyze.py scripts tests
```

Interactive contract: <http://127.0.0.1:8000/docs> (OpenAPI JSON at `/openapi.json`).

## Environment variables

The eight planner routes read plain process environment variables only and make
no outbound calls. The one optional exception is Ask Gemini (`POST /api/chat`),
which reads `HOKIELENS_GEMINI` and `GEMINI_API_KEY` from the process
environment (set them in the Render dashboard; never in the repo or any `VITE_`
variable). Offline pipeline scripts never load `.env`; the optional Google CLIs
read `GOOGLE_MAPS_API_KEY` from the process environment only when
`--allow-network` is passed.

| Variable | Default | Meaning |
|---|---|---|
| `CATALOG_TERM_ID` | `2026-fall` | The single catalog term served. Every section's `term_id` must match. |
| `HOKIELENS_LENIENT` | `0` | `1` = lenient startup (see below). `0` = strict, exactly as the PRD specifies. **Default is 0.** |
| `HOKIELENS_STUB_ANALYZE` | `0` | `1` = `POST /api/analyze` (and swap/stress base analysis) return the isolated placeholder. `0` = the real `risk.analyze` engine. **Default is 0** (normal scoring). The stub is a compatibility/testing path, not production scoring. |
| `HOKIELENS_PUBLIC_URL` | `http://127.0.0.1:8000` | Public origin written into the ANS agent card (`/.well-known/agent-card.json`). Not a secret. |
| `GOOGLE_MAPS_API_KEY` | unset | **Pipeline only.** Required for `fetch_buildings.py` / `fetch_walk_matrix.py` when `--allow-network` is set. The running server never reads this variable. |
| `HOKIELENS_GEMINI` | `0` | `1` plus `GEMINI_API_KEY` turns on Ask Gemini (`/api/chat`) and the explain CLI/gateway. Off by default; the planner never depends on it. |
| `GEMINI_API_KEY` | unset | Server-side only. Never commit, never log, never send to the browser. |
| `GEMINI_MODEL` | `gemini-3.6-flash` | Optional model override for Ask Gemini and the explain CLI/gateway. |
| `ANS_RA_URL` | unset | Optional GoDaddy ANS Registration Authority base URL. Dry-run unless `--allow-network` and CSRs exist. |

Boolean flags accept `1/0`, `true/false`, `yes/no`, `on/off` (case-insensitive).
Any other value aborts startup with a `ValueError` naming the variable.

PowerShell example:

```powershell
$env:HOKIELENS_LENIENT = "1"; $env:HOKIELENS_STUB_ANALYZE = "1"; uvicorn main:app
```

## Sponsor prizes (VTHacks 14)

Optional add-ons. They do not change the eight planner routes, response fields, or
calibrated scores. The core app stays offline. Copy `backend/.env.example` for the
optional names; the process environment is what is read (no dotenv).

Two-minute path from `backend/`:

```powershell
python -m sponsors.demo
```

That prints the Databricks impact story, a grounded schedule explanation, and the
ANS agent-card URL plus DNS TXT record.

### Deloitte x Databricks — student-success impact

**What.** A Databricks-importable notebook plus CSV/JSON exports of the calibrated
demo weeks (easy **41**, brutal **84**, swap **49 -> 19**, miss-week-8 **41 -> 46**).
The notebook tells the advising story: registration says the CRNs fit; the catalog
shows commute failures and difficulty. Spark visualizes the engine output; it does
not recompute risk.

**Run**

```powershell
cd backend
python -m sponsors.impact              # print the four-number story
python -m sponsors.impact --write      # rewrite sponsors/databricks/*.csv
```

**Demo.** Import `sponsors/databricks/HokieLens_Student_Impact.py` into a Databricks
workspace (Community Edition is enough). Run all cells. Point at 41 vs 84, then the
swap delta. Optional: upload the CSVs to `/FileStore/hokielens/` so `display` reads
the live export. Needs a human Databricks login; no workspace token is stored here.

### MLH — Gemini API

**Ask Gemini chat (`POST /api/chat`, `GET /api/chat/status`).** A backend proxy: the
browser never sees the key. Hidden from OpenAPI, so the eight-route contract is
unchanged. Each question is answered from a facts block built server-side from the
student's CRNs: selected sections with readable times, the risk score and factors,
every same-day walk with minutes, gap and verdict, and other sections of the same
courses. Guards:

- Limits: 500 chars per message, 8 messages, 4 student turns, 12 CRNs, 16 KB body,
  12 requests/min per client (X-Forwarded-For) and 30/min overall (429 + `Retry-After`).
- Injection: all client text is stripped of angle brackets and control characters,
  override phrases are redacted, client-supplied "assistant" turns are labelled
  unverified, and `focus` values must match catalog buildings/CRNs.
- Grounding: a reply that names a number, CRN, clock time, or minute count that is
  not in the facts, or that leaks the key or prompt, is dropped for a deterministic
  answer built from the same facts.
- Fallback: missing key, Gemini quota (429), timeout, or any error returns 200 with
  `source: "unavailable"|"fallback"`, a `reason`, and a readable `notice`.

Response: `{reply, source, reason, notice}`. Tests mock Gemini at the function and
HTTP-transport level; nothing in the suite touches the network.

**Explain CLI/gateway.** Gemini rewrites an `AnalyzeResponse` into three
student-facing cards (Risk, Commute, Difficulty). It sees only facts already in that
JSON. Invented numbers are rejected and the deterministic template is used instead.

**Run** (still from `backend/`)

```powershell
python -m sponsors.explain --fixture easy
$env:HOKIELENS_GEMINI = "1"; $env:GEMINI_API_KEY = "your-key"
python -m sponsors.explain --fixture easy --gemini
uvicorn sponsors.gateway:app
# POST /api/explain  {"crns": ["90001","90003","90008"]}
```

Without the flag+key, `/api/explain` and the CLI still return 200 with
`"source": "template"`. `uvicorn main:app` does not mount `/api/explain` and makes
no Gemini call. Needs a human Google AI Studio key.

**Demo.** Run `--fixture brutal --gemini`, then `--fixture easy --gemini`. Same
facts as `/api/analyze`; the copy is what a student would read under the score.
Frontend wiring of `/api/explain` is a later, optional UI change.

### GoDaddy — Agent Name Service (ANS)

**What.** HokieLens is published as a named HTTP-API agent: protocol card at
`GET /.well-known/agent-card.json` (also `/.well-known/ans/agent.json`), registration
document at `/.well-known/ans/registration.json`, and a DNS TXT template in
`sponsors/ans/dns-records.example.txt`. Other agents look it up by domain name, the
same way browsers look up a website.

**Run**

```powershell
cd backend
uvicorn main:app
# open http://127.0.0.1:8000/.well-known/agent-card.json
$env:HOKIELENS_PUBLIC_URL = "https://YOUR_DOMAIN"
python -m sponsors.identity
```

**Demo.** On a laptop: open the well-known card. On a public domain: point GoDaddy
DNS at the deployed API, set `HOKIELENS_PUBLIC_URL`, publish the `_ans` TXT record.
Live Registration Authority certificates/ACME are a human step (`ANS_RA_URL` plus
CSRs); this repo never invents PEMs.

## Strict versus lenient startup

Startup loads every file exactly once and validates in PRD 5.6 order. Each
warning is logged through Python `logging` (logger `hokielens.data`) and counted
in `/api/health.warnings`. A warning never prevents startup. A hard failure
raises `DataValidationError("<file>: <record identity>: <rule>")` and the server
does not start.

| Condition | Strict (`HOKIELENS_LENIENT=0`) | Lenient (`HOKIELENS_LENIENT=1`) |
|---|---|---|
| Missing file, invalid JSON, duplicate JSON object key, schema violation (any rule enforced by `models.py`, e.g. grade `dist` sum, `start_min < end_min`, `course_id == "SUBJECT COURSE_NO"`) | fatal | fatal |
| Duplicate section CRN | fatal | fatal |
| Unknown building code in a meeting or a walk-matrix key; malformed walk key; non-uppercase building key | fatal | fatal |
| Section `term_id` ≠ `CATALOG_TERM_ID` | fatal | warning; section excluded |
| Meeting/modality rule (`f2f` all physical, `online_*` all `building=null`, `hybrid` ≥1 physical, non-`online_async` ≥1 meeting) | fatal | warning; section excluded |
| Course-level metadata inconsistency (`subject`, `course_no`, `title`, `credits` differ within one `course_id`) | fatal | warning; later section excluded (first section in file order is canonical) |
| Duplicate grade-record identity `(course_id, instructor, academic_year, term, crn)` | fatal | warning; later duplicate dropped |
| Demo fixture references an unknown CRN | fatal | warning; fixture served as committed |
| Instructor-key collision (distinct names → same join key) | warning; key merged; `data_notes` entry for affected sections | same |
| Section course without grade records; instructor without RMP; RMP key unused | warning | warning |

Boot stats are logged once per start: section count, grade-record count, unique
non-TBA instructor-key count, building count, walk-pair count, synthetic
grade-record count, warning count. `/api/health` reports the same numbers.

## Zero-network server rule

The running server makes no outbound network calls of any kind and never reads
`.env` or API keys. Third-party APIs (Google Places/Routes) are used only by the
manually invoked offline scripts in `scripts/`, and only when `--allow-network`
is passed. The server never imports anything from `scripts/`. Gemini is the same
shape: optional, off by default, and only on `sponsors.gateway` / the explain CLI.
The demo must work with networking disabled. Request handlers never mutate loaded
data or write files. Identical committed files plus an identical request always
produce an identical response.

## Data files

| File | Shape | Notes |
|---|---|---|
| `data/sections.json` | array of `Section` | one catalog term; regenerated from `data/raw/sections/` |
| `data/grade_records.json` | array of `GradeRecord` | `instructor` is the normalized join key; `meta.source="synthetic_filler"` |
| `data/rmp.json` | object keyed by instructor join key → `RmpEntry` | regenerated from `data/raw/rmp/` with `--synthetic` |
| `data/buildings.json` | object keyed by uppercase code → `Building` | hand-maintained `manual_fix`; not Google-fetched |
| `data/walk_matrix.json` | object keyed by `CODE_A\|CODE_B` (`A < B`) → `WalkEntry` | hand-maintained `manual_override` |
| `tests/fixtures/schedule_easy.json`, `schedule_brutal.json` | `{"crns": [...], "label": "..."}` | demo schedules (file-driven; no CRNs in route code) |
| `tests/fixtures/swap_demo.json` | `{"current_crns": [...], "drop_crn": "...", "add_crn": "..."}` | demo swap |
| `data/raw/udc/*.txt` | UDC grade tables | input to `scripts/parse_udc.py` |
| `data/raw/sections/*.{yaml,yml,csv}` | section extracts | input to `scripts/build_sections.py` |
| `data/raw/rmp/*.txt` | pasted RMP blocks | input to `scripts/build_rmp.py` |
| `data/raw/seed/buildings_seed.json` | `[{code, search}, …]` | seed for optional `fetch_buildings.py` (dry-run default) |
| `tests/fixtures/pipeline/` | small offline samples | pipeline unit tests only; not served |

Instructor join key: last whitespace-delimited token of the name, lowercased,
Unicode punctuation removed (`Olatunde Emebo` → `emebo`, `Jane Smith-Jones` →
`smithjones`). Names equal to `TBA` (case-insensitive) and empty instructor lists
are excluded from every join. `instructor_names[0]` is the primary instructor
used for grade, RMP-difficulty, and risk joins; all names are searchable.

Data limitations: one term only; surname join keys can merge distinct
instructors (surfaced as warnings plus `meta.data_notes`); no exam data; no
waitlist/parent-section fields; walk pairs missing from the matrix fall back to a
default with `source="default_fallback"`; synthetic rows are labeled and counted
in `synthetic_rows`. The committed walk matrix is `manual_override` throughout
(no Google Routes values). Current calibrated fixture outputs (heuristic, not
predictions):

| Fixture | Result |
|---|---|
| `schedule_easy` | risk score **41** (band 25–45) |
| `schedule_brutal` | risk score **84** (band 65–85) |
| `swap_demo` | **49 → 19**, delta **−30** |
| easy `miss_week` week 8 | **41 → 46**, delta **5** |

## API routes (canonical base path `/api`)

Every route has an explicit Pydantic request and response model; `/openapi.json`
is the frontend contract. Fields may be added but are never renamed. Errors always
use `{"detail": ...}` where `detail` is a human-readable string, or the structured
`{"code": "meeting_overlap", "message": ..., "conflicts": [...]}` object when
conflict details are required.

| Method | Path | Request | Response | Status |
|---|---|---|---|---|
| GET | `/api/courses/search` | query `q`, `subject`, `limit` (1–100, default 20) | `CourseSearchResponse` | live |
| GET | `/api/buildings/matrix` | query `include_meta` (default `false`) | `BuildingsMatrixResponse` | live |
| POST | `/api/analyze` | `AnalyzeRequest {crns: 2–12 unique}` | `AnalyzeResponse` | live (`risk.analyze`; stub if flag on) |
| POST | `/api/swap` | `SwapRequest {current_crns, drop_crn, add_crn}` | `SwapResponse` | live (same analysis path) |
| POST | `/api/stress` | `StressRequest {crns, scenario: "miss_week", week: 1–16}` | `StressResponse` | live (shared analysis + PRD 6.5 penalty) |
| GET | `/api/professors/{surname}/vibes` | path `surname` | `VibesResponse` | live |
| GET | `/api/health` | — | `HealthResponse` | live |
| GET | `/api/demo/schedules` | — | `DemoSchedulesResponse` | live |

`/health` (without `/api`) is not provided; frontend code must use `/api/health`.

### Search (`GET /api/courses/search`)

- `q` is an optional case-insensitive substring of `course_id`, `title`, or any
  instructor name on any section of the course. Surrounding whitespace is
  stripped; a blank `q` is treated as omitted (all courses).
- `subject` is an optional case-insensitive exact match on the section subject
  code (e.g. `cs` matches `CS`). Blank is treated as omitted.
- A course is included when it passes the subject filter and matches `q`. All
  sections of that course are returned, sorted by CRN — not only the section
  whose instructor matched. Ranking is lexicographic `course_id` (the PRD does
  not define relevance ranking); `course_id` is unique, so there is no course-level
  tie. Section order is CRN.
- `limit` caps the number of course groups after sorting (default 20, min 1,
  max 100). Empty matches return `{"courses":[]}`. Waitlist and parent-section
  fields are not collected and are not exposed.

### Buildings matrix (`GET /api/buildings/matrix`)

Returns the committed `buildings.json` map and `walk_matrix.json` pairs only.
Missing building pairs are **not** filled with `DEFAULT_WALK_MIN` here (that
fallback is for the later commute classifier). `include_meta=false` (default)
maps each walk key to minutes; `include_meta=true` maps each key to the full
`{minutes, meters, source, fetched_at}` object. Keys are lexicographic.

### Demo schedules (`GET /api/demo/schedules`)

Loaded at startup from `tests/fixtures/schedule_easy.json`,
`schedule_brutal.json`, and `swap_demo.json`. Referenced CRNs are validated
against the loaded section catalog: unknown CRNs are fatal in strict mode and a
counted warning in lenient mode (the committed fixture is still served). Route
code never hardcodes CRNs.

### Schedule validation (`POST /api/analyze`, `POST /api/swap`)

Both routes run the same validation (`main.validate_schedule`) before any
analysis, in this order:

1. Request shape (Pydantic): 2–12 CRNs, no duplicates, nonblank strings →
   `422 {"detail": "<string>"}` (the established string convention).
2. Every CRN must exist in the loaded catalog →
   `422 {"detail": "Unknown CRNs: <crn, …>"}` (request order).
3. No two selected sections may overlap. Two meetings overlap only when they
   share a weekday, their minute intervals overlap (meetings that touch exactly at
   an endpoint do **not** overlap), and their inclusive date ranges overlap. Every
   conflict is reported:

```json
{
  "detail": {
    "code": "meeting_overlap",
    "message": "Selected sections overlap",
    "conflicts": [
      {"crns": ["90003", "90012"], "day": "M", "start": "11:15", "end": "12:05"}
    ]
  }
}
```

`crns` follow request order; conflicts sort by weekday (`M,T,W,R,F,S,U`), then
overlap start, end, and CRNs; `start`/`end` are the overlapping interval in
`HH:MM`. Meeting days, minute ranges, date ranges, modality/building rules, and
building codes are validated once at startup (strict: fatal, lenient: excluded
where the PRD allows; unknown buildings always fatal), so request-time validation
operates on a known-good catalog and is identical in both modes. A valid
schedule then runs `risk.analyze` (or the stub when `HOKIELENS_STUB_ANALYZE=1`).

### Commute classification (PRD 7.6)

For each weekday the timeline of every synchronous meeting is ordered by start
time. Each consecutive pair whose meetings are **both physical** (non-null
building) and whose date ranges overlap is a transition; an online meeting is
never an endpoint and breaks adjacency, so no walk is inferred "through" it.
Asynchronous sections have no meetings and never participate.

| Quantity | Rule (`config.py`) |
|---|---|
| `walk_min` (raw) | matrix minutes for the pair (either direction); `0` for the same building; `DEFAULT_WALK_MIN = 12` with `source="default_fallback"` when the pair is missing |
| `adjusted_walk_min` | `max(0, walk_min − WALK_OPTIMISM_MIN)` with `WALK_OPTIMISM_MIN = 2`; applied exactly once, in `risk.classify_commute` |
| `gap_min` | next meeting start − previous meeting end |
| slack | `gap_min − adjusted_walk_min` |
| `comfortable` | slack ≥ `WALK_COMFORT_SLACK_MIN` (2) |
| `tight` | `−WALK_TIGHT_DEFICIT_MAX` (−5) ≤ slack < 2 |
| `impossible` | slack < −5 |

Boundary examples: raw 18 / gap 18 → slack 2 → comfortable; gap 17 → tight;
gap 15 → tight (the PRD example); gap 11 → slack −5 → tight; gap 10 → slack −6 →
impossible. `commute_warnings` contains only `tight` and `impossible` transitions,
sorted by weekday, start time, then CRN; each carries raw and adjusted minutes,
the gap, the verdict, the actual `source` (`google_routes`, `manual_override`,
`default_fallback`), and a `detail` that names that source and never claims
Google provenance for non-Google values. The `commute` factor severity is
`min(20, Σ points)` with `tight = 3.5`, `impossible = 7`, `comfortable = 0`
(`COMMUTE_TRANSITION_POINTS`).

### Swap (`POST /api/swap`)

1. `current_crns` passes analyze validation (422 as above).
2. Swap-operation rules → `400 {"detail": "<string>"}`: `drop_crn` must occur
   exactly once in `current_crns`; `add_crn` must be a known CRN, differ from
   `drop_crn`, and not already be selected.
3. The resulting schedule — `add_crn` replaces `drop_crn` **at the same index** —
   must pass analyze validation (422 with conflict details on overlap).
4. `before` and `after` are two independent runs of the same analysis path used by
   `POST /api/analyze`, so each equals a standalone analyze call for its CRN list.
   `delta = after.risk_score − before.risk_score`; `summary.risk` is
   `"<before> → <after>"`; `resolved_warnings` / `new_warnings` count commute
   warning identities `(day, from.crn, to.crn, verdict)` present only before /
   only after. With the stub flag off, both analyses use `risk.analyze`.

### Stress (`POST /api/stress`)

Schedule validation is identical to analyze (422 string for unknown CRNs / request
shape; structured `meeting_overlap` for conflicts). `scenario` currently accepts
only `miss_week`; `week` is an integer 1–16 (Pydantic 422 outside that range).
The requested week is echoed in `scenario` for the what-if narrative and does
**not** change points: the backend has no assignment-calendar data.

`analysis` is exactly `run_analysis` for the same CRN list (so it equals an
independent `/api/analyze` call, including under `HOKIELENS_STUB_ANALYZE=1`).
Stress does not mutate that object's factors.

For each selected section, primary-instructor RMP difficulty is used
(`DEFAULT_DIFFICULTY` when missing — the same helper as analyze). Per-section
points (`config.py`):

```text
points = 0
if difficulty >= HARD_DIFFICULTY (3.5): points += 5
if credits >= 4: points += 3
if schedule_type in {Lab, Recitation}: points += 2
points = min(points, 10)
```

Only positive-point sections appear in `penalties`, in request CRN order.
Impact: `low` 1–3, `medium` 4–6, `high` 7–10.

```text
raw_delta = min(STRESS_MAX_UPLIFT, sum(points))     # cap 30, applied once
stressed_risk = min(100, original_risk + raw_delta) # 100-point clamp, applied once
delta = stressed_risk - original_risk               # after the clamp
```

Pass/fail sections are included in the penalty walk (the PRD does not exclude
them here) and remain excluded from expected GPA inside the embedded analysis.
`meta.heuristic` is always true; `meta.note` is the PRD planning-heuristic
sentence. This is a deterministic catch-up cost heuristic, not a prediction.

### Professor vibes (`GET /api/professors/{surname}/vibes`)

The path value is normalized with the same `normalize_instructor_key` used by
the loader (last whitespace token, lowercased, punctuation stripped). Distinct
published names that collide on one key remain merged; looking up either name
returns the same payload.

- **404** when the key is in neither `rmp.json` nor grade records (including
  instructors who only appear on sections, such as the synthetic HNFE
  instructor). `detail` is a string naming the key.
- **200** for partial data: `rmp` is `null` and `tags` empty when there is no
  RMP row; `grade_stats` is always present, with zero counts and null
  `avg_gpa` / `volatility` / `a_rate` when there are no grade records; notes
  explain the gaps.

Grade statistics use every grade record for that instructor key:
enrollment-weighted mean GPA and population σ (same formula as risk
volatility), `n_sections` = record count, `n_students` = sum of graded
enrollment, `a_rate` = enrollment-weighted `dist["A"]` only (not A + A−).
GPAs/volatility round to two decimals; `a_rate` to one (PRD 4).

Tags: `config.VIBE_TAG_LEXICON` is an ordered map of canonical tag → keyword
phrases. Each RMP tag and comment is searched case-insensitively; a canonical
tag is emitted when any phrase is a substring of an individual tag or comment.
Configured order is preserved, at most `MAX_VIBE_TAGS` (6), no LLM, no network.

Confidence:

- `high`: non-synthetic RMP with ≥ 20 reviews and ≥ 3 grade records
- `medium`: non-synthetic RMP with ≥ 5 reviews, or ≥ 3 grade records
- `low`: otherwise, **or** when every available RMP/grade row is synthetic

Placeholder RMP and grade rows are `synthetic_filler`, so committed-data vibes
are `low` and carry synthetic notes. The route never scrapes RateMyProfessors
or any other service.

### Risk engine (`POST /api/analyze`, default)

`main.run_analysis` is the only analysis entry point. With
`HOKIELENS_STUB_ANALYZE=0` (default) it calls `risk.analyze(sections, ctx)`.
There is no second scoring implementation in `main.py`.

All five factors are always returned in `config.FACTOR_ORDER`. Each raw severity
is clamped to `100 * W[factor]` then rounded to one decimal; `risk_score` is
`round(clamp(sum(those displayed values), 0, 100))` so the bars reproduce the
score. Commute points and `commute_warnings` come from the same
`commute_transitions` list (the Block 3 classifier).

**Workload** (7.4): a section is heavy when primary-instructor RMP difficulty
(or `DEFAULT_DIFFICULTY`) is ≥ `HARD_DIFFICULTY` (3.5).
`severity = max * min(1, n_heavy/3) * min(1, heavy_credits/15)`.

**Back-to-back** (7.5): every synchronous meeting; adjacent pairs whose dates
overlap and whose gap is 0–10 minutes are tight; an unbroken block is a maximal
run of such pairs. Day score = `max(0, contact_h − 4) + 2×tight_pairs + (3 if
longest block ≥ 3 h)`. Weekly score is summed and scaled by `/15`.

**Grade volatility** (7.7): standard-grade sections with ≥ 3 instructor-specific
records; enrollment-weighted population σ combined by current credits; scaled by
`VOLATILITY_MAX_SIGMA` (0.8). Pass/fail and short history contribute 0 and a note.

**Difficulty load** (7.8): credit-weighted mean difficulty of *all* selected
sections (including pass/fail): `max * clamp((mean − 2.5) / 2.0, 0, 1)`.

**Expected GPA** (7.9): pass/fail excluded (`reason=pass_fail`). Per remaining
section: instructor-specific records, else all `course_id` records + note, else
`no_grade_history`. Credit-weighted mean; RMS σ; `half_width = max(0.15, σ)`;
range clamped to [0, 4]. Evidence counts unique historical identities.
Confidence is `low` whenever any eligible section is synthetic-only (all
committed grade rows currently are).

The API does **not** emit a risk-band label. The 25–45 / 65–85 bands are test
acceptance criteria for the easy/brutal fixtures (PRD 10.2), not response fields.

### Stub analyze (`HOKIELENS_STUB_ANALYZE=1`)

`stub_analyze.py` returns a response that validates against the same
`AnalyzeResponse` model. Real parts: `sections` in request order, the `commute`
factor, `commute_warnings`, and instructor-collision `data_notes`. Placeholder
parts: the other four factors and expected GPA. `meta.data_notes[0]` starts with
`STUB:`. This is **not** normal scoring; leave the flag unset or `0`.

## Offline pipeline

Scripts live in `scripts/` and are **never imported by the server**. Importing a
script module does not write files, load `.env`, or make network calls. Run them
from this `backend/` directory. Outputs are UTF-8 JSON with sorted keys, indent 2, a
trailing newline, and atomic replace (temp file, never append). Re-running with
the same local input is byte-identical. Failures name the file/row and exit
nonzero. Constants live in `config.py`.

The committed `data/sections.json`, `data/grade_records.json`, and `data/rmp.json`
are generated from `data/raw/` by the commands below. Re-running with the same
inputs is byte-identical. Point `--output` at a temp path unless you intend to
replace production files. `tests/fixtures/pipeline/` is a separate tiny sample
used only by pipeline unit tests; it must not replace the calibrated catalog.

```powershell
python scripts/parse_udc.py --input-dir data/raw/udc --output data/grade_records.json --synthetic
python scripts/build_sections.py --input-dir data/raw/sections --buildings data/buildings.json --term-id 2026-fall --output data/sections.json
python scripts/build_rmp.py --input-dir data/raw/rmp --output data/rmp.json --synthetic --force
```

Do **not** run Google fetch scripts against the committed buildings or walk
matrix unless you also pass `--allow-network`, have `GOOGLE_MAPS_API_KEY` in the
process environment, and `--force` (required to replace `manual_fix` /
`manual_override`). Default is dry-run: no HTTP, no write.

The committed `data/*.json` catalog is **not** overwritten by tests.

### `parse_udc.py` — UDC grades → `grade_records.json`

```powershell
python scripts/parse_udc.py
python scripts/parse_udc.py --input-dir data/raw/udc --output data/grade_records.json --synthetic
```

Reads every `.txt` in `data/raw/udc/`. Each data row is pipe-delimited Markdown
or tab-delimited with the 23 PRD columns: Year, Term, Subject, CourseNo, Title,
Instructor, GPA, A, A−, B+, B, B−, C+, C, C−, D+, D, D−, F, Withdraws,
GradedEnrollment, CRN, Credits. Blank lines, Markdown separators, and the header
row are skipped. Unicode minus characters become ASCII `-`. Instructor names use
the shared join-key function. Malformed rows are logged as `file:line: reason`
and skipped. Identical identity duplicates are dropped; **conflicting** duplicates
are fatal. Default provenance is `source=udc_vt_edu`, `confidence=high`;
`--synthetic` writes `synthetic_filler` / `low`. Records sort by
`(course_id, instructor, academic_year, term, crn)`.

### `build_sections.py` — YAML/CSV → `sections.json`

```powershell
python scripts/build_sections.py
python scripts/build_sections.py --input-dir data/raw/sections --buildings data/buildings.json --term-id 2026-fall --output data/sections.json
```

YAML root is a list of section objects. CSV is one meeting per row; section
fields repeat on each row for that CRN. Times are 12-hour with AM/PM or
unambiguous 24-hour (`14:30` or hour 0). A bare `10:10` is fatal (ambiguous).
Day strings use longest-token matching (`Th` → `R`, `TTh` → `T,R`). Empty /
`online` / `web` / `arranged` / `tba` buildings become `null`. Output is
validated against the Section model, modality rules, unknown buildings (from
`--buildings`), course-level consistency, duplicate CRNs, and instructor-key
collisions (fatal here — stricter than server load). Sections sort by
`(course_id, crn)`; meetings by start, end, building.

YAML sketch:

```yaml
- crn: "91001"
  course_id: "CS 1114"
  title: "Introduction to Software Design"
  credits: 3
  instructor_names: ["Ada Lovelace"]
  modality: f2f
  seats_max: 40
  seats_available: 12
  meetings:
    - days: MWF
      start: "10:10 AM"
      end: "11:00 AM"
      building: MCB
      start_date: "2026-08-24"
      end_date: "2026-12-09"
```

### `build_rmp.py` — pasted RMP text → `rmp.json`

```powershell
python scripts/build_rmp.py
python scripts/build_rmp.py --input-dir data/raw/rmp --output data/rmp.json --report-unmatched
```

Each `.txt` contains one or more records separated by a `---` line:

```
NAME: Ada Lovelace
score: 4.4
difficulty: 3.6
n_reviews: 42
would_take_again: 88
tags: Tough Grader; Inspirational
comment: exams mirror the homework
```

Keys are the shared normalized surname. Conflicting duplicate keys are fatal;
identical duplicates are kept once. Default provenance is `rmp_paste` /
`medium`; `--synthetic` uses `synthetic_filler` / `low`. Existing
`manual_override` keys in the output file are preserved unless `--force`.
`--report-unmatched` lists section instructor keys missing from the new map.
The generated object is compatible with the loader and
`GET /api/professors/{surname}/vibes`.

### Optional Google scripts (opt-in network)

```powershell
python scripts/fetch_buildings.py --seed data/raw/seed/buildings_seed.json --dry-run
python scripts/fetch_walk_matrix.py --all --dry-run
```

Default is dry-run (no HTTP, no write), even if a key is present. Live calls
require **both** `--allow-network` and `GOOGLE_MAPS_API_KEY` in the process
environment. The key is never printed. `--force` is required to replace
`manual_fix` buildings or `manual_override` walk entries. `--all` fetches
pairs among **verified** buildings; `--only MCB,WHI` fetches one pair.
Missing key with `--allow-network` exits nonzero with an actionable message.
Tests never enable `--allow-network`.

## Tests

```powershell
python -m pytest -q
python -m ruff check .
python -m ruff format --check .
python -m compileall main.py config.py data.py models.py risk.py schedule.py stub_analyze.py scripts tests
```

Tests autoblock non-loopback TCP (`tests/conftest.py`). The trimmed acceptance
suite (not the full PRD §10 matrix) lives in `tests/test_loader.py`,
`tests/test_risk.py`, and `tests/test_api.py`.

Loader: strict happy path; duplicate CRN fatal in both modes; unknown building
codes in meetings and walk keys fatal in both modes; modality/meeting-building
rules; strict-versus-lenient for every non-always-fatal startup condition (wrong
term, modality, course-level metadata, duplicate grade identity, unknown demo
CRN); instructor-key collision is a warning with annotated sections; demo
fixture CRNs exist in the strict catalog.

Risk: easy 25–45 and exactly 41; brutal 65–85 and exactly 84; displayed
severities reproduce the score; maxima from `W`; commute boundaries including
equality and the two-minute optimism adjustment once; swap `delta` and
independent before/after analyze; pass/fail excluded from expected GPA (not a
zero-grade record); stress per-section cap, aggregate cap, and 100-point clamp;
deterministic analyze/swap/stress dumps; swap demo 49 → 19 (delta −30); easy
week-8 stress 41 → 46 (delta 5).

API: Pydantic success-model validation for all eight endpoints; OpenAPI `$ref`
to those models; structured 422 overlap shape; health counts match the loaded
context including warnings; real analyze with `HOKIELENS_STUB_ANALYZE=0`; stub
analyze still validates as `AnalyzeResponse`; no runtime network access.

Pipeline: committed `data/raw/` reproduces the served JSON byte-for-byte;
server AST import graph never includes `scripts`, `dotenv`, `httpx`, or
`requests`.

## Implementation Notes / Deviations

Choices made where the PRD (as amended) is silent, plus every amendment applied:

1. **Lenient mode (amendment).** `HOKIELENS_LENIENT=1` downgrades every fatal rule
   except parse/schema errors, duplicate CRNs, and unknown building codes to a
   warning with the exclusion behavior listed in the table above.
2. **Instructor-key collisions are never fatal (amendment).** Names are compared
   after whitespace collapse and case folding; distinct names sharing a key
   produce one warning, keep the merged key, and attach a note (stored in
   `DataContext.section_notes`, keyed by CRN) to every section listing that key.
   The stub already surfaces those notes in `meta.data_notes`.
3. **Demo fixture validation.** The PRD says to validate referenced CRNs at
   startup without naming the failure class; an unknown CRN is fatal in strict
   mode and a warning in lenient mode (fixture served as committed). The check
   runs after the ten PRD validations and before boot stats. Fixture file shapes
   are the exact sub-objects of the `/api/demo/schedules` response.
4. **Schema versus loader rules.** Intra-record constraints are model validators
   and therefore fatal in both modes: grade `dist` keys/range/sum, `start_min <
   end_min`, `start_date <= end_date`, `seats.available <= seats.max`,
   `course_id == "SUBJECT COURSE_NO"` (sections and grade records), uppercase
   `subject`, `academic_year` consecutive `YYYY-YY`, normalized grade
   `instructor` keys, nonblank instructor names, timezone-aware `fetched_at`.
   Data-file models reject unknown fields (`extra="forbid"`); JSON objects with
   duplicate keys are parse errors.
5. **Meeting/modality rules** are loader rules (PRD 5.6 step 4), not schema
   rules, so lenient mode can exclude the section instead of failing.
6. **Course-level consistency** uses the first section for a `course_id` in file
   order as canonical; only later differing sections are rejected/excluded.
7. **`instructors` boot stat** counts unique non-TBA join keys over *all*
   instructor names of retained sections, not only primary instructors.
8. **Synthetic detection** is `meta.source == "synthetic_filler"` (the value
   `parse_udc.py --synthetic` will emit), for grade and RMP records alike.
9. **TBA** means an instructor name equal to `TBA` (case-insensitive, stripped).
10. **Building `place_id`/`address`** are nullable so `geocode`/`manual_fix`
    entries can omit them; `fetched_at` may be null for hand-maintained records.
11. **Committed walk sources** are `google_routes` or `manual_override`;
    `default_fallback` is runtime-only. `BuildingsMatrixResponse.buildings` is
    always the full building map; only `walk` switches between minutes and full
    objects with `include_meta`.
12. **Request validation errors** (body/query shape) return 422 with a single
    deterministic string `detail` (`"body.crns: ..."`), not FastAPI's default
    list, so `detail` is always a string or the documented conflict object.
    Request bodies reject unknown fields; unknown query parameters are ignored.
13. **All eight routes are live.** Stress and vibes no longer answer 501.
    Offline pipeline scripts live in `scripts/` and are never imported by the
    server.
14. **Vibes contract**: `rmp` is `null` when the instructor has no RMP entry;
    `grade_stats` is always present with zero counts and null statistics when
    there are no grade records.
15. **Conflict detail**: `MeetingConflict {crns, day, start, end}` with `HH:MM`
    strings for the overlapping interval.
16. **Environment flags** are read with `os.environ` only; an unrecognized value
    aborts startup rather than silently defaulting.
17. **`stub_analyze.py`** is an extra top-level module (not in the PRD tree) so
    the optional `HOKIELENS_STUB_ANALYZE=1` path stays isolated. Default is off.
    This audit retains it as a contract-compatible testing path rather than
    deleting it (PRD 11.9 said to remove temporary analysis; the block-8
    delivery prompt keeps the flag and requires default-off real scoring).
18. **Duplicate grade identities** in lenient mode keep the first occurrence.
19. **Calibrated synthetic catalog** uses fictional CRNs (`9000x`), fictional
    instructors, and `verified=false` buildings. `schedule_easy` is CS 3114 +
    MATH 2534 + HNFE 1004 (pass/fail); `schedule_brutal` is five packed sections;
    `swap_demo` drops MATH 2534 for ENGL 1106. Scores: easy 41, brutal 84, swap
    49 → 19. Production code never special-cases those identities.
20. **Search matching.** `q` and `subject` are stripped; blank values are omitted.
    Matching uses Unicode case-folding substring search on `course_id`, `title`,
    and raw instructor names (not join keys). A matching course returns every
    section of that course. Order is `course_id` then CRN; there is no relevance
    rank because the PRD specifies `course_id` order.
21. **Matrix key order.** Building codes and walk keys are emitted
    lexicographically. The endpoint never synthesizes fallback pairs.
22. **`schedule.py`** is an extra pure module (not in the PRD tree) holding weekday
    timelines, overlap detection, and `HH:MM` formatting, shared by request-time
    validation (`main.py`) and the commute classifier (`risk.py`). No FastAPI
    imports.
23. **Commute adjacency** is decided on the full weekday timeline of all
    synchronous meetings: only *consecutive* pairs that are both physical and
    share dates form a transition. A pair whose date ranges do not overlap
    produces no transition and does not bridge to the next meeting, and an
    online meeting whose dates do not overlap still breaks adjacency. The PRD
    text is followed literally; per-date-segment timelines are not built.
24. **Same-building transitions** report `walk_min: 0` with
    `source: "default_fallback"` — the PRD defines only three sources and the
    zero is a rule, not a matrix or Google value — and the `detail` says "same
    building". By the PRD formula a same-building gap of 0–1 minutes is `tight`.
25. **Conflict ordering** (weekday, overlap start, end, CRNs) and the
    `MeetingConflict` shape `{crns, day, start, end}` are choices; the PRD only
    requires CRNs, weekday, and the overlap interval for every conflict.
26. **Swap result order**: `add_crn` replaces `drop_crn` at the same index (this
    matches the frontend PRD's "apply swap" behavior). An unknown `add_crn` is a
    swap-operation error (400), not a 422. Resolved/new warning counts use set
    difference over the PRD identity tuple.
27. **Validation before analysis.** Analyze and swap still return their contract
    400/422 errors first; only a fully valid request reaches `run_analysis`.
    Request-time validation is identical in strict and lenient mode; the
    amendment's lenient behavior applies to startup only.
28. **Stub commute is real.** The stub's `commute` factor and `commute_warnings`
    come from the same PRD 7.6 implementation as the real engine; the other four
    factors and expected GPA remain placeholders when the stub flag is on.
29. **No risk-band field.** The PRD 10.2 25–45 / 65–85 bands are fixture
    acceptance tests, not `AnalyzeResponse` fields. Adding a label would be a
    contract change.
30. **Rounding.** Displayed severities use banker's rounding to one decimal on
    the clamped raw value (`decimal.ROUND_HALF_EVEN`, matching Python `round`).
    The integer `risk_score` is the same rounding of their exact decimal sum.
    Expected-GPA mean and range bounds are rounded to two decimals for the
    response; internal combination uses unrounded credit-weighted means and RMS
    sigma. The PRD does not specify GPA display precision.
31. **Calibration (2026-09-19).** `W` and the PRD formula constants were not
    changed. The synthetic catalog was packed so the easy fixture scores **41**
    (band 25–45) and the brutal fixture **84** (band 65–85); swap_demo is
    **49 → 19** (delta −30). MATH 2534 starts 10 minutes after CS 3114 in
    Whittemore (MCB→WHI 18 min → impossible after optimism); CS 2505 (90007)
    starts 5 minutes later in Torgersen; PHYS 2305 starts 10 minutes after
    CS 2505 (90002) on TR. Each brutal instructor has three grade records.
    `risk.py` does not branch on fixture names. Block 7 regenerated
    `sections.json` / `grade_records.json` / `rmp.json` from committed
    `data/raw/` via the pipeline (`--synthetic`); buildings and walk times were
    left as `manual_fix` / `manual_override`. Easy week-8 stress is **41 → 46**.
    No PRD-required score correction.
32. **Stress penalty `reason` text.** The PRD specifies points, impact bands,
    and an example sentence, not a template. Reasons are built from the fired
    conditions in a fixed order (difficulty, credits, lab/recitation) with
    subject-verb agreement. Week never appears in the reason.
33. **Stress penalty order.** Positive-point rows follow request CRN order.
    Zero-point sections (including the easy-fixture pass/fail HNFE 1004 under
    default difficulty) are omitted, matching the PRD.
34. **Vibes tag matching.** Each lexicon phrase is a case-insensitive substring
    of an *individual* RMP tag or comment, not of a concatenated haystack, so a
    phrase cannot match across field boundaries. Lexicon entries and their
    phrases live only in `config.VIBE_TAG_LEXICON`.
35. **Vibes 404 vs section-only instructors.** A surname that appears on a
    loaded section but has no RMP row and no grade records is 404, because the
    PRD keys 404 off RMP ∪ grade records only. `detail` names the normalized
    key. Empty-after-normalize path values are also 404.
36. **Vibes rounding.** Mean GPA and volatility use PRD 4's two-decimal
    convention; `a_rate` uses one decimal. RMP score/difficulty/`would_take_again`
    are passed through as stored.
37. **Pipeline YAML/CSV schema.** The PRD names YAML or CSV inputs for
    `build_sections` but not the column layout. The documented list-of-section
    YAML (and CSV with one meeting per row) is the simplest mapping onto the
    Section model.
38. **RMP paste format.** The PRD asks for a documented simple text format.
    Records are `field: value` blocks separated by `---`, with `comment:` and
    `tags:` lines. Default provenance is `rmp_paste` / `medium`.
39. **Google `.env`.** PRD 8.4 says to read `GOOGLE_MAPS_API_KEY` from `.env`.
    The standing no-dotenv rule wins: scripts read the process environment only
    and never call `load_dotenv`. Live HTTP requires `--allow-network`.
40. **`build_sections` instructor collisions are fatal.** The server amendment
    keeps collisions as warnings at *load* time. The pipeline fails fast as
    PRD 8.2 specifies so a generated catalog does not silently merge names.
41. **UDC `YYYY-YYYY` years** collapse to `YYYY-YY` when the two calendar years
    are consecutive. Other year strings must already match the GradeRecord
    schema.
42. **Google `--all` uses verified buildings only.** Unverified committed
    buildings (`verified=false`) are not eligible for `--all`; `--only`
    still names an explicit pair.
