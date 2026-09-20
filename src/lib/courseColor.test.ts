import { describe, expect, it } from "vitest";
import {
  COURSE_COLOR_COUNT,
  COURSE_COLOR_PALETTE,
  courseColorIndex,
  getCourseColor,
  hashCourseId,
} from "./courseColor";

const SAMPLE_COURSE_IDS = [
  "CS 1114",
  "MATH 2534",
  "ENGL 1105",
  "PHYS 2305",
  "CHEM 1035",
  "HIST 1115",
  "BIOL 1105",
  "ECE 1004",
  "STAT 4705",
  "COMM 1015",
];

/** WCAG relative luminance for a #rrggbb color. */
function luminance(hex: string): number {
  const channels = [0, 1, 2].map((index) => {
    const value = parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = channels as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two #rrggbb colors. */
function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("hashCourseId", () => {
  it("is deterministic for the same course ID", () => {
    expect(hashCourseId("CS 1114")).toBe(hashCourseId("CS 1114"));
    expect(hashCourseId("MATH 2534")).toBe(hashCourseId("MATH 2534"));
  });

  it("returns an unsigned 32-bit integer", () => {
    for (const id of SAMPLE_COURSE_IDS) {
      const hash = hashCourseId(id);
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(0);
      expect(hash).toBeLessThanOrEqual(0xffffffff);
    }
  });
});

describe("courseColorIndex", () => {
  it("is stable and within palette bounds", () => {
    for (const id of SAMPLE_COURSE_IDS) {
      const index = courseColorIndex(id);
      expect(index).toBe(courseColorIndex(id));
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(COURSE_COLOR_COUNT);
    }
  });

  it("spreads the sample catalog across several palette slots", () => {
    const used = new Set(SAMPLE_COURSE_IDS.map(courseColorIndex));
    expect(used.size).toBeGreaterThanOrEqual(4);
  });
});

describe("getCourseColor", () => {
  it("returns the same color object for a repeated course ID", () => {
    expect(getCourseColor("CS 1114")).toEqual(getCourseColor("CS 1114"));
  });

  it("maps every course ID to a real palette entry", () => {
    for (const id of SAMPLE_COURSE_IDS) {
      expect(COURSE_COLOR_PALETTE).toContainEqual(getCourseColor(id));
    }
  });

  it("exposes no risk semantics on a course color", () => {
    const color = getCourseColor("CS 1114");
    expect(Object.keys(color).sort()).toEqual(["background", "border", "index", "text"]);
  });
});

describe("course color accessibility", () => {
  it("meets WCAG 2.1 AA text contrast (>= 4.5:1) for every palette entry", () => {
    for (const color of COURSE_COLOR_PALETTE) {
      expect(contrastRatio(color.text, color.background)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("gives every palette entry a border distinguishable from its background", () => {
    for (const color of COURSE_COLOR_PALETTE) {
      expect(contrastRatio(color.border, color.background)).toBeGreaterThan(1.2);
    }
  });
});
