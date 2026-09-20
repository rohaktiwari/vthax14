import type { CourseSearchParams } from "./types";

/**
 * TanStack Query key factory. One key per documented endpoint/parameter set so
 * later phases can invalidate precisely (e.g. analyze depends on CRN order).
 */
export const queryKeys = {
  health: ["health"] as const,
  demoSchedules: ["demo", "schedules"] as const,
  coursesSearch: (params: CourseSearchParams) => ["courses", "search", params] as const,
  buildingsMatrix: (includeMeta: boolean) => ["buildings", "matrix", { includeMeta }] as const,
  analyze: ["analyze"] as const,
  /** Keyed by ordered CRN list so a schedule change produces a new analysis. */
  analysis: (crns: string[]) => ["analyze", crns] as const,
  swap: ["swap"] as const,
  stress: ["stress"] as const,
  professorVibes: (surname: string) => ["professors", surname, "vibes"] as const,
};
