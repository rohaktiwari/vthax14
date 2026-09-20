import { http, HttpResponse } from "msw";
import {
  analyzeFixture,
  buildingsMatrixFixture,
  courseSearchFixture,
  demoSchedulesFixture,
  healthFixture,
  stressFixture,
  swapFixture,
  vibesFixture,
} from "../fixtures";

const BASE = "http://localhost:8000/api";

/**
 * Contract-matching MSW handlers for the eight documented endpoints.
 * Tests override individual routes with `server.use(...)` for error cases.
 */
export const handlers = [
  http.get(`${BASE}/health`, () => HttpResponse.json(healthFixture)),

  http.get(`${BASE}/demo/schedules`, () => HttpResponse.json(demoSchedulesFixture)),

  // Documented query params only (q, subject, limit); unknown params are ignored.
  http.get(`${BASE}/courses/search`, () => HttpResponse.json(courseSearchFixture)),

  http.get(`${BASE}/buildings/matrix`, ({ request }) => {
    const includeMeta = new URL(request.url).searchParams.get("include_meta") === "true";
    return HttpResponse.json(
      includeMeta
        ? {
            ...buildingsMatrixFixture,
            walk: { "MCB|WHI": { minutes: 18, meters: 1400, source: "manual_override", fetched_at: null } },
          }
        : buildingsMatrixFixture,
    );
  }),

  http.post(`${BASE}/analyze`, () => HttpResponse.json(analyzeFixture)),

  http.post(`${BASE}/swap`, () => HttpResponse.json(swapFixture)),

  http.post(`${BASE}/stress`, () => HttpResponse.json(stressFixture)),

  http.get(`${BASE}/professors/:surname/vibes`, () => HttpResponse.json(vibesFixture)),

  http.get(`${BASE}/chat/status`, () => HttpResponse.json({ enabled: false })),

  http.post(`${BASE}/chat`, () =>
    HttpResponse.json({
      reply: "Your Courses is empty. Search for a course or load a demo week, then ask again.",
      source: "unavailable",
      reason: "disabled",
      notice: "Ask Gemini is not switched on for this demo, so this is HokieLens's own read.",
    }),
  ),
];
