import type { Modality, Weekday } from "../api/types";

/** Time and meeting formatting helpers. Backend times are minutes from midnight. */

/** Format minutes from midnight as e.g. `10:10 AM`. */
export function formatMinutes(minutes: number): string {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(mins).padStart(2, "0")} ${period}`;
}

/** Join weekday initials, e.g. `["M","W","F"]` -> `MWF`. */
export function formatDays(days: Weekday[]): string {
  return days.join("");
}

/** e.g. `MWF 10:10 AM–11:00 AM`. */
export function formatMeetingSummary(meeting: { days: Weekday[]; start_min: number; end_min: number }): string {
  return `${formatDays(meeting.days)} ${formatMinutes(meeting.start_min)}–${formatMinutes(meeting.end_min)}`;
}

const MODALITY_LABELS: Record<Modality, string> = {
  f2f: "In person",
  hybrid: "Hybrid",
  online_sync: "Online (sync)",
  online_async: "Online (async)",
};

export function formatModality(modality: Modality): string {
  return MODALITY_LABELS[modality];
}

// ---------------------------------------------------------------------------
// Calendar grid helpers (frontend PRD §10.5)
//
// Pure display math only. Nothing here derives risk, commute, or any other
// backend-owned value. Desktop default is Monday–Friday, 8:00 AM–6:00 PM, with
// a 30-minute grid that expands when selected meetings fall outside the range.
// ---------------------------------------------------------------------------

/** Minimal meeting shape needed for grid math (backend `Meeting` satisfies it). */
export interface MeetingTime {
  days: Weekday[];
  /** Minutes from midnight. */
  start_min: number;
  /** Minutes from midnight. */
  end_min: number;
}

export const GRID_STEP_MIN = 30;
export const MINUTES_PER_DAY = 24 * 60;

/** Monday–Friday columns, in display order. */
export const WEEKDAYS: readonly Weekday[] = ["M", "T", "W", "R", "F"];
export const WEEKEND_DAYS: readonly Weekday[] = ["S", "U"];

/** Default visible range: 8:00 AM (PRD §10.5). */
export const DEFAULT_VISIBLE_START = 8 * 60;
/** Default visible range: 6:00 PM (PRD §10.5). */
export const DEFAULT_VISIBLE_END = 18 * 60;

/** Floor to the previous grid boundary. */
export function snapDownToStep(minutes: number, step = GRID_STEP_MIN): number {
  return Math.floor(minutes / step) * step;
}

/** Ceil to the next grid boundary. */
export function snapUpToStep(minutes: number, step = GRID_STEP_MIN): number {
  return Math.ceil(minutes / step) * step;
}

/** Round to the nearest grid boundary. */
export function snapToStep(minutes: number, step = GRID_STEP_MIN): number {
  return Math.round(minutes / step) * step;
}

export interface VisibleRange {
  startMin: number;
  endMin: number;
  /** True when some meeting falls on Saturday or Sunday. */
  includesWeekend: boolean;
}

/**
 * Visible range for a set of meetings: the default Monday–Friday window,
 * expanded (snapped to the grid) to include any earlier/later meeting.
 */
export function getVisibleRange(meetings: readonly MeetingTime[]): VisibleRange {
  let start = DEFAULT_VISIBLE_START;
  let end = DEFAULT_VISIBLE_END;
  let includesWeekend = false;

  for (const meeting of meetings) {
    if (meeting.days.some((day) => day === "S" || day === "U")) includesWeekend = true;
    if (meeting.start_min < start) start = meeting.start_min;
    if (meeting.end_min > end) end = meeting.end_min;
  }

  return {
    startMin: Math.min(snapDownToStep(start), DEFAULT_VISIBLE_START),
    endMin: Math.max(snapUpToStep(end), DEFAULT_VISIBLE_END),
    includesWeekend,
  };
}

/** Weekday columns plus weekend columns only when a meeting needs them. */
export function getVisibleDays(meetings: readonly MeetingTime[]): Weekday[] {
  const days: Weekday[] = [...WEEKDAYS];
  for (const day of WEEKEND_DAYS) {
    if (meetings.some((meeting) => meeting.days.includes(day))) days.push(day);
  }
  return days;
}

/** Grid slot start minutes from `startMin` (exclusive) to `endMin` (inclusive). */
export function buildTimeSlots(
  startMin: number,
  endMin: number,
  step = GRID_STEP_MIN,
): number[] {
  const slots: number[] = [];
  const start = snapDownToStep(startMin, step);
  const end = snapUpToStep(endMin, step);
  for (let minutes = start; minutes < end; minutes += step) slots.push(minutes);
  return slots;
}

const SHORT_WEEKDAY: Record<Weekday, string> = {
  M: "Mon",
  T: "Tue",
  W: "Wed",
  R: "Thu",
  F: "Fri",
  S: "Sat",
  U: "Sun",
};

/** Short accessible weekday label, e.g. `R` -> `Thu`. */
export function formatWeekdayShort(day: Weekday): string {
  return SHORT_WEEKDAY[day];
}

/** Compact grid-gutter label, e.g. `8 AM`, `12 PM`, `1:30 PM`. */
export function formatTimeLabel(minutes: number): string {
  const clamped = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours24 = Math.floor(clamped / 60);
  const mins = clamped % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return mins === 0 ? `${hours12} ${period}` : `${hours12}:${String(mins).padStart(2, "0")} ${period}`;
}

export interface EventLayout {
  /** Distance from the top of the grid, as a percentage of the visible range. */
  topPercent: number;
  /** Event height, as a percentage of the visible range. */
  heightPercent: number;
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

/**
 * Percentage placement of a meeting within a visible range. Pure display math:
 * meetings are positioned directly from documented `start_min`/`end_min`, with
 * no overlap or conflict inference.
 */
export function getEventLayout(
  startMin: number,
  endMin: number,
  range: Pick<VisibleRange, "startMin" | "endMin">,
): EventLayout {
  const span = Math.max(range.endMin - range.startMin, 1);
  return {
    topPercent: clampPercent(((startMin - range.startMin) / span) * 100),
    heightPercent: clampPercent(((endMin - startMin) / span) * 100),
  };
}
