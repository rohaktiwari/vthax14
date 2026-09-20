import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { AnalyzeResponse, Section } from "../api/types";
import { server } from "../test/msw/server";
import { analyzeFixture, sectionFixture } from "../test/fixtures";
import PlannerPage from "./PlannerPage";

const meeting = sectionFixture.meetings[0]!;
const cs: Section = { ...sectionFixture, crn: "90001", course_id: "CS 3114", title: "Data Structures" };
const math: Section = {
  ...sectionFixture,
  crn: "90003",
  course_id: "MATH 2534",
  title: "Discrete Mathematics",
  meetings: [{ ...meeting, building: "WHI", room: "230", start_min: 710, end_min: 760 }],
};
const analysis: AnalyzeResponse = { ...analyzeFixture, sections: [cs, math] };

function renderPage(route: string) {
  server.use(
    http.get(`${API_BASE_URL}/courses/search`, () =>
      HttpResponse.json({
        courses: [
          { course_id: "CS 3114", title: "Data Structures", credits: 3, sections: [cs] },
          { course_id: "MATH 2534", title: "Discrete Mathematics", credits: 3, sections: [math] },
        ],
      }),
    ),
    http.post(`${API_BASE_URL}/analyze`, () => HttpResponse.json(analysis)),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <PlannerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PlannerPage (desktop workspace)", () => {
  it("has Your Courses, one center panel, the map, and the calendar, and no header search", async () => {
    renderPage("/?crns=90001,90003");

    expect(await screen.findByRole("region", { name: "Your Courses" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Campus map" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Weekly schedule" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Schedule overview" })).toBeTruthy();

    // The app header is the first banner; panel headers inside sections also match this role.
    const header = screen.getAllByRole("banner")[0]!;
    expect(within(header).getByRole("button", { name: "Open Ask Gemini" })).toBeTruthy();
    expect(within(header).queryByRole("button", { name: /search/i })).toBeNull();
    expect(within(header).queryByRole("searchbox")).toBeNull();
    expect(screen.queryByText("Search & Plan")).toBeNull();
  });

  it("has dropped the stress test, data notes, factor breakdown, and section swap", async () => {
    renderPage("/?crns=90001,90003");
    await screen.findByTestId("risk-score");

    for (const gone of [
      /stress test/i,
      /miss a week/i,
      /data notes/i,
      /factor breakdown/i,
      /improve this schedule/i,
      /compare another section/i,
      /swap/i,
    ]) {
      expect(screen.queryByText(gone)).toBeNull();
      expect(screen.queryByRole("button", { name: gone })).toBeNull();
    }
  });

  it("is desktop-only: no bottom navigation, no search drawer, and the page never scrolls", async () => {
    const { container } = renderPage("/?crns=90001,90003");
    await screen.findByTestId("risk-score");

    expect(screen.queryByRole("navigation", { name: "Primary" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Course search" })).toBeNull();
    expect(container.querySelector(".h-dvh.overflow-hidden")).toBeTruthy();
    expect(container.querySelector("main .overflow-y-auto")).toBeTruthy();
  });

  it("opens a clicked calendar class in the center panel and highlights it in Your Courses", async () => {
    renderPage("/?crns=90001,90003");
    const grid = await screen.findByTestId("calendar-grid");

    fireEvent.click(grid.querySelector('[data-crn="90003"][data-day="M"]') as HTMLElement);

    const details = await screen.findByRole("region", { name: "Course details" });
    expect(within(details).getByRole("heading", { name: "MATH 2534" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Schedule overview" })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Open details for MATH 2534/ }).getAttribute("aria-current"),
    ).toBe("true");
  });

  it("goes from the cart's Add a course button to search and back", async () => {
    renderPage("/?crns=90001,90003");
    const cart = await screen.findByRole("region", { name: "Your Courses" });

    fireEvent.click(within(cart).getByRole("button", { name: "Add a course" }));
    expect(await screen.findByRole("region", { name: "Add a course" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(await screen.findByRole("region", { name: "Schedule overview" })).toBeTruthy();
  });

  it("welcomes an empty schedule with a demo week that fills the cart, map, and calendar", async () => {
    renderPage("/");
    expect(await screen.findByRole("heading", { name: /plan a week you can actually walk/i })).toBeTruthy();
    expect(screen.getByText("0 of 12 courses selected")).toBeTruthy();

    fireEvent.click(await screen.findByTestId("demo-easy"));

    await waitFor(() => expect(screen.getByText("3 of 12 courses selected")).toBeTruthy());
    expect(await screen.findByRole("region", { name: "Schedule overview" })).toBeTruthy();
  });
});
