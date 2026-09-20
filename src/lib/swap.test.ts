import { describe, expect, it } from "vitest";
import type { Section } from "../api/types";
import { sectionFixture } from "../test/fixtures";
import {
  describeDelta,
  findAlternativeSections,
  replaceCrnAtSameIndex,
} from "./swap";

function section(crn: string, courseId: string): Section {
  return { ...sectionFixture, crn, course_id: courseId, course_no: courseId.split(" ")[1] ?? "0000" };
}

describe("replaceCrnAtSameIndex", () => {
  it("replaces the dropped CRN at its exact index", () => {
    expect(replaceCrnAtSameIndex(["a", "b", "c"], "b", "x")).toEqual(["a", "x", "c"]);
  });

  it("is a no-op for CRNs that are not present", () => {
    expect(replaceCrnAtSameIndex(["a", "b"], "z", "x")).toEqual(["a", "b"]);
  });
});

describe("describeDelta", () => {
  it("states a negative delta as a decrease", () => {
    const description = describeDelta(-16, 74, 58);
    expect(description.direction).toBe("decrease");
    expect(description.text).toBe("Risk decreases by 16 points (74 → 58).");
  });

  it("states a zero delta as no change", () => {
    const description = describeDelta(0, 50, 50);
    expect(description.direction).toBe("none");
    expect(description.text).toBe("No risk score change (50 → 50).");
  });

  it("states a positive delta as an increase", () => {
    const description = describeDelta(5, 40, 45);
    expect(description.direction).toBe("increase");
    expect(description.text).toBe("Risk increases by 5 points (40 → 45).");
  });

  it("pluralizes a single point", () => {
    expect(describeDelta(-1, 41, 40).text).toBe("Risk decreases by 1 point (41 → 40).");
  });
});

describe("findAlternativeSections", () => {
  const available = [
    section("1", "CS 1114"),
    section("2", "CS 1114"),
    section("3", "MATH 2534"),
    section("4", "CS 1114"),
  ];

  it("prefers same-course alternatives and excludes selected CRNs", () => {
    const result = findAlternativeSections(available, {
      dropCrn: "1",
      selectedCrns: ["1", "3"],
    });
    expect(result.map((item) => item.crn)).toEqual(["2", "4"]);
  });

  it("keeps the preferred add CRN out of the generic list but never drops it silently", () => {
    const result = findAlternativeSections(available, {
      dropCrn: "1",
      selectedCrns: ["1"],
      preferredAddCrn: "2",
    });
    expect(result.map((item) => item.crn)).toEqual(["4"]);
  });

  it("falls back to all cached sections when the drop section is unavailable", () => {
    const result = findAlternativeSections(available, {
      dropCrn: "999",
      selectedCrns: ["3"],
    });
    expect(result.map((item) => item.crn)).toEqual(["1", "2", "4"]);
  });
});
