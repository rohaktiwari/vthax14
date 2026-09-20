import type { ApiError } from "../api/errors";
import { formatWeekdayShort } from "../lib/time";

interface ErrorStateProps {
  title?: string;
  error: ApiError;
  onRetry: () => void;
}

/**
 * Normalized, recoverable error surface. Structured 422 meeting-overlap errors
 * render every backend-provided conflict; they are never collapsed into a
 * generic message. The backend remains the authority on validation.
 */
export default function ErrorState({ title = "Could not analyze this schedule", error, onRetry }: ErrorStateProps) {
  const conflicts = error.conflicts ?? [];
  const isOverlap = error.code === "meeting_overlap" || conflicts.length > 0;

  return (
    <div role="alert" className="rounded-xl border border-danger/40 bg-panel p-4 text-sm">
      <p className="font-semibold text-danger">{isOverlap ? "Schedule conflict" : title}</p>
      <p className="mt-1 text-xs text-ink-secondary">{error.message}</p>

      {conflicts.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {conflicts.map((conflict, index) => (
            <li
              key={`${conflict.crns.join("-")}-${conflict.day}-${conflict.start}-${index}`}
              data-testid="conflict-item"
              className="rounded-lg border border-danger/30 bg-warm p-2 text-xs text-ink-primary"
            >
              {`${conflict.crns[0] ?? "?"} and ${conflict.crns[1] ?? "?"} overlap on ${formatWeekdayShort(conflict.day)} ${conflict.start}–${conflict.end}.`}
            </li>
          ))}
        </ul>
      ) : null}

      <button
        type="button"
        onClick={onRetry}
        className="mt-3 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-primary transition-colors hover:bg-soft-maroon"
      >
        {isOverlap ? "Re-check after editing" : "Retry"}
      </button>
    </div>
  );
}
