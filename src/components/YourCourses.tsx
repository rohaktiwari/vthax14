import { useState } from "react";
import type { Section } from "../api/types";
import { useCenterView } from "../context/CenterViewContext";
import { useCourseSearch } from "../context/CourseSearchContext";
import { useSchedule } from "../context/ScheduleContext";
import { useScheduleAnalysis } from "../hooks/useScheduleAnalysis";
import { getCourseColor } from "../lib/courseColor";
import { courseRiskFor } from "../lib/courseRisk";
import { MAX_CRNS, sumCredits } from "../lib/schedule";
import { creditsLabel, meetingLines } from "../lib/sectionText";
import { BTN_GHOST, BTN_PRIMARY, BTN_PRIMARY_LG, BTN_SECONDARY, CARD } from "../lib/ui";
import CourseRiskBadge, { riskReasonLine } from "./CourseRiskBadge";

function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

interface CourseRowProps {
  section: Section;
  active: boolean;
  riskLoading: boolean;
  analysis: ReturnType<typeof useScheduleAnalysis>["data"];
  onOpen: (crn: string) => void;
  onRemove: (crn: string) => void;
}

function CourseRow({ section, active, riskLoading, analysis, onOpen, onRemove }: CourseRowProps) {
  const color = getCourseColor(section.course_id);
  const risk = courseRiskFor(section.crn, analysis);
  const flagged = risk?.reasons.filter((reason) => reason.tone !== "neutral").slice(0, 2) ?? [];
  const [firstMeeting] = meetingLines(section);

  return (
    <li
      className={`rounded-xl border bg-panel shadow-sm transition-colors ${
        active ? "border-maroon ring-1 ring-maroon" : "border-line hover:border-maroon/40"
      }`}
    >
      <button
        type="button"
        onClick={() => onOpen(section.crn)}
        aria-label={`Open details for ${section.course_id}, ${section.title}${
          risk ? `. ${risk.label}: ${riskReasonLine(risk)}` : ""
        }`}
        aria-current={active ? "true" : undefined}
        className="flex w-full gap-3 rounded-t-xl p-3 text-left"
      >
        <span
          aria-hidden="true"
          className="mt-0.5 w-1.5 shrink-0 self-stretch rounded-full"
          style={{ backgroundColor: color.border }}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="text-base font-semibold text-ink-primary">
              {section.course_id}
              <span className="ml-1.5 text-sm font-normal text-ink-secondary">
                {creditsLabel(section.credits)}
              </span>
            </span>
            <CourseRiskBadge risk={risk} loading={riskLoading} focusable={false} />
          </span>
          <span className="mt-0.5 block truncate text-sm text-ink-primary">{section.title}</span>
          <span className="mt-1 block truncate text-sm text-ink-secondary">{firstMeeting}</span>
          {risk ? (
            <span
              className={`mt-1 block text-sm ${flagged.length > 0 ? "font-medium text-ink-primary" : "text-ink-secondary"}`}
            >
              {flagged.length > 0 ? flagged.map((reason) => reason.short).join(" · ") : "No issues flagged"}
            </span>
          ) : null}
        </span>
      </button>
      <div className="flex justify-end border-t border-line/70 px-2 py-1">
        <button
          type="button"
          onClick={() => onRemove(section.crn)}
          aria-label={`Remove ${section.course_id} (CRN ${section.crn})`}
          className="rounded-md px-2 py-1 text-sm font-medium text-ink-secondary hover:bg-soft-maroon hover:text-maroon"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function CourseRowSkeleton() {
  return (
    <li
      aria-hidden="true"
      className="animate-pulse space-y-2 rounded-xl border border-line bg-panel p-3"
    >
      <div className="h-4 w-1/3 rounded bg-line" />
      <div className="h-3.5 w-2/3 rounded bg-line" />
      <div className="h-3 w-1/2 rounded bg-line" />
    </li>
  );
}

/**
 * The course cart. Every selected course with its risk, where it meets, and a way
 * to open or remove it; the primary action is adding another course. Risk labels
 * come from the backend analysis of the whole schedule (see `courseRiskFor`).
 */
export default function YourCourses() {
  const { crns, selectedSections, removeCrn, clear, isFull } = useSchedule();
  const { isPending: catalogPending } = useCourseSearch();
  const { focusedCrn, showCourse, showAdd } = useCenterView();
  const analysis = useScheduleAnalysis();
  const [confirmingClear, setConfirmingClear] = useState(false);

  const credits = sumCredits(selectedSections);
  const count = crns.length;
  const riskLoading = count >= 2 && (analysis.isPending || analysis.isUpdating);
  const byCrn = new Map(selectedSections.map((section) => [section.crn, section]));

  return (
    <section aria-label="Your Courses" className={`${CARD} flex h-full min-h-0 flex-col`}>
      <div className="space-y-3 border-b border-line p-4">
        <h2 className="text-lg font-bold text-ink-primary">Your Courses</h2>
        <div>
          <p className="text-sm font-medium text-ink-primary" aria-live="polite">
            {count} of {MAX_CRNS} courses selected
            {count > 0 && credits > 0 ? (
              <span className="font-normal text-ink-secondary"> · {creditsLabel(credits)}</span>
            ) : null}
          </p>
          <div
            role="progressbar"
            aria-label="Courses selected"
            aria-valuemin={0}
            aria-valuemax={MAX_CRNS}
            aria-valuenow={count}
            className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line"
          >
            <div
              className="h-full rounded-full bg-maroon transition-[width] duration-300"
              style={{ width: `${Math.min(100, (count / MAX_CRNS) * 100)}%` }}
            />
          </div>
        </div>
        <button type="button" onClick={showAdd} disabled={isFull} className={`${BTN_PRIMARY_LG} w-full`}>
          <PlusIcon />
          {isFull ? "Course limit reached" : "Add a course"}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 hl-scroll">
        {count === 0 ? (
          <p className="px-1 py-6 text-center text-sm text-ink-secondary">
            No courses yet. Add one to see where it meets and how risky it is.
          </p>
        ) : (
          <>
            {count === 1 ? (
              <p className="mb-3 rounded-lg border border-line bg-warm px-3 py-2 text-sm text-ink-secondary">
                Add one more course to see risk and walking times.
              </p>
            ) : null}
            <ul className="space-y-2">
              {crns.map((crn) => {
                const section = byCrn.get(crn);
                if (section) {
                  return (
                    <CourseRow
                      key={crn}
                      section={section}
                      active={focusedCrn === crn}
                      riskLoading={riskLoading}
                      analysis={analysis.data}
                      onOpen={showCourse}
                      onRemove={removeCrn}
                    />
                  );
                }
                if (catalogPending) return <CourseRowSkeleton key={crn} />;
                return (
                  <li
                    key={crn}
                    className="flex items-center justify-between gap-2 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm"
                  >
                    <span className="text-ink-primary">
                      CRN {crn}: details unavailable. Add it again from search.
                    </span>
                    <button
                      type="button"
                      onClick={() => removeCrn(crn)}
                      aria-label={`Remove CRN ${crn}`}
                      className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-ink-primary hover:bg-panel"
                    >
                      Remove
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {count > 0 ? (
        <div className="border-t border-line p-3">
          {confirmingClear ? (
            <div role="alert" className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink-primary">Remove all {count} courses?</p>
              <span className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    clear();
                    setConfirmingClear(false);
                  }}
                  className={BTN_PRIMARY}
                >
                  Remove all
                </button>
                <button type="button" onClick={() => setConfirmingClear(false)} className={BTN_SECONDARY}>
                  Cancel
                </button>
              </span>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirmingClear(true)} className={`${BTN_GHOST} w-full text-ink-secondary`}>
              Clear all courses
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}
