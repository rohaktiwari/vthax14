import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./msw/server";

// Node >= 24's fetch rejects jsdom's AbortSignal. Strip it and re-implement abort so
// client timeout/cancel tests behave the same. Wraps MSW's fetch, so it must run after listen().
function withJsdomSignalSupport(inner: typeof fetch): typeof fetch {
  return (input, init) => {
    const signal = init?.signal;
    if (!signal) return inner(input, init);
    const rest = { ...init };
    delete rest.signal;
    if (signal.aborted) return Promise.reject(new DOMException("The operation was aborted.", "AbortError"));
    return new Promise<Response>((resolve, reject) => {
      const onAbort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      inner(input, rest).then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
  };
}

let restoreFetch: (() => void) | undefined;

beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  const mswFetch = globalThis.fetch;
  globalThis.fetch = withJsdomSignalSupport(mswFetch);
  restoreFetch = () => {
    globalThis.fetch = mswFetch;
  };
});
afterEach(() => server.resetHandlers());
afterAll(() => {
  restoreFetch?.();
  server.close();
});
