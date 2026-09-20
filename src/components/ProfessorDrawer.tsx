import { useEffect, useRef } from "react";
import type { VibesGradeStats, VibesRmp } from "../api/types";
import { useProfessorVibes } from "../api/hooks";
import { ApiError, normalizeApiError } from "../api/errors";
import { confidenceLabel, formatOneDecimal, formatTwoDecimals } from "../lib/risk";
import ErrorState from "./ErrorState";
import Skeleton from "./Skeleton";

interface ProfessorDrawerProps {
  /** Surname for the documented `/professors/{surname}/vibes` path. */
  surname: string;
  /** Full display name from section data, shown when available. */
  displayName: string;
  returnFocusTo?: HTMLElement | null;
  onClose: () => void;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function gradeStatsEmpty(stats: VibesGradeStats): boolean {
  return (
    stats.n_sections === 0 &&
    stats.n_students === 0 &&
    stats.avg_gpa === null &&
    stats.volatility === null &&
    stats.a_rate === null
  );
}

function valueOrFallback(value: number | null, format: (input: number) => string): string {
  return value === null ? "Not available" : format(value);
}

function RmpSection({ rmp }: { rmp: VibesRmp | null }) {
  if (!rmp) {
    return (
      <p className="mt-1 text-sm text-ink-secondary" data-testid="professor-rmp-empty">
        No review summary available
      </p>
    );
  }

  return (
    <dl className="mt-2 grid grid-cols-2 gap-3 text-sm" data-testid="professor-rmp">
      <div>
        <dt className="text-xs text-ink-secondary">RMP score</dt>
        <dd className="font-semibold text-ink-primary">{formatOneDecimal(rmp.score)}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-secondary">Difficulty</dt>
        <dd className="font-semibold text-ink-primary">{formatOneDecimal(rmp.difficulty)}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-secondary">Reviews</dt>
        <dd className="font-semibold text-ink-primary">{rmp.n_reviews}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-secondary">Would take again</dt>
        <dd className="font-semibold text-ink-primary">
          {rmp.would_take_again === null
            ? "Not available"
            : `${formatOneDecimal(rmp.would_take_again)}%`}
        </dd>
      </div>
    </dl>
  );
}

function GradesSection({ stats }: { stats: VibesGradeStats }) {
  if (gradeStatsEmpty(stats)) {
    return (
      <p className="mt-1 text-sm text-ink-secondary" data-testid="professor-grades-empty">
        No matching grade history available
      </p>
    );
  }

  return (
    <dl className="mt-2 grid grid-cols-2 gap-3 text-sm" data-testid="professor-grades">
      <div>
        <dt className="text-xs text-ink-secondary">Average GPA</dt>
        <dd className="font-semibold text-ink-primary">
          {valueOrFallback(stats.avg_gpa, formatTwoDecimals)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-ink-secondary">Volatility</dt>
        <dd className="font-semibold text-ink-primary">
          {valueOrFallback(stats.volatility, formatTwoDecimals)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-ink-secondary">Grade records</dt>
        <dd className="font-semibold text-ink-primary">{stats.n_sections}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-secondary">Students graded</dt>
        <dd className="font-semibold text-ink-primary">{stats.n_students}</dd>
      </div>
      <div>
        <dt className="text-xs text-ink-secondary">A rate</dt>
        <dd className="font-semibold text-ink-primary">
          {valueOrFallback(stats.a_rate, (value) => `${formatOneDecimal(value)}%`)}
        </dd>
      </div>
    </dl>
  );
}

/**
 * Instructor "vibes" drawer (frontend PRD §10.13).
 *
 * Loaded lazily through `ProfessorDrawerContext`. Calls only
 * `GET /api/professors/{surname}/vibes`; every RMP, grade, tag, confidence, and
 * note value is rendered as returned. The browser never contacts RMP.
 *
 * Accessibility: modal dialog with a labelled heading, initial focus, a Tab
 * focus trap, Escape to close, and focus restored to the triggering control.
 */
export default function ProfessorDrawer({
  surname,
  displayName,
  returnFocusTo = null,
  onClose,
}: ProfessorDrawerProps) {
  const query = useProfessorVibes(surname);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled"),
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnFocusTo?.focus();
    };
  }, [onClose, returnFocusTo]);

  const normalized = query.isError ? normalizeApiError(query.error) : null;
  const notFound = normalized instanceof ApiError && normalized.status === 404;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink-primary/40 backdrop-blur-sm"
      onClick={onClose}
      data-testid="professor-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="professor-drawer-title"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        data-testid="professor-drawer"
        className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-panel p-5 shadow-2xl hl-scroll"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="professor-drawer-title" className="text-base font-semibold text-ink-primary">
              {displayName || "Instructor"}
            </h2>
            <p className="text-xs text-ink-secondary">
              Instructor data for “{displayName || surname}”.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close instructor details"
            className="rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-semibold text-ink-secondary transition-colors hover:bg-soft-maroon hover:text-ink-primary"
          >
            Close
          </button>
        </header>

        {query.isPending ? (
          <div className="mt-4" aria-busy="true" data-testid="professor-loading">
            <p className="text-sm text-ink-secondary">Loading instructor details…</p>
            <div className="mt-3">
              <Skeleton lines={4} />
            </div>
          </div>
        ) : notFound ? (
          <p className="mt-4 rounded-lg border border-line bg-warm p-3 text-sm text-ink-secondary" data-testid="professor-not-found">
            No instructor data found
          </p>
        ) : query.isError ? (
          <div className="mt-4">
            <ErrorState
              title="Instructor data unavailable"
              error={normalized ?? normalizeApiError(query.error)}
              onRetry={() => void query.refetch()}
            />
          </div>
        ) : query.data ? (
          <div className="mt-4 space-y-4">
            <section>
              <h3 className="text-sm font-semibold text-ink-primary">Reviews</h3>
              <RmpSection rmp={query.data.rmp} />
            </section>

            <section>
              <h3 className="text-sm font-semibold text-ink-primary">Historical grades</h3>
              <GradesSection stats={query.data.grade_stats} />
            </section>

            <section>
              <h3 className="text-sm font-semibold text-ink-primary">Vibe tags</h3>
              {query.data.tags.length > 0 ? (
                <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="professor-tags">
                  {query.data.tags.map((tag) => (
                    <li
                      key={tag}
                      className="rounded-full border border-line bg-warm px-2 py-0.5 text-xs text-ink-primary"
                    >
                      {tag}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-ink-secondary" data-testid="professor-tags-empty">
                  No vibe tags available
                </p>
              )}
            </section>

            <section>
              <h3 className="text-sm font-semibold text-ink-primary">Confidence</h3>
              <p className="mt-1 text-sm text-ink-secondary" data-testid="professor-confidence">
                {confidenceLabel(query.data.confidence)} ({query.data.confidence})
              </p>
            </section>

            <section className="rounded-xl border border-line bg-warm p-3 text-xs">
              <h3 className="text-sm font-semibold text-ink-primary">Data notes</h3>
              {query.data.data_notes.length > 0 ? (
                <ul className="mt-2 list-disc space-y-1 pl-4 text-ink-secondary" data-testid="professor-notes">
                  {query.data.data_notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-ink-secondary" data-testid="professor-notes-empty">
                  No data notes were reported for this instructor.
                </p>
              )}
            </section>
          </div>
        ) : null}
      </div>
    </div>
  );
}
