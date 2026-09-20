import { QueryClient } from "@tanstack/react-query";

/**
 * Shared QueryClient.
 *
 * GET retry (one attempt on network/5xx) lives in src/api/client.ts, so React
 * Query must not retry a second time. Mutations (POST) are never retried.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});
