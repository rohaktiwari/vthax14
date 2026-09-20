/**
 * Schedule sharing (frontend PRD §10.6 "Share").
 *
 * The canonical, restorable representation of a schedule is the URL `crns`
 * query parameter. These helpers build that URL, prefer the Web Share API, and
 * otherwise fall back to the clipboard. They never claim the schedule is saved
 * on a server, because no account or persistence exists.
 */

export type ShareMethod = "web-share" | "clipboard" | "cancelled" | "failed";

export interface ShareResult {
  method: ShareMethod;
  /** The canonical URL that was built, with ordered CRNs only. */
  url: string;
}

/**
 * Build the canonical share URL: the current origin/path plus an ordered `crns`
 * parameter. Unrelated query parameters and the hash are dropped so the link is
 * exactly the durable schedule state.
 */
export function buildShareUrl(crns: readonly string[], baseUrl: string): string {
  const ordered = crns.map((crn) => crn.trim()).filter(Boolean);
  let path: string;
  try {
    const base = new URL(baseUrl);
    path = `${base.origin}${base.pathname}`;
  } catch {
    path = baseUrl;
  }
  return ordered.length > 0 ? `${path}?crns=${ordered.join(",")}` : path;
}

/** True when the browser exposes the Web Share API. */
export function canUseWebShare(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.share === "function";
}

/**
 * Copy text to the clipboard, preferring the async Clipboard API and falling
 * back to a temporary textarea + `execCommand("copy")`. Returns success rather
 * than throwing so callers can show an error toast.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const copied =
      typeof document.execCommand === "function" ? document.execCommand("copy") : false;
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

/**
 * Share the schedule URL. Uses the Web Share API when available; a user aborts
 * cleanly with `cancelled`. Any other share failure, or an unavailable API,
 * falls back to the clipboard.
 */
export async function shareSchedule(
  crns: readonly string[],
  currentUrl: string = typeof window !== "undefined" ? window.location.href : "",
): Promise<ShareResult> {
  const url = buildShareUrl(crns, currentUrl);

  if (canUseWebShare()) {
    try {
      await navigator.share({
        title: "HokieLens schedule",
        text: "My HokieLens schedule",
        url,
      });
      return { method: "web-share", url };
    } catch (error) {
      if (isAbort(error)) return { method: "cancelled", url };
      // Fall through to clipboard on any other failure.
    }
  }

  const copied = await copyToClipboard(url);
  return { method: copied ? "clipboard" : "failed", url };
}
