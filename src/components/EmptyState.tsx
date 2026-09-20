import { useSchedule } from "../context/ScheduleContext";
import DemoPicker from "./DemoPicker";

const STEPS = [
  {
    title: "Search",
    body: "Find sections in the catalog for the courses you are weighing.",
  },
  {
    title: "Add",
    body: "Add candidate sections and watch conflicts surface immediately.",
  },
  {
    title: "Analyze",
    body: "Read the risk score, walking gaps, and grade history before you commit.",
  },
] as const;

/**
 * Empty-schedule guidance (PRD §11.2). Demo buttons load real CRNs from
 * `GET /api/demo/schedules` via DemoPicker — never hardcoded here. It renders
 * only while the schedule is empty so onboarding copy and its demo picker do
 * not linger once a plan exists.
 */
export default function EmptyState() {
  const { crns } = useSchedule();
  if (crns.length > 0) return null;

  return (
    <div className="rounded-2xl border border-line bg-panel p-5 shadow-card">
      <p className="mb-3 text-sm text-ink-secondary">
        Start here: search for a course, or load a demo week below.
      </p>
      <ol className="grid gap-3 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="rounded-xl border border-line bg-warm px-4 py-3 shadow-sm"
          >
            <p className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-maroon text-xs font-bold text-white">
                {index + 1}
              </span>
              {step.title}
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-secondary">{step.body}</p>
          </li>
        ))}
      </ol>

      <div className="mt-4 border-t border-line pt-4">
        <DemoPicker title="Or start from a demo schedule" />
      </div>
    </div>
  );
}
