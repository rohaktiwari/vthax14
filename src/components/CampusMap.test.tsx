import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { AnalyzeResponse, Section } from "../api/types";
import { server } from "../test/msw/server";
import { analyzeFixture, sectionFixture } from "../test/fixtures";
import { MapSelectionProvider } from "../context/MapSelectionContext";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import CampusMap from "./CampusMap";
import WeeklyCalendar from "./WeeklyCalendar";

function makeSection(
  crn: string,
  courseId: string,
  building: string,
  startMin: number,
  endMin: number,
): Section {
  return {
    ...sectionFixture,
    crn,
    course_id: courseId,
    meetings: [
      {
        ...sectionFixture.meetings[0]!,
        days: ["M"],
        building,
        start_min: startMin,
        end_min: endMin,
      },
    ],
  };
}

const alpha = makeSection("90001", "CS 3114", "MCB", 600, 650);
const beta = makeSection("90002", "CS 2505", "WHI", 700, 750);
const gamma = makeSection("90003", "PHYS 2305", "DUR", 800, 850);

const WARNING_DETAIL =
  "MCB -> WHI is a 12-minute walk; the schedule provides 8 minutes.";

const analyzeWithWarning: AnalyzeResponse = {
  ...analyzeFixture,
  commute_warnings: [
    {
      day: "M",
      from: { crn: "90001", building: "MCB", ends: "10:50" },
      to: { crn: "90002", building: "WHI", starts: "11:40" },
      walk_min: 12,
      adjusted_walk_min: 10,
      gap_min: 8,
      verdict: "tight",
      source: "manual_override",
      detail: WARNING_DETAIL,
    },
  ],
};

const validMatrix = {
  buildings: {
    MCB: { name: "McBryde Hall", place_id: null, lat: 37.2295, lng: -80.421, address: null, verified: true, source: "manual_fix", fetched_at: null },
    WHI: { name: "Whittemore Hall", place_id: null, lat: 37.225, lng: -80.415, address: null, verified: true, source: "manual_fix", fetched_at: null },
    DUR: { name: "Durham Hall", place_id: null, lat: 37.228, lng: -80.418, address: null, verified: true, source: "manual_fix", fetched_at: null },
  },
  walk: { "MCB|WHI": 12, "DUR|WHI": 7 },
};

function mockMatrix(matrix: Record<string, unknown>, status = 200) {
  server.use(
    http.get(`${API_BASE_URL}/buildings/matrix`, () => HttpResponse.json(matrix, { status })),
  );
}

function mockAnalyze(response: AnalyzeResponse) {
  server.use(http.post(`${API_BASE_URL}/analyze`, () => HttpResponse.json(response)));
}

function Seed({ sections }: { sections: Section[] }) {
  const { registerSections } = useSchedule();
  useEffect(() => {
    registerSections(sections);
  }, [registerSections, sections]);
  return null;
}

