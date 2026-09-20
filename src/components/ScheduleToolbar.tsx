import { useState } from "react";
import { useSchedule } from "../context/ScheduleContext";
import { useToast } from "../context/ToastContext";
import { sumCredits } from "../lib/schedule";
import { creditsLabel } from "../lib/sectionText";
import { BTN_SECONDARY } from "../lib/ui";
import { shareSchedule } from "../lib/share";

/**
 * Schedule toolbar (frontend PRD §10.6).
 *
 * Shows the selected course count and total credits from cached sections and
 * offers Download and Share. Share prefers the Web Share API and
 * otherwise copies the canonical URL; it never implies the schedule is saved
 * anywhere. Print uses the browser's native print dialog and print stylesheet.
 */
export default function ScheduleToolbar() {
  const { crns, selectedSections } = useSchedule();
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
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
      <div>
        <h2 className="text-lg font-bold text-ink-primary">Your Schedule</h2>
        <p className="text-sm text-ink-secondary" data-testid="schedule-summary" aria-live="polite">
          {hasSelection
            ? `${crns.length} course${crns.length === 1 ? "" : "s"}${credits > 0 ? ` · ${creditsLabel(credits)}` : ""}`
            : "Plan, adjust, and visualize your week."}
        </p>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          data-testid="print-schedule"
          onClick={() => window.print()}
          disabled={!hasSelection}
          title="Opens the print dialog. Choose Save as PDF to download."
          className={BTN_SECONDARY}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9V3h12v6" />
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
            <path d="M6 14h12v7H6z" />
          </svg>
          Download
        </button>
        <button
          type="button"
          data-testid="share-schedule"
          onClick={handleShare}
          disabled={!hasSelection || sharing}
          className={BTN_SECONDARY}
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3v12" />
            <path d="m7 8 5-5 5 5" />
            <path d="M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" />
          </svg>
          Share
        </button>
      </div>
    </header>
  );
}
