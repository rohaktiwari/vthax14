import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "./client";
import { queryKeys } from "./queryKeys";
import { MAX_CRNS } from "../lib/schedule";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  BuildingsMatrixResponse,
  CourseSearchParams,
  CourseSearchResponse,
  DemoSchedulesResponse,
  HealthResponse,
  StressRequest,
  StressResponse,
  SwapRequest,
  SwapResponse,
  VibesResponse,
  ChatRequest,
  ChatResponse,
  ChatStatusResponse,
} from "./types";

/**
 * TanStack Query hooks for the eight documented planner endpoints, plus the
 * optional Ask Gemini chat routes (hidden from OpenAPI; default off).
 */

/** GET /api/health — header status indicator and startup diagnostics. */
export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: ({ signal }) => apiGet<HealthResponse>("/health", { signal }),
  });
}

/** GET /api/demo/schedules — judge-safe startup fixtures. */
export function useDemoSchedules() {
  return useQuery({
    queryKey: queryKeys.demoSchedules,
    queryFn: ({ signal }) => apiGet<DemoSchedulesResponse>("/demo/schedules", { signal }),
  });
}

/** GET /api/courses/search — grouped course/section results. */
export function useCoursesSearch(params: CourseSearchParams) {
  return useQuery({
    queryKey: queryKeys.coursesSearch(params),
    queryFn: ({ signal }) =>
      apiGet<CourseSearchResponse>("/courses/search", {
        signal,
        query: { q: params.q, subject: params.subject, limit: params.limit },
      }),
  });
}

/** GET /api/buildings/matrix — committed buildings and walk pairs. */
export function useBuildingsMatrix(includeMeta = false) {
  return useQuery({
    queryKey: queryKeys.buildingsMatrix(includeMeta),
    queryFn: ({ signal }) =>
      apiGet<BuildingsMatrixResponse>("/buildings/matrix", {
        signal,
        query: { include_meta: includeMeta },
      }),
  });
}

/** POST /api/analyze — risk, factors, commute warnings, expected GPA. */
export function useAnalyze() {
  return useMutation({
    mutationKey: queryKeys.analyze,
    mutationFn: (body: AnalyzeRequest) => apiPost<AnalyzeResponse>("/analyze", body),
  });
}

/**
 * Auto-run analysis for the ordered URL CRNs. Disabled below two selections so
 * a single section never triggers a request; the URL already caps at 12. The
 * key includes the ordered CRN list, so a schedule change requests a fresh
 * analysis and cached results for other schedules are not reused.
 */
export function useAnalysis(crns: string[]) {
  return useQuery({
    queryKey: queryKeys.analysis(crns),
    queryFn: ({ signal }) => apiPost<AnalyzeResponse>("/analyze", { crns }, { signal }),
    enabled: crns.length >= 2 && crns.length <= MAX_CRNS,
    retry: false,
  });
}

/** POST /api/swap — before/after comparison; caller confirms before applying. */
export function useSwap() {
  return useMutation({
    mutationKey: queryKeys.swap,
    mutationFn: (body: SwapRequest) => apiPost<SwapResponse>("/swap", body),
  });
}

/** POST /api/stress — miss-a-week catch-up heuristic. */
export function useStress() {
  return useMutation({
    mutationKey: queryKeys.stress,
    mutationFn: (body: StressRequest) => apiPost<StressResponse>("/stress", body),
  });
}

/** GET /api/professors/{surname}/vibes — 404 renders as a "no data" state later. */
export function useProfessorVibes(surname: string) {
  return useQuery({
    queryKey: queryKeys.professorVibes(surname),
    queryFn: ({ signal }) =>
      apiGet<VibesResponse>(`/professors/${encodeURIComponent(surname)}/vibes`, { signal }),
    enabled: surname.trim().length > 0,
  });
}

/** GET /api/chat/status — whether the server has a Gemini key configured. */
export function useChatStatus(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.chatStatus,
    queryFn: ({ signal }) => apiGet<ChatStatusResponse>("/chat/status", { signal }),
    enabled,
    retry: false,
  });
}

/** POST /api/chat — grounded Gemini reply; never retries. 25s budget for the model. */
export function useChat() {
  return useMutation({
    mutationKey: queryKeys.chat,
    mutationFn: (body: ChatRequest) => apiPost<ChatResponse>("/chat", body, { timeoutMs: 25_000 }),
  });
}
