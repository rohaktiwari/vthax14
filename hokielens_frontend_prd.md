# HokieLens — Frontend PRD (v1)

> **Audience:** AI-assisted implementation (Cursor) and the frontend team.
> **Context:** 36-hour hackathon; frontend-only scope. The backend is specified separately by **HokieLens Backend PRD v2** and is the source of truth for API payloads.
> **Design reference:** The supplied HokieLens desktop mockup defines the visual direction: Virginia Tech branding, left-side search controls, a central campus hero, and a right-side map/schedule workspace.
> **Implementation rule:** Build the simplest polished implementation that satisfies this contract. Do not invent backend capabilities. If a control cannot be made functional with the existing API, omit it or label it clearly as unavailable rather than faking it.

---

## 0. Product Decision Summary

The reference image is visually strong but does not expose the product’s most important differentiator: the explainable schedule-risk analysis. This PRD preserves the image’s layout and styling while adding the minimum UI needed to surface the backend’s real capabilities.

Key decisions:

1. **Single-page planning workspace.** Search, selected sections, map, calendar, risk analysis, swaps, stress test, and professor details live in one dashboard.
2. **The screenshot is a visual reference, not a pixel-perfect contract.** The interface should feel the same while remaining responsive and accessible.
3. **No fake AI chat.** “HokieAI” is a branded help/insights surface powered only by existing deterministic backend responses. It must not imply a generative chat service.
4. **No live map dependency.** Use a committed campus map asset or simple local map illustration with positioned building markers. Do not require Google, Mapbox, or OpenStreetMap calls during the demo.
5. **The backend owns all calculations.** The frontend may format and visualize risk, GPA, commute, swap, and stress responses but must never recalculate them.
6. **The selected schedule is client-side state.** Encode selected CRNs in the URL so schedules can be refreshed and shared without accounts or backend persistence.
7. **Desktop-first, responsive rather than desktop-only.** The supplied layout is the desktop target; tablet and mobile use stacked panels.
8. **Demo safety is mandatory.** The frontend loads `/api/demo/schedules`; demo CRNs are never hardcoded.

---

## 1. Product Summary

Build a responsive web application that helps Virginia Tech students search for course sections, assemble a candidate schedule, visualize meeting locations and walking transitions, and understand the schedule’s academic and logistical risk.

The frontend must support:

1. Course and section search
2. Adding and removing sections from a candidate schedule
3. Meeting-overlap prevention and clear conflict errors
4. Weekly calendar visualization
5. Campus building and commute visualization
6. Composite risk score with explainable factor breakdown
7. Expected-GPA summary with confidence and data notes
8. Before/after section swaps
9. “Miss a week” stress testing
10. Professor vibes and historical statistics
11. Stable demo schedules
12. Shareable schedule URLs and printable/downloadable schedule views

**Mission:** Plan smarter. Understand the cost of a schedule before registration.

HokieLens is a planning aid. It does not predict an individual student’s grades, health, or success.

---

## 2. Goals and Non-Goals

### 2.1 Goals

- Make the core flow understandable without instructions: search → add sections → inspect schedule → analyze → improve.
- Present backend results without hiding uncertainty, synthetic data, or heuristic behavior.
- Make “Why is this schedule risky?” answerable in under 15 seconds.
- Keep the demo usable if external internet access is unavailable, provided the frontend and backend are running locally.
- Match the visual quality and structure of the supplied reference image.
- Give the frontend team a precise implementation and behavior contract.

### 2.2 Non-goals

- Registration, Banner submission, or seat reservation
- User accounts, authentication, saved schedules, cloud persistence, or collaboration
- Live seat updates
- A generative AI chatbot
- Degree audit, prerequisite validation, major-requirement validation, or graduation planning
- Live Google Maps, transit, weather, elevation, or routing
- Manual drag-and-drop rescheduling of fixed class meetings
- Editing course or instructor source data
- Predicting a student’s personal GPA or mental-health outcome

---

## 3. Users and Primary Jobs

### Primary user

A Virginia Tech student building a schedule for the configured catalog term.

### Primary jobs

