import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { queryClient } from "../api/queryClient";
import { useDemoSchedules, useHealth } from "../api/hooks";

/**
 * Fires the two documented startup queries in parallel (frontend PRD §11.1)
 * without blocking render or showing a full-page spinner. Errors are left for
 * later UI surfaces; this component renders nothing.
 */
function StartupQueries() {
  useHealth();
  useDemoSchedules();
  return null;
}

export default function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <StartupQueries />
        {children}
      </BrowserRouter>
    </QueryClientProvider>
  );
}
