import { ApiError, apiErrorFromResponse, normalizeApiError } from "./errors";

/**
 * HokieLens API client.
 *
 * - Prefixes every request with VITE_API_BASE_URL (which already includes /api).
 * - Sends JSON bodies with `Content-Type: application/json`.
 * - Enforces a 10-second timeout and supports caller AbortSignal cancellation.
 * - Retries idempotent GET requests once on network failure or 5xx only.
 * - Never retries POST, and never retries 400/404/422.
 */

const RAW_BASE_URL = import.meta.env.VITE_API_BASE_URL as string | undefined;
const FALLBACK_BASE_URL = "http://localhost:8000/api";

export const API_BASE_URL = (RAW_BASE_URL?.trim() || FALLBACK_BASE_URL).replace(/\/+$/, "");

export const REQUEST_TIMEOUT_MS = 10_000;

export type QueryValue = string | number | boolean | null | undefined;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  /** Query string parameters. Undefined/null values are omitted. */
  query?: QueryParams;
  /** Caller cancellation signal, combined with the timeout signal. */
  signal?: AbortSignal;
  /** Override the default 10-second timeout. */
  timeoutMs?: number;
}

interface RequestConfig extends RequestOptions {
  method: "GET" | "POST";
  body?: unknown;
}

/** Build an absolute request URL and append defined query parameters. */
export function buildUrl(path: string, query?: QueryParams): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const params = new URLSearchParams();
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null) continue;
      params.set(key, String(value));
    }
  }
  const queryString = params.toString();
  return `${API_BASE_URL}${normalizedPath}${queryString ? `?${queryString}` : ""}`;
}

function linkAbortSignal(external: AbortSignal | undefined, controller: AbortController): () => void {
  if (!external) return () => {};
  if (external.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  external.addEventListener("abort", onAbort);
  return () => external.removeEventListener("abort", onAbort);
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isRetryable(error: ApiError): boolean {
  return error.kind === "network" || (error.kind === "http" && (error.status ?? 0) >= 500);
}

async function request<T>(path: string, config: RequestConfig): Promise<T> {
  const { method, body, query, signal, timeoutMs = REQUEST_TIMEOUT_MS } = config;
  const url = buildUrl(path, query);
  const maxAttempts = method === "GET" ? 2 : 1;
  let attempts = 0;

  while (attempts < maxAttempts) {
    attempts += 1;

    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const unlink = linkAbortSignal(signal, controller);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      const payload = await parseBody(response);
      if (!response.ok) {
        throw apiErrorFromResponse(response.status, payload);
      }
      return payload as T;
    } catch (raw) {
      const error = normalizeApiError(raw, {
        timedOut,
        timeoutMs,
        externalAbort: Boolean(signal?.aborted),
      });
      if (attempts < maxAttempts && isRetryable(error)) continue;
      throw error;
    } finally {
      clearTimeout(timer);
      unlink();
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new ApiError("unexpected", "The HokieLens API request could not be completed.");
}

/** Idempotent GET with one retry on network/5xx failure. */
export function apiGet<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, { ...options, method: "GET" });
}

/** POST with no automatic retry (400/404/422 are surfaced immediately). */
export function apiPost<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
  return request<T>(path, { ...options, method: "POST", body });
}