1. “Find sections for the courses I want.”
2. “See whether the meetings overlap.”
3. “See what my week looks like.”
4. “Know whether I can physically get between consecutive classes.”
5. “Understand which courses or days make the schedule difficult.”
6. “Compare an alternative section without rebuilding everything.”
7. “Understand the quality and limits of the supporting data.”

### Secondary user

A hackathon judge or teammate using stable demo schedules to understand the product within two minutes.

---

## 4. Stack — Fixed

| Component | Choice |
|---|---|
| Language | TypeScript 5+ |
| Framework | React 18+ with Vite |
| Styling | Tailwind CSS |
| Data fetching/cache | TanStack Query |
| Local UI state | React state/context; no Redux |
| Routing and share state | React Router; selected CRNs stored in URL query parameters |
| Icons | Lucide React |
| Charts | CSS/SVG first; Recharts only if needed for the factor chart |
| Dates/times | Native `Intl` plus small local helpers; no Moment.js |
| Testing | Vitest + React Testing Library + MSW |
| End-to-end smoke test | Playwright |
| Lint/format | ESLint + Prettier |
| Build command | `npm run build` |
| Development command | `npm run dev` |

Do not introduce a full UI framework such as Material UI, Chakra, or Ant Design. The supplied design requires custom composition, and adding a second design system creates unnecessary hackathon overhead.

### 4.1 Runtime configuration

Use one environment variable:

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

Production-like builds may set it to a deployed API URL. The frontend must not contain hardcoded hostnames outside the environment default helper.

---

## 5. Repository Structure

```text
/
├─ index.html
├─ package.json
├─ vite.config.ts
├─ tailwind.config.ts
├─ tsconfig.json
├─ .env.example
├─ public/
│  ├─ brand/
│  │  ├─ vt-mark.svg
│  │  ├─ hokielens-wordmark.svg
│  │  └─ hokie-mascot.png
│  ├─ images/
│  │  ├─ burruss-hero.webp
│  │  └─ campus-map.webp
│  └─ fonts/
├─ src/
│  ├─ main.tsx
│  ├─ App.tsx
│  ├─ api/
│  │  ├─ client.ts
│  │  ├─ hooks.ts
│  │  └─ types.ts
│  ├─ components/
│  │  ├─ AppHeader.tsx
│  │  ├─ SearchSidebar.tsx
│  │  ├─ CourseResults.tsx
│  │  ├─ SectionCard.tsx
│  │  ├─ HeroPanel.tsx
│  │  ├─ CampusMap.tsx
│  │  ├─ WeeklyCalendar.tsx
│  │  ├─ ScheduleToolbar.tsx
│  │  ├─ RiskOverview.tsx
│  │  ├─ FactorBreakdown.tsx
│  │  ├─ CommuteWarnings.tsx
│  │  ├─ ExpectedGpa.tsx
│  │  ├─ SwapWorkbench.tsx
│  │  ├─ StressTest.tsx
│  │  ├─ ProfessorDrawer.tsx
│  │  ├─ DataNotes.tsx
│  │  ├─ DemoPicker.tsx
│  │  ├─ ErrorState.tsx
│  │  ├─ EmptyState.tsx
│  │  └─ Skeleton.tsx
│  ├─ context/
│  │  └─ ScheduleContext.tsx
│  ├─ hooks/
│  │  ├─ useScheduleUrl.ts
│  │  └─ useResponsiveLayout.ts
│  ├─ lib/
│  │  ├─ schedule.ts
│  │  ├─ time.ts
│  │  ├─ mapProjection.ts
│  │  ├─ share.ts
│  │  └─ accessibility.ts
│  ├─ pages/
│  │  └─ PlannerPage.tsx
│  ├─ styles/
│  │  └─ globals.css
│  └─ test/
│     ├─ handlers.ts
│     └─ fixtures.ts
└─ tests/
   └─ planner.spec.ts
```

Keep API response types centralized in `src/api/types.ts`. UI components must not redefine partial, incompatible versions of backend models.

---

## 6. Information Architecture

The application is one main route:

```text
/?crns=83522,83545,87236
```

Optional UI-only query parameters:

```text
?crns=...&panel=insights
?demo=brutal
```

