import type { Section } from "../api/types";
import {
  describeRiskDelta,
  type RiskDeltaDescription,
  type RiskDeltaDirection,
} from "./risk";

/**
 * Pure swap helpers (frontend PRD §10.11).
 *
 * These only reshape already-known state and describe backend-provided values.
 * They never calculate risk, a swap delta, commute verdicts, or validation.
 */

/** Replace `dropCrn` with `addCrn` at the exact same list index. */
export function replaceCrnAtSameIndex(
  crns: readonly string[],
  dropCrn: string,
  addCrn: string,
): string[] {
  return crns.map((crn) => (crn === dropCrn ? addCrn : crn));
}

export type DeltaDirection = RiskDeltaDirection;
export type DeltaDescription = RiskDeltaDescription;

/**
 * Describe a backend `delta` (`after.risk_score - before.risk_score`) in text so
 * improvement is never conveyed by color alone. Shared with the stress view.
 */
export const describeDelta = describeRiskDelta;

export interface AlternativeOptions {
  dropCrn: string | null;
  selectedCrns: readonly string[];
  /** A backend/demo-provided add CRN that must always remain selectable. */
  preferredAddCrn?: string | null;
}

/**
 * Candidate alternatives drawn only from full Section objects already in
 * frontend state (search results / cached selections). Prefers sections of the
 * dropped section's own course; nothing is synthesized or fetched.
 */
export function findAlternativeSections(
  available: readonly Section[],
  { dropCrn, selectedCrns, preferredAddCrn }: AlternativeOptions,
): Section[] {
  const selected = new Set(selectedCrns);
  const dropSection = dropCrn ? available.find((section) => section.crn === dropCrn) ?? null : null;

  return available
    .filter((section) => {
      if (section.crn === dropCrn) return false;
      if (selected.has(section.crn)) return false;
      if (section.crn === preferredAddCrn) return false;
      if (dropSection && section.course_id !== dropSection.course_id) return false;
      return true;
    })
    .sort(
      (a, b) =>
        a.course_id.localeCompare(b.course_id) ||
        a.course_no.localeCompare(b.course_no) ||
        a.crn.localeCompare(b.crn),
    );
}
