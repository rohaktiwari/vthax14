import { useMemo } from "react";
import type { Meeting, Section, Weekday } from "../api/types";
import { useCenterView } from "../context/CenterViewContext";
import { useMapSelection } from "../context/MapSelectionContext";
import { useSchedule } from "../context/ScheduleContext";
import { getCourseColor } from "../lib/courseColor";
import { meetingLocation } from "../lib/sectionText";
import {
  buildTimeSlots,
  formatMinutes,
  formatTimeLabel,
  formatWeekdayShort,
  getEventLayout,
  getVisibleDays,
  getVisibleRange,
  type MeetingTime,
} from "../lib/time";
import { CARD } from "../lib/ui";
import ScheduleToolbar from "./ScheduleToolbar";

/** Minimum pixel height per visible hour, so course and building names are not clipped. */
const HOUR_PX = 64;
/** Pixel height a block needs to show the building line, then the time line. */
const SHOW_LOCATION_PX = 36;
const SHOW_TIME_PX = 52;

interface CalendarEvent {
  key: string;
  section: Section;
  meeting: Meeting;
  day: Weekday;
  startMin: number;
  endMin: number;
}

/** One meeting day per event, matching the PRD rule to render each day separately. */
function buildEvents(sections: readonly Section[]): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  for (const section of sections) {
    for (const meeting of section.meetings) {
      for (const day of meeting.days) {
        events.push({
          key: `${section.crn}-${day}-${meeting.start_min}-${meeting.end_min}`,
          section,
          meeting,
          day,
          startMin: meeting.start_min,
          endMin: meeting.end_min,
        });
      }
    }
  }
  return events;
}

interface EventButtonProps {
  event: CalendarEvent;
  rangeStart: number;
  rangeEnd: number;
  /** Minimum rendered height of the whole grid; lets thresholds work in pixels. */
  gridPx: number;
  active: boolean;
  highlighted: boolean;
  onOpen: (crn: string) => void;
}

function EventButton({ event, rangeStart, rangeEnd, gridPx, active, highlighted, onOpen }: EventButtonProps) {
  const color = getCourseColor(event.section.course_id);
  const location = meetingLocation(event.section, event.meeting);
  const timeLabel = `${formatMinutes(event.startMin)}–${formatMinutes(event.endMin)}`;
  const layout = getEventLayout(event.startMin, event.endMin, { startMin: rangeStart, endMin: rangeEnd });
  const blockPx = (layout.heightPercent / 100) * gridPx;
  const label = `${event.section.course_id}, ${formatWeekdayShort(event.day)} ${timeLabel}, ${location}. Open details.${
    highlighted ? " Highlighted from the map." : ""
  }`;

  return (
    <button
      type="button"
      data-crn={event.section.crn}
      data-day={event.day}
      data-start={event.startMin}
      data-end={event.endMin}
      data-map-highlight={highlighted ? "true" : undefined}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      onClick={() => onOpen(event.section.crn)}
      className={`absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-left leading-tight shadow-sm transition-shadow hover:shadow-md focus-visible:z-30 ${
        active ? "z-10 ring-2 ring-maroon" : ""
      } ${highlighted ? "z-20 ring-2 ring-maroon ring-offset-1" : ""}`}
      style={{
        top: `${layout.topPercent}%`,
        height: `${layout.heightPercent}%`,
        backgroundColor: color.background,
        borderColor: color.border,
        color: color.text,
      }}
    >
      <span className="block truncate text-xs font-semibold">{event.section.course_id}</span>
      {blockPx >= SHOW_LOCATION_PX ? <span className="block truncate text-xs">{location}</span> : null}
      {blockPx >= SHOW_TIME_PX ? <span className="block truncate text-xs">{timeLabel}</span> : null}
    </button>
  );
}

interface WeeklyCalendarProps {
  /** Selected sections are still loading from the catalog; show a placeholder. */
  hydrating?: boolean;
}

/**
 * Weekly calendar. Fills whatever height its column gives it, positions each
 * meeting from `start_min`/`end_min`, and opens the clicked course in the center
 * panel. Course color is stable per course and never encodes risk.
 */