Canonical state is the `crns` parameter. `demo` is converted to fixture CRNs after `/api/demo/schedules` loads; it is not treated as a source of schedule data by itself.

### 6.1 Desktop regions

1. **Global header** — brand, global search focus action, status, profile placeholder
2. **Search sidebar** — filters, course results, and add-section actions
3. **Hero/selection panel** — Burruss visual when empty; selected-course summary when active
4. **Planning workspace** — campus map, weekly schedule, and insights
5. **HokieAI help button** — opens contextual explanation, not free-form AI chat

### 6.2 Responsive regions

- **Desktop, 1200px and above:** three-column layout similar to the supplied image.
- **Tablet, 768–1199px:** collapsible search drawer on the left; workspace occupies the remainder; hero becomes a compact banner.
- **Mobile, below 768px:** single column with sticky top bar and bottom navigation: `Search`, `Schedule`, `Insights`.

No critical action may require hover.

---

## 7. Visual Design Contract

### 7.1 Brand direction

The application should feel official and Virginia Tech-adjacent without claiming to be an official university service.

Use the following tokens:

```text
Primary maroon:       #861F41
Primary maroon dark:  #5E1230
Burnt orange accent:  #E87722
Warm background:      #F7F5F4
Panel background:     #FFFFFF
Soft maroon surface:  #F7EEF2
Text primary:         #1E2430
Text secondary:       #667085
Border:               #E4E7EC
Success:              #18794E
Warning:              #B54708
Danger:               #B42318
Info:                 #175CD3
```

Use CSS custom properties so exact tones can be adjusted once without changing components.

### 7.2 Typography

- Primary font: `Inter`, `Source Sans 3`, or a committed equivalent.
- Display/brand headings may use a slightly heavier geometric sans serif.
- Body text minimum: 14px desktop and 16px for form fields on mobile.
- Do not place body text directly over a photograph without a contrast overlay.

### 7.3 Shape and elevation

- Panels: 10–14px radius
- Inputs and buttons: 6–10px radius
- Shadows: restrained; use borders to establish structure
- Active controls: maroon background or maroon border, not color alone
- Minimum interactive target: 44×44 CSS pixels

### 7.4 Desktop composition

Target proportions based on the supplied reference:

- Header: approximately 56–64px high
- Search column: 250–300px
- Hero/selection column: 38–44% of remaining width
- Workspace column: 38–44% of remaining width
- Page minimum useful width: 1024px
- Overall content height: viewport minus header; individual columns may scroll independently

### 7.5 Hero behavior

When no sections are selected, show the Burruss image and short brand message.

When sections are selected, retain the image as a reduced-height header or background but prioritize:

- Selected section count
- Total credits
- Current term
- Analyze status
- Clear-schedule action

The hero must never consume most of the viewport on mobile.

### 7.6 Use of Virginia Tech marks

Only use supplied or legally permitted brand assets. Include a footer disclaimer:

> HokieLens is a student-built planning tool and is not an official Virginia Tech registration service.

---

## 8. Core Application State

### 8.1 Selected schedule

Store selected CRNs as an ordered, de-duplicated string array.

Rules:

- URL is the durable client-side representation.
- Maximum 12 CRNs, matching backend validation.
- Preserve user selection order when calling `/analyze`.
- Removing a section updates the URL and invalidates analysis-dependent queries.
- On page load, parse, trim, and de-duplicate CRNs before requesting data.
- Do not silently remove unknown CRNs. Show the backend error and offer “Remove invalid sections.”

### 8.2 Server state

TanStack Query owns:

- Search results
- Building matrix
- Analysis
- Swap previews
- Stress result
- Professor vibes
- Health status
- Demo fixtures

Do not copy full server responses into context or local storage.

### 8.3 Local UI state

React state/context may own:

- Open/closed drawers and dialogs
- Search filter values
- Active workspace panel
- Selected swap candidate
- Stress-test week
- Calendar display density
- Toast messages

### 8.4 Persistence

No account storage exists. The URL is sufficient for refresh/share. Optional local storage may remember purely cosmetic preferences such as the last active panel, but it must not become the canonical schedule store.

