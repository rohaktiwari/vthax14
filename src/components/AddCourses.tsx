import { useEffect, useRef, type FormEvent } from "react";
import { useCenterView } from "../context/CenterViewContext";
import { useCourseSearch } from "../context/CourseSearchContext";
import { useSchedule } from "../context/ScheduleContext";
import { COURSE_LEVELS, type CourseLevel } from "../lib/courses";
import { MAX_CRNS } from "../lib/schedule";
import { BTN_PRIMARY, BTN_SECONDARY, CARD } from "../lib/ui";
import ConnectedCourseResults from "./ConnectedCourseResults";

const FIELD =
  "mt-1.5 w-full rounded-lg border border-line bg-panel px-3 py-2 text-sm text-ink-primary";

/**
 * Add-a-course view in the center panel: one search box, filters tucked away,
 * results with an Add button per section. Search state lives in
 * `CourseSearchContext` so results keep hydrating selected CRNs either way.
 */
export default function AddCourses() {
  const { crns } = useSchedule();
  const { showOverview } = useCenterView();
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
    hasFilters,
    clearSearch,
  } = useCourseSearch();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function done() {
    clearSearch();
    showOverview();
  }

  const activeFilters = [subject !== "all", level !== "all", openOnly].filter(Boolean).length;

  return (
    <section aria-label="Add a course" className={`${CARD} flex min-h-0 flex-col`}>
      <div className="space-y-4 border-b border-line p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-ink-primary">Add a course</h2>
            <p className="mt-0.5 text-sm text-ink-secondary" aria-live="polite">
              {crns.length} of {MAX_CRNS} courses selected
            </p>
          </div>
          <button type="button" onClick={done} className={BTN_SECONDARY}>
            Done
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <label htmlFor="course-search" className="sr-only">
            Search for a course
          </label>
          <input
            ref={inputRef}
            id="course-search"
            type="search"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Course or subject, like CS 2104 or MATH"
            className="min-w-0 flex-1 rounded-lg border border-line bg-warm px-3.5 py-2.5 text-base text-ink-primary transition-colors placeholder:text-ink-secondary focus:border-maroon/50"
          />
          <button type="submit" className={BTN_PRIMARY}>
            Search
          </button>
        </form>

        <details className="group">
          <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-semibold text-maroon">
            <span aria-hidden="true" className="transition-transform group-open:rotate-90">
              ▶
            </span>
            Filters{activeFilters > 0 ? ` (${activeFilters} on)` : ""}
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="filter-subject" className="text-sm font-medium text-ink-primary">
                Subject
              </label>
              <select
                id="filter-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                className={FIELD}
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
              <label htmlFor="filter-level" className="text-sm font-medium text-ink-primary">
                Course level
              </label>
              <select
                id="filter-level"
                value={level}
                onChange={(event) =>
                  setLevel(event.target.value === "all" ? "all" : (Number(event.target.value) as CourseLevel))
                }
                className={FIELD}
              >
                <option value="all">All levels</option>
                {COURSE_LEVELS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <label className="col-span-2 flex items-center gap-2 text-sm text-ink-primary">
              <input
                type="checkbox"
                checked={openOnly}
                onChange={(event) => setOpenOnly(event.target.checked)}
                className="h-4 w-4 accent-maroon"
              />
              Only show classes with open seats
            </label>
          </div>
        </details>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 hl-scroll">
        {isSearchActive || hasFilters ? (
          <ConnectedCourseResults />
        ) : (
          <div className="rounded-xl border border-dashed border-line bg-warm p-6 text-center">
            <p className="text-base font-medium text-ink-primary">Find a course to add</p>
            <p className="mt-1 text-sm text-ink-secondary">
              Type at least two letters of a course or subject, or look through everything.
            </p>
            <button type="button" onClick={submit} className={`${BTN_SECONDARY} mt-4`}>
              Browse all courses
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
