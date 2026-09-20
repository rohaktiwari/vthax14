import { useEffect } from "react";
import { useAnalysis } from "../api/hooks";
import type { AnalyzeResponse } from "../api/types";
import { normalizeApiError, type ApiError } from "../api/errors";
import { useSchedule } from "../context/ScheduleContext";

export interface ScheduleAnalysis {
  /** Analysis for the current selection, or the previous one while `isUpdating`. */
  data: AnalyzeResponse | undefined;
  /** First analysis of this session is loading (nothing to show yet). */
  isPending: boolean;
  /** A new analysis is loading and `data` may be for the previous selection. */
  isUpdating: boolean;
  error: ApiError | null;
  retry: () => void;
}

/**
 * Analysis of the selected CRNs for every panel that shows risk. Below two
 * courses there is nothing to analyze and every field stays empty. Panels that
 * need the result for exactly the current selection use `courseRiskFor`, which
 * returns null when a stale result does not cover a CRN.
 */
export function useScheduleAnalysis(): ScheduleAnalysis {
  const { crns } = useSchedule();
  const query = useAnalysis(crns, { keepPrevious: true });
  const ready = crns.length >= 2;

  return {
    data: ready ? query.data : undefined,
    isPending: ready && query.isPending,
    isUpdating: ready && query.isPlaceholderData,
    error: ready && query.isError ? normalizeApiError(query.error) : null,
    retry: () => void query.refetch(),
  };
}

/**
 * Mounted once. Full Section objects in an analysis response hydrate selected
 * CRNs the catalog search did not return (for example a shared link with courses
 * beyond the first page of results), since no section-by-CRN endpoint exists.
 */
export function useHydrateFromAnalysis(): void {
  const { registerSections } = useSchedule();
  const { data, isUpdating } = useScheduleAnalysis();

  useEffect(() => {
    if (data && !isUpdating) registerSections(data.sections);
  }, [data, isUpdating, registerSections]);
}
