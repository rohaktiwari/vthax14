/**
 * Shared class strings so every button, card, and badge looks and behaves the
 * same. One primary action per view uses BTN_PRIMARY; everything else is
 * secondary or ghost.
 */
const BTN_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_PRIMARY = `${BTN_BASE} bg-maroon px-4 py-2.5 text-sm text-white shadow-sm hover:bg-maroon-dark`;
export const BTN_PRIMARY_LG = `${BTN_BASE} bg-maroon px-5 py-3 text-base text-white shadow-sm hover:bg-maroon-dark`;
export const BTN_SECONDARY = `${BTN_BASE} border border-line bg-panel px-3.5 py-2 text-sm text-ink-primary shadow-sm hover:bg-soft-maroon`;
export const BTN_GHOST = `${BTN_BASE} px-2.5 py-1.5 text-sm text-maroon hover:bg-soft-maroon`;

export const CARD = "rounded-2xl border border-line bg-panel shadow-card";

export type Tone = "danger" | "warning" | "success" | "info" | "neutral" | "maroon";

export const BADGE_TONE: Record<Tone, string> = {
  danger: "border-danger/30 bg-danger-soft text-danger",
  warning: "border-warning/30 bg-warning-soft text-warning",
  success: "border-success/30 bg-success-soft text-success",
  info: "border-info/30 bg-info-soft text-info",
  neutral: "border-line bg-warm text-ink-secondary",
  maroon: "border-maroon/30 bg-soft-maroon text-maroon",
};
