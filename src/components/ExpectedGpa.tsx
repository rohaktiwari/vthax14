import type { ExpectedGpa as ExpectedGpaData, GpaExclusionReason } from "../api/types";
import { confidenceLabel, formatTwoDecimals } from "../lib/risk";

const EXCLUSION_LABELS: Record<GpaExclusionReason, string> = {
  pass_fail: "pass/fail",
  no_grade_history: "no grade history",
};

/**
 * Expected GPA, collapsed by default (secondary information). Values render
 * unchanged with two decimals; confidence, sample size, and excluded sections are
 * always inside the disclosure.
 */
export default function ExpectedGpa({ expectedGpa }: { expectedGpa: ExpectedGpaData }) {
  const { range, mean, confidence, n_students, n_terms, excluded } = expectedGpa;

  return (
    <details aria-label="Expected GPA" className="group rounded-xl border border-line bg-panel">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5">
        <span className="text-base font-semibold text-ink-primary">
          Expected GPA{" "}
          <span className="tabular-nums">{mean === null ? "not available" : formatTwoDecimals(mean)}</span>
        </span>
        <span className="flex items-center gap-2 text-sm text-ink-secondary">
          {confidenceLabel(confidence)}
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">
            ▶
          </span>
        </span>
      </summary>

      <div className="space-y-2 border-t border-line px-3 py-3 text-sm text-ink-secondary">
        <p>
          {range === null
            ? "No historical range was reported."
            : `Range ${formatTwoDecimals(range[0])} to ${formatTwoDecimals(range[1])}.`}{" "}
          Based on {n_students} historical student{n_students === 1 ? "" : "s"} across {n_terms} term
          {n_terms === 1 ? "" : "s"}.
        </p>
        {excluded.length > 0 ? (
          <p>
            Left out:{" "}
            {excluded.map((item) => `CRN ${item.crn} (${EXCLUSION_LABELS[item.reason]})`).join(", ")}.
          </p>
        ) : null}
        <p>Historical grade data describes past sections and is not a prediction of your grade.</p>
      </div>
    </details>
  );
}
