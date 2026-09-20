import type { FormEvent } from "react";
import { useHealth } from "../api/hooks";
import { useCourseSearch } from "../context/CourseSearchContext";
import { useSchedule } from "../context/ScheduleContext";
import { COURSE_LEVELS, type CourseLevel } from "../lib/courses";
import { MAX_CRNS } from "../lib/schedule";
import ConnectedCourseResults from "./ConnectedCourseResults";

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium text-ink-primary">
      {children}
    </label>
  );
}

interface ToggleProps {
  id: string;
  label: string;
  helper?: string;
  checked?: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}

function Toggle({ id, label, helper, checked = false, disabled = false, onChange }: ToggleProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-ink-primary">
          {label}
        </label>
        {helper ? <p className="text-xs text-ink-secondary">{helper}</p> : null}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange?.(!checked)}
        className={`mt-0.5 inline-flex h-6 w-11 shrink-0 items-center rounded-full border px-0.5 transition-colors ${
          checked ? "border-maroon bg-maroon" : "border-line bg-line/70"
        } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
      >
        <span
          aria-hidden="true"
          className={`h-5 w-5 rounded-full bg-panel shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

interface SearchSidebarProps {
  /**
   * Render course results inside the sidebar. Desktop passes `false` because the
   * center column shows results there; the tablet drawer and mobile Search tab
   * keep the default so search still works without a center column.
   */
  showResults?: boolean;
}

/**
 * Course search controls: query, subject, level, open-seat filter, and the
 * selection counter. Search state lives in `CourseSearchContext` so results can
 * be shown elsewhere (see `CenterPanel`).
 */
export default function SearchSidebar({ showResults = true }: SearchSidebarProps) {
  const { crns, clear } = useSchedule();
  const health = useHealth();
  const {
    text,
    setText,
    submit,
    subject,
    setSubject,
    level,
    setLevel,
    openOnly,
    setOpenOnly,
    subjects,
    isSearchActive,
    courses,
    isPending,
    isError,
  } = useCourseSearch();

  const termLabel = health.data?.term_id ?? (health.isError ? "Term unavailable" : "Loading term…");
  const sectionCount = courses.reduce((total, group) => total + group.sections.length, 0);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  return (
    <div className="flex h-full flex-col rounded-2xl border border-line bg-panel shadow-card">
      <div className="border-b border-line p-4">
        <p className="flex items-center gap-2 rounded-lg bg-maroon px-3 py-2 text-sm font-semibold tracking-wide text-white shadow-sm">
          <svg
            viewBox="0 0 24 24"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          Search &amp; Plan
        </p>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 hl-scroll">
        <form onSubmit={handleSubmit}>
          <FieldLabel htmlFor="sb-search">Search for a course</FieldLabel>
          <input
            id="sb-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="e.g., CS 2104, MATH 2534"
            className="mt-1.5 w-full rounded-lg border border-line bg-warm px-3 py-2 text-sm transition-colors placeholder:text-ink-secondary focus:border-maroon/50"
          />
          <button
            type="submit"
            className="mt-2 w-full rounded-lg bg-maroon px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-maroon-dark active:bg-maroon-dark"
          >
            Search Classes
          </button>
        </form>

        <div>
          <FieldLabel htmlFor="sb-term">Term</FieldLabel>
          <select
            id="sb-term"
            disabled
            title="Term comes from /api/health and is display-only."
            className="mt-1.5 w-full cursor-not-allowed rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink-secondary disabled:opacity-70"
          >
            <option>{termLabel}</option>
          </select>
        </div>

        <div>
          <FieldLabel htmlFor="sb-subject">Subject</FieldLabel>
          <select
            id="sb-subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            className="mt-1.5 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink-primary"
          >
            <option value="all">All subjects</option>
            {subjects.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div>
          <FieldLabel htmlFor="sb-level">Course level</FieldLabel>
          <select
            id="sb-level"
            value={level}
            onChange={(event) =>
              setLevel(event.target.value === "all" ? "all" : (Number(event.target.value) as CourseLevel))
            }
            className="mt-1.5 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink-primary"
          >
            <option value="all">All levels</option>
            {COURSE_LEVELS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <div className="border-t border-line">
          <Toggle
            id="sb-open"
            label="Only open classes"
            helper="Client-side filter"
            checked={openOnly}
            onChange={setOpenOnly}
          />
          <p className="py-2 text-xs text-ink-secondary">
            Degree-audit filters are not available in this demo.
          </p>
        </div>

        <details className="group rounded-lg border border-line bg-warm/50">
          <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm font-medium text-ink-primary">
            More filters
            <span aria-hidden="true" className="text-ink-secondary transition-transform group-open:rotate-90">
              ▶
            </span>
          </summary>
          <p className="px-3 pb-3 text-xs text-ink-secondary">
            Course level and open-seat filters are applied client-side. The catalog API accepts only
            q, subject, and limit.
          </p>
        </details>

        <div className="rounded-lg border border-line bg-warm px-3 py-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-ink-primary">
              Selected {crns.length} of {MAX_CRNS}
            </span>
            <button
              type="button"
              onClick={clear}
              disabled={crns.length === 0}
              className="rounded-md border border-line bg-panel px-2.5 py-1 font-semibold text-ink-primary transition-colors hover:bg-soft-maroon disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clear
            </button>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div
              className="h-full rounded-full bg-maroon transition-[width] duration-300"
              style={{ width: `${Math.min(100, (crns.length / MAX_CRNS) * 100)}%` }}
            />
          </div>
        </div>

        {showResults ? (
          <ConnectedCourseResults />
        ) : (
          <p className="text-xs text-ink-secondary" aria-live="polite">
            {!isSearchActive
              ? "Type a course (2+ characters) or press Search Classes. Results appear in the main panel."
              : isPending
                ? "Searching…"
                : isError
                  ? "Could not load courses. See the main panel."
                  : `${courses.length} course${courses.length === 1 ? "" : "s"} · ${sectionCount} section${sectionCount === 1 ? "" : "s"} shown in the main panel.`}
          </p>
        )}
      </div>
    </div>
  );
}
