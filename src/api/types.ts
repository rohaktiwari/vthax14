/**
 * Centralized HokieLens API types.
 *
 * These mirror the documented backend contract (backend/models.py + the
 * frontend PRD §9). Rules:
 * - Never invent endpoints, fields, or query parameters.
 * - The backend may add fields over time; these types are intentionally not
 *   exhaustive at runtime, so UI code must ignore unknown fields, not crash.
 * - UI components must import shapes from here; do not redefine partial copies.
 */

// ---------------------------------------------------------------------------
// Shared scalar unions (backend/models.py)
// ---------------------------------------------------------------------------

export type Confidence = "high" | "medium" | "low";
export type Weekday = "M" | "T" | "W" | "R" | "F" | "S" | "U";
export type ScheduleType = "Lecture" | "Lab" | "Recitation" | "Independent Study";
export type Modality = "f2f" | "hybrid" | "online_sync" | "online_async";
export type GradeMode = "standard" | "pass_fail";
export type Campus = "Blacksburg";
export type FactorType =
  | "workload_collision"
  | "back_to_back_density"
  | "commute"
  | "grade_volatility"
  | "difficulty_load";
export type CommuteVerdict = "comfortable" | "tight" | "impossible";
export type WalkSource = "google_routes" | "manual_override" | "default_fallback";
export type GpaExclusionReason = "pass_fail" | "no_grade_history";
export type StressImpact = "low" | "medium" | "high";
export type StressScenarioType = "miss_week";

// ---------------------------------------------------------------------------
// GET /api/health
// ---------------------------------------------------------------------------

export interface HealthResponse {
  status: "ok";
  term_id: string;
  sections: number;
  grade_records: number;
  instructors: number;
  buildings: number;
  walk_pairs: number;
  synthetic_rows: number;
  warnings: number;
}

// ---------------------------------------------------------------------------
// Catalog shapes (GET /api/courses/search; reused inside analyze/swap/stress)
// ---------------------------------------------------------------------------

export interface SectionMeta {
  source: "banner_class_search";
  verified: boolean;
  confidence: Confidence;
  fetched_at?: string | null;
}

export interface Meeting {
  days: Weekday[];
  /** Minutes from midnight. */
  start_min: number;
  /** Minutes from midnight. */
  end_min: number;
  /** Uppercase building code, or null for online / location-unspecified. */
  building: string | null;
  room?: string | null;
  /** ISO date (YYYY-MM-DD). */
  start_date: string;
  /** ISO date (YYYY-MM-DD). */
  end_date: string;
}

export interface Seats {
  max: number;
  available: number;
}

export interface Section {
  crn: string;
  term_id: string;
  course_id: string;
  subject: string;
  course_no: string;
  title: string;
  credits: number;
  instructor_names: string[];
  schedule_type: ScheduleType;
  modality: Modality;
  grade_mode: GradeMode;
  campus: Campus;
  seats: Seats;
  description?: string | null;
  prereqs_text?: string | null;
  comments?: string | null;
  meetings: Meeting[];
  meta: SectionMeta;
}

export interface CourseGroup {
  course_id: string;
  title: string;
  credits: number;
  sections: Section[];
}

export interface CourseSearchResponse {
  courses: CourseGroup[];
}

