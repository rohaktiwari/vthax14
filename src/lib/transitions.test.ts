import { describe, expect, it } from "vitest";
import type { Section } from "../api/types";
import { sectionFixture } from "../test/fixtures";
import { buildDayTransitions, transitionDays, warningKey } from "./transitions";

function withMeetings(
  crn: string,
  courseId: string,
  meetings: Section["meetings"],
): Section {
  return { ...sectionFixture, crn, course_id: courseId, meetings };
}

const mwf = (building: string, start: number, end: number): Section["meetings"][number] => ({
  ...sectionFixture.meetings[0]!,
  days: ["M"],
  building,
  start_min: start,
  end_min: end,
});

describe("transitionDays", () => {
  it("returns in-person days in Monday-first order", () => {
    const sections = [
      withMeetings("1", "CS 1114", [{ ...mwf("MCB", 600, 650), days: ["R"] }]),
      withMeetings("2", "MATH 2534", [mwf("WHI", 700, 750)]),
    ];
    expect(transitionDays(sections)).toEqual(["M", "R"]);
  });

  it("ignores meetings without a building", () => {
    const sections = [
      withMeetings("1", "CS 1114", [{ ...mwf("MCB", 600, 650), building: null, days: ["T"] }]),
    ];
    expect(transitionDays(sections)).toEqual([]);
  });
});

describe("buildDayTransitions", () => {
  it("orders stops chronologically and pairs adjacent stops", () => {
    const sections = [
      withMeetings("2", "MATH 2534", [mwf("WHI", 700, 750)]),
      withMeetings("1", "CS 1114", [mwf("MCB", 600, 650)]),
      withMeetings("3", "PHYS 2305", [mwf("DUR", 800, 850)]),
    ];

    const transitions = buildDayTransitions(sections, "M");
    expect(transitions.map((transition) => [transition.from.crn, transition.to.crn])).toEqual([
      ["1", "2"],
      ["2", "3"],
    ]);
    expect(transitions[0]?.from.building).toBe("MCB");
    expect(transitions[0]?.to.building).toBe("WHI");
  });

  it("returns no transitions for a single stop", () => {
    const sections = [withMeetings("1", "CS 1114", [mwf("MCB", 600, 650)])];
    expect(buildDayTransitions(sections, "M")).toEqual([]);
  });

  it("keeps only stops scheduled on the requested day", () => {
    const sections = [
      withMeetings("1", "CS 1114", [{ ...mwf("MCB", 600, 650), days: ["T"] }]),
      withMeetings("2", "MATH 2534", [mwf("WHI", 700, 750)]),
    ];
    expect(buildDayTransitions(sections, "M")).toEqual([]);
    expect(buildDayTransitions(sections, "T")).toEqual([]);
  });
});

describe("warningKey", () => {
  it("builds a stable day/crn/crn identity", () => {
    expect(warningKey("M", "1", "2")).toBe("M|1|2");
  });
});
