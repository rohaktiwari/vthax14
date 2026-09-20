import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { CourseGroup, Section } from "../api/types";
import { server } from "../test/msw/server";
import { CourseSearchProvider } from "../context/CourseSearchContext";
import { ScheduleProvider } from "../context/ScheduleContext";
import SearchSidebar from "./SearchSidebar";

function makeSection(crn: string, courseNo: string): Section {
  return {
    crn,
    term_id: "2026-fall",
    course_id: `CS ${courseNo}`,
    subject: "CS",
    course_no: courseNo,
    title: "Test Course",
    credits: 3,
    instructor_names: ["Ada Lovelace"],
    schedule_type: "Lecture",
    modality: "f2f",
    grade_mode: "standard",
    campus: "Blacksburg",
    seats: { max: 100, available: 10 },
    meetings: [
      {
        days: ["M", "W", "F"],
        start_min: 610,
        end_min: 700,
        building: "MCB",
        room: "204",
        start_date: "2026-08-24",
        end_date: "2026-12-09",
      },
    ],
    meta: { source: "banner_class_search", verified: true, confidence: "low", fetched_at: null },
  };
}

const groupA: CourseGroup = {
  course_id: "CS 1114",
  title: "Intro to Software Design",
  credits: 3,
  sections: [makeSection("90001", "1114")],
};

const groupB: CourseGroup = {
  course_id: "MATH 2534",
  title: "Discrete Mathematics",
  credits: 3,
  sections: [makeSection("90002", "2534")],
};

function useSearchHandler(groups: CourseGroup[], seenUrls?: string[]) {
  server.use(
    http.get(`${API_BASE_URL}/courses/search`, ({ request }) => {
      seenUrls?.push(request.url);
      return HttpResponse.json({ courses: groups });
    }),
  );
}

function LocationProbe() {
  const [params] = useSearchParams();
  return <output data-testid="crns">{params.get("crns") ?? ""}</output>;
}

function renderSidebar(initialEntry = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <CourseSearchProvider>
            <SearchSidebar />
            <LocationProbe />
          </CourseSearchProvider>
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SearchSidebar", () => {
  it("renders grouped course results with section details", async () => {
    useSearchHandler([groupA, groupB]);
    renderSidebar();

    expect(await screen.findByText("CS 1114")).toBeTruthy();
    expect(screen.getByText("MATH 2534")).toBeTruthy();
    expect(await screen.findByText("CRN 90001")).toBeTruthy();
    expect(screen.getAllByText(/Seats: 10 of 100/).length).toBeGreaterThan(0);
  });

  it("debounces typed queries by ~250ms using only the q parameter", async () => {
    const seenUrls: string[] = [];
    useSearchHandler([groupA], seenUrls);
    renderSidebar();

    const input = screen.getByLabelText(/search for a course/i);
    fireEvent.change(input, { target: { value: "C" } });
    await delay(100);
    fireEvent.change(input, { target: { value: "CS" } });

    await waitFor(() => {
      const queries = seenUrls.map((url) => new URL(url).searchParams.get("q"));
      expect(queries).toContain("CS");
    });

    const queries = seenUrls.map((url) => new URL(url).searchParams.get("q"));
    expect(queries).not.toContain("C");
  });

  it("adds and removes a section via the URL", async () => {
    useSearchHandler([groupA, groupB]);
    renderSidebar();

    await screen.findByText("CS 1114");

    fireEvent.click(await screen.findByRole("button", { name: /add section 90001/i }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001"));

    fireEvent.click(screen.getByRole("button", { name: /remove section 90001/i }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe(""));
  });

  it("preserves selection order across multiple adds", async () => {
    useSearchHandler([groupA, groupB]);
    renderSidebar();

    await screen.findByText("CS 1114");
    fireEvent.click(await screen.findByRole("button", { name: /add section 90001/i }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001"));

    fireEvent.click(await screen.findByRole("button", { name: /add section 90002/i }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001,90002"));
  });

  it("parses, de-duplicates, and re-serializes an initial crns URL", async () => {
    useSearchHandler([groupA, groupB]);
    renderSidebar("/?crns=90002,90002,90001");

    expect(await screen.findByRole("button", { name: /remove section 90002/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /remove section 90001/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /remove section 90002/i }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001"));
  });
});
