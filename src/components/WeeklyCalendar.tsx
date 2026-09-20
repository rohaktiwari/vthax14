import { useMemo, useState } from "react";
import type { Meeting, Section, Weekday } from "../api/types";
import { useSchedule } from "../context/ScheduleContext";
import { useMapSelection } from "../context/MapSelectionContext";
import { useSwapWorkbench } from "../context/SwapWorkbenchContext";
import { getCourseColor } from "../lib/courseColor";
import {
  buildTimeSlots,
  formatMinutes,
  formatModality,
  formatTimeLabel,
  formatWeekdayShort,
  getEventLayout,
  getVisibleDays,
  getVisibleRange,
  type MeetingTime,
} from "../lib/time";
import DemoPicker from "./DemoPicker";
import InstructorLinks from "./InstructorLinks";
import ScheduleToolbar from "./ScheduleToolbar";

/** Fixed visual grid height; events are positioned by percentage within it. */
const GRID_HEIGHT = "36rem";

/** Display order for the chronological list. */
const DAY_ORDER: Weekday[] = ["M", "T", "W", "R", "F", "S", "U"];

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

function eventLocation(section: Section, meeting: Meeting): string {
  if (meeting.building) {
    return meeting.room ? `${meeting.building} ${meeting.room}` : meeting.building;
  }
  return formatModality(section.modality);
}

function chronological(events: readonly CalendarEvent[]): CalendarEvent[] {
  return [...events].sort(
    (a, b) =>
      DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) ||
      a.startMin - b.startMin ||
      a.section.course_id.localeCompare(b.section.course_id),
  );
}

interface EventButtonProps {
  event: CalendarEvent;
  rangeStart: number;
  rangeEnd: number;
  active: boolean;
  highlighted: boolean;
  onActivate: (key: string) => void;
}