---

## 9. Backend Integration Contract

The backend PRD v2 is authoritative. The frontend must handle all fields documented below and tolerate additive fields.

### 9.1 API client rules

- Prefix requests with `VITE_API_BASE_URL`.
- Set `Content-Type: application/json` for JSON bodies.
- Use `AbortSignal` to cancel superseded searches.
- Parse FastAPI errors from `detail`, which may be a string or object.
- Never retry 400, 404, or 422 responses automatically.
- Retry idempotent GET requests once for network failure or 5xx errors.
- Do not retry POST requests automatically.
- Use a 10-second timeout and show a recoverable timeout state.
- Never calculate a risk score, expected GPA, stress penalty, or swap delta locally.

### 9.2 Endpoint mapping

| Endpoint | UI consumer |
|---|---|
| `GET /api/health` | Header API-status indicator and startup diagnostics |
| `GET /api/courses/search` | Search sidebar and global search |
| `GET /api/buildings/matrix` | Campus map labels and walk display |
| `POST /api/analyze` | Risk overview, factors, commute warnings, expected GPA, data notes |
| `POST /api/swap` | Swap workbench before/after comparison |
| `POST /api/stress` | Miss-a-week scenario panel |
| `GET /api/professors/{surname}/vibes` | Professor drawer |
| `GET /api/demo/schedules` | Demo picker and judge-safe startup actions |

### 9.3 Search request

```text
GET /api/courses/search?q={query}&subject={subject}&limit={limit}
```

The frontend may derive course-level or availability filters from returned section fields, but it must label them as client-side filters. It must not send unsupported parameters.

### 9.4 Analyze request

```json
{
  "crns": ["83522", "83545"]
}
```

Only request analysis when at least two sections are selected. With one selected section, show a prompt to add another section.

### 9.5 Structured conflict errors

A 422 response may include:

```json
{
  "detail": {
    "code": "meeting_overlap",
    "message": "Selected sections overlap",
    "conflicts": []
  }
}
```

Render every returned conflict. Do not reduce the error to a generic toast.

### 9.6 Swap request

```json
{
  "current_crns": ["83522", "83545", "87236"],
  "drop_crn": "83545",
  "add_crn": "83601"
}
```

The frontend previews the returned `before`, `after`, and `delta`. It modifies the selected schedule only after explicit user confirmation.

### 9.7 Stress request

```json
{
  "crns": ["83522", "83545"],
  "scenario": "miss_week",
  "week": 8
}
```

The frontend must display the backend disclaimer that this is a deterministic heuristic, not a prediction.

---

## 10. Screen and Component Requirements

## 10.1 App Header

Desktop layout:

- Left: VT mark, “HokieLens,” and subtitle “Plan Smarter. Study Happier.”
- Center/right: global course search trigger or input
- Right: API status icon and a neutral profile/avatar placeholder

Behavior:

- Clicking the global search focuses or opens the search sidebar.
- Health status uses accessible text:
  - Green: `API connected`
  - Amber: `API connected with data warnings`
  - Red: `API unavailable`
- Do not show a notification bell unless notifications exist. A nonfunctional bell from the mockup should be replaced by the health indicator.
- The avatar is decorative in MVP and must not imply an authenticated user. It may open an “About HokieLens” popover.

## 10.2 Search Sidebar

The left panel contains:

1. Search input
2. Term display
3. Subject filter
4. Course-level filter
5. “Only open classes” toggle
6. Expandable “More filters” area
7. Search/results region

### Search behavior

- Debounce text search by 250ms.
- Search automatically after two characters; also support an explicit button and Enter.
- Empty query may request the first 20 course groups.
- Subject values are derived from loaded search results or a small committed display list. If derived, include an `All subjects` option.
- Term is read from `/api/health.term_id`; it is display-only because the backend serves one configured term.
- Course level is a client-side filter inferred from the first digit of `course_no`.
- “Only open classes” filters sections where `seats.available > 0`.
- Do not implement “Only major requirements”; the backend has no degree-program context. If retained visually, it must be disabled and labeled `Requires degree audit data`.

### Results

