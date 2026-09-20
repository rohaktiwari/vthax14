/**
 * Instructor-name helpers for the professor drawer (frontend PRD §10.13).
 *
 * The documented endpoint is `GET /api/professors/{surname}/vibes`, so the only
 * thing the frontend derives from a display name is the surname used in the path.
 * No names are invented, and placeholders such as "TBA" never become a lookup.
 */

const NAME_TOKEN = /^[A-Za-z][A-Za-z'.-]*$/;

/** True for blank names and non-instructor placeholders. */
export function isPlaceholderInstructor(name: string): boolean {
  const normalized = name.trim().toLowerCase().replace(/[.\s]/g, "");
  return normalized === "" || normalized === "tba" || normalized === "staff";
}

/**
 * Surname for the documented `/professors/{surname}/vibes` path, taken from the
 * last whitespace-delimited token. Returns null when no usable surname exists
 * (blank, placeholder, or a token that is not a plausible name).
 */
export function instructorSurname(name: string): string | null {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (!trimmed || isPlaceholderInstructor(trimmed)) return null;
  const tokens = trimmed.split(" ");
  const last = tokens[tokens.length - 1];
  if (!last || last.length < 2 || !NAME_TOKEN.test(last)) return null;
  return last;
}
