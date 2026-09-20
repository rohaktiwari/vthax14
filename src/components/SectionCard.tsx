import type { Section } from "../api/types";
import { meetingLines } from "../lib/sectionText";
import { BTN_PRIMARY, BTN_SECONDARY } from "../lib/ui";
import Badge from "./Badge";
import InstructorLinks from "./InstructorLinks";

interface SectionCardProps {
  section: Section;
  selected: boolean;
  disabled: boolean;
  onToggle: (section: Section) => void;
}

/** One section row: who, when, where, seats, and a big Add or Remove button. */
export default function SectionCard({ section, selected, disabled, onToggle }: SectionCardProps) {
  const { available, max } = section.seats;

  return (
    <li
      className={`rounded-xl border p-3 shadow-sm transition-colors ${
        selected ? "border-maroon/50 bg-soft-maroon/40" : "border-line bg-panel hover:border-maroon/30"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <p className="flex flex-wrap items-center gap-2 text-base font-medium text-ink-primary">
            <InstructorLinks names={section.instructor_names} />
            {selected ? <Badge tone="success">Added</Badge> : null}
          </p>
          {meetingLines(section).map((line) => (
            <p key={line} className="text-sm text-ink-secondary">
              {line}
            </p>
          ))}
          <p
            className="text-sm text-ink-secondary"
            title="Seat counts reflect the committed catalog snapshot."
          >
            CRN <span className="font-mono">{section.crn}</span> ·{" "}
            {available === 0 ? "Full" : `${available} of ${max} seats open`}
            <span className="sr-only">. Seat counts reflect the committed catalog snapshot.</span>
          </p>
        </div>
        <button
          type="button"
          aria-label={`${selected ? "Remove" : "Add"} section ${section.crn}`}
          aria-pressed={selected}
          disabled={!selected && disabled}
          onClick={() => onToggle(section)}
          className={`shrink-0 ${selected ? BTN_SECONDARY : BTN_PRIMARY}`}
        >
          {selected ? "Remove" : "Add"}
        </button>
      </div>
    </li>
  );
}
