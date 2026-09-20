import { describe, expect, it } from "vitest";
import { MAX_CRNS, addCrn, parseCrnParam, removeCrn, serializeCrns, sumCredits } from "./schedule";

describe("parseCrnParam", () => {
  it("returns an empty list for missing or blank values", () => {
    expect(parseCrnParam(null)).toEqual([]);
    expect(parseCrnParam(undefined)).toEqual([]);
    expect(parseCrnParam("")).toEqual([]);
    expect(parseCrnParam(" , , ")).toEqual([]);
  });

  it("trims entries and drops blanks", () => {
    expect(parseCrnParam(" 90001 , , 90002 ")).toEqual(["90001", "90002"]);
  });

  it("de-duplicates while preserving first-occurrence order", () => {
    expect(parseCrnParam("90003,90001,90003,90002,90001")).toEqual([
      "90003",
      "90001",
      "90002",
    ]);
  });

  it("caps the list at the backend maximum of 12", () => {
    const raw = Array.from({ length: 20 }, (_, index) => `9${String(index).padStart(4, "0")}`).join(
      ",",
    );
    const parsed = parseCrnParam(raw);
    expect(parsed).toHaveLength(MAX_CRNS);
    expect(parsed[0]).toBe("90000");
    expect(parsed[MAX_CRNS - 1]).toBe("90011");
  });
});

describe("serializeCrns", () => {
  it("joins in order", () => {
    expect(serializeCrns(["90002", "90001"])).toBe("90002,90001");
    expect(serializeCrns([])).toBe("");
  });
});

describe("addCrn", () => {
  it("appends in order", () => {
    expect(addCrn(["90001"], "90002")).toEqual(["90001", "90002"]);
  });

  it("ignores blanks and duplicates", () => {
    expect(addCrn(["90001"], "  ")).toEqual(["90001"]);
    expect(addCrn(["90001", "90002"], "90001")).toEqual(["90001", "90002"]);
  });

  it("refuses to exceed the maximum", () => {
    const full = Array.from({ length: MAX_CRNS }, (_, index) => String(index));
    expect(addCrn(full, "extra")).toHaveLength(MAX_CRNS);
    expect(addCrn(full, "extra")).toBe(full);
  });
});

describe("removeCrn", () => {
  it("removes a CRN and preserves order", () => {
    expect(removeCrn(["90001", "90002", "90003"], "90002")).toEqual(["90001", "90003"]);
  });

  it("is a no-op for an unselected CRN", () => {
    expect(removeCrn(["90001"], "90099")).toEqual(["90001"]);
  });
});

describe("sumCredits", () => {
  it("sums cached section credits", () => {
    expect(sumCredits([{ credits: 3 }, { credits: 4 }, { credits: 1.5 }])).toBe(8.5);
  });

  it("returns 0 for an empty selection", () => {
    expect(sumCredits([])).toBe(0);
  });

  it("ignores non-finite credits instead of fabricating a value", () => {
    expect(sumCredits([{ credits: 3 }, { credits: Number.NaN }])).toBe(3);
  });
});
