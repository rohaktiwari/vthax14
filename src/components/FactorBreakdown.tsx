import type { RiskFactor } from "../api/types";
import { factorDisplayName, formatOneDecimal, severityPercent } from "../lib/risk";

/**
 * Factors in backend order. Values are rendered unchanged (one decimal);
 * zero-severity factors stay visible with a zero bar rather than being hidden.
 */
export default function FactorBreakdown({ factors }: { factors: RiskFactor[] }) {
  return (
    <section aria-label="Factor breakdown">
      <h3 className="text-sm font-semibold text-ink-primary">Factor breakdown</h3>
      <ul className="mt-2 space-y-3">
        {factors.map((factor) => {
          const percent = severityPercent(factor.severity, factor.max_severity);
          return (
            <li key={factor.type} className="rounded-xl border border-line bg-warm/40 p-3 shadow-sm">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium text-ink-primary">{factorDisplayName(factor.type)}</p>
                <p className="shrink-0 text-xs tabular-nums text-ink-secondary">
                  <span className="font-semibold text-ink-primary" data-testid="factor-severity">
                    {formatOneDecimal(factor.severity)}
                  </span>
                  {" / "}
                  <span data-testid="factor-max">{formatOneDecimal(factor.max_severity)}</span>
                </p>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line">
                <div
                  className="h-full rounded-full bg-maroon"
                  style={{ width: `${percent}%` }}
                  aria-hidden="true"
                />
              </div>
              <p className="mt-2 text-xs text-ink-secondary">{factor.detail}</p>
              {factor.affected_crns.length > 0 ? (
                <p className="mt-1 text-[0.6875rem] text-ink-secondary">
                  Affected CRNs: <span className="font-mono">{factor.affected_crns.join(", ")}</span>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
