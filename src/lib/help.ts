import type { AnalyzeResponse } from "../api/types";
import {
  confidenceLabel,
  factorDisplayName,
  formatOneDecimal,
  formatRiskScore,
  formatTwoDecimals,
  riskBand,
  verdictLabel,
} from "./risk";
import { formatWeekdayShort } from "./time";

/**
 * Deterministic help answers (frontend PRD §10.14).
 *
 * `Ask HokieLens` is not a chatbot. Each predefined prompt is answered from
 * committed explanatory text plus the current `/api/analyze` response. No
 * free-form generation and no external service is involved. These helpers are
 * pure so the wording is unit-testable.
 */

export type HelpTopicId = "risk" | "commute" | "gpa" | "compare";

export interface HelpTopic {
  id: HelpTopicId;
  prompt: string;
}

export const HELP_TOPICS: readonly HelpTopic[] = [
  { id: "risk", prompt: "Why is my risk high?" },
  { id: "commute", prompt: "Which commute is hardest?" },
  { id: "gpa", prompt: "What does GPA confidence mean?" },
  { id: "compare", prompt: "How can I compare sections?" },
];

export interface HelpContext {
  /** Latest analysis for the current schedule, when one exists. */
  analysis: AnalyzeResponse | undefined;
  /** Number of selected CRNs, used when no analysis is available yet. */
  selectionCount: number;
}

const RISK_EXPLAINER =
  "The risk score is a deterministic backend heuristic from 0 to 100; lower is generally easier. It is not a prediction of your grades.";

const GPA_EXPLAINER =
  "Expected-GPA confidence describes how much historical evidence the backend used. High confidence needs many non-synthetic records, medium needs some evidence, and low means little evidence or all-synthetic data. The range describes past sections, not your grade.";

const COMPARE_EXPLAINER =
  "Open the swap workbench from the weekly calendar, the risk overview, or the swap demo. The preview shows the backend's before-and-after risk and warnings; your selected schedule changes only after you confirm the swap.";

function needMoreSections(selectionCount: number): string {
  if (selectionCount <= 0) {
    return "Add at least two sections to your schedule first.";
  }
  return "Add at least one more section to calculate schedule risk first.";
}

function answerRisk({ analysis, selectionCount }: HelpContext): string {
  if (!analysis) {
    return `Risk is calculated from at least two selected sections. ${needMoreSections(selectionCount)}`;
  }
  const score = formatRiskScore(analysis.risk_score);
  const band = riskBand(analysis.risk_score);
  const factors = analysis.factors
    .map(
      (factor) =>
        `${factorDisplayName(factor.type)} (${formatOneDecimal(factor.severity)} of ${formatOneDecimal(factor.max_severity)}; ${factor.detail})`,
    )
    .join("; ");
  const factorSentence =
    factors.length > 0
      ? `The backend reports these contributing factors: ${factors}.`
      : "The backend reported no contributing factors for this schedule.";
  return `Your risk score is ${score}/100 (${band.label}). ${factorSentence} ${RISK_EXPLAINER}`;
}

function answerCommute({ analysis, selectionCount }: HelpContext): string {
  if (!analysis) {
    return `Commute warnings appear once you have an analysis. ${needMoreSections(selectionCount)}`;
  }
  const warnings = analysis.commute_warnings;
  if (warnings.length === 0) {
    return "The backend reported no tight or impossible walking transitions for this schedule.";
  }
  const describe = (index: number) => {
    const warning = warnings[index]!;
    return `${formatWeekdayShort(warning.day)} ${warning.from.crn} (${warning.from.building}) to ${warning.to.crn} (${warning.to.building}), ${verdictLabel(warning.verdict).toLowerCase()}, ${warning.walk_min} min walk with a ${warning.gap_min} min gap`;
  };
  const impossible = warnings
    .map((warning, index) => ({ warning, index }))
    .filter((item) => item.warning.verdict === "impossible");
  const tight = warnings
    .map((warning, index) => ({ warning, index }))
    .filter((item) => item.warning.verdict === "tight");

  const parts: string[] = [];
  if (impossible.length > 0) {
    parts.push(`Impossible transitions: ${impossible.map((item) => describe(item.index)).join("; ")}.`);
  }
  if (tight.length > 0) {
    parts.push(`Tight transitions: ${tight.map((item) => describe(item.index)).join("; ")}.`);
  }
  return `The backend reported ${warnings.length} walking warning${warnings.length === 1 ? "" : "s"}. ${parts.join(" ")}`;
}

function answerGpa({ analysis, selectionCount }: HelpContext): string {
  if (!analysis) {
    return `${GPA_EXPLAINER} ${needMoreSections(selectionCount)}`;
  }
  const { mean, confidence, n_students, n_terms } = analysis.expected_gpa;
  const value = mean === null ? "not available" : formatTwoDecimals(mean);
  return `This schedule's expected GPA is ${value} with ${confidenceLabel(confidence).toLowerCase()}, based on ${n_students} historical student${n_students === 1 ? "" : "s"} across ${n_terms} term${n_terms === 1 ? "" : "s"}. ${GPA_EXPLAINER}`;
}

function answerCompare({ selectionCount }: HelpContext): string {
  return `${COMPARE_EXPLAINER} You currently have ${selectionCount} selected section${selectionCount === 1 ? "" : "s"}.`;
}

/** Build the answer for one predefined prompt from current backend data. */
export function buildHelpAnswer(topic: HelpTopicId, context: HelpContext): string {
  switch (topic) {
    case "risk":
      return answerRisk(context);
    case "commute":
      return answerCommute(context);
    case "gpa":
      return answerGpa(context);
    case "compare":
      return answerCompare(context);
  }
}
