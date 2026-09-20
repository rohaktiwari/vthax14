import { describe, expect, it } from "vitest";
import { ApiError, apiErrorFromResponse, normalizeApiError } from "./errors";

describe("normalizeApiError", () => {
  it("maps a fetch TypeError to a network error", () => {
    const error = normalizeApiError(new TypeError("Failed to fetch"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe("network");
  });

  it("maps a fired timeout to a timeout error with the budget in the message", () => {
    const error = normalizeApiError(new DOMException("Aborted", "AbortError"), {
      timedOut: true,
      timeoutMs: 10_000,
    });
    expect(error.kind).toBe("timeout");
    expect(error.message).toContain("10 seconds");
  });

  it("maps an abort (not a timeout) to an aborted error", () => {
    const error = normalizeApiError(new DOMException("Aborted", "AbortError"));
    expect(error.kind).toBe("aborted");
  });

  it("returns an existing ApiError unchanged", () => {
    const existing = new ApiError("network", "already normalized");
    expect(normalizeApiError(existing)).toBe(existing);
  });

  it("maps an unknown thrown value to an unexpected error", () => {
    expect(normalizeApiError({ weird: true }).kind).toBe("unexpected");
    expect(normalizeApiError("boom").kind).toBe("unexpected");
  });
});

describe("apiErrorFromResponse", () => {
  it("uses a FastAPI string detail verbatim and marks 422 as validation", () => {
    const error = apiErrorFromResponse(422, { detail: "body.crns: Field required" });
    expect(error.kind).toBe("validation");
    expect(error.status).toBe(422);
    expect(error.message).toBe("body.crns: Field required");
  });

  it("uses a FastAPI object detail and keeps conflict details", () => {
    const error = apiErrorFromResponse(422, {
      detail: {
        code: "meeting_overlap",
        message: "Selected sections overlap",
        conflicts: [{ crns: ["90003", "90012"], day: "M", start: "11:15", end: "12:05" }],
      },
    });
    expect(error.kind).toBe("validation");
    expect(error.code).toBe("meeting_overlap");
    expect(error.message).toBe("Selected sections overlap");
    expect(error.conflicts).toHaveLength(1);
    expect(error.conflicts?.[0]?.crns).toEqual(["90003", "90012"]);
  });

  it("treats a 400 swap-operation error as an http error", () => {
    const error = apiErrorFromResponse(400, { detail: "add_crn '90004' is not a known CRN" });
    expect(error.kind).toBe("http");
    expect(error.status).toBe(400);
    expect(error.message).toContain("not a known CRN");
  });

  it("falls back to a status message when no detail is present", () => {
    const error = apiErrorFromResponse(404, { unrelated: true });
    expect(error.kind).toBe("http");
    expect(error.message).toContain("404");
  });

  it("accepts a bare string body", () => {
    const error = apiErrorFromResponse(500, "upstream failure");
    expect(error.kind).toBe("http");
    expect(error.message).toBe("upstream failure");
  });
});
