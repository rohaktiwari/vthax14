import type { Section } from "../api/types";
import { formatMeetingSummary, formatModality } from "../lib/time";
import InstructorLinks from "./InstructorLinks";

interface SectionCardProps {
  section: Section;
  selected: boolean;
  disabled: boolean;
  onToggle: (section: Section) => void;
}

function locationLabel(section: Section): string {
  const buildings = Array.from(
    new Set(
      section.meetings
        .map((meeting) => meeting.building)
        .filter((building): building is string => Boolean(building)),
    ),
  );
  return buildings.length > 0 ? buildings.join(", ") : formatModality(section.modality);
}

function meetingLabel(section: Section): string {
  if (section.meetings.length === 0) return "No scheduled meetings";
  return section.meetings.map(formatMeetingSummary).join(" · ");
}

/** One section row with add/remove, meeting summary, and seat snapshot copy. */
export default function SectionCard({ section, selected, disabled, onToggle }: SectionCardProps) {
  return (
    <li
      className={`rounded-xl border p-3 shadow-sm transition-colors ${
        selected ? "border-maroon/50 bg-soft-maroon/40" : "border-line bg-panel hover:border-maroon/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-ink-secondary">CRN {section.crn}</p>
          <p className="truncate text-sm font-medium text-ink-primary">
            <InstructorLinks names={section.instructor_names} />
          </p>
          <p className="mt-0.5 text-xs text-ink-secondary">{meetingLabel(section)}</p>
          <p className="text-xs text-ink-secondary">{locationLabel(section)}</p>
          <p
            className="mt-1 text-xs text-ink-secondary"
            title="Seat counts reflect the committed catalog snapshot."
          >
            Seats: {section.seats.available} of {section.seats.max} available
            <span className="sr-only">. Seat counts reflect the committed catalog snapshot.</span>
          </p>
        </div>
        <button
          type="button"
          aria-label={`${selected ? "Remove" : "Add"} section ${section.crn}`}
          aria-pressed={selected}
          disabled={!selected && disabled}
          onClick={() => onToggle(section)}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold shadow-sm transition-colors ${
            selected
              ? "border border-maroon bg-soft-maroon text-maroon hover:bg-maroon hover:text-white"
              : "bg-maroon text-white hover:bg-maroon-dark disabled:cursor-not-allowed disabled:opacity-50"
          }`}
        >
          {selected ? "Remove" : "Add"}
        </button>
      </div>
    </li>
  );
}
