import type { ExpectedGpa as ExpectedGpaData, GpaExclusionReason } from "../api/types";
import { confidenceLabel, formatTwoDecimals } from "../lib/risk";

const EXCLUSION_LABELS: Record<GpaExclusionReason, string> = {
  pass_fail: "pass/fail",
  no_grade_history: "no grade history",
};

/**
 * Expected GPA block (frontend PRD §10.10). Values render unchanged with two
 * decimals; confidence, sample size, and excluded sections are always shown.
 */
export default function ExpectedGpa({ expectedGpa }: { expectedGpa: ExpectedGpaData }) {
  const { range, mean, confidence, n_students, n_terms, excluded } = expectedGpa;

  return (
    <section aria-label="Expected GPA" className="rounded-xl border border-line bg-panel p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-primary">Expected GPA</h3>
        <span className="shrink-0 rounded-full border border-line bg-warm px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-secondary">
          {confidenceLabel(confidence)}
        </span>
      </div>

      <p className="mt-2 text-2xl font-bold tabular-nums text-ink-primary">
        {mean === null ? "Not available" : formatTwoDecimals(mean)}
      </p>
      <p className="text-xs text-ink-secondary">
        {range === null
          ? "No historical range was reported."
          : `Range ${formatTwoDecimals(range[0])}–${formatTwoDecimals(range[1])}`}
      </p>

      <p className="mt-2 text-xs text-ink-secondary">
        Based on {n_students} historical student{n_students === 1 ? "" : "s"} across {n_terms} term
        {n_terms === 1 ? "" : "s"}.
      </p>

      {excluded.length > 0 ? (
        <div className="mt-2 text-xs text-ink-secondary">
          <p className="font-medium text-ink-primary">Excluded sections</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {excluded.map((item) => (
              <li key={item.crn}>
                <span className="font-mono">{item.crn}</span> — {EXCLUSION_LABELS[item.reason]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="mt-3 rounded-md border border-line bg-warm px-2 py-1.5 text-xs text-ink-secondary">
        Historical grade data describes past sections and is not a prediction of your grade.
      </p>
    </section>
  );
}
