# HokieLens — Agent Rules

## Scope

This repository is full stack: a React/Vite frontend at the repository root and a FastAPI backend in `backend/`. Agents may change either side.

The frontend PRD (`hokielens_frontend_prd.md`) is the UI and product source of truth. The backend PRD (`hokielens_backend_prd.md`) is the source of truth for endpoint paths, request/response schemas, status codes, error shapes, and backend-owned behavior.

## Backend rules

The backend owns risk, GPA, commute, swap, stress, validation, and every formula. Keep it that way.

- Run backend commands from `backend/` (`python -m pytest`, `uvicorn main:app`). `requirements.txt` at the root installs `backend/requirements.txt`.
- The eight planner routes are a frozen contract. Do not rename them or change any request or response field. Fixture scores must stay easy **41**, brutal **84**, and the swap demo **49 → 19**.
- The planner routes stay offline: no outbound calls, and the server never imports from `scripts/`.
- Optional routes (`/api/chat`, `/api/chat/status`, `/.well-known/*`, `/api/explain` on `sponsors.gateway`) are hidden from OpenAPI and must not change the planner contract.
- Ask Gemini (`POST /api/chat`) is the only route that may call Google, and only when `HOKIELENS_GEMINI=1` and `GEMINI_API_KEY` are set. The key is server-side only: never commit it, log it, or send it to the browser. Tests mock Gemini; nothing in the suite may touch the network.
- Pipeline scripts in `backend/scripts/` are offline tools. Committed JSON under `backend/data/` is what the server loads.
- No database, accounts, authentication, or live seat polling.

## Frontend rules

- Format and visualize API responses; never recreate backend calculations in the frontend.
- Do not invent endpoints, fields, request parameters, or backend capabilities. Optional endpoints (`/api/chat`, `/api/chat/status`) must degrade gracefully when the backend reports them disabled.
- Use `VITE_API_BASE_URL` for all API requests; never hardcode API hosts in application code.
- No accounts, registration workflows, live seat polling, external map tiles, or routing services.
- Ask Gemini is the one generative AI feature. It talks to the backend proxy only, never to Google directly.
- Demo schedule CRNs must come from `GET /api/demo/schedules`; never hardcode them in UI components.
- MSW is allowed only for browser development and frontend tests under `src/test/`. Never create a standalone mock API server.
- Frontend tests live under `src/` (Vitest) and `tests/` (Playwright, run against browser fixtures).

## Workflow

1. Inspect the relevant files and PRDs before changing code.
2. For non-trivial work, state a short plan and list the files expected to change.
3. Implement the requested change only; do not broaden scope.
4. Verify with the commands that match what you touched:
   - Frontend: `npm run build`, `npm run lint`, `npx tsc --noEmit`, Vitest, Playwright.
   - Backend (from `backend/`): `python -m pytest`.
5. Report changed files, commands run and their results, and any limitations or contract blockers.
