/**
 * Deterministic, accessible course colors (frontend PRD §10.5).
 *
 * Rules encoded here:
 * - The palette index is derived from a stable hash of the course ID, so the
 *   same course always gets the same color across renders and sessions.
 * - Colors are presentation only. They never encode risk, warnings, or any
 *   backend-owned value; risk is communicated separately.
 * - Each entry pairs a dark text color with a light tinted background and a
 *   stronger border. Text contrast is verified by the unit tests (WCAG 2.1 AA,
 *   >= 4.5:1) rather than assumed.
 * - Maroon/red is intentionally not the dominant tone because warnings already
 *   use maroon and red.
 */

export interface CourseColor {
  /** Stable palette slot, useful for legends and debugging. */
  index: number;
  /** Light tinted event background. */
  background: string;
  /** Stronger border/edge color for the event. */
  border: string;
  /** Readable dark text color for `background`. */
  text: string;
}

/** Eight visually distinct tones; all dark-text-on-light-tint for contrast. */
export const COURSE_COLOR_PALETTE: readonly CourseColor[] = [
  { index: 0, background: "#e7f0fb", border: "#175cd3", text: "#0b3a86" },
  { index: 1, background: "#e6f5ee", border: "#18794e", text: "#0b4a2f" },
  { index: 2, background: "#fdf0e3", border: "#b54708", text: "#7a2e05" },
  { index: 3, background: "#f0eafc", border: "#6941c6", text: "#3d2483" },
  { index: 4, background: "#e6f4f6", border: "#0e7090", text: "#084a5e" },
  { index: 5, background: "#eceff3", border: "#5a6b82", text: "#2f3b4a" },
  { index: 6, background: "#eef2d8", border: "#5c6f00", text: "#3a4700" },
  { index: 7, background: "#f0e6e1", border: "#8a4b2f", text: "#5a2f1c" },
];

export const COURSE_COLOR_COUNT = COURSE_COLOR_PALETTE.length;

/** FNV-1a 32-bit hash. Stable across runtimes and sessions. */
export function hashCourseId(courseId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < courseId.length; i += 1) {
    hash ^= courseId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Palette slot for a course ID, always within `[0, COURSE_COLOR_COUNT)`. */
export function courseColorIndex(courseId: string): number {
  return hashCourseId(courseId) % COURSE_COLOR_COUNT;
}

/** Deterministic color for a course ID. Presentation only; not risk-encoded. */
export function getCourseColor(courseId: string): CourseColor {
  const slot = COURSE_COLOR_PALETTE[courseColorIndex(courseId)];
  // Palette is non-empty and the index is bounded by modulo, so slot exists.
  return slot ?? COURSE_COLOR_PALETTE[0]!;
}
