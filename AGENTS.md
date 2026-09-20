# HokieLens — Frontend-Only Agent Rules

## Scope

Work only on the browser React/Vite frontend at this repository root and frontend-owned assets, configuration, and tests.

The frontend PRD is the UI and product source of truth. The backend PRD, backend source, OpenAPI output, and API samples are read-only interface references. Use them only to match documented endpoint paths, request/response schemas, status codes, error shapes, and backend-owned behavior.

## Absolute backend boundary

Never create, edit, move, delete, format, scaffold, repair, refactor, test, run, or otherwise modify backend code or infrastructure.

Never create or modify:

- Python files or Python environments
- FastAPI routes, Pydantic models, server code, OpenAPI files, databases, migrations, loaders, pipelines, or server-side calculations
- `main.py`, `data.py`, `models.py`, `risk.py`, `config.py`, or `requirements.txt`
- `data/` or `scripts/`
- backend tests or backend fixtures
- backend `.env` files

Do not run `python`, `pip`, `uvicorn`, `pytest`, migrations, backend formatters, backend generators, or server commands.

If a backend folder appears later, it is strictly read-only.

## Permitted frontend work

You may create and edit only frontend files, including:

- React/TypeScript source under `src/`
- static assets under `public/`
- frontend configuration such as `package.json`, Vite, Tailwind, ESLint, Prettier, TypeScript, and frontend `.env.example`
- frontend tests, including MSW handlers and fixtures only under `src/test/` and Playwright tests under `tests/`
- frontend documentation such as `README.md`

MSW is allowed only for browser development and frontend tests. Never create a standalone mock API server.

## Product constraints

- The backend owns risk, GPA, commute, swap, stress, validation, and every formula. Format and visualize API responses; never recreate calculations in the frontend.
- Do not invent endpoints, fields, request parameters, or backend capabilities.
- Use `VITE_API_BASE_URL` for all API requests; never hardcode API hosts in application code.
- No authentication, accounts, database, registration workflows, live seat polling, external map tiles, routing services, or generative AI chat.
- Demo schedule CRNs must come from `GET /api/demo/schedules`; never hardcode them in UI components.
- For missing or incompatible backend behavior, keep the frontend contract-correct, use in-frontend MSW where appropriate, report the mismatch, and do not repair the backend.

## Workflow

1. Inspect relevant frontend files and the supplied PRDs before changing code.
2. For non-trivial work, state a short plan and list the frontend files expected to change.
3. Implement the requested frontend phase only; do not broaden scope.
4. Run frontend commands only, such as `npm install`, `npm run dev`, `npm run build`, `npm run lint`, Vitest, and Playwright.
5. Report changed frontend files, commands run and their results, limitations or API-contract blockers, and this exact final line:

`Backend files created or modified: none.`