import { useCourseSearch } from "../context/CourseSearchContext";
import ConnectedCourseResults from "./ConnectedCourseResults";

function Chip({ children }: { children: string }) {
  return (
    <span className="rounded-full border border-line bg-warm px-2.5 py-0.5 text-xs font-medium text-ink-secondary">
      {children}
    </span>
  );
}

/**
 * Search results for the center column (desktop). Replaces the hero while a
 * search is active; "Back to overview" clears the search and restores it.
 */
export default function SearchResultsPanel() {
  const { activeQuery, subject, level, openOnly, clearSearch } = useCourseSearch();

  const chips: string[] = [];
  if (subject !== "all") chips.push(`Subject: ${subject}`);
  if (level !== "all") chips.push(`Level: ${level === 5000 ? "5000+" : level}`);
  if (openOnly) chips.push("Open seats only");

  return (
    <section
      aria-label="Course search results"
      className="rounded-2xl border border-line bg-panel shadow-card"
    >
      <div className="sticky top-0 z-10 flex items-start justify-between gap-3 rounded-t-2xl border-b border-line bg-panel/95 px-5 py-4 backdrop-blur">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-ink-primary">Search results</h2>
          <p className="mt-0.5 truncate text-sm text-ink-secondary">
            {activeQuery ? `Matches for “${activeQuery}”` : "Browsing the catalog"}
          </p>
          {chips.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((chip) => (
                <Chip key={chip}>{chip}</Chip>
              ))}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={clearSearch}
          className="shrink-0 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-primary transition-colors hover:bg-soft-maroon"
        >
          ← Back to overview
        </button>
      </div>
      <div className="p-5">
        <ConnectedCourseResults />
      </div>
    </section>
  );
}
