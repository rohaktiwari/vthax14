import { describe, expect, it } from "vitest";
import type { CourseGroup, Section } from "../api/types";
import { collectSubjects, filterCourses, inferCourseLevel } from "./courses";

function makeSection(crn: string, courseNo: string, available: number): Section {
  return {
    crn,
    term_id: "2026-fall",
    course_id: `CS ${courseNo}`,
    subject: "CS",
    course_no: courseNo,
    title: "Test Course",
    credits: 3,
    instructor_names: ["Ada Lovelace"],
    schedule_type: "Lecture",
    modality: "f2f",
    grade_mode: "standard",
    campus: "Blacksburg",
    seats: { max: 100, available },
    meetings: [],
    meta: { source: "banner_class_search", verified: true, confidence: "low", fetched_at: null },
  };
}

const openGroup: CourseGroup = {
  course_id: "CS 1114",
  title: "Intro",
  credits: 3,
  sections: [makeSection("90001", "1114", 12), makeSection("90002", "1114", 0)],
};

const closedGroup: CourseGroup = {
  course_id: "MATH 2534",
  title: "Discrete",
  credits: 3,
  sections: [makeSection("90003", "2534", 0)],
};

describe("inferCourseLevel", () => {
  it("maps the first digit to a display level", () => {
    expect(inferCourseLevel("1114")).toBe(1000);
    expect(inferCourseLevel("2534")).toBe(2000);
    expect(inferCourseLevel("3114")).toBe(3000);
    expect(inferCourseLevel("4994")).toBe(4000);
    expect(inferCourseLevel("5974")).toBe(5000);
  });

  it("returns null when no leading digit exists", () => {
    expect(inferCourseLevel("")).toBeNull();
    expect(inferCourseLevel("abcd")).toBeNull();
    expect(inferCourseLevel("0114")).toBeNull();
  });
});

describe("filterCourses", () => {
  it("keeps only open sections and drops empty groups", () => {
    const result = filterCourses([openGroup, closedGroup], { level: null, openOnly: true });
    expect(result).toHaveLength(1);
    expect(result[0]?.course_id).toBe("CS 1114");
    expect(result[0]?.sections.map((section) => section.crn)).toEqual(["90001"]);
  });

  it("filters by inferred course level", () => {
    const result = filterCourses([openGroup, closedGroup], { level: 2000, openOnly: false });
    expect(result.map((group) => group.course_id)).toEqual(["MATH 2534"]);
  });

  it("returns everything when no filters are set", () => {
    const result = filterCourses([openGroup, closedGroup], { level: null, openOnly: false });
    expect(result).toHaveLength(2);
    expect(result[0]?.sections).toHaveLength(2);
  });
});

describe("collectSubjects", () => {
  it("returns sorted unique subjects", () => {
    expect(collectSubjects([openGroup, closedGroup])).toEqual(["CS"]);
  });
});
