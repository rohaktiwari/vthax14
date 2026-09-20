import { describe, expect, it } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "../test/msw/server";
import { analyzeFixture, healthFixture } from "../test/fixtures";
import type { HealthResponse } from "./types";
import { API_BASE_URL, apiGet, apiPost } from "./client";
import { ApiError } from "./errors";

describe("apiGet", () => {
  it("builds the URL from VITE_API_BASE_URL and appends defined query parameters", async () => {
    let seenUrl = "";
    server.use(
      http.get(`${API_BASE_URL}/health`, ({ request }) => {
        seenUrl = request.url;
        return HttpResponse.json(healthFixture);
      }),
    );

    const result = await apiGet<HealthResponse>("/health", {
      query: { probe: "yes", limit: 5, skipped: undefined },
    });

    expect(seenUrl).toBe(`${API_BASE_URL}/health?probe=yes&limit=5`);
    expect(result.status).toBe("ok");
  });

  it("retries a GET once on a 5xx response, then succeeds", async () => {
    let calls = 0;
    server.use(
      http.get(`${API_BASE_URL}/health`, () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json({ detail: "boom" }, { status: 500 })
          : HttpResponse.json(healthFixture);
      }),
    );

    const result = await apiGet<HealthResponse>("/health");

    expect(calls).toBe(2);
    expect(result.status).toBe("ok");
  });
});

describe("apiPost", () => {
  it("sends a JSON Content-Type header and a serialized body", async () => {
    let contentType: string | null = null;
    let received: unknown = null;
    server.use(
      http.post(`${API_BASE_URL}/analyze`, async ({ request }) => {
        contentType = request.headers.get("content-type");
        received = await request.json();
        return HttpResponse.json(analyzeFixture);
      }),
    );

    await apiPost("/analyze", { crns: ["90001", "90003"] });

    expect(contentType).toContain("application/json");
    expect(received).toEqual({ crns: ["90001", "90003"] });
  });

  it("does not retry a POST on a 5xx response", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE_URL}/analyze`, () => {
        calls += 1;
        return HttpResponse.json({ detail: "boom" }, { status: 500 });
      }),
    );

    await expect(apiPost("/analyze", { crns: [] })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toBe(1);
  });

  it("does not retry a 422 and surfaces structured conflicts", async () => {
    let calls = 0;
    server.use(
      http.post(`${API_BASE_URL}/analyze`, () => {
        calls += 1;
        return HttpResponse.json(
          {
            detail: {
              code: "meeting_overlap",
              message: "Selected sections overlap",
              conflicts: [{ crns: ["90003", "90012"], day: "M", start: "11:15", end: "12:05" }],
            },
          },
          { status: 422 },
        );
      }),
    );

    await expect(apiPost("/analyze", { crns: [] })).rejects.toMatchObject({
      kind: "validation",
      code: "meeting_overlap",
      status: 422,
    });
    expect(calls).toBe(1);
  });
});
