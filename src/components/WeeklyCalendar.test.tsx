import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Section } from "../api/types";
import { sectionFixture } from "../test/fixtures";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import { DEFAULT_VISIBLE_END, DEFAULT_VISIBLE_START, getEventLayout } from "../lib/time";
import WeeklyCalendar from "./WeeklyCalendar";

/** Seeds the in-memory selected-section cache the way search results would. */
function Seed({ sections }: { sections: Section[] }) {
  const { registerSections } = useSchedule();
  useEffect(() => {
    if (sections.length > 0) registerSections(sections);
  }, [sections, registerSections]);
  return null;
}

function renderCalendar(sections: Section[], initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ScheduleProvider>
        <Seed sections={sections} />
        <WeeklyCalendar />
      </ScheduleProvider>
    </MemoryRouter>,
  );
}

const weekendSection: Section = {
  ...sectionFixture,
  crn: "90010",
  course_id: "BIOL 1105",
  meetings: [{ ...sectionFixture.meetings[0]!, days: ["S"], start_min: 600, end_min: 700 }],
};

const earlyLateSection: Section = {
  ...sectionFixture,
  crn: "90011",
  course_id: "PHYS 2305",
  meetings: [{ ...sectionFixture.meetings[0]!, days: ["T"], start_min: 7 * 60, end_min: 19 * 60 }],
};

describe("WeeklyCalendar day columns", () => {
  it("defaults to Monday–Friday", () => {
    renderCalendar([sectionFixture], "/?crns=90001");

    for (const day of ["M", "T", "W", "R", "F"]) {
      expect(screen.getByTestId(`day-header-${day}`)).toBeTruthy();
    }
    expect(screen.queryByTestId("day-header-S")).toBeNull();
    expect(screen.queryByTestId("day-header-U")).toBeNull();
    expect(screen.getByTestId("calendar-grid").getAttribute("data-visible-days")).toBe("MTWRF");
  });

  it("adds weekend columns only when a cached meeting uses them", () => {
    renderCalendar([weekendSection], "/?crns=90010");

    expect(screen.getByTestId("day-header-S")).toBeTruthy();
    expect(screen.queryByTestId("day-header-U")).toBeNull();
    expect(screen.getByTestId("calendar-grid").getAttribute("data-visible-days")).toBe("MTWRFS");
  });
});

describe("WeeklyCalendar visible range", () => {
  it("uses the default 8 AM–6 PM range", () => {
    renderCalendar([sectionFixture], "/?crns=90001");

    const grid = screen.getByTestId("calendar-grid");
    expect(grid.getAttribute("data-range-start")).toBe(String(DEFAULT_VISIBLE_START));
    expect(grid.getAttribute("data-range-end")).toBe(String(DEFAULT_VISIBLE_END));
  });

  it("expands for meetings outside the default range", () => {
    renderCalendar([earlyLateSection], "/?crns=90011");

    const grid = screen.getByTestId("calendar-grid");
    expect(grid.getAttribute("data-range-start")).toBe(String(7 * 60));
    expect(grid.getAttribute("data-range-end")).toBe(String(19 * 60));
  });
});

describe("WeeklyCalendar placement", () => {
  it("renders each meeting day separately at its documented position", () => {
    renderCalendar([sectionFixture], "/?crns=90001");

    const grid = screen.getByTestId("calendar-grid");
    const buttons = Array.from(grid.querySelectorAll('[data-crn="90001"]')) as HTMLElement[];
    expect(buttons).toHaveLength(3);

    const expected = getEventLayout(610, 700, {
      startMin: DEFAULT_VISIBLE_START,
      endMin: DEFAULT_VISIBLE_END,
    });
    for (const button of buttons) {
      expect(parseFloat(button.style.top)).toBeCloseTo(expected.topPercent, 3);
      expect(parseFloat(button.style.height)).toBeCloseTo(expected.heightPercent, 3);
    }
  });
});

describe("WeeklyCalendar selected-schedule presentation", () => {
  it("shows the selected count and cached total credits", () => {
    renderCalendar([sectionFixture], "/?crns=90001");

    const summary = screen.getByTestId("schedule-summary").textContent ?? "";
    expect(summary).toContain("1 selected");
    expect(summary).toContain("3 credit");
  });

  it("lists cached meetings in chronological order", () => {
    renderCalendar([sectionFixture, weekendSection], "/?crns=90001,90010");

    const list = screen.getByRole("list", { name: /chronological order/i });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(4);

    const text = items.map((item) => item.textContent ?? "").join("|");
    expect(text.indexOf("CS 1114")).toBeLessThan(text.indexOf("BIOL 1105"));
  });

  it("removes a section from the selected list", async () => {
    renderCalendar([sectionFixture], "/?crns=90001");

    fireEvent.click(screen.getByRole("button", { name: /remove section 90001/i }));

    await waitFor(() => expect(screen.getByTestId("calendar-empty")).toBeTruthy());
  });
});

describe("WeeklyCalendar event details", () => {
  it("exposes instructor, location, and dates on keyboard focus", () => {
    renderCalendar([sectionFixture], "/?crns=90001");

    const grid = screen.getByTestId("calendar-grid");
    const button = grid.querySelector('[data-crn="90001"][data-day="M"]') as HTMLElement;
    fireEvent.focus(button);

    const details = screen.getByTestId("event-details").textContent ?? "";
    expect(details).toContain("Ada Lovelace");
    expect(details).toContain("MCB 204");
    expect(details).toContain("2026-08-24");
    expect(details).toContain("2026-12-09");
  });
});

describe("WeeklyCalendar empty and unavailable states", () => {
  it("shows a clear empty state when nothing is selected", () => {
    renderCalendar([], "/");

    expect(screen.getByTestId("calendar-empty")).toBeTruthy();
    expect(screen.queryByTestId("calendar-grid")).toBeNull();
  });

  it("reports URL-restored CRNs with no cached details as unavailable", () => {
    renderCalendar([], "/?crns=90009");

    const note = screen.getByTestId("calendar-unavailable").textContent ?? "";
    expect(note).toContain("90009");
    expect(note).toMatch(/no section-by-CRN endpoint/i);

    const summary = screen.getByTestId("schedule-summary").textContent ?? "";
    expect(summary).toContain("1 selected");
    expect(summary).toContain("0 credits");
    expect(screen.queryByTestId("calendar-grid")).toBeNull();
  });
});
