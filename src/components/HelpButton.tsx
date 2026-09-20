import { useEffect, useRef, useState } from "react";
import { useAnalysis } from "../api/hooks";
import { useSchedule } from "../context/ScheduleContext";
import { buildHelpAnswer, HELP_TOPICS, type HelpTopicId } from "../lib/help";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * "Ask HokieLens" help surface (frontend PRD §10.14).
 *
 * Branded like the prototype mascot button, but strictly deterministic: it
 * offers the four predefined prompts and answers each from committed copy plus
 * the current `/api/analyze` response. There is deliberately no free-text input
 * and no generative AI call, so it never looks like a chat that cannot answer.
 */
export default function HelpButton() {
  const { crns } = useSchedule();
  const analysis = useAnalysis(crns);

  const [open, setOpen] = useState(false);
  const [activeTopic, setActiveTopic] = useState<HelpTopicId | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const answer = activeTopic
    ? buildHelpAnswer(activeTopic, {
        analysis: analysis.data,
        selectionCount: crns.length,
      })
    : null;

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    function onClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [open]);

  // Move focus into the panel on open and restore it to the trigger on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => previous?.focus?.();
  }, [open]);

  function toggle() {
    setOpen((value) => {
      if (value) setActiveTopic(null);
      return !value;
    });
  }

  return (
    <div ref={containerRef} className="fixed bottom-20 right-4 z-40 md:bottom-6 md:right-6">
      {open ? (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Ask HokieLens"
          className="absolute bottom-full right-0 mb-3 w-80 max-w-[calc(100vw-2rem)] rounded-2xl border border-line bg-panel p-4 shadow-2xl"
        >
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-ink-primary">Ask HokieLens</p>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={toggle}
              aria-label="Close help panel"
              className="rounded-md p-1 text-ink-secondary hover:text-ink-primary"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-secondary">
            Deterministic explanations assembled from your current schedule analysis — not a
            chatbot, and no generative AI.
          </p>

          <ul className="mt-3 space-y-2">
            {HELP_TOPICS.map((topic) => (
              <li key={topic.id}>
                <button
                  type="button"
                  aria-pressed={activeTopic === topic.id}
                  onClick={() => setActiveTopic(topic.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                    activeTopic === topic.id
                      ? "border-maroon bg-soft-maroon font-medium text-maroon"
                      : "border-line bg-warm text-ink-primary hover:border-maroon/40 hover:bg-soft-maroon"
                  }`}
                >
                  {topic.prompt}
                </button>
              </li>
            ))}
          </ul>

          <div aria-live="polite" className="mt-3" data-testid="help-answer">
            {answer ? (
              <>
                <p className="text-xs font-semibold text-ink-primary">
                  {HELP_TOPICS.find((topic) => topic.id === activeTopic)?.prompt}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-ink-secondary">{answer}</p>
              </>
            ) : (
              <p className="text-xs text-ink-secondary">
                Choose a question to see an explanation built from your current results.
              </p>
            )}
          </div>

          <p className="mt-3 text-[0.625rem] text-ink-secondary">
            Predefined questions only. Answers use your current backend results and fixed
            explanatory text.
          </p>
        </div>
      ) : null}

      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Open Ask HokieLens help"
        onClick={toggle}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-maroon text-white shadow-lg transition-colors hover:bg-maroon-dark"
      >
        <svg viewBox="0 0 32 32" className="h-8 w-8" fill="currentColor" aria-hidden="true">
          <path d="M16 3 6 7v2h20V7Z" />
          <rect x="8" y="11" width="3.2" height="8" />
          <rect x="14.4" y="11" width="3.2" height="8" />
          <rect x="20.8" y="11" width="3.2" height="8" />
          <rect x="5" y="21" width="22" height="3" />
          <rect x="4" y="26" width="24" height="3" />
        </svg>
      </button>
    </div>
  );
}
