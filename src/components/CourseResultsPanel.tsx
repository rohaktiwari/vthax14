import { useSchedule } from "../context/ScheduleContext";
import { useSearch } from "../context/SearchContext";
import { MAX_CRNS } from "../lib/schedule";
import CourseResults from "./CourseResults";

/**
 * Central course-results surface.
 *
 * The left sidebar owns the search controls; this panel owns the grouped course
 * and section cards. It reuses the existing `CourseResults` presentation and the
 * shared search/selection state, so no search logic is duplicated.
 */
export default function CourseResultsPanel() {
  const {
    filteredCourses,
    isPending,
    isError,
    errorMessage,
    hasFilters,
    activeQuery,
    retry,
    clearFilters,
  } = useSearch();
  const { crns, addSection, removeCrn, isFull } = useSchedule();

  return (
    <section
      aria-label="Course results"
      data-testid="course-results-panel"
      className="flex flex-col rounded-2xl border border-line bg-panel shadow-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink-primary">Course results</h2>
          <p className="truncate text-xs text-ink-secondary">
            {activeQuery ? `Matching “${activeQuery}”` : "Catalog courses"}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-soft-maroon px-2.5 py-1 text-[0.6875rem] font-semibold uppercase tracking-wide text-maroon">
          {crns.length} of {MAX_CRNS} selected
        </span>
      </header>

      <div className="p-4">
        <CourseResults
          courses={filteredCourses}
          isPending={isPending}
          isError={isError}
          errorMessage={errorMessage}
          hasFilters={hasFilters}
          queryLabel={activeQuery ?? ""}
          isSelected={(crn) => crns.includes(crn)}
          isFull={isFull}
          onToggleSection={(section) =>
            crns.includes(section.crn) ? removeCrn(section.crn) : addSection(section)
          }
          onRetry={retry}
          onClearFilters={clearFilters}
        />
      </div>
    </section>
  );
}
