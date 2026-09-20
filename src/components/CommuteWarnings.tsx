import type { CommuteWarning, CommuteVerdict } from "../api/types";
import { formatWeekdayShort } from "../lib/time";
import { verdictLabel } from "../lib/risk";

const VERDICT_CLASSES: Record<CommuteVerdict, string> = {
  comfortable: "border-success/40 bg-panel text-success",
  tight: "border-warning/50 bg-panel text-warning",
  impossible: "border-danger/50 bg-panel text-danger",
};

/**
 * Backend commute warnings, rendered exactly. The backend returns only tight
 * and impossible transitions; the frontend never re-derives verdicts from
 * thresholds. Verdict is stated in text as well as color.
 */
export default function CommuteWarnings({ warnings }: { warnings: CommuteWarning[] }) {
  return (
    <section aria-label="Commute warnings">
      <h3 className="text-sm font-semibold text-ink-primary">Commute warnings</h3>

      {warnings.length === 0 ? (
        <p className="mt-2 rounded-lg border border-line bg-warm px-3 py-2 text-xs text-ink-secondary">
          No tight or impossible walking transitions were reported.
        </p>
      ) : (
        <ul className="mt-2 space-y-3">
          {warnings.map((warning, index) => (
            <li key={`${warning.day}-${warning.from.crn}-${warning.to.crn}-${index}`} className="rounded-xl border border-line bg-warm/40 p-3 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-medium text-ink-primary">
                  {formatWeekdayShort(warning.day)} · {warning.from.crn} → {warning.to.crn}
                </p>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[0.6875rem] font-semibold ${VERDICT_CLASSES[warning.verdict]}`}
                >
                  {verdictLabel(warning.verdict)}
                </span>
              </div>
              <p className="mt-1 text-xs text-ink-secondary">
                {warning.from.building} ({warning.from.ends}) → {warning.to.building} ({warning.to.starts})
              </p>
              <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt className="text-ink-secondary">Walk</dt>
                  <dd className="font-semibold text-ink-primary">{warning.walk_min} min</dd>
                </div>
                <div>
                  <dt className="text-ink-secondary">Adjusted</dt>
                  <dd className="font-semibold text-ink-primary">{warning.adjusted_walk_min} min</dd>
                </div>
                <div>
                  <dt className="text-ink-secondary">Gap</dt>
                  <dd className="font-semibold text-ink-primary">{warning.gap_min} min</dd>
                </div>
              </dl>
              <p className="mt-2 text-xs text-ink-secondary">{warning.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
