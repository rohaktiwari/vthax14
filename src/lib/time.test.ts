import { describe, expect, it } from "vitest";
import {
  DEFAULT_VISIBLE_END,
  DEFAULT_VISIBLE_START,
  GRID_STEP_MIN,
  buildTimeSlots,
  formatDays,
  formatMinutes,
  formatTimeLabel,
  formatWeekdayShort,
  getEventLayout,
  getVisibleDays,
  getVisibleRange,
  snapDownToStep,
  snapToStep,
  snapUpToStep,
  type MeetingTime,
} from "./time";

function meeting(start: number, end: number, days: MeetingTime["days"]): MeetingTime {
  return { days, start_min: start, end_min: end };
}

describe("formatMinutes", () => {
  it("formats minutes from midnight as 12-hour time", () => {
    expect(formatMinutes(0)).toBe("12:00 AM");
    expect(formatMinutes(610)).toBe("10:10 AM");
    expect(formatMinutes(700)).toBe("11:40 AM");
    expect(formatMinutes(720)).toBe("12:00 PM");
    expect(formatMinutes(13 * 60 + 5)).toBe("1:05 PM");
    expect(formatMinutes(23 * 60 + 59)).toBe("11:59 PM");
  });
});

describe("formatDays", () => {
  it("joins weekday initials in order", () => {
    expect(formatDays(["M", "W", "F"])).toBe("MWF");
    expect(formatDays(["T", "R"])).toBe("TR");
  });
});

describe("grid snapping", () => {
  it("floors to the previous grid boundary", () => {
    expect(snapDownToStep(610)).toBe(600);
    expect(snapDownToStep(600)).toBe(600);
    expect(snapDownToStep(599)).toBe(570);
  });

  it("ceils to the next grid boundary", () => {
    expect(snapUpToStep(610)).toBe(630);
    expect(snapUpToStep(600)).toBe(600);
    expect(snapUpToStep(601)).toBe(630);
  });

  it("rounds to the nearest grid boundary", () => {
    expect(snapToStep(605)).toBe(600);
    expect(snapToStep(615)).toBe(630);
  });
});

describe("getVisibleRange", () => {
  it("keeps the default Monday–Friday 8:00 AM–6:00 PM window", () => {
    const range = getVisibleRange([meeting(610, 700, ["M", "W", "F"])]);
    expect(range).toEqual({
      startMin: DEFAULT_VISIBLE_START,
      endMin: DEFAULT_VISIBLE_END,
      includesWeekend: false,
    });
  });

  it("expands earlier and later for out-of-range meetings", () => {
    const range = getVisibleRange([meeting(7 * 60 + 5, 19 * 60 + 50, ["T"])]);
    expect(range.startMin).toBe(7 * 60);
    expect(range.endMin).toBe(20 * 60);
  });

  it("never shrinks below the default window", () => {
    const range = getVisibleRange([meeting(10 * 60, 11 * 60, ["R"])]);
    expect(range.startMin).toBe(DEFAULT_VISIBLE_START);
    expect(range.endMin).toBe(DEFAULT_VISIBLE_END);
  });

  it("flags weekends", () => {
    expect(getVisibleRange([meeting(600, 700, ["S"])]).includesWeekend).toBe(true);
    expect(getVisibleRange([meeting(600, 700, ["U"])]).includesWeekend).toBe(true);
    expect(getVisibleRange([meeting(600, 700, ["F"])]).includesWeekend).toBe(false);
  });
});

describe("getVisibleDays", () => {
  it("defaults to Monday–Friday", () => {
    expect(getVisibleDays([meeting(600, 700, ["M", "W"])])).toEqual(["M", "T", "W", "R", "F"]);
  });

  it("appends weekend columns only when needed", () => {
    expect(getVisibleDays([meeting(600, 700, ["M", "S"])])).toEqual([
      "M",
      "T",
      "W",
      "R",
      "F",
      "S",
    ]);
    expect(getVisibleDays([meeting(600, 700, ["U"])])).toEqual([
      "M",
      "T",
      "W",
      "R",
      "F",
      "U",
    ]);
  });
});

describe("buildTimeSlots", () => {
  it("builds 30-minute slots across the visible range", () => {
    const slots = buildTimeSlots(DEFAULT_VISIBLE_START, DEFAULT_VISIBLE_END);
    expect(slots[0]).toBe(DEFAULT_VISIBLE_START);
    expect(slots[slots.length - 1]).toBe(DEFAULT_VISIBLE_END - GRID_STEP_MIN);
    expect(slots).toHaveLength((DEFAULT_VISIBLE_END - DEFAULT_VISIBLE_START) / GRID_STEP_MIN);
  });

  it("snaps partial ranges outward to the grid", () => {
    expect(buildTimeSlots(7 * 60 + 5, 19 * 60 + 50)).toEqual(
      buildTimeSlots(7 * 60, 20 * 60),
    );
  });
});

describe("formatWeekdayShort and formatTimeLabel", () => {
  it("expands weekday initials for accessibility", () => {
    expect(formatWeekdayShort("R")).toBe("Thu");
    expect(formatWeekdayShort("U")).toBe("Sun");
  });

  it("omits minutes on the hour and includes them otherwise", () => {
    expect(formatTimeLabel(8 * 60)).toBe("8 AM");
    expect(formatTimeLabel(12 * 60)).toBe("12 PM");
    expect(formatTimeLabel(13 * 60 + 30)).toBe("1:30 PM");
  });
});

describe("getEventLayout", () => {
  const range = { startMin: DEFAULT_VISIBLE_START, endMin: DEFAULT_VISIBLE_END };

  it("positions a meeting from its documented start and end minutes", () => {
    const layout = getEventLayout(610, 700, range);
    // Range is 480–1080 (600 minutes). 610 is 130 minutes in; 90 minutes tall.
    expect(layout.topPercent).toBeCloseTo((130 / 600) * 100, 5);
    expect(layout.heightPercent).toBeCloseTo((90 / 600) * 100, 5);
  });

  it("places an event at the very top when it starts at the range start", () => {
    const layout = getEventLayout(DEFAULT_VISIBLE_START, DEFAULT_VISIBLE_START + 60, range);
    expect(layout.topPercent).toBe(0);
    expect(layout.heightPercent).toBeCloseTo(10, 5);
  });

  it("tracks an expanded visible range", () => {
    const expanded = { startMin: 7 * 60, endMin: 20 * 60 };
    const layout = getEventLayout(7 * 60, 8 * 60, expanded);
    expect(layout.topPercent).toBe(0);
    expect(layout.heightPercent).toBeCloseTo((60 / (13 * 60)) * 100, 5);
  });

  it("clamps values to the visible range", () => {
    const layout = getEventLayout(0, 24 * 60, range);
    expect(layout.topPercent).toBe(0);
    expect(layout.heightPercent).toBe(100);
  });
});
