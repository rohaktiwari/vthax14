import { useState } from "react";
import { useDemoSchedules } from "../api/hooks";
import { normalizeApiError } from "../api/errors";
import { useSchedule } from "../context/ScheduleContext";
import ErrorState from "./ErrorState";
import Skeleton from "./Skeleton";

type DemoKey = "easy" | "brutal";

interface DemoPickerProps {
  title?: string;
}

/**
 * Demo schedule picker (frontend PRD §10.15).
 *
 * Every CRN comes from `GET /api/demo/schedules`; none are hardcoded. Selecting
 * a demo replaces the current schedule, after an inline confirmation when a
 * selection already exists.
 */
export default function DemoPicker({ title = "Start from a demo schedule" }: DemoPickerProps) {
  const query = useDemoSchedules();
  const { crns, setSchedule } = useSchedule();
  const [pending, setPending] = useState<DemoKey | null>(null);

  function apply(key: DemoKey) {
    const data = query.data;
    if (!data) return;
    setSchedule(data[key].crns);
    setPending(null);
  }

  function request(key: DemoKey) {
    if (crns.length > 0) {
      setPending(key);
      return;
    }
    apply(key);
  }

  if (query.isPending) {
    return (
      <div data-testid="demo-loading" aria-busy="true">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{title}</p>
        <div className="mt-2 w-56">
          <Skeleton lines={2} />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div data-testid="demo-error">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{title}</p>
        <div className="mt-2">
          <ErrorState
            title="Demo schedules unavailable"
            error={normalizeApiError(query.error)}
            onRetry={() => void query.refetch()}
          />
        </div>
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;

  const options: { key: DemoKey; label: string }[] = [
    { key: "easy", label: data.easy.label || "Balanced schedule" },
    { key: "brutal", label: data.brutal.label || "The wall of pain" },
  ];

  const pendingOption = options.find((option) => option.key === pending) ?? null;

  return (
    <div data-testid="demo-picker">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-secondary">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            data-testid={`demo-${option.key}`}
            aria-haspopup="false"
            onClick={() => request(option.key)}
            className={`rounded-lg border px-3.5 py-2 text-sm font-medium shadow-sm transition-colors ${
              pending === option.key
                ? "border-maroon bg-maroon text-white"
                : "border-maroon/40 bg-soft-maroon text-maroon hover:border-maroon hover:bg-maroon/10"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {pendingOption ? (
        <div
          role="alert"
          data-testid="demo-confirm"
          className="mt-3 rounded-xl border border-warning/40 bg-warm p-3 text-xs shadow-sm"
        >
          <p className="font-semibold text-ink-primary">
            Replace your current {crns.length} selected section{crns.length === 1 ? "" : "s"}?
          </p>
          <p className="mt-1 text-ink-secondary">
            Loading “{pendingOption.label}” replaces the schedule in the URL. This cannot be undone.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="demo-confirm-accept"
              onClick={() => apply(pendingOption.key)}
              className="rounded-lg border border-maroon bg-maroon px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-maroon-dark"
            >
              Replace schedule
            </button>
            <button
              type="button"
              data-testid="demo-confirm-cancel"
              onClick={() => setPending(null)}
              className="rounded-lg border border-line bg-panel px-3 py-1.5 text-xs font-semibold text-ink-primary transition-colors hover:bg-soft-maroon"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
