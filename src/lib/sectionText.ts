import type { Meeting, Section } from "../api/types";
import { formatMeetingSummary, formatModality } from "./time";

/** Where one meeting happens: building and room, or the delivery mode when it has no building. */
export function meetingLocation(section: Section, meeting: Meeting): string {
  if (meeting.building) return meeting.room ? `${meeting.building} ${meeting.room}` : meeting.building;
  return formatModality(section.modality);
}

/** One readable line per meeting, for example `MWF 10:10 AM–11:00 AM · MCB 204`. */
export function meetingLines(section: Section): string[] {
  if (section.meetings.length === 0) return [`${formatModality(section.modality)} · no set meeting times`];
  return section.meetings.map(
    (meeting) => `${formatMeetingSummary(meeting)} · ${meetingLocation(section, meeting)}`,
  );
}

export function creditsLabel(credits: number): string {
  return `${credits} credit${credits === 1 ? "" : "s"}`;
}
