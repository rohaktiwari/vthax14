import { useEffect, useRef, useState } from "react";
import { normalizeApiError } from "../api/errors";
import { useHealth } from "../api/hooks";
import AskGemini from "./AskGemini";

function Monogram() {
  return (
    <svg viewBox="0 0 46 34" className="h-9 w-11 shrink-0" aria-hidden="true">
      <path
        d="M2 7 15.5 32 21 23.5"
        fill="none"
        stroke="var(--color-maroon)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M22.5 7h21M33 7v25"
        fill="none"
        stroke="var(--color-vt-orange)"
        strokeWidth="4.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Live API-health indicator backed by the documented `GET /api/health` query
 * (frontend PRD §11.1). It shows a neutral checking state, a connected state
 * with the backend term, or an offline state with a retry hint. It never claims
 * notifications or live registration data; the prototype's bell stays absent.
 */
function ApiHealthStatus() {
  const health = useHealth();

  if (health.isPending) {
    return (
      <span
        role="status"
        className="inline-flex items-center gap-2 rounded-full border border-line bg-warm px-3 py-1.5 text-sm font-medium text-ink-secondary"
      >
        <span className="h-2 w-2 animate-pulse rounded-full bg-warning" aria-hidden="true" />
        Checking API…
      </span>
    );
  }

  if (health.isError) {
    return (
      <span
        role="status"
        title={normalizeApiError(health.error).message}
        className="inline-flex items-center gap-2 rounded-full border border-danger/40 bg-danger-soft px-3 py-1.5 text-sm font-medium text-danger"
      >
        <span className="h-2 w-2 rounded-full bg-danger" aria-hidden="true" />
        API offline
      </span>
    );
  }

  return (
    <span
      role="status"
      title="Backend health from GET /api/health"
      className="inline-flex items-center gap-2 rounded-full border border-line bg-warm px-3 py-1.5 text-sm font-medium text-ink-secondary"
    >
      <span className="h-2 w-2 rounded-full bg-success" aria-hidden="true" />
      API connected · {health.data.term_id}
    </span>
  );
}

function AboutPopover() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="About HokieLens"
        onClick={() => setOpen((value) => !value)}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-maroon text-sm font-bold text-white transition-colors hover:bg-maroon-dark"
      >
        H
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="About HokieLens"
          className="absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-line bg-panel p-4 text-sm shadow-lg"
        >
          <p className="font-semibold text-ink-primary">About HokieLens</p>
          <p className="mt-1 text-ink-secondary">
            HokieLens is a student-built planning aid for Virginia Tech course schedules. There are
            no accounts and no registration access, just clearer trade-offs before you register.
          </p>
        </div>
      ) : null}
    </div>
  );
}

export default function AppHeader() {
  return (
    <header className="z-30 flex h-16 shrink-0 items-center gap-4 border-b border-line bg-panel px-6 shadow-sm">
      <div className="flex min-w-0 items-center gap-3">
        <Monogram />
        <div className="min-w-0">
          <p className="truncate text-xl font-extrabold uppercase leading-tight tracking-[0.02em] text-ink-primary">
            Hokie<span className="text-maroon">Lens</span>
          </p>
          <p className="truncate text-xs font-medium uppercase tracking-[0.18em] text-ink-secondary">
            Plan Smarter. Study Happier.
          </p>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <ApiHealthStatus />
        <AskGemini />
        <AboutPopover />
      </div>
    </header>
  );
}
