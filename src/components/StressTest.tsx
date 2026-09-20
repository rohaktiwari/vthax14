import { useEffect, useState } from "react";
import type { StressImpact } from "../api/types";
import { useStress } from "../api/hooks";
import { normalizeApiError } from "../api/errors";
import { useSchedule } from "../context/ScheduleContext";
import { describeRiskDelta, formatRiskScore, riskBand } from "../lib/risk";
import ErrorState from "./ErrorState";
import Skeleton from "./Skeleton";

/** Required, always-visible copy (frontend PRD §10.12). */
const DISCLAIMER =
  "This is a deterministic catch-up-cost heuristic, not a forecast of academic performance.";

const WEEKS = Array.from({ length: 16 }, (_, index) => index + 1);

const IMPACT_LABEL: Record<StressImpact, string> = {
  low: "Low impact",
  medium: "Medium impact",
  high: "High impact",
};

const IMPACT_TONE: Record<StressImpact, string> = {
  low: "border-line bg-warm text-ink-secondary",
  medium: "border-warning/50 bg-panel text-warning",
  high: "border-danger/50 bg-panel text-danger",
};

/**
 * Miss-one-week stress test (frontend PRD §10.12).
 *
 * Sends `{ crns, scenario: "miss_week", week }` and renders backend
 * original/stressed risk, delta, per-course penalties, and the backend heuristic
 * note unchanged. The chosen week is narrative input only: the UI never implies
 * the backend knows assignments, tests, or actual student performance.
 */
export default function StressTest() {
  const { crns } = useSchedule();
  const stress = useStress();
  const [week, setWeek] = useState(8);

  const eligible = crns.length >= 2 && crns.length <= 12;
  const crnsKey = crns.join(",");

  // A schedule change invalidates any displayed result (different CRN set).
  useEffect(() => {
    stress.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset is stable; keyed by schedule.
  }, [crnsKey]);

  function run() {
    if (!eligible) return;
    stress.mutate({ crns, scenario: "miss_week", week });
  }

  const result = stress.data;

  return (
    <section aria-label="Stress test" className="space-y-4 rounded-2xl border border-line bg-panel p-5 shadow-card">
      <div>
        <h2 className="text-base font-semibold text-ink-primary">Stress test</h2>
        <p className="mt-1 text-sm text-ink-secondary">
          Estimate the catch-up cost of missing one week of classes.
        </p>
      </div>

      <p
        data-testid="stress-disclaimer"
        className="rounded-lg border border-warning/40 bg-warm px-3 py-2 text-xs text-ink-primary"
      >
        {DISCLAIMER}
      </p>

      {eligible ? (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <p className="text-xs font-medium text-ink-secondary">Scenario</p>
            <p className="text-sm text-ink-primary">Miss one week</p>
          </div>
          <div>
            <label htmlFor="stress-week" className="block text-xs font-medium text-ink-secondary">
              Week
            </label>
            <select
              id="stress-week"
              data-testid="stress-week"
              value={week}
              onChange={(event) => {
                stress.reset();
                setWeek(Number(event.target.value));
              }}
              className="mt-0.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm text-ink-primary"
            >
              {WEEKS.map((value) => (
                <option key={value} value={value}>
                  Week {value}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            data-testid="run-stress"
            onClick={run}
            disabled={stress.isPending}
            className="rounded-lg border border-maroon bg-maroon px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-maroon-dark disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stress.isPending ? "Running…" : "Run stress test"}
          </button>
        </div>
      ) : (
        <p className="text-sm text-ink-secondary" data-testid="stress-prompt">
          Add at least one more section to run a stress test.
        </p>
      )}

      {stress.isPending ? (
        <div aria-busy="true" data-testid="stress-loading">
          <p className="text-sm text-ink-secondary">Running stress test…</p>
          <div className="mt-3">
            <Skeleton lines={3} />
          </div>
        </div>
      ) : null}

      {stress.isError ? (
        <ErrorState
          title="Stress test could not be run"
          error={normalizeApiError(stress.error)}
          onRetry={run}
        />
      ) : null}

      {result && !stress.isError ? (
        <div className="space-y-3" data-testid="stress-result">
          <div className="rounded-xl border border-line bg-warm p-3">
            <p className="text-sm font-semibold text-ink-primary">Risk impact</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
              <p className="text-ink-secondary">
                Original:{" "}
                <span className="font-semibold text-ink-primary">
                  {formatRiskScore(result.original_risk)}
                </span>{" "}
                ({riskBand(result.original_risk).label})
              </p>
              <p className="text-ink-secondary">
                Stressed:{" "}
                <span className="font-semibold text-ink-primary">
                  {formatRiskScore(result.stressed_risk)}
                </span>{" "}
                ({riskBand(result.stressed_risk).label})
              </p>
            </div>
            <p className="mt-2 text-sm text-ink-primary" data-testid="stress-delta">
              {describeRiskDelta(result.delta, result.original_risk, result.stressed_risk).text}
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink-primary">Per-course penalties</h3>
            {result.penalties.length > 0 ? (
              <ul className="mt-2 space-y-2" data-testid="stress-penalties">
                {result.penalties.map((penalty) => (
                  <li
                    key={`${penalty.crn}-${penalty.course_id}`}
                    className="rounded-xl border border-line bg-warm/40 p-2.5 text-sm shadow-sm"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-ink-primary">{penalty.course_id}</span>
                      <span className="flex items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold ${IMPACT_TONE[penalty.impact]}`}
                        >
                          {IMPACT_LABEL[penalty.impact]}
                        </span>
                        <span className="text-xs text-ink-secondary">+{penalty.points} points</span>
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-ink-secondary">{penalty.reason}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-ink-secondary" data-testid="stress-penalties-empty">
                No per-course penalties were reported.
              </p>
            )}
          </div>

          <p
            className="rounded-lg border border-line bg-warm p-3 text-xs text-ink-secondary"
            data-testid="stress-meta-note"
          >
            {result.meta.note}
          </p>
        </div>
      ) : null}
    </section>
  );
}
