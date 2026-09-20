import type { AnalyzeResponse } from "../api/types";
import { factorDisplayName, severityPercent, verdictLabel } from "./risk";
import { formatWeekdayShort } from "./time";

/**
 * Per-course risk, presentation only.
 *
 * The backend scores a whole schedule; it has no per-course score. What it does
 * report per course is which factors list a CRN in `affected_crns` and which
 * tight or impossible walks touch it. This module only groups and labels those
 * backend values; it never computes a new number. The thresholds below decide
 * which label a backend-provided severity earns, the same way `riskBand` labels
 * the overall score.
 */

export type CourseRiskLevel = "low" | "medium" | "high";
export type ReasonTone = "danger" | "warning" | "neutral";

/** Share of a factor's maximum that earns each label. */
export const FACTOR_HIGH_PERCENT = 80;
export const FACTOR_MEDIUM_PERCENT = 40;

export interface CourseRiskReason {
  key: string;
  tone: ReasonTone;
  /** Chip-length text, for example "Impossible walk". */
  short: string;
  /** Full sentence for the details view. */
  text: string;
}

export interface CourseRisk {
  level: CourseRiskLevel;
  label: string;
  reasons: CourseRiskReason[];
}

const LEVEL_LABEL: Record<CourseRiskLevel, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

const TONE_ORDER: Record<ReasonTone, number> = { danger: 0, warning: 1, neutral: 2 };

type Warning = AnalyzeResponse["commute_warnings"][number];

function walkReasons(crn: string, analysis: AnalyzeResponse): CourseRiskReason[] {
  const groups = new Map<string, { days: string[]; warning: Warning }>();
  for (const warning of analysis.commute_warnings) {
    if (warning.from.crn !== crn && warning.to.crn !== crn) continue;
    const key = `${warning.from.crn}>${warning.to.crn}|${warning.verdict}`;
    const group = groups.get(key);
    if (group) group.days.push(formatWeekdayShort(warning.day));
    else groups.set(key, { days: [formatWeekdayShort(warning.day)], warning });
  }
  return [...groups.entries()].map(([key, { days, warning }]) => ({
    key: `walk-${key}`,
    tone: warning.verdict === "impossible" ? "danger" : "warning",
    short: `${verdictLabel(warning.verdict)} walk`,
    text: `${days.join(", ")}: ${warning.detail}`,
  }));
}

function factorReasons(crn: string, analysis: AnalyzeResponse): CourseRiskReason[] {
  const reasons: CourseRiskReason[] = [];
  for (const factor of analysis.factors) {
    // Walking is reported through the commute warnings above.
    if (factor.type === "commute") continue;
    if (!factor.affected_crns.includes(crn) || factor.severity <= 0) continue;
    const percent = severityPercent(factor.severity, factor.max_severity);
    const name = factorDisplayName(factor.type);
    reasons.push({
      key: `factor-${factor.type}`,
      tone:
        percent >= FACTOR_HIGH_PERCENT ? "danger" : percent >= FACTOR_MEDIUM_PERCENT ? "warning" : "neutral",
      short: name,
      text: `${name}: ${factor.detail}`,
    });
  }
  return reasons;
}

/**
 * Risk for one selected CRN, or null when the analysis does not cover it (no
 * analysis yet, or a stale one for a different selection).
 */
export function courseRiskFor(crn: string, analysis: AnalyzeResponse | undefined): CourseRisk | null {
  if (!analysis || !analysis.sections.some((section) => section.crn === crn)) return null;

  const reasons = [...walkReasons(crn, analysis), ...factorReasons(crn, analysis)].sort(
    (a, b) => TONE_ORDER[a.tone] - TONE_ORDER[b.tone],
  );
  const level: CourseRiskLevel = reasons.some((reason) => reason.tone === "danger")
    ? "high"
    : reasons.some((reason) => reason.tone === "warning")
      ? "medium"
      : "low";
  return { level, label: LEVEL_LABEL[level], reasons };
}
