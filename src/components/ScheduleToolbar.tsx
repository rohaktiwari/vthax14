import { useState } from "react";
import { useSchedule } from "../context/ScheduleContext";
import { useToast } from "../context/ToastContext";
import { sumCredits } from "../lib/schedule";
import { shareSchedule } from "../lib/share";

/**
 * Schedule toolbar (frontend PRD §10.6).
 *
 * Shows the selected section count and total credits from cached sections and
 * offers Clear, Print / Download, and Share. Share prefers the Web Share API and
 * otherwise copies the canonical URL; it never implies the schedule is saved
 * anywhere. Print uses the browser's native print dialog and print stylesheet.
 */
export default function ScheduleToolbar() {
  const { crns, selectedSections, clear } = useSchedule();
  const { showToast } = useToast();
  const [sharing, setSharing] = useState(false);

  const credits = sumCredits(selectedSections);
  const hasSelection = crns.length > 0;

  async function handleShare() {
    if (!hasSelection || sharing) return;
    setSharing(true);
    try {
      const result = await shareSchedule(crns, window.location.href);
      if (result.method === "web-share") {
        showToast("Schedule link shared. This link is not saved on any server.", "success");
      } else if (result.method === "clipboard") {
        showToast("Schedule link copied to your clipboard. This link is not saved on any server.", "success");
      } else if (result.method === "failed") {
        showToast("Could not copy the link. Copy the browser address bar instead.", "error");
      }
      // A cancelled share is a deliberate user action; no toast.
    } finally {
      setSharing(false);
    }
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-warm/40 px-4 py-3">
      <div>
        <h2 className="text-base font-semibold text-ink-primary">Your Schedule</h2>
        <p className="text-xs text-ink-secondary" data-testid="schedule-summary" aria-live="polite">
          {hasSelection
            ? `${crns.length} selected · ${credits} credit${credits === 1 ? "" : "s"} from cached sections`
            : "Plan, adjust, and visualize your week."}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          data-testid="print-schedule"
          onClick={() => window.print()}
          disabled={!hasSelection}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-primary shadow-sm transition-colors hover:bg-soft-maroon disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9V3h12v6" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <path d="M6 14h12v7H6z" />
          </svg>
          Print / Download
        </button>
        <button
          type="button"
          data-testid="share-schedule"
          onClick={handleShare}
          disabled={!hasSelection || sharing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-maroon/40 bg-soft-maroon px-3 py-1.5 text-xs font-semibold text-maroon shadow-sm transition-colors hover:bg-maroon/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 8 5-5 5 5" />
            <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
          </svg>
          Share
        </button>
        <button
          type="button"
          onClick={clear}
          disabled={!hasSelection}
          className="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-medium text-ink-primary shadow-sm transition-colors hover:bg-soft-maroon disabled:cursor-not-allowed disabled:opacity-60"
        >
          Clear schedule
        </button>
      </div>
    </header>
  );
}
