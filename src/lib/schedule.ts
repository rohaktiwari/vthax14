/**
 * Pure helpers for the URL-backed selected-CRN list.
 *
 * The frontend PRD makes the `crns` query parameter the durable client-side
 * schedule state: ordered, de-duplicated, and capped at 12 to match backend
 * validation. These functions are intentionally pure so they are unit-testable
 * without React Router.
 */

export const MAX_CRNS = 12;

/** Parse a `crns` query value: split, trim, drop blanks, de-dupe, cap at 12. */
export function parseCrnParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of raw.split(",")) {
    const crn = part.trim();
    if (!crn || seen.has(crn)) continue;
    seen.add(crn);
    result.push(crn);
    if (result.length >= MAX_CRNS) break;
  }
  return result;
}

/** Serialize the ordered CRN list for the `crns` query parameter. */
export function serializeCrns(crns: string[]): string {
  return crns.join(",");
}

/**
 * Append a CRN preserving selection order. No-ops for blank input, an already
 * selected CRN, or a full list (max 12).
 */
export function addCrn(crns: string[], crn: string): string[] {
  const next = crn.trim();
  if (!next) return crns;
  if (crns.includes(next)) return crns;
  if (crns.length >= MAX_CRNS) return crns;
  return [...crns, next];
}

/** Remove a CRN, preserving the order of the remainder. */
export function removeCrn(crns: string[], crn: string): string[] {
  return crns.filter((existing) => existing !== crn);
}

/**
 * Total credits for cached selected sections only. Sections whose details are
 * unavailable are excluded by the caller; this never estimates or fabricates
 * credits.
 */
export function sumCredits(items: readonly { credits: number }[]): number {
  return items.reduce(
    (total, item) => total + (Number.isFinite(item.credits) ? item.credits : 0),
    0,
  );
}
