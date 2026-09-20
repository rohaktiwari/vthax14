import { useState } from "react";
import { useDemoSchedules } from "../api/hooks";
import { normalizeApiError } from "../api/errors";
import { useSchedule } from "../context/ScheduleContext";
import { BTN_PRIMARY, BTN_SECONDARY } from "../lib/ui";
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
        <p className="text-sm font-medium text-ink-secondary">{title}</p>
        <div className="mt-2 w-56">
          <Skeleton lines={2} />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div data-testid="demo-error">
        <p className="text-sm font-medium text-ink-secondary">{title}</p>
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
      <p className="text-sm font-medium text-ink-secondary">{title}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            data-testid={`demo-${option.key}`}
            aria-haspopup="false"
            onClick={() => request(option.key)}
            className={pending === option.key ? BTN_PRIMARY : BTN_SECONDARY}
          >
            {option.label}
          </button>
        ))}
      </div>

      {pendingOption ? (
        <div
          role="alert"
          data-testid="demo-confirm"
          className="mt-3 rounded-xl border border-warning/40 bg-warning-soft p-3 text-sm shadow-sm"
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
              className={BTN_PRIMARY}
            >
              Replace schedule
            </button>
            <button
              type="button"
              data-testid="demo-confirm-cancel"
              onClick={() => setPending(null)}
              className={BTN_SECONDARY}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
