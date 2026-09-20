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
  it("places markers for valid coordinates and lists transitions textually", async () => {
    mockMatrix(validMatrix);
    mockAnalyze(analyzeWithWarning);
    renderMap([alpha, beta, gamma], "/?crns=90001,90002,90003");

    expect(await screen.findByRole("button", { name: /McBryde Hall \(MCB\)/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Whittemore Hall \(WHI\)/ })).toBeTruthy();

    const list = screen.getByTestId("transition-list");
    expect(within(list).getByRole("button", { name: /CS 3114.*CS 2505/ })).toBeTruthy();
    expect(within(list).getByRole("button", { name: /CS 2505.*PHYS 2305/ })).toBeTruthy();
    // Backend verdict and committed matrix minutes are shown unchanged.
    expect(within(list).getByText("Tight")).toBeTruthy();
    expect(within(list).getByText(/Committed matrix walk: 12 min/)).toBeTruthy();
  });

  it("opens backend warning details from a transition", async () => {
    mockMatrix(validMatrix);
    mockAnalyze(analyzeWithWarning);
    renderMap([alpha, beta], "/?crns=90001,90002");

    const list = screen.getByTestId("transition-list");
    const transition = await within(list).findByRole("button", { name: /CS 3114.*CS 2505/ });
    fireEvent.click(transition);

    const details = await screen.findByTestId("transition-details");
    expect(details.textContent).toContain("Walk 12 min");
    expect(details.textContent).toContain("adjusted 10 min");
    expect(details.textContent).toContain("available gap 8 min");
    expect(details.textContent).toContain(WARNING_DETAIL);
  });

  it("falls back to the textual list when no coordinates are available", async () => {
    mockMatrix({ buildings: {}, walk: {} });
    mockAnalyze(analyzeFixture);
    renderMap([alpha, beta], "/?crns=90001,90002");

    expect(
      await screen.findByText(/No usable coordinates for the selected buildings/),
    ).toBeTruthy();
    expect(screen.getByTestId("transition-list")).toBeTruthy();
    expect(screen.getAllByText(/Walk time unavailable/).length).toBeGreaterThan(0);
  });

  it("keeps the textual list usable when the building matrix request fails", async () => {
    mockMatrix({ detail: "boom" }, 500);
    mockAnalyze(analyzeFixture);
    renderMap([alpha, beta], "/?crns=90001,90002");

    expect(await screen.findByText("Building data unavailable")).toBeTruthy();
    const list = screen.getByTestId("transition-list");
    expect(within(list).getByRole("button", { name: /CS 3114.*CS 2505/ })).toBeTruthy();
  });

  it("shows the add-a-section prompt for a single section", async () => {
    mockMatrix(validMatrix);
    renderMap([alpha], "/?crns=90001");

    expect(
      await screen.findByText("Add at least one more section to see walking transitions."),
    ).toBeTruthy();
    expect(screen.getByTestId("transition-none")).toBeTruthy();
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
