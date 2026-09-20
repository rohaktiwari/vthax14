import { describe, expect, it } from "vitest";
import { isValidCoordinate, projectCoordinates, walkMinutesFor } from "./mapProjection";

describe("isValidCoordinate", () => {
  it("accepts finite in-range coordinates", () => {
    expect(isValidCoordinate(37.2295, -80.421)).toBe(true);
  });

  it("rejects missing and out-of-range coordinates", () => {
    expect(isValidCoordinate(null, -80.4)).toBe(false);
    expect(isValidCoordinate(undefined, undefined)).toBe(false);
    expect(isValidCoordinate(Number.NaN, -80.4)).toBe(false);
    expect(isValidCoordinate(120, -80.4)).toBe(false);
    expect(isValidCoordinate(37.2, 200)).toBe(false);
  });
});

describe("projectCoordinates", () => {
  it("projects supplied coordinates into 0–100 percentages", () => {
    const { markers, unplaced } = projectCoordinates([
      { code: "MCB", name: "McBryde Hall", lat: 37.23, lng: -80.42 },
      { code: "WHI", name: "Whittemore Hall", lat: 37.22, lng: -80.41 },
    ]);

    expect(unplaced).toEqual([]);
    expect(markers).toHaveLength(2);
    for (const marker of markers) {
      expect(marker.xPercent).toBeGreaterThanOrEqual(0);
      expect(marker.xPercent).toBeLessThanOrEqual(100);
      expect(marker.yPercent).toBeGreaterThanOrEqual(0);
      expect(marker.yPercent).toBeLessThanOrEqual(100);
    }
    // Higher latitude (north) renders higher on screen.
    const mcb = markers.find((marker) => marker.code === "MCB")!;
    const whi = markers.find((marker) => marker.code === "WHI")!;
    expect(mcb.yPercent).toBeLessThan(whi.yPercent);
  });

  it("centers a single building rather than stretching a degenerate range", () => {
    const { markers } = projectCoordinates([
      { code: "MCB", name: "McBryde Hall", lat: 37.23, lng: -80.42 },
    ]);
    expect(markers).toEqual([
      { code: "MCB", name: "McBryde Hall", xPercent: 50, yPercent: 50 },
    ]);
  });

  it("reports buildings without usable coordinates instead of fabricating them", () => {
    const { markers, unplaced } = projectCoordinates([
      { code: "MCB", name: "McBryde Hall", lat: 37.23, lng: -80.42 },
      { code: "TBA", name: "Online", lat: null, lng: null },
    ]);
    expect(markers.map((marker) => marker.code)).toEqual(["MCB"]);
    expect(unplaced).toEqual(["TBA"]);
  });

  it("returns no markers when every coordinate is unusable", () => {
    const { markers, unplaced } = projectCoordinates([
      { code: "X", name: "X", lat: Number.NaN, lng: 1 },
    ]);
    expect(markers).toEqual([]);
    expect(unplaced).toEqual(["X"]);
  });
});

describe("walkMinutesFor", () => {
  const walk = { "MCB|WHI": 18, "DUR|MCB": { minutes: 9, meters: 700, source: "manual_override" as const } };

  it("looks up committed minutes regardless of pair order", () => {
    expect(walkMinutesFor(walk, "MCB", "WHI")).toBe(18);
    expect(walkMinutesFor(walk, "WHI", "MCB")).toBe(18);
    expect(walkMinutesFor(walk, "DUR", "MCB")).toBe(9);
  });

  it("returns null for unknown pairs and missing data", () => {
    expect(walkMinutesFor(walk, "MCB", "UNKNOWN")).toBeNull();
    expect(walkMinutesFor(walk, "MCB", "MCB")).toBeNull();
    expect(walkMinutesFor(undefined, "MCB", "WHI")).toBeNull();
  });
});
