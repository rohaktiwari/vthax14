import { useId, useState } from "react";
import type { CourseRisk, CourseRiskLevel } from "../lib/courseRisk";
import type { Tone } from "../lib/ui";
import Badge from "./Badge";

const LEVEL_TONE: Record<CourseRiskLevel, Tone> = {
  low: "success",
  medium: "warning",
  high: "danger",
};

interface CourseRiskBadgeProps {
  risk: CourseRisk | null;
  /** Analysis is on its way, so show a placeholder instead of nothing. */
  loading?: boolean;
  /**
   * Keyboard-focusable tooltip trigger. Turn off inside another button or link
   * (nested interactive controls are an accessibility failure); the reason is then
   * hover-only and should be exposed elsewhere, such as the parent's label.
   */
  focusable?: boolean;
}

/** One-line reason built from the backend-reported flags for this course. */
export function riskReasonLine(risk: CourseRisk): string {
  const shorts = risk.reasons.map((reason) => reason.short);
  if (shorts.length === 0) return "No risk flags for this course";
  const shown = shorts.slice(0, 3).join(", ");
  return shorts.length > 3 ? `${shown} and ${shorts.length - 3} more` : shown;
}

/**
 * Per-course risk pill. Text is always present, so it never relies on color alone.
 * Hover or keyboard focus shows a one-line reason; Escape dismisses it.
 */
export default function CourseRiskBadge({ risk, loading = false, focusable = true }: CourseRiskBadgeProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);

  if (risk) {
    return (
      <span
        className="relative inline-flex"
        tabIndex={focusable ? 0 : undefined}
        aria-describedby={open ? tooltipId : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={focusable ? () => setOpen(true) : undefined}
        onBlur={focusable ? () => setOpen(false) : undefined}
        onKeyDown={
          focusable
            ? (event) => {
                if (event.key === "Escape") setOpen(false);
              }
            : undefined
        }
      >
        <Badge tone={LEVEL_TONE[risk.level]}>{risk.label}</Badge>
        {open ? (
          <span
            id={tooltipId}
            role="tooltip"
            className="absolute left-0 top-full z-50 mt-1.5 w-max max-w-[16rem] rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs font-medium text-ink-primary shadow-card-lg"
          >
            {riskReasonLine(risk)}
          </span>
        ) : null}
      </span>
    );
  }
  if (!loading) return null;
  return (
    <span
      role="status"
      aria-label="Checking risk"
      className="inline-block h-6 w-20 shrink-0 animate-pulse rounded-full bg-line"
    />
  );
}
