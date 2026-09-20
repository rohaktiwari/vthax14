import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { CourseGroup } from "../api/types";
import { CourseSearchProvider } from "../context/CourseSearchContext";
import { ScheduleProvider } from "../context/ScheduleContext";
import { sectionFixture } from "../test/fixtures";
import { server } from "../test/msw/server";
import CenterPanel from "./CenterPanel";
import SearchSidebar from "./SearchSidebar";

const group: CourseGroup = {
  course_id: "CS 1114",
  title: "Intro to Software Design",
  credits: 3,
  sections: [{ ...sectionFixture, crn: "90001", course_id: "CS 1114" }],
};

function renderDesktopShell() {
  server.use(
    http.get(`${API_BASE_URL}/courses/search`, () => HttpResponse.json({ courses: [group] })),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ScheduleProvider>
          <CourseSearchProvider>
            <SearchSidebar showResults={false} />
            <CenterPanel />
          </CourseSearchProvider>
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("CenterPanel", () => {
  it("shows the hero before any search and keeps results out of the sidebar", async () => {
    renderDesktopShell();

    expect(screen.getByText("Burruss Hall")).toBeTruthy();
    expect(screen.queryByRole("region", { name: /course search results/i })).toBeNull();
    // The catalog still loads in the background, but no results render yet.
    expect(screen.queryByText("CS 1114")).toBeNull();
  });

  it("replaces the hero with results in the center panel when the user searches", async () => {
    renderDesktopShell();

    fireEvent.click(screen.getByRole("button", { name: "Search Classes" }));

    const results = await screen.findByRole("region", { name: /course search results/i });
    expect(await screen.findByText("CS 1114")).toBeTruthy();
    expect(results.textContent).toContain("CS 1114");
    expect(screen.queryByText("Burruss Hall")).toBeNull();
  });

  it("searches as the user types and returns to the overview when the text is cleared", async () => {
    renderDesktopShell();
    const input = screen.getByLabelText(/search for a course/i);

    fireEvent.change(input, { target: { value: "CS" } });
    expect(await screen.findByRole("region", { name: /course search results/i })).toBeTruthy();

    fireEvent.change(input, { target: { value: "" } });
    await waitFor(() => expect(screen.getByText("Burruss Hall")).toBeTruthy());
  });

  it("'Back to overview' clears the search and restores the hero", async () => {
    renderDesktopShell();

    fireEvent.click(screen.getByRole("button", { name: "Search Classes" }));
    await screen.findByText("CS 1114");

    fireEvent.click(screen.getByRole("button", { name: /back to overview/i }));
    expect(await screen.findByText("Burruss Hall")).toBeTruthy();
    expect((screen.getByLabelText(/search for a course/i) as HTMLInputElement).value).toBe("");
  });

  it("can add a section straight from the center panel", async () => {
    renderDesktopShell();

    fireEvent.click(screen.getByRole("button", { name: "Search Classes" }));
    fireEvent.click(await screen.findByRole("button", { name: /add section 90001/i }));

    expect(await screen.findByRole("button", { name: /remove section 90001/i })).toBeTruthy();
  });
});
