import type { Section, Weekday } from "../api/types";
import { WEEKDAYS, WEEKEND_DAYS } from "./time";

/**
 * Pure daily transition ordering (frontend PRD §10.4).
 *
 * Builds chronological adjacent in-person transitions from documented meeting
 * data only. It never calculates walk duration, verdicts, or routes; callers
 * overlay backend warnings and committed matrix minutes.
 */

const DAY_ORDER: readonly Weekday[] = [...WEEKDAYS, ...WEEKEND_DAYS];

export interface TransitionStop {
  crn: string;
  courseId: string;
  building: string;
  startMin: number;
  endMin: number;
}

export interface DayTransition {
  key: string;
  day: Weekday;
  from: TransitionStop;
  to: TransitionStop;
}

export interface TransitionWarning {
  day: Weekday;
  from: { crn: string; building: string; ends: string };
  to: { crn: string; building: string; starts: string };
}

/** Stable identity for a backend commute warning. */
export function warningKey(day: Weekday, fromCrn: string, toCrn: string): string {
  return `${day}|${fromCrn}|${toCrn}`;
}

/** Weekdays (Mon–Fri first) that have at least one in-person meeting. */
export function transitionDays(sections: readonly Section[]): Weekday[] {
  const present = new Set<Weekday>();
  for (const section of sections) {
    for (const meeting of section.meetings) {
      if (!meeting.building) continue;
      for (const day of meeting.days) present.add(day);
    }
  }
  return DAY_ORDER.filter((day) => present.has(day));
}

/**
 * Chronological adjacent transitions for one weekday. Only in-person stops
 * (meetings with a building) are considered, matching the PRD's "in-person
 * transitions" wording.
 */
export function buildDayTransitions(sections: readonly Section[], day: Weekday): DayTransition[] {
  const stops: TransitionStop[] = [];
  for (const section of sections) {
    for (const meeting of section.meetings) {
      if (!meeting.building || !meeting.days.includes(day)) continue;
      stops.push({
        crn: section.crn,
        courseId: section.course_id,
        building: meeting.building,
        startMin: meeting.start_min,
        endMin: meeting.end_min,
      });
    }
  }

  stops.sort(
    (a, b) => a.startMin - b.startMin || a.courseId.localeCompare(b.courseId),
  );

  const transitions: DayTransition[] = [];
  for (let index = 0; index + 1 < stops.length; index += 1) {
    const from = stops[index];
    const to = stops[index + 1];
    if (!from || !to) continue;
    transitions.push({
      key: `${day}-${from.crn}-${to.crn}-${to.startMin}`,
      day,
      from,
      to,
    });
  }
  return transitions;
}
