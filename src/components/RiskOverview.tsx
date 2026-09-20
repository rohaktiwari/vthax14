import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAnalysis } from "../api/hooks";
import { normalizeApiError } from "../api/errors";
import { queryKeys } from "../api/queryKeys";
import { useSchedule } from "../context/ScheduleContext";
import { formatRiskScore, riskBand, type RiskTone } from "../lib/risk";
import CommuteWarnings from "./CommuteWarnings";
import ErrorState from "./ErrorState";
import ExpectedGpa from "./ExpectedGpa";
import Skeleton from "./Skeleton";

const TONE_TEXT: Record<RiskTone, string> = {
  low: "text-success",
  moderate: "text-info",
  high: "text-warning",
  "very-high": "text-danger",
};

const TONE_BG: Record<RiskTone, string> = {
  low: "bg-success",
  moderate: "bg-info",
  high: "bg-warning",
  "very-high": "bg-danger",
};

function RiskScore({ score }: { score: number }) {
  const band = riskBand(score);
  const filled = Math.round(Math.min(100, Math.max(0, score)) / 10);

  return (
    <div>
      <div className="flex items-end gap-2">
        <p
          className={`text-5xl font-extrabold leading-none tabular-nums ${TONE_TEXT[band.tone]}`}
          data-testid="risk-score"
        >
          {formatRiskScore(score)}
        </p>
        <p className="pb-1 text-sm font-semibold text-ink-secondary">/ 100</p>
        <span
          className={`mb-1 rounded-full border border-line px-2 py-0.5 text-xs font-semibold ${TONE_TEXT[band.tone]}`}
          data-testid="risk-band"
        >
          {band.label}
        </span>
      </div>
      <div className="mt-3 flex gap-1.5" aria-hidden="true">
        {Array.from({ length: 10 }, (_, index) => (
          <span
            key={index}
            className={`h-2 flex-1 rounded-full ${index < filled ? TONE_BG[band.tone] : "bg-line"}`}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * /api/analyze insights (frontend PRD §10.7–§10.10).
 *
 * Runs only for 2–12 selected URL CRNs, in order. One selected section shows
 * the required prompt and makes no request. All rendered values come from the
 * backend; bands, labels, and number formatting are presentation only.
 */
export default function RiskOverview() {
  const { crns } = useSchedule();
  const analysis = useAnalysis(crns);
  const queryClient = useQueryClient();

  // Selected schedule changed: drop cached analyses for other CRN sets so
  // insights never show results for a schedule the URL no longer represents.
  const crnsKey = crns.join(",");
  useEffect(() => {
    queryClient.removeQueries({
      queryKey: queryKeys.analyze,
      predicate: (query) =>
        (query.queryKey[1] as string[] | undefined)?.join(",") !== crnsKey,
    });
  }, [crnsKey, queryClient]);

  if (crns.length === 0) {
    return (
      <section aria-label="Schedule insights" className="rounded-2xl border border-line bg-panel p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink-primary">Insights</h2>
        <p className="mt-1 text-sm text-ink-secondary" data-testid="insights-empty">
          Select at least two sections to see risk, walking gaps, and expected GPA.
        </p>
      </section>
    );
  }

  if (crns.length === 1) {
    return (
      <section aria-label="Schedule insights" className="rounded-2xl border border-line bg-panel p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink-primary">Insights</h2>
        <p className="mt-1 text-sm text-ink-secondary" data-testid="analyze-prompt">
          Add at least one more section to calculate schedule risk.
        </p>
      </section>
    );
  }

  if (analysis.isPending) {
    return (
      <section
        aria-label="Schedule insights"
        aria-busy="true"
        className="space-y-3 rounded-2xl border border-line bg-panel p-5 shadow-card"
      >
        <h2 className="text-base font-semibold text-ink-primary">Analyzing your schedule…</h2>
        <Skeleton lines={4} />
        <Skeleton lines={3} />
      </section>
    );
  }

  if (analysis.isError) {
    return (
      <section aria-label="Schedule insights" className="rounded-2xl border border-line bg-panel p-5 shadow-card">
        <h2 className="mb-3 text-base font-semibold text-ink-primary">Insights</h2>
        <ErrorState error={normalizeApiError(analysis.error)} onRetry={() => void analysis.refetch()} />
      </section>
    );
  }

  const data = analysis.data;
  if (!data) {
    return (
      <section aria-label="Schedule insights" className="rounded-2xl border border-line bg-panel p-5 shadow-card">
        <h2 className="text-base font-semibold text-ink-primary">Insights</h2>
        <p className="mt-1 text-sm text-ink-secondary">No analysis is available yet.</p>
      </section>
    );
  }

  const band = riskBand(data.risk_score);
  const sectionCount = data.sections.length || crns.length;
  const warningCount = data.commute_warnings.length;

  return (
    <section
      aria-label="Schedule insights"
      className="space-y-4 rounded-2xl border border-line bg-panel p-5 shadow-card"
    >
      <div>
        <h2 className="text-base font-semibold text-ink-primary">Risk overview</h2>
        <p className="mt-1 text-sm text-ink-secondary" data-testid="risk-summary">
          {band.label} risk ({formatRiskScore(data.risk_score)}/100) across {sectionCount} selected
          section{sectionCount === 1 ? "" : "s"}
          {warningCount > 0
            ? `, with ${warningCount} walking warning${warningCount === 1 ? "" : "s"}.`
            : "."}
        </p>
        <div className="mt-3">
          <RiskScore score={data.risk_score} />
        </div>
        <p className="sr-only" role="status">
          Analysis complete. Risk score {formatRiskScore(data.risk_score)} out of 100,{" "}
          {band.label}.
        </p>
      </div>

      <CommuteWarnings warnings={data.commute_warnings} />
      <ExpectedGpa expectedGpa={data.expected_gpa} />
    </section>
  );
}