export default function WeeklyCalendar({ hydrating = false }: WeeklyCalendarProps) {
  const { crns, selectedSections, unavailableCrns } = useSchedule();
  const { highlightedCrns } = useMapSelection();
  const { focusedCrn, showCourse } = useCenterView();

  const events = useMemo(() => buildEvents(selectedSections), [selectedSections]);
  const meetingTimes = useMemo<MeetingTime[]>(
    () => events.map((event) => ({ days: [event.day], start_min: event.startMin, end_min: event.endMin })),
    [events],
  );
  const range = useMemo(() => getVisibleRange(meetingTimes), [meetingTimes]);
  const days = useMemo(() => getVisibleDays(meetingTimes), [meetingTimes]);
  const slots = useMemo(() => buildTimeSlots(range.startMin, range.endMin), [range]);

  const rangeSpan = Math.max(range.endMin - range.startMin, 1);
  const gridPx = Math.max(224, Math.round((rangeSpan / 60) * HOUR_PX));
  const percent = (minutes: number) => ((minutes - range.startMin) / rangeSpan) * 100;
  const waiting = crns.length > 0 && selectedSections.length === 0 && hydrating;
  const unavailable = !waiting && crns.length > 0 && selectedSections.length === 0 && unavailableCrns.length > 0;

  return (
    <section aria-label="Weekly schedule" className={`${CARD} flex h-full min-h-0 flex-col overflow-hidden`}>
      <ScheduleToolbar />

      {crns.length === 0 ? (
        <div className="p-6 text-center" data-testid="calendar-empty">
          <p className="text-base font-medium text-ink-primary">Nothing on your calendar yet</p>
          <p className="mt-1 text-sm text-ink-secondary">Add a course and it shows up here.</p>
        </div>
      ) : null}

      {waiting ? (
        <div className="flex-1 animate-pulse space-y-3 p-4" aria-busy="true" aria-label="Loading your schedule">
          <div className="h-5 w-full rounded bg-line" />
          <div className="h-full min-h-40 w-full rounded bg-line/60" />
        </div>
      ) : null}

      {unavailable ? (
        <p
          role="status"
          data-testid="calendar-unavailable"
          className="m-4 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm"
        >
          Details for {unavailableCrns.length} selected course{unavailableCrns.length === 1 ? " is" : "s are"}{" "}
          unavailable, so nothing can be placed on the calendar. Remove and re-add from search.
        </p>
      ) : null}

      {events.length > 0 ? (
        <div
          className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3"
          data-testid="calendar-grid"
          data-range-start={range.startMin}
          data-range-end={range.endMin}
          data-visible-days={days.join("")}
        >
          <div className="flex">
            <div className="w-12 shrink-0" aria-hidden="true" />
            {days.map((day) => (
              <div
                key={day}
                role="columnheader"
                data-testid={`day-header-${day}`}
                className="flex-1 border-l border-line bg-warm/70 py-1.5 text-center text-xs font-semibold uppercase tracking-wide text-ink-secondary"
              >
                {formatWeekdayShort(day)}
              </div>
            ))}
          </div>
          <div className="flex flex-1" style={{ minHeight: `${gridPx}px` }}>
            <div className="relative w-12 shrink-0 bg-warm/40" aria-hidden="true">
              {slots.map((minutes, index) =>
                index % 2 === 0 ? (
                  <div
                    key={minutes}
                    className="absolute right-1.5 -translate-y-1/2 text-xs tabular-nums text-ink-secondary"
                    style={{ top: `${percent(minutes)}%` }}
                  >
                    {formatTimeLabel(minutes)}
                  </div>
                ) : null,
              )}
            </div>
            {days.map((day) => (
              <div
                key={day}
                className={`relative flex-1 border-l border-line ${day === "S" || day === "U" ? "bg-warm/40" : "bg-panel"}`}
              >
                {slots.map((minutes) => (
                  <div
                    key={minutes}
                    aria-hidden="true"
                    className="absolute inset-x-0 border-t border-line/60"
                    style={{ top: `${percent(minutes)}%` }}
                  />
                ))}
                {events
                  .filter((event) => event.day === day)
                  .map((event) => (
                    <EventButton
                      key={event.key}
                      event={event}
                      rangeStart={range.startMin}
                      rangeEnd={range.endMin}
                      gridPx={gridPx}
                      active={focusedCrn === event.section.crn}
                      highlighted={highlightedCrns.includes(event.section.crn)}
                      onOpen={showCourse}
                    />
                  ))}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
