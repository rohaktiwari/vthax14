import type {
  AnalyzeResponse,
  BuildingsMatrixResponse,
  CourseSearchResponse,
  DemoSchedulesResponse,
  HealthResponse,
  Section,
  StressResponse,
  SwapResponse,
  VibesResponse,
} from "../api/types";

/**
 * Contract-matching MSW fixtures (frontend-only).
 *
 * Shapes mirror the documented backend contract exactly. Fields the frontend is
 * not yet certain about are kept isolated here and commented, rather than spread
 * into application code. Additive backend fields are ignored by these types.
 */

export const sectionFixture: Section = {
  crn: "90001",
  term_id: "2026-fall",
  course_id: "CS 1114",
  subject: "CS",
  course_no: "1114",
  title: "Introduction to Software Design",
  credits: 3,
  instructor_names: ["Ada Lovelace"],
  schedule_type: "Lecture",
  modality: "f2f",
  grade_mode: "standard",
  campus: "Blacksburg",
  seats: { max: 120, available: 42 },
  // Uncertain/optional fields are nullable per the backend model; kept explicit here.
  description: null,
  prereqs_text: null,
  comments: null,
  meetings: [
    {
      days: ["M", "W", "F"],
      start_min: 610,
      end_min: 700,
      building: "MCB",
      room: "204",
      start_date: "2026-08-24",
      end_date: "2026-12-09",
    },
  ],
  meta: {
    source: "banner_class_search",
    verified: true,
    confidence: "high",
    fetched_at: "2026-07-01T12:00:00Z",
  },
};

export const healthFixture: HealthResponse = {
  status: "ok",
  term_id: "2026-fall",
  sections: 36,
  grade_records: 210,
  instructors: 22,
  buildings: 15,
  walk_pairs: 105,
  synthetic_rows: 140,
  warnings: 3,
};

export const demoSchedulesFixture: DemoSchedulesResponse = {
  brutal: { crns: ["90001", "90003", "90002", "90005", "90007"], label: "The wall of pain" },
  easy: { crns: ["90001", "90003", "90008"], label: "Balanced schedule" },
  swap_demo: { current_crns: ["90001", "90003", "90002"], drop_crn: "90003", add_crn: "90004" },
};

export const courseSearchFixture: CourseSearchResponse = {
  courses: [
    {
      course_id: "CS 1114",
      title: "Introduction to Software Design",
      credits: 3,
      sections: [sectionFixture],
    },
  ],
};

export const buildingsMatrixFixture: BuildingsMatrixResponse = {
  buildings: {
    MCB: {
      name: "McBryde Hall",
      place_id: null,
      lat: 37.2295,
      lng: -80.421,
      address: null,
      verified: true,
      source: "manual_fix",
      fetched_at: null,
    },
  },
  // Matrix keys are "CODE_A|CODE_B" with A < B; minutes unless include_meta=true.
  walk: { "MCB|WHI": 18 },
};

export const analyzeFixture: AnalyzeResponse = {
  risk_score: 41,
  sections: [sectionFixture],
  factors: [
    {
      type: "workload_collision",
      severity: 12.0,
      max_severity: 30.0,
      detail: "1 heavy-workload course: CS 1114",
      affected_crns: ["90001"],
    },
    {
      type: "back_to_back_density",
      severity: 5.0,
      max_severity: 25.0,
      detail: "Moderate back-to-back density.",
      affected_crns: ["90001"],
    },
    {
      type: "commute",
      severity: 3.5,
      max_severity: 20.0,
      detail: "MCB -> WHI is a tight transition.",
      affected_crns: ["90001"],
    },
    {
      type: "grade_volatility",
      severity: 10.5,
      max_severity: 15.0,
      detail: "Historical grade spread for CS 1114.",
      affected_crns: ["90001"],
    },
    {
      type: "difficulty_load",
      severity: 4.0,
      max_severity: 10.0,
      detail: "Credit-weighted instructor difficulty.",
      affected_crns: ["90001"],
    },
  ],
  commute_warnings: [
    {
      day: "M",
      // JSON key is `from` (backend alias of from_).
      from: { crn: "90001", building: "MCB", ends: "11:40" },
      to: { crn: "90003", building: "WHI", starts: "11:50" },
      walk_min: 18,
      adjusted_walk_min: 16,
      gap_min: 10,
      verdict: "impossible",
      source: "manual_override",
      detail: "MCB -> WHI is an 18-minute walk; the schedule provides 10 minutes.",
    },
  ],
  expected_gpa: {
    range: [2.9, 3.4],
    mean: 3.15,
    confidence: "low",
    n_students: 340,
    n_terms: 6,
    excluded: [{ crn: "90008", reason: "pass_fail" }],
  },
  meta: {
    term_id: "2026-fall",
    data_notes: ["Grade data is synthetic and representative."],
    heuristic: true,
  },
};

export const swapFixture: SwapResponse = {
  before: analyzeFixture,
  after: { ...analyzeFixture, risk_score: 25 },
  delta: -16,
  summary: { risk: "41 → 25", resolved_warnings: 1, new_warnings: 0 },
};

export const stressFixture: StressResponse = {
  analysis: analyzeFixture,
  scenario: { type: "miss_week", week: 8 },
  original_risk: 41,
  stressed_risk: 46,
  delta: 5,
  penalties: [
    {
      crn: "90001",
      course_id: "CS 1114",
      points: 6,
      impact: "medium",
      reason: "High instructor difficulty and four credits increase catch-up cost.",
    },
  ],
  meta: { heuristic: true, note: "This scenario is a deterministic planning heuristic, not a prediction." },
};

export const vibesFixture: VibesResponse = {
  instructor: "lovelace",
  rmp: { score: 4.2, difficulty: 3.1, n_reviews: 87, would_take_again: 78.0 },
  tags: ["curves"],
  grade_stats: { avg_gpa: 3.1, volatility: 0.4, n_sections: 5, n_students: 340, a_rate: 34.2 },
  confidence: "low",
  data_notes: ["RMP and grade rows are synthetic_filler."],
};
