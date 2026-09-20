import { useEffect, useState } from "react";
import { useHealth } from "../api/hooks";

/** How long the first health check may take before we explain the wait. */
export const SLOW_HEALTH_MS = 4000;

/**
 * The backend can be asleep (free hosting spins down when idle). If the first
 * health check is slow, say so instead of leaving the page looking broken.
 */
export default function WakingBanner() {
  const health = useHealth();
  const waiting = health.isPending;
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), SLOW_HEALTH_MS);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  if (!waiting || !slow) return null;
  return (
    <div
      role="status"
      data-testid="waking-banner"
      className="flex shrink-0 items-center justify-center gap-2 border-b border-warning/30 bg-warning-soft px-4 py-2 text-sm font-medium text-ink-primary"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-warning" aria-hidden="true" />
      Waking up the server, this can take up to a minute on the first load.
    </div>
  );
}
