import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../api/client";
import type { AnalyzeRequest, AnalyzeResponse, Section } from "../api/types";
import { renderInApp, makeSection } from "../test/harness";
import { server } from "../test/msw/server";
import { analyzeFixture, sectionFixture } from "../test/fixtures";
import YourCourses from "./YourCourses";

const meeting = sectionFixture.meetings[0]!;
const dataStructures = makeSection(sectionFixture, {
  crn: "90001",
  course_id: "CS 3114",
  title: "Data Structures and Algorithms",
});
const discrete = makeSection(sectionFixture, {
  crn: "90003",
  course_id: "MATH 2534",
  title: "Introduction to Discrete Mathematics",
  credits: 3,
  meetings: [{ ...meeting, building: "WHI", room: "230", start_min: 670, end_min: 720 }],
});
const nutrition = makeSection(sectionFixture, {
  crn: "90008",
  course_id: "HNFE 1004",
  title: "Foods, Nutrition and Fitness",
  credits: 3,
  modality: "online_sync",
  meetings: [{ ...meeting, days: ["T"], building: null, room: null, start_min: 1020, end_min: 1070 }],
});
const sections: Section[] = [dataStructures, discrete, nutrition];

const analysis: AnalyzeResponse = { ...analyzeFixture, sections };

let posts: AnalyzeRequest[];

beforeEach(() => {
  posts = [];
  server.use(
    http.post(`${API_BASE_URL}/analyze`, async ({ request }) => {
      posts.push((await request.json()) as AnalyzeRequest);
      return HttpResponse.json(analysis);
    }),
  );
});

describe("YourCourses", () => {
  it("shows N of 12 selected, total credits, and a matching progress bar", () => {
    renderInApp(<YourCourses />, { route: "/?crns=90001,90003,90008", sections });

    expect(screen.getByText(/3 of 12 courses selected/)).toBeTruthy();
    expect(screen.getByText(/9 credits/)).toBeTruthy();
    const bar = screen.getByRole("progressbar", { name: "Courses selected" });
    expect(bar.getAttribute("aria-valuenow")).toBe("3");
    expect(bar.getAttribute("aria-valuemax")).toBe("12");
  });

  it("lists each course with where it meets and a per-course risk from the analysis", async () => {
    renderInApp(<YourCourses />, { route: "/?crns=90001,90003,90008", sections });

    const cs = screen.getByRole("button", { name: /Open details for CS 3114/ });
    expect(cs.textContent).toContain("Data Structures and Algorithms");
    expect(cs.textContent).toContain("MWF 10:10 AM–11:40 AM · MCB 204");

    await waitFor(() => expect(within(cs).getByText("High risk")).toBeTruthy());
    expect(cs.textContent).toContain("Impossible walk · Heavy-course load");

    const math = screen.getByRole("button", { name: /Open details for MATH 2534/ });
    expect(within(math).getByText("High risk")).toBeTruthy();
    expect(math.textContent).toContain("Impossible walk");

    const nutritionRow = screen.getByRole("button", { name: /Open details for HNFE 1004/ });
    expect(within(nutritionRow).getByText("Low risk")).toBeTruthy();
    expect(nutritionRow.textContent).toContain("No issues flagged");
    expect(nutritionRow.textContent).toContain("T 5:00 PM–5:50 PM · Online (sync)");
  });

  it("shows a placeholder for risk while the analysis loads, never a made-up level", async () => {
    server.use(
      http.post(`${API_BASE_URL}/analyze`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return HttpResponse.json(analysis);
      }),
    );
    renderInApp(<YourCourses />, { route: "/?crns=90001,90003", sections });

    expect(screen.getAllByRole("status", { name: "Checking risk" })).toHaveLength(2);
    expect(screen.queryByText(/risk$/)).toBeNull();
    expect((await screen.findAllByText("High risk")).length).toBe(2);
    expect(screen.queryByRole("status", { name: "Checking risk" })).toBeNull();
  });

  it("asks for a second course and makes no analysis request with only one", async () => {
    renderInApp(<YourCourses />, { route: "/?crns=90001", sections });

    expect(screen.getByText("Add one more course to see risk and walking times.")).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts).toHaveLength(0);
    expect(screen.queryByText(/risk$/)).toBeNull();
  });

  it("opens a course's details in the center when its row is clicked", () => {
    renderInApp(<YourCourses />, { route: "/?crns=90001,90003", sections });

    fireEvent.click(screen.getByRole("button", { name: /Open details for MATH 2534/ }));

    expect(screen.getByTestId("view").textContent).toBe("course:90003");
    expect(
      screen.getByRole("button", { name: /Open details for MATH 2534/ }).getAttribute("aria-current"),
    ).toBe("true");
  });

  it("removes a course from the URL", async () => {
    renderInApp(<YourCourses />, { route: "/?crns=90001,90003,90008", sections });

    fireEvent.click(screen.getByRole("button", { name: "Remove MATH 2534 (CRN 90003)" }));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001,90008"));
    expect(screen.getByText(/2 of 12 courses selected/)).toBeTruthy();
  });

  it("makes Add a course the big primary action and opens the add view", () => {
    renderInApp(<YourCourses />, { route: "/?crns=90001", sections });

    const add = screen.getByRole("button", { name: "Add a course" });
    expect(add.className).toContain("bg-maroon");
    fireEvent.click(add);

    expect(screen.getByTestId("view").textContent).toBe("add");
  });

  it("stops adding at the 12-course limit and says so", () => {
    const crns = Array.from({ length: 12 }, (_, index) => String(91000 + index));
    renderInApp(<YourCourses />, { route: `/?crns=${crns.join(",")}` });

    expect(screen.getByText(/12 of 12 courses selected/)).toBeTruthy();
    const add = screen.getByRole("button", { name: "Course limit reached" });
    expect(add).toHaveProperty("disabled", true);
  });

  it("asks before clearing everything, and Cancel keeps the courses", async () => {
    renderInApp(<YourCourses />, { route: "/?crns=90001,90003", sections });

    fireEvent.click(screen.getByRole("button", { name: "Clear all courses" }));
    expect(screen.getByText("Remove all 2 courses?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("crns").textContent).toBe("90001,90003");

    fireEvent.click(screen.getByRole("button", { name: "Clear all courses" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove all" }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe(""));
    expect(screen.getByText(/No courses yet/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear all courses" })).toBeNull();
  });

  it("shows loading rows while the catalog loads, then a plain-language unavailable row", async () => {
    server.use(
      http.get(`${API_BASE_URL}/courses/search`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return HttpResponse.json({ courses: [] });
      }),
    );
    renderInApp(<YourCourses />, { route: "/?crns=90009" });

    expect(screen.queryByText(/details unavailable/i)).toBeNull();

    const row = await screen.findByText(/CRN 90009: details unavailable/);
    expect(row.textContent).not.toMatch(/endpoint|api/i);
    fireEvent.click(screen.getByRole("button", { name: "Remove CRN 90009" }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe(""));
  });
});
