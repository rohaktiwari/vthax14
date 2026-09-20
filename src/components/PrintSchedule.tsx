import { useMemo } from "react";
import type { Section, Weekday } from "../api/types";
import { useAnalysis } from "../api/hooks";
import { useSchedule } from "../context/ScheduleContext";
import {
  confidenceLabel,
  factorDisplayName,
  formatOneDecimal,
  formatRiskScore,
  formatTwoDecimals,
  riskBand,
} from "../lib/risk";
import { sumCredits } from "../lib/schedule";
import { formatMinutes, formatModality, formatWeekdayShort } from "../lib/time";

const DAY_ORDER: Weekday[] = ["M", "T", "W", "R", "F", "S", "U"];

const PLANNING_DISCLAIMER =
  "HokieLens is a student-built planning tool and is not an official Virginia Tech registration service. Risk, GPA, stress, and commute values are deterministic planning heuristics, not forecasts of academic performance.";

interface PrintMeeting {
  key: string;
  day: Weekday;
  courseId: string;
  crn: string;
  startMin: number;
  endMin: number;
  location: string;
}

function meetingLocation(
  section: Section,
  building: string | null | undefined,
  room: string | null | undefined,
): string {
  if (building) return room ? `${building} ${room}` : building;
  return formatModality(section.modality);
}

/**
 * Print-only schedule and analysis summary (frontend PRD §10.6).
 *
 * Rendered off-screen and revealed by the print stylesheet when the user picks
 * Print / Download. It includes the term, selected courses and CRNs, a
 * day-by-day weekly calendar, available core analysis, commute warnings, and the
 * planning-aid disclaimer. No PDF library is used — `window.print()` plus CSS.
 */
export default function PrintSchedule() {
  const { crns, selectedSections, unavailableCrns } = useSchedule();
  const analysis = useAnalysis(crns);
  const data = analysis.data;

  const term = data?.meta.term_id ?? selectedSections[0]?.term_id ?? "Not available";

  const meetingsByDay = useMemo(() => {
    const grouped = new Map<Weekday, PrintMeeting[]>();
    for (const day of DAY_ORDER) grouped.set(day, []);
    for (const section of selectedSections) {
      for (const meeting of section.meetings) {
        for (const day of meeting.days) {
          const list = grouped.get(day);
          if (!list) continue;
          list.push({
            key: `${section.crn}-${day}-${meeting.start_min}-${meeting.end_min}`,
            day,
            courseId: section.course_id,
            crn: section.crn,
            startMin: meeting.start_min,
            endMin: meeting.end_min,
            location: meetingLocation(section, meeting.building, meeting.room),
          });
        }
      }
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.startMin - b.startMin || a.courseId.localeCompare(b.courseId));
    }
    return grouped;
  }, [selectedSections]);

  const daysWithMeetings = DAY_ORDER.filter((day) => (meetingsByDay.get(day) ?? []).length > 0);

  return (
    <div
      data-testid="print-schedule"
      className="hidden bg-white p-6 text-black print:block"
    >
      <header className="border-b border-black/20 pb-3">
        <h1 className="text-2xl font-bold">HokieLens schedule</h1>
        <p className="mt-1 text-sm">Term: {term}</p>
      </header>

      <section className="mt-4">
        <h2 className="text-lg font-semibold">Selected courses and CRNs</h2>
        {crns.length === 0 ? (
          <p className="mt-1 text-sm">No sections selected.</p>
        ) : (
          <table className="mt-2 w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-black/30">
                <th className="py-1 pr-2">Course</th>
                <th className="py-1 pr-2">Title</th>
                <th className="py-1 pr-2">CRN</th>
                <th className="py-1 pr-2">Credits</th>
                <th className="py-1 pr-2">Instructor</th>
              </tr>
            </thead>
            <tbody>
              {selectedSections.map((section) => (
                <tr key={section.crn} className="border-b border-black/10 align-top">
                  <td className="py-1 pr-2 font-medium">{section.course_id}</td>
                  <td className="py-1 pr-2">{section.title}</td>
                  <td className="py-1 pr-2 font-mono">{section.crn}</td>
                  <td className="py-1 pr-2">{section.credits}</td>
                  <td className="py-1 pr-2">
                    {section.instructor_names.join(", ") || "TBA"}
                  </td>
                </tr>
              ))}
              {unavailableCrns.map((crn) => (
                <tr key={crn} className="border-b border-black/10 align-top">
                  <td className="py-1 pr-2">Details unavailable</td>
                  <td className="py-1 pr-2">—</td>
                  <td className="py-1 pr-2 font-mono">{crn}</td>
                  <td className="py-1 pr-2">—</td>
                  <td className="py-1 pr-2">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-1 text-xs">
          Total credits from cached sections: {sumCredits(selectedSections)}
        </p>
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-semibold">Weekly calendar</h2>
        {daysWithMeetings.length === 0 ? (
          <p className="mt-1 text-sm" data-testid="print-calendar-empty">
            No in-person meetings on the selected schedule.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {daysWithMeetings.map((day) => (
              <div key={day}>
                <h3 className="text-sm font-semibold">{formatWeekdayShort(day)}</h3>
                <ul className="mt-1 space-y-0.5 text-xs">
                  {(meetingsByDay.get(day) ?? []).map((meeting) => (
                    <li key={meeting.key}>
                      {formatMinutes(meeting.startMin)}–{formatMinutes(meeting.endMin)} ·{" "}
                      {meeting.courseId} ({meeting.location}) · CRN {meeting.crn}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-4">
        <h2 className="text-lg font-semibold">Risk and commute analysis</h2>
        {data ? (
          <>
            <p className="mt-1 text-sm" data-testid="print-risk">
              Risk score: {formatRiskScore(data.risk_score)}/100 ({riskBand(data.risk_score).label})
            </p>

            <h3 className="mt-2 text-sm font-semibold">Top factors</h3>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs">
              {data.factors.map((factor) => (
                <li key={factor.type}>
                  {factorDisplayName(factor.type)} — {formatOneDecimal(factor.severity)} of{" "}
                  {formatOneDecimal(factor.max_severity)}: {factor.detail}
                </li>
              ))}
            </ul>

            <h3 className="mt-2 text-sm font-semibold">Commute warnings</h3>
            {data.commute_warnings.length === 0 ? (
              <p className="mt-1 text-xs" data-testid="print-commute-empty">
                No tight or impossible walking transitions were reported.
              </p>
            ) : (
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs" data-testid="print-commute">
                {data.commute_warnings.map((warning, index) => (
                  <li key={`${warning.day}-${warning.from.crn}-${warning.to.crn}-${index}`}>
                    {formatWeekdayShort(warning.day)} · {warning.from.building} →{" "}
                    {warning.to.building} · {warning.verdict} · {warning.walk_min} min walk /{" "}
                    {warning.gap_min} min gap — {warning.detail}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-2 text-xs">
              Expected GPA:{" "}
              {data.expected_gpa.mean === null
                ? "Not available"
                : formatTwoDecimals(data.expected_gpa.mean)}{" "}
              ({confidenceLabel(data.expected_gpa.confidence)})
            </p>
          </>
        ) : (
          <p className="mt-1 text-sm">
            {crns.length >= 2
              ? "Analysis is not available to print yet."
              : "Add at least one more section to calculate schedule risk."}
          </p>
        )}
      </section>

      <footer className="mt-4 border-t border-black/20 pt-2 text-xs">
        <p>Planning aid only. {PLANNING_DISCLAIMER}</p>
      </footer>
    </div>
  );
}
