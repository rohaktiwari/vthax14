import { describe, expect, it } from "vitest";
import {
  confidenceLabel,
  factorDisplayName,
  formatOneDecimal,
  formatRiskScore,
  formatTwoDecimals,
  riskBand,
  severityPercent,
  verdictLabel,
} from "./risk";

describe("riskBand (presentation-only PRD §10.7 table)", () => {
  it("maps each documented range to its label", () => {
    expect(riskBand(0).label).toBe("Low");
    expect(riskBand(24).label).toBe("Low");
    expect(riskBand(25).label).toBe("Moderate");
    expect(riskBand(49).label).toBe("Moderate");
    expect(riskBand(50).label).toBe("High");
    expect(riskBand(69).label).toBe("High");
    expect(riskBand(70).label).toBe("Very high");
    expect(riskBand(100).label).toBe("Very high");
  });

  it("assigns a distinct tone per band", () => {
    expect(riskBand(10).tone).toBe("low");
    expect(riskBand(30).tone).toBe("moderate");
    expect(riskBand(60).tone).toBe("high");
    expect(riskBand(90).tone).toBe("very-high");
  });
});

describe("factorDisplayName", () => {
  it("maps every known backend factor identifier", () => {
    expect(factorDisplayName("workload_collision")).toBe("Heavy-course load");
    expect(factorDisplayName("back_to_back_density")).toBe("Back-to-back density");
    expect(factorDisplayName("commute")).toBe("Walking pressure");
    expect(factorDisplayName("grade_volatility")).toBe("Grade volatility");
    expect(factorDisplayName("difficulty_load")).toBe("Instructor difficulty");
  });

  it("preserves unknown factors with a title-cased fallback", () => {
    expect(factorDisplayName("new_risk_signal")).toBe("New Risk Signal");
    expect(factorDisplayName("mystery")).toBe("Mystery");
  });
});

describe("numeric formatting", () => {
  it("renders the risk score as an integer", () => {
    expect(formatRiskScore(41)).toBe("41");
    expect(formatRiskScore(41.6)).toBe("42");
  });

  it("renders factor values with one decimal and GPA with two", () => {
    expect(formatOneDecimal(22)).toBe("22.0");
    expect(formatOneDecimal(12.34)).toBe("12.3");
    expect(formatTwoDecimals(3.15)).toBe("3.15");
    expect(formatTwoDecimals(2.9)).toBe("2.90");
  });
});

describe("verdictLabel", () => {
  it("states the backend verdict in text", () => {
    expect(verdictLabel("impossible")).toBe("Impossible");
    expect(verdictLabel("tight")).toBe("Tight");
    expect(verdictLabel("comfortable")).toBe("Comfortable");
  });
});

describe("confidenceLabel", () => {
  it("maps backend confidence values", () => {
    expect(confidenceLabel("high")).toBe("High confidence");
    expect(confidenceLabel("medium")).toBe("Medium confidence");
    expect(confidenceLabel("low")).toBe("Low confidence");
  });
});

describe("severityPercent", () => {
  it("scales severity against the backend maximum", () => {
    expect(severityPercent(15, 30)).toBeCloseTo(50);
    expect(severityPercent(0, 30)).toBe(0);
  });

  it("guards against a non-positive or invalid maximum", () => {
    expect(severityPercent(10, 0)).toBe(0);
    expect(severityPercent(10, Number.NaN)).toBe(0);
  });
});