Results replace or appear beneath filters in the sidebar. Each course group shows:

- Course ID and title
- Credits
- Section count
- Expand/collapse control

Each section row shows:

- CRN
- Instructor or `TBA`
- Meeting summary
- Building/modality
- Seat availability
- Add/remove button
- Conflict indicator if an attempted add is rejected

Do not treat seat availability as live. Add a tooltip: `Seat counts reflect the committed catalog snapshot.`

## 10.3 Section Selection

When the user clicks `Add`:

1. Add the CRN to the URL state.
2. If total selected sections is at least two, call `/api/analyze`.
3. If analysis succeeds, keep the selection.
4. If the backend returns unknown CRN, duplicate CRN, or overlap validation, revert the attempted add and show the exact reason.
5. For overlap errors, highlight both conflicting calendar events if they are available.

Because analysis validates the full schedule, the frontend must not rely solely on local overlap detection. A local overlap preview may be used for immediate feedback, but backend validation remains authoritative.

## 10.4 Campus Map

The map is a schematic visualization, not a navigation application.

Requirements:

- Use a committed local campus map image or SVG.
- Position markers with a deterministic local latitude/longitude projection helper.
- Show buildings used by the selected schedule.
- Draw dashed lines for chronological adjacent in-person transitions by weekday.
- Emphasize warning transitions returned by `/api/analyze`.
- Clicking a marker highlights associated calendar events.
- Clicking a transition opens its walk/gap detail.
- Include a weekday selector when different days have different routes.
- Include a legend for selected building, tight transition, and impossible transition.

Fallback:

If coordinates or the map asset are unavailable, render a clear ordered list of daily building transitions. The planner must remain usable.

Do not load third-party map tiles or call routing services from the browser.

## 10.5 Weekly Calendar

Desktop default:

- Monday through Friday columns
- 8:00 AM–6:00 PM visible range
- Extend earlier/later when selected meetings require it
- Optional weekend columns only when a selected meeting occurs Saturday or Sunday
- Time grid at 30-minute intervals

Event cards show:

- Course ID
- Building and room, or online modality
- Start/end time when space permits
- Instructor on hover/focus or expanded view

Rules:

- Position events using meeting minutes from midnight.
- Render each meeting day separately.
- Use course-stable colors based on a deterministic palette and course ID hash.
- Do not encode risk solely through course color.
- Visually connect an event selected on the map.
- Show date-range details in the event popover because meetings may not span the entire term.
- Touching meetings are allowed; overlapping meetings are backend-invalid.

Calendar color palette must meet text contrast requirements. Avoid using maroon for every class because warnings also use maroon/red.

## 10.6 Schedule Toolbar

Provide:

- Selected section count
- Total credits calculated from selected section objects
- `Clear schedule`
- `Print / Download`
- `Share`
- Demo schedule selector

### Share

- Copy the current URL containing ordered CRNs.
- Use Web Share API when available, otherwise clipboard.
- Show a confirmation toast.
- Never claim the schedule is publicly saved.

### Print / Download

Use a print stylesheet and `window.print()` for MVP. The print view includes:

- Term
- Selected courses and CRNs
- Weekly calendar
- Risk score and top factors
- Commute warnings
- Planning-aid disclaimer

Do not add a PDF library unless browser printing is demonstrably insufficient.

## 10.7 Risk Overview

Display when a valid analysis exists.

Required content:

- Risk score from 0–100
- Human-readable band
- One-sentence summary
- Factor breakdown
- Expected GPA range and confidence
- Commute warnings
- Data notes and heuristic disclaimer

Risk bands are presentation-only labels:

| Score | Label | Color intent |
|---:|---|---|
| 0–24 | Low | green |
| 25–49 | Moderate | blue/teal |
| 50–69 | High | amber |
| 70–100 | Very high | red/maroon |

These labels do not modify or reinterpret the backend score.

The primary score must not be shown as an unsupported precision gauge. A large integer plus a segmented bar is preferred over a speedometer.

## 10.8 Factor Breakdown

Render factors in backend order. Each factor shows:

- Display name
- Severity and maximum severity
- Proportional bar
- Backend detail text
- Affected courses/CRNs

