# HokieLens — Frontend

HokieLens is a responsive web app that helps Virginia Tech students search course sections,
assemble a candidate schedule, visualize meetings and walking gaps, and understand the academic
and logistical risk of a week — before registration. This repository is the browser frontend.

## Stack

- Vite + React 18 + TypeScript (strict)
- Tailwind CSS (brand tokens as CSS custom properties in `src/styles/globals.css`)
- TanStack Query, React Router
- Vitest + React Testing Library + MSW (component/unit tests)
- Playwright (browser end-to-end smoke test)

## Prerequisites

- Node.js 18 or newer and npm.
- For the Playwright test only: the Chromium browser downloaded by
  `npx playwright install chromium`. No backend is required for any test.

## Setup

```powershell
npm install
cp .env.example .env.local   # optional; the default already points at the local API
```

Environment (frontend-owned):

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

The value already includes the `/api` prefix. API hosts must never be hardcoded in components;
all requests go through `VITE_API_BASE_URL` in `src/api/client.ts`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite dev server (default <http://localhost:5173>) |
| `npm run build` | Type-check (`tsc --noEmit`) and produce a production build in `dist/` |
| `npm run lint` | ESLint (flat config) across the frontend |
| `npm test` | Vitest unit/component tests (MSW-backed; no backend needed) |
| `npm run test:e2e` | Playwright end-to-end smoke + responsive/state tests |
| `npm run preview` | Preview the production build |

The Playwright test starts the Vite dev server itself on <http://localhost:4173> with
`VITE_API_BASE_URL=/api` and fulfills the documented API routes at the browser boundary with
contract-matching fixtures, so the e2e suite needs neither the backend nor the internet. Screenshots
from the responsive checks are written under `test-results/` (gitignored).

## Running against the separately supplied backend

The HokieLens backend lives in `backend/` (see `backend/README.md`). Install its Python
dependencies from the repository root with `pip install -r requirements.txt`, which pulls
`backend/requirements.txt`. Then:

```powershell
pip install -r requirements.txt
cd backend
uvicorn main:app
```

The frontend expects the eight documented endpoints under `/api`: health, course search, buildings
matrix, analyze, swap, stress, professor vibes, and demo schedules.

1. Start the backend in its own process, using its own documentation.
2. Point the frontend at it with `VITE_API_BASE_URL` (for example
   `VITE_API_BASE_URL=http://localhost:8000/api` in `.env.local`).
3. Run `npm run dev` and open <http://localhost:5173>.

The frontend setup and test commands never start, modify, or depend on backend code; `backend/` is
strictly read-only.

## Architecture notes

- The selected schedule is the ordered, de-duplicated `crns` URL parameter (max 12). It is the only
  durable schedule state; full `Section` objects live in an in-memory cache and are never persisted
  to local storage.
- All risk, GPA, commute, swap, stress, validation, and confidence values come from the backend and
  are only formatted and visualized here.
- The campus map is a committed local schematic (`public/campus-map.svg`) plus the backend buildings
  matrix. There are no map tiles, routing services, generative AI, accounts, or seat polling.
- MSW is used only for browser development and frontend tests under `src/test/`; there is no
  standalone mock API server.

## Known limitations

- The documented API has no section-by-CRN endpoint, so a schedule restored from the URL (or loaded
  from a demo, which provides CRNs only) cannot hydrate full `Section` objects by itself. Search
  results are the only source of `Section` data. CRNs without cached details are surfaced honestly
  as "details unavailable" with a remove action, and are never replaced with fabricated data.
- "Print / Download" uses the browser's native print dialog and a print stylesheet; no PDF library
  is bundled.
- Share prefers the Web Share API and otherwise copies the canonical URL to the clipboard. A
  cancelled share shows no toast; an unavailability/failure shows an error toast.
- Ask Gemini (see below) is optional and off unless the backend has a Gemini key. Without it the
  chat shows a friendly fallback and every planner surface still works.
- The Playwright suite runs against frontend-owned browser fixtures, not a live backend.

## Manual visual / regression checks

Automated overflow checks and screenshots cover the required widths in
`tests/planner.spec.ts` (empty, populated, conflict, API-error, and loading states). To review the
full matrix by hand, run `npm run dev` and confirm there is no page-level horizontal overflow and
that each state stays readable:

| Width | What to verify |
| --- | --- |
| 1440×900 desktop | Three columns fit; sidebar, map, calendar, insights, and stress all visible. |
| 1024×768 tablet/desktop | Desktop columns still fit at the `lg` breakpoint; no clipping. |
| 768×1024 tablet | Two-column workspace; search opens as a focus-trapped drawer. |
| 390×844 mobile | Single column behind the Search / Schedule / Insights bottom nav; content scrolls vertically only. |

How to reproduce each state locally:

- Empty: open `/` with a cleared schedule.
- Loading: throttle the network (or open before the API responds) and observe the skeleton states.
- Populated: select `The wall of pain` from the demo picker (or open `/?crns=90001,90003,90002`).
- Conflict: choose two sections whose meetings overlap and read every conflict in the error list.
- API error: stop the backend (or block `/api`) and confirm each surface shows a retryable error.

## Ask Gemini chat

The help panel is an optional chat (`src/components/AskGemini.tsx`) that talks to the backend
proxy, never to Google directly, so the API key stays server-side.

- `GET /api/chat/status` reports whether the server has a key configured (`{enabled}`).
- `POST /api/chat` sends the question plus the current schedule CRNs. The server re-runs the
  analysis and grounds Gemini's answer in it, so the model never invents scores or sections.
- Both routes are hidden from OpenAPI and do not change the eight planner routes or any response
  field. Requests are rate limited, and a missing key, quota (429), or timeout returns a normal
  reply with a fallback notice instead of an error.
- Enable it by setting `HOKIELENS_GEMINI=1` and `GEMINI_API_KEY` in the backend's environment; see
  `backend/README.md` for the full contract.

## Sponsor prizes

The planner UI is unchanged. Prize add-ons live in `backend/sponsors/` and are
documented in `backend/README.md`. From `backend/`, `python -m sponsors.demo`
is the two-minute script.

- **Deloitte x Databricks:** import `backend/sponsors/databricks/HokieLens_Student_Impact.py`
  and show easy **41** vs brutal **84**, then the **49 -> 19** swap.
- **Gemini:** `python -m sponsors.explain --fixture easy --gemini` (needs
  `HOKIELENS_GEMINI=1` and `GEMINI_API_KEY`). The CLI only rewrites
  `/api/analyze` facts; the interactive chat is Ask Gemini above. Optional `POST /api/explain` exists on
  `uvicorn sponsors.gateway:app`, not on the core API.
- **GoDaddy ANS:** serve `GET /.well-known/agent-card.json` from `uvicorn main:app`.
  Publish the `_ans` TXT record from `backend/sponsors/ans/dns-records.example.txt`
  on the public domain.

## Disclaimer

HokieLens is a student-built planning tool and is not an official Virginia Tech registration
service.
