import { describe, expect, it } from "vitest";
import type { AnalyzeResponse, CommuteWarning, RiskFactor } from "../api/types";
import { analyzeFixture, sectionFixture } from "../test/fixtures";
import { courseRiskFor } from "./courseRisk";

const section = (crn: string) => ({ ...sectionFixture, crn });

function analysis(overrides: Partial<AnalyzeResponse>): AnalyzeResponse {
  return {
    ...analyzeFixture,
    sections: [section("90001"), section("90003"), section("90008")],
    factors: [],
    commute_warnings: [],
    ...overrides,
  };
}

function factor(type: RiskFactor["type"], severity: number, max: number, crns: string[]): RiskFactor {
  return { type, severity, max_severity: max, detail: `${type} detail`, affected_crns: crns };
}

function warning(
  day: CommuteWarning["day"],
  from: string,
  to: string,
  verdict: CommuteWarning["verdict"],
): CommuteWarning {
  return {
    ...analyzeFixture.commute_warnings[0]!,
    day,
    from: { crn: from, building: "MCB", ends: "11:00" },
    to: { crn: to, building: "WHI", starts: "11:10" },
    verdict,
    detail: "MCB -> WHI is an 18-minute walk; the schedule provides 10 minutes.",
  };
}

describe("courseRiskFor", () => {
  it("returns null without an analysis or when the analysis does not cover the CRN", () => {
    expect(courseRiskFor("90001", undefined)).toBeNull();
    expect(courseRiskFor("99999", analysis({}))).toBeNull();
  });

  it("is low with no reasons when nothing lists the course", () => {
    const risk = courseRiskFor("90008", analysis({ factors: [factor("difficulty_load", 0, 10, ["90008"])] }));
    expect(risk).toEqual({ level: "low", label: "Low risk", reasons: [] });
  });

  it("is high for an impossible walk on either end and groups repeated days", () => {
    const data = analysis({
      commute_warnings: [
        warning("M", "90001", "90003", "impossible"),
        warning("W", "90001", "90003", "impossible"),
        warning("F", "90001", "90003", "impossible"),
      ],
    });
    for (const crn of ["90001", "90003"]) {
      const risk = courseRiskFor(crn, data)!;
      expect(risk.level).toBe("high");
      expect(risk.label).toBe("High risk");
      expect(risk.reasons).toHaveLength(1);
      expect(risk.reasons[0]).toMatchObject({ tone: "danger", short: "Impossible walk" });
      expect(risk.reasons[0]!.text.startsWith("Mon, Wed, Fri: ")).toBe(true);
    }
    expect(courseRiskFor("90008", data)!.level).toBe("low");
  });

  it("is medium for a tight walk or a factor at 40 to 79 percent of its maximum", () => {
    const tight = analysis({ commute_warnings: [warning("T", "90001", "90003", "tight")] });
    expect(courseRiskFor("90001", tight)!.level).toBe("medium");

    const factorOnly = courseRiskFor(
      "90008",
      analysis({ factors: [factor("grade_volatility", 6, 15, ["90008"])] }),
    )!;
    expect(factorOnly.level).toBe("medium");
    expect(factorOnly.reasons[0]).toMatchObject({ tone: "warning", short: "Grade volatility" });
  });

  it("is high for a factor at 80 percent or more, and ignores the commute factor itself", () => {
    const risk = courseRiskFor(
      "90001",
      analysis({
        factors: [factor("workload_collision", 26, 30, ["90001"]), factor("commute", 20, 20, ["90001"])],
      }),
    )!;
    expect(risk.level).toBe("high");
    expect(risk.reasons.map((reason) => reason.short)).toEqual(["Heavy-course load"]);
  });

  it("keeps small factor contributions as neutral reasons without raising the level", () => {
    const risk = courseRiskFor("90001", analysis({ factors: [factor("difficulty_load", 3.3, 10, ["90001"])] }))!;
    expect(risk.level).toBe("low");
    expect(risk.reasons).toEqual([
      expect.objectContaining({ tone: "neutral", short: "Instructor difficulty" }),
    ]);
  });

  it("orders danger before warning before neutral", () => {
    const risk = courseRiskFor(
      "90001",
      analysis({
        factors: [factor("difficulty_load", 2, 10, ["90001"]), factor("grade_volatility", 7, 15, ["90001"])],
        commute_warnings: [warning("M", "90001", "90003", "impossible")],
      }),
    )!;
    expect(risk.reasons.map((reason) => reason.tone)).toEqual(["danger", "warning", "neutral"]);
  });
});