function renderMap(
  sections: Section[],
  initialEntry: string,
  options: { withCalendar?: boolean } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <MapSelectionProvider>
            <Seed sections={sections} />
            <CampusMap />
            {options.withCalendar ? <WeeklyCalendar /> : null}
          </MapSelectionProvider>
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CampusMap", () => {
  it("places building markers and draws each walk as a chip with its minutes and verdict", async () => {
    mockMatrix(validMatrix);
    mockAnalyze(analyzeWithWarning);
    renderMap([alpha, beta, gamma], "/?crns=90001,90002,90003");

    expect(await screen.findByRole("button", { name: /McBryde Hall \(MCB\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Whittemore Hall \(WHI\)/ })).toBeTruthy();

    // Backend verdict and committed matrix minutes appear on the map, unchanged.
    const tight = await screen.findByRole("button", { name: /CS 3114 to CS 2505: 12 minute walk, tight/ });
    expect(tight.textContent).toBe("12 min · Tight");
    expect(tight.getAttribute("data-verdict")).toBe("tight");

    // A walk with no backend warning is drawn as an ordinary walk.
    const plain = screen.getByRole("button", { name: /CS 2505 to PHYS 2305: 7 minute walk, no warning/ });
    expect(plain.textContent).toBe("7 min");
    expect(plain.getAttribute("data-verdict")).toBe("none");
  });

  it("keeps a textual equivalent of every walk, collapsed by default", async () => {
    mockMatrix(validMatrix);
    mockAnalyze(analyzeWithWarning);
    renderMap([alpha, beta, gamma], "/?crns=90001,90002,90003");

    await screen.findByRole("button", { name: /CS 3114 to CS 2505/ });
    const list = screen.getByTestId("transition-list") as HTMLDetailsElement;
    expect(list.open).toBe(false);
    expect(within(list).getByText(/CS 3114 \(MCB\) → CS 2505 \(WHI\)/)).toBeTruthy();
    expect(within(list).getByText(/12 min walk · Tight/)).toBeTruthy();
    expect(within(list).getByText(/7 min walk · no warning/)).toBeTruthy();
  });

  it("opens the backend's warning sentence when a walk chip is clicked", async () => {
    mockMatrix(validMatrix);
    mockAnalyze(analyzeWithWarning);
    renderMap([alpha, beta], "/?crns=90001,90002");

    fireEvent.click(await screen.findByRole("button", { name: /CS 3114 to CS 2505/ }));

    const details = await screen.findByTestId("transition-details");
    expect(details.textContent).toContain("CS 3114 → CS 2505");
    expect(details.textContent).toContain("Tight");
    expect(details.textContent).toContain(WARNING_DETAIL);

    fireEvent.click(screen.getByRole("button", { name: /CS 3114 to CS 2505/ }));
    await waitFor(() => expect(screen.queryByTestId("transition-details")).toBeNull());
  });

  it("only offers weekdays that have a walk, and switches the chips when one is chosen", async () => {
    const tuesdayA = makeSection("90004", "MATH 2534", "MCB", 600, 650);
    const tuesdayB = makeSection("90005", "PHYS 2305", "DUR", 700, 750);
    for (const section of [tuesdayA, tuesdayB]) {
      section.meetings[0]!.days = ["T"];
    }
    mockMatrix(validMatrix);
    mockAnalyze(analyzeFixture);
    renderMap([alpha, beta, tuesdayA, tuesdayB], "/?crns=90001,90002,90004,90005");

    const group = await screen.findByRole("group", { name: "Choose a weekday" });
    expect(within(group).getAllByRole("button").map((button) => button.textContent)).toEqual(["Mon", "Tue"]);
    expect(await screen.findByRole("button", { name: /CS 3114 to CS 2505/ })).toBeTruthy();

    fireEvent.click(within(group).getByRole("button", { name: "Tue" }));
    expect(await screen.findByRole("button", { name: /MATH 2534 to PHYS 2305/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /CS 3114 to CS 2505/ })).toBeNull();
  });

  it("falls back to the textual list when no coordinates are available", async () => {
    mockMatrix({ buildings: {}, walk: {} });
    mockAnalyze(analyzeFixture);
    renderMap([alpha, beta], "/?crns=90001,90002");

    expect(await screen.findByText(/No usable coordinates for the selected buildings/)).toBeTruthy();
    expect(screen.getByTestId("transition-list")).toBeTruthy();
    expect(screen.getAllByText(/walk time unavailable/i).length).toBeGreaterThan(0);
  });

  it("keeps the textual list usable and words the failure plainly when the building matrix fails", async () => {
    mockMatrix({ detail: "boom" }, 500);
    mockAnalyze(analyzeFixture);
    renderMap([alpha, beta], "/?crns=90001,90002");

    expect(await screen.findByText("Building locations unavailable")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).not.toMatch(/[{}]|status 500/);
    const list = screen.getByTestId("transition-list");
    expect(within(list).getByText(/CS 3114 \(MCB\) → CS 2505 \(WHI\)/)).toBeTruthy();
  });

  it("asks for one more course when there is a single section", async () => {
    mockMatrix(validMatrix);
    renderMap([alpha], "/?crns=90001");

    expect(await screen.findByText("Add one more course to see walking times.")).toBeTruthy();
    expect(screen.getByTestId("transition-none")).toBeTruthy();
    expect(screen.queryByTestId("walk-chip")).toBeNull();
  });

  it("explains an empty selection", () => {
    renderMap([], "/");
    expect(screen.getByTestId("map-empty").textContent).toMatch(/add courses/i);
  });

  it("reports URL-restored CRNs whose details are unavailable", async () => {
    mockMatrix(validMatrix);
    renderMap([], "/?crns=90001");

    expect(await screen.findByTestId("map-unavailable")).toBeTruthy();
  });

  it("highlights matching calendar events when a marker is clicked", async () => {
    mockMatrix(validMatrix);
    mockAnalyze(analyzeWithWarning);
    renderMap([alpha, beta], "/?crns=90001,90002", { withCalendar: true });

    const marker = await screen.findByRole("button", { name: /McBryde Hall \(MCB\)/ });
    fireEvent.click(marker);

    await waitFor(() =>
      expect(document.querySelector('[data-crn="90001"][data-map-highlight="true"]')).toBeTruthy(),
    );
    expect(document.querySelector('[data-crn="90002"][data-map-highlight="true"]')).toBeNull();
  });
});
