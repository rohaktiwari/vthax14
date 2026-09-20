import { useCourseSearch } from "../context/CourseSearchContext";
import EmptyState from "./EmptyState";
import HeroPanel from "./HeroPanel";
import SearchResultsPanel from "./SearchResultsPanel";

/**
 * Desktop center column. Shows the Burruss hero and onboarding steps until the
 * person searches, then swaps them for the course results.
 */
export default function CenterPanel() {
  const { isSearchActive } = useCourseSearch();

  if (isSearchActive) return <SearchResultsPanel />;

  return (
    <>
      <HeroPanel />
      <EmptyState />
    </>
  );
}