Display names:

```text
workload_collision   → Heavy-course load
back_to_back_density → Back-to-back density
commute               → Walking pressure
grade_volatility      → Grade volatility
difficulty_load       → Instructor difficulty
```

The frontend may map known factor identifiers to friendly labels but must preserve unknown factors with a title-cased fallback.

Do not hide factors with a zero severity; show them in a collapsed `No added risk` group or include them with a zero bar.

## 10.9 Commute Warnings

For each returned warning, show:

- Day
- From/to course and building
- End/start times
- Actual walk minutes
- Adjusted walk minutes when provided
- Available gap
- Verdict
- Backend detail

Verdict styling:

- `tight`: amber
- `impossible`: red

The frontend must not recreate verdict thresholds from configuration values. It displays the backend verdict exactly.

## 10.10 Expected GPA

Display:

- Mean when present
- Range
- Confidence badge
- Number of historical students
- Number of terms
- Excluded sections

Required explanatory copy:

> Historical grade data describes past sections and is not a prediction of your grade.

Synthetic or representative data notes must remain visible, not hidden behind an unlabeled tooltip.

## 10.11 Swap Workbench

Entry points:

- `Compare another section` on a selected section
- `Improve this schedule` in the insights panel

Flow:

1. User chooses a selected section to drop.
2. UI shows alternative sections from the same course when possible.
3. User chooses an add candidate.
4. Frontend calls `/api/swap`.
5. Show risk before/after, delta, warning changes, and changed meeting times/buildings.
6. User confirms `Apply swap` or cancels.
7. Applying replaces `drop_crn` with `add_crn` at the same index in URL state.

Delta display:

- Negative delta: improvement
- Zero: no score change
- Positive delta: increased risk

Never infer improvement from color alone. Include text such as `Risk decreases by 16 points`.

If the resulting schedule is invalid, show all backend conflict details and do not offer confirmation.

## 10.12 Stress Test

Controls:

- Scenario fixed to `Miss one week`
- Week selector from 1–16
- `Run stress test` button

Results:

- Original risk
- Stressed risk
- Delta
- Per-course penalties with impact and reason
- Backend heuristic note

The selected week is a narrative input only; do not suggest that the backend knows assignments or exam dates.

Required copy:

> This is a deterministic catch-up-cost heuristic, not a forecast of academic performance.

## 10.13 Professor Drawer

Open by clicking an instructor name.

Show:

- Full display name from section data when available
- RMP score, difficulty, review count, and would-take-again percentage
- Deterministic vibe tags
- Historical GPA, volatility, section count, student count, and A rate
- Confidence
- Data notes

Partial data behavior:

- Null RMP fields: `No review summary available`
- Empty grade stats: `No matching grade history available`
- 404: `No instructor data found`

Do not link to or scrape RMP at runtime unless a future backend field explicitly provides a URL.

## 10.14 HokieAI Help Surface

The floating mascot button and `HokieAI` navigation item may remain as branding, but their behavior is constrained.

MVP behavior:

- Opens a panel called `Ask HokieLens`.
- Offers predefined prompts based on available data:
  - `Why is my risk high?`
  - `Which commute is hardest?`
  - `What does GPA confidence mean?`
  - `How can I compare sections?`
- Answers are assembled from the current backend response and committed explanatory text.
- No free-form text generation and no external API call.

If predefined help cannot be completed, replace the feature with a simple `How HokieLens works` panel. Do not ship a fake text input that cannot answer.

## 10.15 Demo Picker

Load `/api/demo/schedules` at startup or on first open.

Show actions:

- `Balanced schedule`
- `The wall of pain`
- `Swap demo`

Selecting a demo replaces the current schedule after confirmation if the user has existing selections.

For `swap_demo`, load `current_crns` and preconfigure the swap workbench with `drop_crn` and `add_crn`.

---

## 11. Loading, Empty, Error, and Offline States

### 11.1 Startup

- Render the shell immediately.
- Fetch health and demo fixtures in parallel.
- Do not block search on demo fixture failure.
- Show skeletons rather than a full-page spinner.

### 11.2 Empty schedule

Show:

