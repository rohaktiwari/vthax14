import { describe, expect, it } from "vitest";
import { instructorSurname, isPlaceholderInstructor } from "./instructors";

describe("isPlaceholderInstructor", () => {
  it("flags blank, TBA, and staff", () => {
    expect(isPlaceholderInstructor("")).toBe(true);
    expect(isPlaceholderInstructor("TBA")).toBe(true);
    expect(isPlaceholderInstructor("T.B.A.")).toBe(true);
    expect(isPlaceholderInstructor("Staff")).toBe(true);
  });

  it("does not flag real names", () => {
    expect(isPlaceholderInstructor("Ada Lovelace")).toBe(false);
  });
});

describe("instructorSurname", () => {
  it("uses the last token of a full display name", () => {
    expect(instructorSurname("Ada Lovelace")).toBe("Lovelace");
    expect(instructorSurname("Grace Brewster Hopper")).toBe("Hopper");
  });

  it("accepts a single-token surname", () => {
    expect(instructorSurname("Lovelace")).toBe("Lovelace");
  });

  it("normalizes surrounding and repeated whitespace", () => {
    expect(instructorSurname("  Ada   Lovelace  ")).toBe("Lovelace");
  });

  it("returns null for placeholders and implausible tokens", () => {
    expect(instructorSurname("")).toBeNull();
    expect(instructorSurname("TBA")).toBeNull();
    expect(instructorSurname("Ada 1")).toBeNull();
  });
});