/** Documented query parameters only: q, subject, limit (1–100, default 20). */
export interface CourseSearchParams {
  q?: string;
  subject?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// GET /api/buildings/matrix
// ---------------------------------------------------------------------------

export interface Building {
  name: string;
  place_id?: string | null;
  lat: number;
  lng: number;
  address?: string | null;
  verified: boolean;
  source: "google_places" | "geocode" | "manual_fix";
  fetched_at?: string | null;
}

/** Committed walk entries only ever carry these two sources. */
export interface WalkEntry {
  minutes: number;
  meters: number;
  source: "google_routes" | "manual_override";
  fetched_at?: string | null;
}

export interface BuildingsMatrixResponse {
  buildings: Record<string, Building>;
  /** Minutes by default; full WalkEntry objects when include_meta=true. */
  walk: Record<string, number | WalkEntry>;
}

// ---------------------------------------------------------------------------
// POST /api/analyze
// ---------------------------------------------------------------------------

export interface AnalyzeRequest {
  /** 2–12 unique, non-blank CRNs in the caller's selection order. */
  crns: string[];
}

export interface RiskFactor {
  type: FactorType;
  /** One decimal, clamped to max_severity. */
  severity: number;
  /** Always 100 * W[type]. */
  max_severity: number;
  detail: string;
  affected_crns: string[];
}

export interface CommuteFrom {
  crn: string;
  building: string;
  /** HH:MM. */
  ends: string;
}

export interface CommuteTo {
  crn: string;
  building: string;
  /** HH:MM. */
  starts: string;
}

/**
 * JSON key is `from` (the backend model field is `from_` with an alias). Always
 * read `warning.from` here.
 */
export interface CommuteWarning {
  day: Weekday;
  from: CommuteFrom;
  to: CommuteTo;
  walk_min: number;
  adjusted_walk_min: number;
  gap_min: number;
  verdict: CommuteVerdict;
  source: WalkSource;
  detail: string;
}

export interface GpaExclusion {
  crn: string;
  reason: GpaExclusionReason;
}

export interface ExpectedGpa {
  range: [number, number] | null;
  mean: number | null;
  confidence: Confidence;
  n_students: number;
  n_terms: number;
  excluded: GpaExclusion[];
}

export interface AnalysisMeta {
  term_id: string;
  data_notes: string[];
  heuristic: boolean;
}

export interface AnalyzeResponse {
  risk_score: number;
  /** Sections in request CRN order. */
  sections: Section[];
  /** Always all five factors in configured order. */
  factors: RiskFactor[];
  /** Tight / impossible transitions only. */
  commute_warnings: CommuteWarning[];
  expected_gpa: ExpectedGpa;
  meta: AnalysisMeta;
}

// ---------------------------------------------------------------------------
// POST /api/swap
// ---------------------------------------------------------------------------

export interface SwapRequest {
  current_crns: string[];
  drop_crn: string;
  add_crn: string;
}

export interface SwapSummary {
  /** e.g. "74 → 58". */
  risk: string;
  resolved_warnings: number;
  new_warnings: number;
}

export interface SwapResponse {
  before: AnalyzeResponse;
  after: AnalyzeResponse;
  /** after.risk_score − before.risk_score. */
  delta: number;
  summary: SwapSummary;
}

// ---------------------------------------------------------------------------
// POST /api/stress
// ---------------------------------------------------------------------------

export interface StressRequest {
  crns: string[];
  scenario: StressScenarioType;
  /** 1–16. Narrative only; the backend has no assignment calendar. */
  week: number;
}

export interface StressScenario {
  type: StressScenarioType;
  week: number;
}

export interface StressPenalty {
  crn: string;
  course_id: string;
  points: number;
  impact: StressImpact;
  reason: string;
}

export interface StressMeta {
  heuristic: boolean;
  note: string;
}

export interface StressResponse {
  analysis: AnalyzeResponse;
  scenario: StressScenario;
  original_risk: number;
  stressed_risk: number;
  delta: number;
  penalties: StressPenalty[];
  meta: StressMeta;
}

// ---------------------------------------------------------------------------
// GET /api/professors/{surname}/vibes
// ---------------------------------------------------------------------------

export interface VibesRmp {
  score: number;
  difficulty: number;
  n_reviews: number;
  would_take_again: number | null;
}

export interface VibesGradeStats {
  avg_gpa: number | null;
  volatility: number | null;
  n_sections: number;
  n_students: number;
  a_rate: number | null;
}

export interface VibesResponse {
  /** Normalized instructor join key (not a display name). */
  instructor: string;
  rmp: VibesRmp | null;
  tags: string[];
  grade_stats: VibesGradeStats;
  confidence: Confidence;
  data_notes: string[];
}

// ---------------------------------------------------------------------------
// GET /api/demo/schedules
// ---------------------------------------------------------------------------

export interface DemoSchedule {
  crns: string[];
  label: string;
}

export interface DemoSwap {
  current_crns: string[];
  drop_crn: string;
  add_crn: string;
}

export interface DemoSchedulesResponse {
  brutal: DemoSchedule;
  easy: DemoSchedule;
  swap_demo: DemoSwap;
}

// ---------------------------------------------------------------------------
// Optional Ask Gemini (POST /api/chat, GET /api/chat/status; not in OpenAPI)
// ---------------------------------------------------------------------------

export type ChatRole = "user" | "assistant";
export type ChatSource = "gemini" | "fallback" | "unavailable";
export type ChatReason =
  | "disabled"
  | "no_key"
  | "quota"
  | "timeout"
  | "error"
  | "ungrounded"
  | "empty"
  | "blocked";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatFocus {
  building?: string | null;
  crn?: string | null;
  professor?: string | null;
}

export interface ChatRequest {
  messages: ChatMessage[];
  crns?: string[];
  focus?: ChatFocus | null;
}

export interface ChatResponse {
  reply: string;
  source: ChatSource;
  /** Why the reply is not from Gemini; null when it is. */
  reason: ChatReason | null;
  /** One readable sentence explaining a non-Gemini reply; null when Gemini answered. */
  notice: string | null;
}

export interface ChatStatusResponse {
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Error contract (detail is a string, or a structured object)
// ---------------------------------------------------------------------------

export interface MeetingConflict {
  /** The two conflicting CRNs, in request order. */
  crns: string[];
  day: Weekday;
  /** HH:MM start of the overlapping interval. */
  start: string;
  /** HH:MM end of the overlapping interval. */
  end: string;
}

export interface ConflictErrorDetail {
  code: "meeting_overlap";
  message: string;
  conflicts: MeetingConflict[];
}

export interface ErrorResponse {
  detail: string | ConflictErrorDetail;
}
