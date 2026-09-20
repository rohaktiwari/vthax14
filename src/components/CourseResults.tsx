import { useState } from "react";
import type { CourseGroup, Section } from "../api/types";
import SectionCard from "./SectionCard";

interface CourseResultsProps {
  courses: CourseGroup[];
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  hasFilters: boolean;
  queryLabel: string;
  isSelected: (crn: string) => boolean;
  isFull: boolean;
  onToggleSection: (section: Section) => void;
  onRetry: () => void;
  onClearFilters: () => void;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-2 rounded-lg border border-line p-3">
      <div className="h-3 w-24 rounded bg-line" />
      <div className="h-3 w-40 rounded bg-line" />
      <div className="h-3 w-32 rounded bg-line" />
    </div>
  );
}

/**
 * Grouped course results with expandable sections and loading / empty / error
 * states. Purely presentational: selection and URL writes are owned by the
 * caller.
 */
export default function CourseResults({
  courses,
  isPending,
  isError,
  errorMessage,
  hasFilters,
  queryLabel,
  isSelected,
  isFull,
  onToggleSection,
  onRetry,
  onClearFilters,
}: CourseResultsProps) {
  // Groups start expanded; a group ID in this set is collapsed by the user.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleGroup(courseId: string) {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(courseId)) next.delete(courseId);
      else next.add(courseId);
      return next;
    });
  }

  const sectionCount = courses.reduce((total, group) => total + group.sections.length, 0);

  if (isPending) {
    return (
      <div className="space-y-2" aria-busy="true" aria-live="polite">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-lg border border-danger/40 bg-panel p-4 text-sm">
        <p className="font-medium text-danger">Could not load courses</p>
        <p className="mt-1 text-xs text-ink-secondary">{errorMessage}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-primary transition-colors hover:bg-warm"
        >
          Retry
        </button>
      </div>
    );
  }

  if (courses.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-warm p-4 text-center">
        <p className="text-sm font-medium text-ink-primary">No matching courses</p>
        <p className="mt-1 text-xs text-ink-secondary">
          {queryLabel ? `Nothing matched “${queryLabel}” in this catalog term.` : "No courses are available to show."}
        </p>
        {hasFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-3 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-primary transition-colors hover:bg-soft-maroon"
          >
            Clear filters
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-secondary" aria-live="polite">
        {courses.length} course{courses.length === 1 ? "" : "s"} · {sectionCount} section
        {sectionCount === 1 ? "" : "s"}
      </p>

      <ul className="space-y-2">
        {courses.map((group) => {
          const isCollapsed = collapsed.has(group.course_id);
          return (
            <li key={group.course_id} className="overflow-hidden rounded-xl border border-line shadow-sm">
              <button
                type="button"
                onClick={() => toggleGroup(group.course_id)}
                aria-expanded={!isCollapsed}
                className="flex w-full items-center justify-between gap-2 bg-warm px-3 py-2 text-left transition-colors hover:bg-soft-maroon"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-ink-primary">
                    {group.course_id}
                  </span>
                  <span className="block truncate text-xs text-ink-secondary">{group.title}</span>
                </span>
                <span className="shrink-0 text-right text-xs text-ink-secondary">
                  <span className="block">{group.credits} cr</span>
                  <span className="block">
                    {group.sections.length} section{group.sections.length === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
              {!isCollapsed ? (
                <ul className="space-y-2 p-2">
                  {group.sections.map((section) => (
                    <SectionCard
                      key={section.crn}
                      section={section}
                      selected={isSelected(section.crn)}
                      disabled={isFull}
                      onToggle={onToggleSection}
                    />
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>

      {isFull ? (
        <p className="rounded-lg border border-line bg-warm px-3 py-2 text-xs text-ink-secondary">
          Maximum of 12 sections selected.
        </p>
      ) : null}
    </div>
  );
}
