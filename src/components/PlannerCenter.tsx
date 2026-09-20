import { useSchedule } from "../context/ScheduleContext";
import { useSearch } from "../context/SearchContext";
import CourseResultsPanel from "./CourseResultsPanel";
import EmptyState from "./EmptyState";
import HeroPanel from "./HeroPanel";
import SelectedScheduleSummary from "./SelectedScheduleSummary";

interface PlannerCenterProps {
  /** Compact Burruss rendering for the tablet / mobile breakpoints. */
  compactHero?: boolean;
}

/**
 * Center-column content decision (PRD §11.2–§11.3).
 *
 * - Active search (or a catalog error): course results replace the hero.
 * - A selection with no active search: compact selected-schedule summary.
 * - Otherwise: the Burruss hero plus empty-state guidance.
 *
 * The Burruss visual is therefore reachable only in the true empty/no-search
 * state, and results never compete with the sidebar for width.
 */
export default function PlannerCenter({ compactHero = false }: PlannerCenterProps) {
  const { showResults } = useSearch();
  const { crns } = useSchedule();

  if (showResults) return <CourseResultsPanel />;
  if (crns.length > 0) return <SelectedScheduleSummary />;

  return (
    <>
      <HeroPanel compact={compactHero} />
      <EmptyState />
    </>
  );
}
