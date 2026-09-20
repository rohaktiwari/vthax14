import { useSchedule } from "../context/ScheduleContext";
import { sumCredits } from "../lib/schedule";

/**
 * Compact selected-schedule summary shown in the center once a plan exists and
 * the user is no longer actively searching. It replaces the oversized Burruss
 * hero while preserving the one-section analysis prompt from `HeroPanel`.
 */
export default function SelectedScheduleSummary() {
  const { crns, selectedSections, unavailableCrns } = useSchedule();
  const selectedCount = selectedSections.length;
  const credits = sumCredits(selectedSections);

  return (
    <section
      aria-label="Selected schedule summary"
      data-testid="selected-schedule-summary"
      className="rounded-2xl border border-line bg-panel p-5 shadow-card"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-semibold uppercase tracking-[0.16em] text-ink-secondary">
            Selected schedule
          </p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight text-ink-primary">
            {crns.length} section{crns.length === 1 ? "" : "s"}
            <span className="ml-2 text-base font-semibold text-ink-secondary">
              {credits} credit{credits === 1 ? "" : "s"}
            </span>
          </p>
        </div>
        <span aria-hidden="true" className="h-1 w-16 rounded-full bg-gradient-to-r from-vt-orange to-transparent" />
      </div>

      {unavailableCrns.length > 0 ? (
        <p className="mt-2 text-xs text-ink-secondary">
          {unavailableCrns.length} selected section
          {unavailableCrns.length === 1 ? "" : "s"} with details unavailable. Search the course to load
          its full details.
        </p>
      ) : null}

      {selectedCount === 1 ? (
        <p className="mt-2 text-sm text-ink-secondary">
          Add at least one more section to calculate schedule risk.
        </p>
      ) : null}

      <p className="mt-3 text-xs text-ink-secondary">
        Calendar, map, risk, stress, and swap tools remain available.
      </p>
    </section>
  );
}