- Burruss hero image
- Short mission statement
- Three-step instruction: search, add, analyze
- Demo schedule buttons

### 11.3 One selected section

Show the event on the calendar and its building on the map. Replace analysis with:

> Add at least one more section to calculate schedule risk.

### 11.4 API unavailable

- Preserve current URL schedule state.
- Show a persistent, nonmodal banner.
- Search and analysis surfaces show retry actions.
- Static hero, about content, and previously cached query data may remain visible.
- Never display stale data without a `Previously loaded` indicator.

### 11.5 Error normalization

Create one helper that converts:

- network failures
- HTTP status errors
- FastAPI string `detail`
- FastAPI object `detail`
- unexpected payloads

into a consistent UI error model.

Do not expose raw stack traces or `[object Object]`.

### 11.6 No search results

Show the active query and filters, plus `Clear filters`. Do not suggest that the course does not exist outside the configured catalog term.

---

## 12. Accessibility Requirements

Target WCAG 2.1 AA for the implemented flows.

Required:

1. Full keyboard access to search, results, calendar events, drawers, dialogs, and tabs.
2. Visible focus states.
3. Semantic buttons, labels, headings, lists, tables, and dialogs.
4. Dialog focus trap and focus restoration.
5. `aria-live="polite"` for search counts, add/remove confirmations, and completed analyses.
6. Color contrast of at least 4.5:1 for normal text.
7. Risk and warning meaning communicated through text/icons as well as color.
8. Map information duplicated in a textual transition list.
9. Calendar events accessible as a chronological list on mobile and to screen readers.
10. Respect `prefers-reduced-motion`.
11. Decorative images use empty alt text; informative images have concise alt text.
12. Form validation errors are associated with their fields.

Do not use inaccessible drag-and-drop as the only way to change a schedule.

---

## 13. Performance Requirements

Measured on a typical modern laptop using the committed demo dataset:

- Initial production bundle target: under 350 KB gzipped excluding local images/fonts
- First meaningful shell render: under 1.5 seconds on local development backend
- Search interaction response: show pending feedback within 100ms
- Calendar/map update after selection: under 100ms after data is available
- Avoid rerendering the entire planner on hover or marker focus
- Lazy-load the professor and stress panels
- Convert the hero image to WebP/AVIF and keep it below 500 KB where practical
- Do not ship an entire mapping SDK for a schematic campus view

---

## 14. Analytics and Privacy

Analytics are out of scope for the hackathon unless explicitly required by the event.

If added later:

- Do not collect names, student IDs, or free-form user text.
- Treat selected CRNs as potentially sensitive behavioral data.
- Obtain approval before sending schedules to a third-party analytics service.

The MVP must not require cookies.

---

## 15. Testing Requirements

### 15.1 Unit tests

Test:

- URL CRN parsing, ordering, and de-duplication
- Time formatting
- Course-level inference
- Course color stability
- Map coordinate projection
- API error normalization
- Risk-band presentation labels
- Share URL construction

Do not unit-test backend formulas in the frontend repository.

### 15.2 Component tests

Using React Testing Library and MSW:

- Search renders grouped courses and sections
- Open-only filter removes closed sections
- Add/remove updates URL state
- One section does not call analyze
- Two sections call analyze with ordered CRNs
- Structured overlap error renders every conflict
- Risk factors render backend values unchanged
- Synthetic data notes are visible
- Professor partial-data state renders correctly
- Swap preview does not mutate the schedule before confirmation
- Confirmed swap replaces the correct CRN
- Stress disclaimer is visible
- API outage shows retry state

### 15.3 End-to-end smoke test

Playwright happy path:

1. Open the planner.
2. Load the brutal demo.
3. Confirm calendar events and risk analysis appear.
4. Open a commute warning.
5. Run the miss-week stress test.
6. Load the swap demo.
7. Preview and apply the swap.
8. Confirm the URL and risk result update.
9. Copy the share link.

### 15.4 Visual checks

At minimum capture screenshots at:

- 1440×900 desktop
- 1024×768 tablet landscape
- 390×844 mobile

Check empty, loading, populated, conflict, and API-error states.

---

