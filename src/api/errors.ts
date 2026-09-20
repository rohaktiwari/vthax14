import type { ConflictErrorDetail, ErrorResponse, MeetingConflict } from "./types";

/**
 * Single error-normalization module.
 *
 * Converts network failures, timeouts/aborts, HTTP status errors, FastAPI
 * string `detail`, FastAPI structured `detail`, and unexpected payloads into a
 * consistent UI error model. Nothing here exposes raw stack traces or
 * `[object Object]`.
 */

export type ApiErrorKind =
  | "network"
  | "timeout"
  | "aborted"
  | "http"
  | "validation"
  | "unexpected";

export interface ApiErrorOptions {
  status?: number;
  code?: string;
  detail?: string;
  conflicts?: MeetingConflict[];
}

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;
  readonly conflicts?: MeetingConflict[];

  constructor(kind: ApiErrorKind, message: string, options: ApiErrorOptions = {}) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    if (options.status !== undefined) this.status = options.status;
    if (options.code !== undefined) this.code = options.code;
    if (options.detail !== undefined) this.detail = options.detail;
    if (options.conflicts !== undefined) this.conflicts = options.conflicts;
  }
}

export interface NormalizeOptions {
  /** The request's own timeout fired (distinguishes timeout from a caller abort). */
  timedOut?: boolean;
  /** Timeout budget in ms, used only to word the timeout message. */
  timeoutMs?: number;
  /** The caller's AbortSignal was already aborted. */
  externalAbort?: boolean;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (isRecord(error) && error.name === "AbortError")
  );
}

function isNetworkError(error: unknown): boolean {
  // `fetch` rejects with a TypeError when the request cannot reach the network.
  return error instanceof TypeError;
}

function isMeetingConflict(value: unknown): value is MeetingConflict {
  return (
    isRecord(value) &&
    Array.isArray(value.crns) &&
    typeof value.day === "string" &&
    typeof value.start === "string" &&
    typeof value.end === "string"
  );
}

/** Build an ApiError from a non-OK HTTP response and its parsed body. */
export function apiErrorFromResponse(status: number, payload: unknown): ApiError {
  const kind: ApiErrorKind = status === 422 ? "validation" : "http";
  const fallback = `The HokieLens API rejected the request (status ${status}).`;

  const body = payload as ErrorResponse | unknown;
  const detail = isRecord(body) ? (body as { detail?: unknown }).detail : undefined;

  if (typeof detail === "string") {
    const message = detail.trim() || fallback;
    return new ApiError(kind, message, { status, detail: message });
  }

  if (isRecord(detail)) {
    const structured = detail as Partial<ConflictErrorDetail>;
    if (typeof structured.message === "string") {
      const conflicts = Array.isArray(structured.conflicts)
        ? structured.conflicts.filter(isMeetingConflict)
        : undefined;
      return new ApiError(kind, structured.message, {
        status,
        code: typeof structured.code === "string" ? structured.code : undefined,
        conflicts,
      });
    }
  }

  // Some proxies return a bare string body rather than {"detail": ...}.
  if (typeof payload === "string" && payload.trim()) {
    const message = payload.trim();
    return new ApiError(kind, message, { status, detail: message });
  }

  return new ApiError(kind, fallback, { status });
}

/** The one helper every caller uses to turn an unknown thrown value into an ApiError. */
export function normalizeApiError(error: unknown, options: NormalizeOptions = {}): ApiError {
  if (error instanceof ApiError) return error;

  if (options.timedOut) {
    const seconds = Math.round((options.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000);
    return new ApiError(
      "timeout",
      `The HokieLens API did not respond within ${seconds} seconds. Try again.`,
    );
  }

  if (options.externalAbort || isAbortError(error)) {
    return new ApiError("aborted", "The request was cancelled.");
  }

  if (isNetworkError(error)) {
    return new ApiError(
      "network",
      "Unable to reach the HokieLens API. Check that the backend is running and try again.",
    );
  }

  return new ApiError("unexpected", "The HokieLens API returned an unexpected response.");
}
