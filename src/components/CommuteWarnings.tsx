import type { CommuteVerdict, CommuteWarning, Section } from "../api/types";
import { verdictLabel } from "../lib/risk";
import { formatWeekdayShort } from "../lib/time";
import type { Tone } from "../lib/ui";
import Badge from "./Badge";

const VERDICT_TONE: Record<CommuteVerdict, Tone> = {
  comfortable: "success",
  tight: "warning",
  impossible: "danger",
};

const PREVIEW_COUNT = 3;

interface CommuteWarningsProps {
  warnings: CommuteWarning[];
  sections: readonly Section[];
}

function WarningRow({ warning, names }: { warning: CommuteWarning; names: Map<string, string> }) {
  const from = names.get(warning.from.crn) ?? warning.from.crn;
  const to = names.get(warning.to.crn) ?? warning.to.crn;
  return (
    <li className="rounded-xl border border-line bg-warm/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink-primary">
          {formatWeekdayShort(warning.day)} · {from} → {to}
        </p>
        <Badge tone={VERDICT_TONE[warning.verdict]}>{verdictLabel(warning.verdict)}</Badge>
      </div>
      <p className="mt-1 text-sm text-ink-secondary">
        {warning.from.building} to {warning.to.building}: {warning.walk_min} min walk, {warning.gap_min} min
        between classes.
      </p>
    </li>
  );
}

/**
 * Backend commute warnings, rendered exactly. The backend returns only tight
 * and impossible transitions; the frontend never re-derives verdicts from
 * thresholds. Verdict is stated in text as well as color. Only the first few
 * show; the rest sit behind one disclosure to keep the panel short.
 */
export default function CommuteWarnings({ warnings, sections }: CommuteWarningsProps) {
  const names = new Map(sections.map((section) => [section.crn, section.course_id]));
  const preview = warnings.slice(0, PREVIEW_COUNT);
  const rest = warnings.slice(PREVIEW_COUNT);

  return (
    <section aria-label="Commute warnings">
      <h3 className="text-base font-semibold text-ink-primary">Walking between classes</h3>

      {warnings.length === 0 ? (
        <p className="mt-2 rounded-lg border border-success/30 bg-success-soft px-3 py-2 text-sm text-success">
          No tight or impossible walks. Every gap between classes leaves enough time.
        </p>
      ) : (
        <>
          <ul className="mt-2 space-y-2">
            {preview.map((warning, index) => (
              <WarningRow key={`${warning.day}-${warning.from.crn}-${warning.to.crn}-${index}`} warning={warning} names={names} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-sm font-semibold text-maroon">
                Show {rest.length} more
              </summary>
              <ul className="mt-2 space-y-2">
                {rest.map((warning, index) => (
                  <WarningRow key={`${warning.day}-${warning.from.crn}-${warning.to.crn}-r${index}`} warning={warning} names={names} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </section>
  );
}
