import type { ReactNode } from "react";
import type { Section } from "../api/types";
import { useCenterView } from "../context/CenterViewContext";
import { useSchedule } from "../context/ScheduleContext";
import { useScheduleAnalysis } from "../hooks/useScheduleAnalysis";
import { getCourseColor } from "../lib/courseColor";
import { courseRiskFor, type ReasonTone } from "../lib/courseRisk";
import { creditsLabel, meetingLocation } from "../lib/sectionText";
import { formatDateRange, formatMeetingSummary, formatModality } from "../lib/time";
import { BTN_GHOST, BTN_SECONDARY, CARD, type Tone } from "../lib/ui";
import Badge from "./Badge";
import CourseRiskBadge from "./CourseRiskBadge";
import InstructorLinks from "./InstructorLinks";

const REASON_TONE: Record<ReasonTone, Tone> = {
  danger: "danger",
  warning: "warning",
  neutral: "neutral",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-ink-secondary">{label}</dt>
      <dd className="mt-0.5 text-base font-medium text-ink-primary">{children}</dd>
    </div>
  );
}

function seatsText(section: Section): string {
  const { available, max } = section.seats;
  return available === 0 ? `Full (0 of ${max} open)` : `${available} of ${max} open`;
}

/**
 * Details for the course picked from the calendar or Your Courses: who teaches
 * it, when and where it meets, seats, and why it is flagged. Everything shown is
 * a documented section field or a backend analysis value.
 */
export default function CourseDetails() {
  const { selectedSections, removeCrn } = useSchedule();
  const { focusedCrn, showOverview } = useCenterView();
  const analysis = useScheduleAnalysis();

  const section = selectedSections.find((item) => item.crn === focusedCrn);
  if (!section) return null;

  const color = getCourseColor(section.course_id);
  const risk = courseRiskFor(section.crn, analysis.data);
  const riskLoading = selectedSections.length >= 2 && !risk && (analysis.isPending || analysis.isUpdating);
  const notes = [section.description, section.prereqs_text, section.comments].filter(Boolean);

  return (
    <section aria-label="Course details" className={`${CARD} overflow-hidden`}>
      <div className="h-1.5" style={{ backgroundColor: color.border }} aria-hidden="true" />
      <div className="space-y-5 p-5">
        <button type="button" onClick={showOverview} className={`${BTN_GHOST} -ml-2.5`}>
          ← Schedule overview
        </button>

        <header>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-2xl font-bold text-ink-primary">{section.course_id}</h2>
            <CourseRiskBadge risk={risk} loading={riskLoading} />
          </div>
          <p className="mt-1 text-lg text-ink-primary">{section.title}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Badge>{creditsLabel(section.credits)}</Badge>
            <Badge>{section.schedule_type}</Badge>
            <Badge>{formatModality(section.modality)}</Badge>
            {section.grade_mode === "pass_fail" ? <Badge tone="info">Pass/fail</Badge> : null}
          </div>
        </header>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Fact label="Instructor">
            <InstructorLinks names={section.instructor_names} />
          </Fact>
          <Fact label="CRN">
            <span className="font-mono">{section.crn}</span>
          </Fact>
          <Fact label="Seats">
            <span title="Seat counts reflect the committed catalog snapshot.">{seatsText(section)}</span>
          </Fact>
        </dl>

        <div>
          <h3 className="text-base font-semibold text-ink-primary">When and where</h3>
          {section.meetings.length === 0 ? (
            <p className="mt-2 text-base text-ink-secondary">No set meeting times.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {section.meetings.map((meeting, index) => (
                <li key={index} className="rounded-xl border border-line bg-warm/50 px-3 py-2.5">
                  <p className="text-base font-medium text-ink-primary">{formatMeetingSummary(meeting)}</p>
                  <p className="text-sm text-ink-secondary">
                    {meetingLocation(section, meeting)} · {formatDateRange(meeting.start_date, meeting.end_date)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-base font-semibold text-ink-primary">Risk for this course</h3>
          {risk ? (
            risk.reasons.length === 0 ? (
              <p className="mt-2 text-base text-ink-secondary">
                Nothing about this course is flagged in your current schedule.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {risk.reasons.map((reason) => (
                  <li key={reason.key} className="flex items-start gap-3 rounded-xl border border-line px-3 py-2.5">
                    <Badge tone={REASON_TONE[reason.tone]}>{reason.short}</Badge>
                    <p className="text-sm text-ink-primary">{reason.text}</p>
                  </li>
                ))}
              </ul>
            )
          ) : riskLoading ? (
            <p className="mt-2 text-base text-ink-secondary">Checking how this fits your week…</p>
          ) : (
            <p className="mt-2 text-base text-ink-secondary">
              Add one more course to see how this one fits your week.
            </p>
          )}
        </div>

        {notes.length > 0 ? (
          <details className="rounded-xl border border-line">
            <summary className="cursor-pointer px-3 py-2.5 text-base font-semibold text-ink-primary">
              Description and notes
            </summary>
            <div className="space-y-2 border-t border-line px-3 py-3 text-sm text-ink-secondary">
              {notes.map((note, index) => (
                <p key={index}>{note}</p>
              ))}
            </div>
          </details>
        ) : null}

        <div className="border-t border-line pt-4">
          <button
            type="button"
            onClick={() => removeCrn(section.crn)}
            aria-label={`Remove ${section.course_id} (CRN ${section.crn}) from Your Courses`}
            className={BTN_SECONDARY}
          >
            Remove from Your Courses
          </button>
        </div>
      </div>
    </section>
  );
}
