import { useCourseSearch } from "../context/CourseSearchContext";
import { useSchedule } from "../context/ScheduleContext";
import CourseResults from "./CourseResults";

/**
 * CourseResults wired to the shared search state and the schedule selection.
 * Rendered in the center panel on desktop and inside the sidebar/drawer on
 * smaller screens, so both places behave identically.
 */
export default function ConnectedCourseResults() {
  const { crns, addSection, removeCrn, isFull } = useSchedule();
  const search = useCourseSearch();

  return (
    <CourseResults
      courses={search.courses}
      isPending={search.isPending}
      isError={search.isError}
      errorMessage={search.errorMessage}
      hasFilters={search.hasFilters}
      queryLabel={search.activeQuery ?? ""}
      isSelected={(crn) => crns.includes(crn)}
      isFull={isFull}
      onToggleSection={(section) =>
        crns.includes(section.crn) ? removeCrn(section.crn) : addSection(section)
      }
      onRetry={search.retry}
      onClearFilters={search.clearSearch}
    />
  );
}