## 16. Delivery Order

Build in this sequence:

1. Vite/Tailwind shell, brand tokens, and responsive page regions
2. Typed API client, health check, error normalization, and MSW fixtures
3. Search sidebar with grouped course/section results
4. URL-backed selected schedule state and add/remove behavior
5. Weekly calendar
6. `/api/analyze` integration with risk, factor, GPA, and notes surfaces
7. Campus map and textual commute list
8. Demo picker
9. Swap workbench
10. Stress test
11. Professor drawer
12. Share and print styles
13. HokieLens contextual help panel
14. Accessibility pass, responsive pass, tests, and visual polish

For frontend/backend parallel work, implement against MSW fixtures matching the backend PRD and switch only the API base URL when the backend is ready.

---

## 17. Demo Script

The final product should support this two-minute demo without manual data entry:

1. Open HokieLens and show the balanced, branded empty state.
2. Select `The wall of pain` from the demo picker.
3. Point out the weekly calendar and map transitions.
4. Open the high risk score and identify the top two factors.
5. Show a tight or impossible commute with walk time versus schedule gap.
6. Run `Miss one week` and show the deterministic uplift and disclaimer.
7. Open `Swap demo`, compare the alternative, and apply it.
8. Show the reduced risk score and resolved warnings.
9. Copy the shareable URL.

The demo must not depend on typing exact CRNs or on external map services.

---

## 18. Out of Scope

Do not build:

- Login, SSO, accounts, profiles, or saved schedules
- Registration submission
- Real-time seat polling
- A database or frontend persistence service
- A generative AI chatbot
- Live map tiles or browser-side Google API calls
- Degree audit or major-requirement filtering
- Prerequisite parsing or validation
- Exam visualization
- Bus, transit, weather, or elevation features
- Push notifications
- Social feeds or public schedule discovery
- Drag-and-drop movement of fixed class meetings
- Admin/data-entry interfaces
- Native mobile applications

---

## 19. Acceptance Criteria

- [ ] The production build completes with `npm run build` and runs without TypeScript errors.
- [ ] The desktop layout clearly reflects the supplied design: branded header, search sidebar, Burruss visual treatment, campus map, and weekly schedule.
- [ ] The interface is usable at 390px, 768px, 1024px, and 1440px widths without horizontal page overflow.
- [ ] Search uses `/api/courses/search` and supports query, subject, course-level, and open-section filtering without sending unsupported API parameters.
- [ ] The selected CRNs are ordered, de-duplicated, limited to 12, and encoded in the URL.
- [ ] A shared schedule URL restores the same selected CRNs after refresh.
- [ ] The frontend calls `/api/analyze` only with at least two sections and displays backend scores, factors, GPA, warnings, and notes without recalculation.
- [ ] Meeting-overlap errors list all conflicts returned by the backend.
- [ ] The calendar correctly places meetings from minutes-since-midnight data and supports meetings outside the default visible range.
- [ ] The campus map uses local assets and makes no external routing or tile requests.
- [ ] All map warnings have an equivalent textual representation.
- [ ] `/api/swap` previews before/after results and changes the selected schedule only after confirmation.
- [ ] `/api/stress` shows original risk, stressed risk, delta, penalties, and the heuristic disclaimer.
- [ ] Professor vibes support full, partial, empty, and 404 states.
- [ ] Demo schedules come from `/api/demo/schedules`; no demo CRNs are hardcoded in components.
- [ ] Share copies a restorable URL; print output includes the schedule and core analysis.
- [ ] No UI control falsely implies live data, registration capability, authentication, or generative AI.
- [ ] Keyboard-only users can complete search, add, analyze, swap, stress, and share flows.
- [ ] Automated unit/component tests and the Playwright smoke test pass.
- [ ] The app remains demonstrable with external internet disabled while the local frontend and backend are running.

---

## 20. Definition of Done

The frontend is done when a first-time user can load a demo or find sections, build a valid schedule, understand its calendar and walking constraints, explain the risk score, compare a swap, run the stress scenario, inspect professor data, and share the schedule—all without unsupported calculations, dead controls, external runtime dependencies, or knowledge of CRNs.