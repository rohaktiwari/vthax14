import type { ReactNode } from "react";
import { useCenterView } from "../context/CenterViewContext";
import { useSchedule } from "../context/ScheduleContext";
import { useCountUp } from "../hooks/useCountUp";
import { useScheduleAnalysis } from "../hooks/useScheduleAnalysis";
import { formatRiskScore, riskBand, type RiskTone } from "../lib/risk";
import { creditsLabel } from "../lib/sectionText";
import { sumCredits } from "../lib/schedule";
import { BTN_PRIMARY_LG, CARD, type Tone } from "../lib/ui";
import Badge from "./Badge";
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

const TONE_BADGE: Record<RiskTone, Tone> = {
  low: "success",
  moderate: "info",
  high: "warning",
  "very-high": "danger",
};

function ScoreMeter({ score }: { score: number }) {
  const band = riskBand(score);
  const animated = useCountUp(score);
  const filled = Math.round(Math.min(100, Math.max(0, animated)) / 10);
  return (
    <div className="flex items-center gap-5">
      <p className={`flex items-baseline gap-1.5 leading-none ${TONE_TEXT[band.tone]}`}>
        <span className="text-6xl font-extrabold tabular-nums" data-testid="risk-score">
          {formatRiskScore(animated)}
        </span>
        <span className="text-base font-semibold text-ink-secondary">/ 100</span>
      </p>
      <div className="min-w-0 flex-1">
        <Badge tone={TONE_BADGE[band.tone]}>
          <span data-testid="risk-band">{band.label}</span> risk
        </Badge>
        <div className="mt-3 flex gap-1.5" aria-hidden="true">
          {Array.from({ length: 10 }, (_, index) => (
            <span
              key={index}
              className={`h-2.5 flex-1 rounded-full ${index < filled ? TONE_BG[band.tone] : "bg-line"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function OverviewFrame({ subtitle, children }: { subtitle: string; children: ReactNode }) {
  return (
    <section aria-label="Schedule overview" className={`${CARD} p-5`}>
      <h2 className="text-xl font-bold text-ink-primary">Schedule overview</h2>
      <p className="mt-0.5 text-sm text-ink-secondary">{subtitle}</p>
      <div className="mt-4 space-y-5">{children}</div>
    </section>
  );
}

/**
 * The default center view once courses are selected: overall risk, the walks
 * that need attention, and expected GPA (collapsed). Every number comes from the
 * backend analysis; bands and labels are presentation only.
 */
export default function ScheduleOverview() {
  const { crns, selectedSections } = useSchedule();
  const { showAdd } = useCenterView();
  const analysis = useScheduleAnalysis();

  const count = crns.length;
  const credits = sumCredits(selectedSections);
  const subtitle = `${count} course${count === 1 ? "" : "s"}${credits > 0 ? ` · ${creditsLabel(credits)}` : ""}`;

  if (count < 2) {
    return (
      <OverviewFrame subtitle={subtitle}>
        <div className="rounded-xl border border-line bg-warm p-4">
          <p className="text-base font-medium text-ink-primary" data-testid="analyze-prompt">
            Add one more course to see your risk score and walking times.
          </p>
          <button type="button" onClick={showAdd} className={`${BTN_PRIMARY_LG} mt-3`}>
            Add a course
          </button>
        </div>
      </OverviewFrame>
    );
  }

  if (analysis.isPending) {
    return (
      <section aria-label="Schedule overview" aria-busy="true" className={`${CARD} space-y-4 p-5`}>
        <h2 className="text-xl font-bold text-ink-primary">Checking your schedule…</h2>
        <Skeleton lines={3} />
        <Skeleton lines={4} />
      </section>
    );
  }

  if (analysis.error && !analysis.data) {
    return (
      <OverviewFrame subtitle={subtitle}>
        <ErrorState error={analysis.error} onRetry={analysis.retry} />
      </OverviewFrame>
    );
  }

  const data = analysis.data;
  if (!data) return null;

  const band = riskBand(data.risk_score);
  const warningCount = data.commute_warnings.length;

  return (
    <OverviewFrame subtitle={subtitle}>
      <div className={analysis.isUpdating ? "opacity-60 transition-opacity" : "transition-opacity"}>
        <ScoreMeter score={data.risk_score} />
        <p className="mt-3 text-base text-ink-primary" data-testid="risk-summary">
          {band.label} risk across {data.sections.length || count} course
          {(data.sections.length || count) === 1 ? "" : "s"}
          {warningCount > 0
            ? `, with ${warningCount} walking warning${warningCount === 1 ? "" : "s"}.`
            : ", and no walking warnings."}
        </p>
        <p className="mt-1 text-sm text-ink-secondary" role="status">
          {analysis.isUpdating
            ? "Updating for your latest change…"
            : "A planning heuristic, not a prediction of your grades."}
        </p>
      </div>

      {analysis.error ? <ErrorState error={analysis.error} onRetry={analysis.retry} /> : null}

      <CommuteWarnings warnings={data.commute_warnings} sections={data.sections} />
      <ExpectedGpa expectedGpa={data.expected_gpa} />

      <p className="text-sm text-ink-secondary">
        Select a course in Your Courses or click a class on the calendar to see its details.
      </p>
    </OverviewFrame>
  );
}
