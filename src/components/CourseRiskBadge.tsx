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
}

/** Per-course risk pill. Text is always present, so it never relies on color alone. */
export default function CourseRiskBadge({ risk, loading = false }: CourseRiskBadgeProps) {
  if (risk) return <Badge tone={LEVEL_TONE[risk.level]}>{risk.label}</Badge>;
  if (!loading) return null;
  return (
    <span
      role="status"
      aria-label="Checking risk"
      className="inline-block h-6 w-20 shrink-0 animate-pulse rounded-full bg-line"
    />
  );
}
