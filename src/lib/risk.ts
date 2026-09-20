import type { CommuteVerdict, Confidence, FactorType } from "../api/types";

/**
 * Risk/analysis presentation helpers.
 *
 * Presentation only. These never recompute or reinterpret a backend value:
 * risk bands and factor labels are display metadata, mirroring the frontend PRD
 * §10.7/§10.8. The backend remains authoritative for every score, severity,
 * verdict, and GPA value.
 */

export type RiskTone = "low" | "moderate" | "high" | "very-high";

export interface RiskBand {
  tone: RiskTone;
  label: string;
}

/** PRD §10.7 band table. Does not modify the backend score. */
export function riskBand(score: number): RiskBand {
  if (score < 25) return { tone: "low", label: "Low" };
  if (score < 50) return { tone: "moderate", label: "Moderate" };
  if (score < 70) return { tone: "high", label: "High" };
  return { tone: "very-high", label: "Very high" };
}

/** Risk score is an integer 0–100; render it as a whole number. */
export function formatRiskScore(score: number): string {
  return String(Math.round(score));
}

/** One decimal, for factor severity / max severity. */
export function formatOneDecimal(value: number): string {
  return value.toFixed(1);
}

/** Two decimals, for expected GPA mean and range. */
export function formatTwoDecimals(value: number): string {
  return value.toFixed(2);
}

const FACTOR_LABELS: Record<FactorType, string> = {
  workload_collision: "Heavy-course load",
  back_to_back_density: "Back-to-back density",
  commute: "Walking pressure",
  grade_volatility: "Grade volatility",
  difficulty_load: "Instructor difficulty",
};

/**
 * Friendly factor name. Unknown factor identifiers are preserved with a
 * title-cased fallback rather than dropped or renamed to "Unknown".
 */
export function factorDisplayName(type: string): string {
  const known = FACTOR_LABELS[type as FactorType];
  if (known) return known;
  const titled = type
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return titled || type;
}

/** Textual verdict label so verdict is never conveyed by color alone. */
export function verdictLabel(verdict: CommuteVerdict): string {
  if (verdict === "impossible") return "Impossible";
  if (verdict === "tight") return "Tight";
  return "Comfortable";
}

export function confidenceLabel(confidence: Confidence): string {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Medium confidence";
  return "Low confidence";
}

/** Guard for proportional bar widths; backend max may be zero in theory. */
export function severityPercent(severity: number, maxSeverity: number): number {
  if (!Number.isFinite(maxSeverity) || maxSeverity <= 0) return 0;
  return Math.min(100, Math.max(0, (severity / maxSeverity) * 100));
}
