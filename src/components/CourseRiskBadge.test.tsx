import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CourseRisk } from "../lib/courseRisk";
import CourseRiskBadge, { riskReasonLine } from "./CourseRiskBadge";

const high: CourseRisk = {
  level: "high",
  label: "High risk",
  reasons: [
    { key: "a", tone: "danger", short: "Impossible walk", text: "x" },
    { key: "b", tone: "warning", short: "Heavy-course load", text: "y" },
  ],
};

describe("CourseRiskBadge tooltip", () => {
  it("builds a one-line reason from the existing flags", () => {
    expect(riskReasonLine(high)).toBe("Impossible walk, Heavy-course load");
    expect(riskReasonLine({ level: "low", label: "Low risk", reasons: [] })).toBe("No risk flags for this course");
  });

  it("shows the reason on focus and hides it on Escape", () => {
    render(<CourseRiskBadge risk={high} />);
    expect(screen.queryByRole("tooltip")).toBeNull();
    const trigger = screen.getByText("High risk").parentElement as HTMLElement;
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip").textContent).toBe("Impossible walk, Heavy-course load");
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