function EventButton({ event, rangeStart, rangeEnd, active, highlighted, onActivate }: EventButtonProps) {
  const color = getCourseColor(event.section.course_id);
  const location = eventLocation(event.section, event.meeting);
  const timeLabel = `${formatMinutes(event.startMin)}–${formatMinutes(event.endMin)}`;
  const layout = getEventLayout(event.startMin, event.endMin, {
    startMin: rangeStart,
    endMin: rangeEnd,
  });
  const label = `${event.section.course_id}, ${formatWeekdayShort(event.day)} ${timeLabel}, ${location}${
    highlighted ? ", highlighted from map" : ""
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
      aria-pressed={active}
      onClick={() => onActivate(event.key)}
      onFocus={() => onActivate(event.key)}
      className={`absolute inset-x-1 overflow-hidden rounded-md border px-2 py-1 text-left leading-tight shadow-sm transition-shadow hover:shadow-md focus-visible:z-30 ${
        active ? "z-10 shadow-md" : ""
      } ${highlighted ? "z-20 ring-2 ring-maroon ring-offset-1" : ""}`}
      style={{
        top: `${layout.topPercent}%`,
        height: `${layout.heightPercent}%`,
        backgroundColor: color.background,
        borderColor: color.border,
        borderWidth: active ? 2 : 1,
        color: color.text,
      }}
    >
      <span className="block truncate text-xs font-semibold">{event.section.course_id}</span>
      {layout.heightPercent >= 5 ? (
        <span className="block truncate text-[0.625rem]">{location}</span>
      ) : null}
      {layout.heightPercent >= 8 ? (
        <span className="block truncate text-[0.625rem]">{timeLabel}</span>
      ) : null}
    </button>
  );
}

function RemoveButton({ crn, onRemove }: { crn: string; onRemove: (crn: string) => void }) {
  return (
    <button
      type="button"
      aria-label={`Remove section ${crn}`}
      onClick={() => onRemove(crn)}
      className="shrink-0 rounded-md border border-line bg-panel px-2 py-0.5 text-xs font-semibold text-ink-primary hover:bg-soft-maroon"
    >
      Remove
    </button>
  );
}

/**
 * Weekly calendar and selected-schedule presentation.
 *
 * Renders only full documented `Section` objects already present in the
 * in-memory selected cache. Meetings are positioned from `start_min`/`end_min`;
 * course color is stable and never encodes risk. CRNs restored from the URL
 * that have no cached Section are reported as unavailable, because the
 * documented contract has no section-by-CRN endpoint.
 */
export default function WeeklyCalendar({ showDemoPicker = false }: { showDemoPicker?: boolean } = {}) {
  const { crns, selectedSections, unavailableCrns, removeCrn } = useSchedule();
  const { highlightedCrns } = useMapSelection();
  const { openSwapWorkbench } = useSwapWorkbench();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const events = useMemo(() => buildEvents(selectedSections), [selectedSections]);
  const meetingTimes = useMemo<MeetingTime[]>(
    () => events.map((event) => ({ days: [event.day], start_min: event.startMin, end_min: event.endMin })),
    [events],
  );
  const range = useMemo(() => getVisibleRange(meetingTimes), [meetingTimes]);
  const days = useMemo(() => getVisibleDays(meetingTimes), [meetingTimes]);
  const slots = useMemo(() => buildTimeSlots(range.startMin, range.endMin), [range]);
  const ordered = useMemo(() => chronological(events), [events]);
  const activeEvent = useMemo(
    () => events.find((event) => event.key === activeKey) ?? null,
    [events, activeKey],
  );

  const rangeSpan = Math.max(range.endMin - range.startMin, 1);
  const percent = (minutes: number) => ((minutes - range.startMin) / rangeSpan) * 100;

  return (
    <section
      aria-label="Weekly schedule"
      className="overflow-hidden rounded-2xl border border-line bg-panel shadow-card"
    >
      <ScheduleToolbar />

      {showDemoPicker && crns.length > 0 ? (
        <div className="border-b border-line px-4 py-3">
          <DemoPicker title="Switch demo schedule" />
        </div>
      ) : null}

      {crns.length === 0 ? (
        <div className="p-6 text-center" data-testid="calendar-empty">
          <p className="text-sm font-medium text-ink-primary">No sections selected</p>
          <p className="mt-1 text-xs text-ink-secondary">
            Add sections from search to see them placed on your week.
          </p>
        </div>
      ) : null}

      {unavailableCrns.length > 0 ? (
        <div
          role="status"
          data-testid="calendar-unavailable"
          className="m-4 rounded-lg border border-warning/40 bg-warm p-3 text-xs"
        >
          <p className="font-semibold text-warning">
            Section details unavailable for {unavailableCrns.length} selected section
            {unavailableCrns.length === 1 ? "" : "s"}
          </p>
          <p className="mt-1 text-ink-secondary">
            These CRNs were restored from the URL, but the documented API has no section-by-CRN
            endpoint, so their details cannot be loaded here. Add them again from search results or
            remove them.
          </p>
          <ul className="mt-2 space-y-1">
            {unavailableCrns.map((crn) => (
              <li key={crn} className="flex items-center justify-between gap-2">
                <span className="font-mono text-ink-secondary">CRN {crn}</span>
                <RemoveButton crn={crn} onRemove={removeCrn} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {events.length > 0 ? (
        <>
          <div
            className="space-y-3 p-4"
            data-testid="calendar-grid"
            data-range-start={range.startMin}
            data-range-end={range.endMin}
            data-visible-days={days.join("")}
          >
            <div className="overflow-x-auto hl-scroll">
              <div className="min-w-[34rem]">
                <div className="flex">
                  <div className="w-12 shrink-0" aria-hidden="true" />
                  {days.map((day) => (
                    <div
                      key={day}
                      role="columnheader"
                      data-testid={`day-header-${day}`}
                      className="flex-1 border-l border-line bg-warm/70 py-2 text-center text-[0.6875rem] font-semibold uppercase tracking-wide text-ink-secondary"
                    >
                      {formatWeekdayShort(day)}
                    </div>
                  ))}
                </div>
                <div className="flex">
                  <div
                    className="relative w-12 shrink-0 bg-warm/40"
                    style={{ height: GRID_HEIGHT }}
                    aria-hidden="true"
                  >
                    {slots.map((minutes, index) =>
                      index % 2 === 0 ? (
                        <div
                          key={minutes}
                          className="absolute right-1.5 -translate-y-1/2 text-[0.625rem] tabular-nums text-ink-secondary"
                          style={{ top: `${percent(minutes)}%` }}
                        >
                          {formatTimeLabel(minutes)}
                        </div>
                      ) : null,
                    )}
                  </div>
                  {days.map((day) => {
                    const isWeekend = day === "S" || day === "U";
                    return (
                      <div
                        key={day}
                        className={`relative flex-1 border-l border-line ${
                          isWeekend ? "bg-warm/40" : "bg-panel"
                        }`}
                        style={{ height: GRID_HEIGHT }}
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
                              active={activeEvent?.key === event.key}
                              highlighted={highlightedCrns.includes(event.section.crn)}
                              onActivate={setActiveKey}
                            />
                          ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {activeEvent ? (
              <div
                role="region"
                aria-label="Event details"
                data-testid="event-details"
                className="rounded-xl border border-line bg-warm p-3 text-xs"
              >
                <p className="text-sm font-semibold text-ink-primary">
                  {activeEvent.section.course_id} — {activeEvent.section.title}
                </p>
                <dl className="mt-1 grid gap-x-4 gap-y-1 text-ink-secondary sm:grid-cols-2">
                  <div>
                    <dt className="inline font-medium text-ink-primary">CRN: </dt>
                    <dd className="inline">{activeEvent.section.crn}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink-primary">Time: </dt>
                    <dd className="inline">
                      {formatWeekdayShort(activeEvent.day)} {formatMinutes(activeEvent.startMin)}–
                      {formatMinutes(activeEvent.endMin)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink-primary">Location: </dt>
                    <dd className="inline">
                      {eventLocation(activeEvent.section, activeEvent.meeting)}
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink-primary">Instructor: </dt>
                    <dd className="inline">
                      <InstructorLinks names={activeEvent.section.instructor_names} />
                    </dd>
                  </div>
                  <div>
                    <dt className="inline font-medium text-ink-primary">Dates: </dt>
                    <dd className="inline">
                      {activeEvent.meeting.start_date} to {activeEvent.meeting.end_date}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : (
              <p className="text-xs text-ink-secondary">
                Select an event to see instructor, location, and term dates.
              </p>
            )}
          </div>

          {/* Chronological equivalent for small screens and assistive tech. */}
          <ul className="space-y-2 border-t border-line p-4 md:hidden" aria-label="Selected meetings in chronological order">
            {ordered.map((event) => {
              const color = getCourseColor(event.section.course_id);
              const location = eventLocation(event.section, event.meeting);
              return (
                <li key={event.key}>
                  <button
                    type="button"
                    onClick={() => setActiveKey(event.key)}
                    onFocus={() => setActiveKey(event.key)}
                    className="w-full rounded-lg border p-2 text-left"
                    style={{
                      backgroundColor: color.background,
                      borderColor: color.border,
                      color: color.text,
                    }}
                  >
                    <span className="block text-sm font-semibold">{event.section.course_id}</span>
                    <span className="block text-xs">
                      {formatWeekdayShort(event.day)} {formatMinutes(event.startMin)}–
                      {formatMinutes(event.endMin)}
                    </span>
                    <span className="block text-xs">{location}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}

      {crns.length > 0 ? (
        <div className="border-t border-line p-4">
          <h3 className="text-sm font-semibold text-ink-primary">Selected sections</h3>
          <ul className="mt-2 space-y-2">
            {selectedSections.map((section) => (
              <li
                key={section.crn}
                className="flex items-center justify-between gap-2 rounded-lg border border-line/70 bg-warm/50 px-2.5 py-2 text-xs"
              >
                <span className="min-w-0 truncate text-ink-secondary">
                  <span className="font-medium text-ink-primary">{section.course_id}</span> · CRN{" "}
                  {section.crn} · {section.credits} cr
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openSwapWorkbench({ dropCrn: section.crn })}
                    aria-label={`Compare another section for ${section.course_id} (CRN ${section.crn})`}
                    className="rounded-md border border-line bg-panel px-2 py-0.5 text-[0.6875rem] font-semibold text-ink-primary transition-colors hover:border-maroon/40 hover:bg-soft-maroon"
                  >
                    Compare
                  </button>
                  <RemoveButton crn={section.crn} onRemove={removeCrn} />
                </span>
              </li>
            ))}
            {unavailableCrns.map((crn) => (
              <li
                key={crn}
                className="flex items-center justify-between gap-2 rounded-lg border border-warning/40 bg-warm/50 px-2.5 py-2 text-xs"
              >
                <span className="min-w-0 truncate font-mono text-ink-secondary">
                  CRN {crn} · details unavailable
                </span>
                <RemoveButton crn={crn} onRemove={removeCrn} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
