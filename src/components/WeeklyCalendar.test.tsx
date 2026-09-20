import { useEffect } from "react";
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Section } from "../api/types";
import { sectionFixture } from "../test/fixtures";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import { renderInApp } from "../test/harness";
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

describe("WeeklyCalendar summary", () => {
  it("shows the selected count and cached total credits", () => {
    renderCalendar([sectionFixture], "/?crns=90001");

    expect(screen.getByTestId("schedule-summary").textContent).toBe("1 course · 3 credits");
  });

  it("offers Download and Share but no schedule-clearing control", () => {
    renderCalendar([sectionFixture], "/?crns=90001");

    expect(screen.getByTestId("print-schedule")).toBeTruthy();
    expect(screen.getByTestId("share-schedule")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /clear/i })).toBeNull();
  });
});

describe("WeeklyCalendar opens course details in the center panel", () => {
  function eventButton(day: string) {
    return screen
      .getByTestId("calendar-grid")
      .querySelector(`[data-crn="90001"][data-day="${day}"]`) as HTMLElement;
  }

  it("shows the course in the center view when a class is clicked", () => {
    renderInApp(<WeeklyCalendar />, { route: "/?crns=90001", sections: [sectionFixture] });
    expect(screen.getByTestId("view").textContent).toBe("overview");

    fireEvent.click(eventButton("W"));

    expect(screen.getByTestId("view").textContent).toBe("course:90001");
    for (const day of ["M", "W", "F"]) {
      expect(eventButton(day).getAttribute("aria-current")).toBe("true");
    }
  });

  it("does not switch views just because a class received keyboard focus", () => {
    renderInApp(<WeeklyCalendar />, { route: "/?crns=90001", sections: [sectionFixture] });

    fireEvent.focus(eventButton("M"));

    expect(screen.getByTestId("view").textContent).toBe("overview");
  });

  it("names the action and location for assistive technology", () => {
    renderInApp(<WeeklyCalendar />, { route: "/?crns=90001", sections: [sectionFixture] });

    expect(eventButton("M").getAttribute("aria-label")).toBe(
      "CS 1114, Mon 10:10 AM–11:40 AM, MCB 204. Open details.",
    );
  });
});

describe("WeeklyCalendar empty, loading, and unavailable states", () => {
  it("shows a clear empty state when nothing is selected", () => {
    renderCalendar([], "/");

    expect(screen.getByTestId("calendar-empty")).toBeTruthy();
    expect(screen.queryByTestId("calendar-grid")).toBeNull();
  });

  it("shows a loading placeholder while selected courses are still loading", () => {
    render(
      <MemoryRouter initialEntries={["/?crns=90001"]}>
        <ScheduleProvider>
          <WeeklyCalendar hydrating />
        </ScheduleProvider>
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Loading your schedule").getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("calendar-unavailable")).toBeNull();
  });

  it("says details are unavailable, in plain words, once loading has finished", () => {
    renderCalendar([], "/?crns=90009");

    const note = screen.getByTestId("calendar-unavailable").textContent ?? "";
    expect(note).toMatch(/details for 1 selected course is unavailable/i);
    expect(note).not.toMatch(/endpoint|api|json/i);
    expect(screen.getByTestId("schedule-summary").textContent).toBe("1 course");
    expect(screen.queryByTestId("calendar-grid")).toBeNull();
  });
});
