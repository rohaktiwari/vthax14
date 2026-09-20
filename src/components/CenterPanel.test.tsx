import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../api/client";
import type { AnalyzeResponse, Section } from "../api/types";
import { useCenterView } from "../context/CenterViewContext";
import { makeSection, renderInApp } from "../test/harness";
import { server } from "../test/msw/server";
import { analyzeFixture, sectionFixture } from "../test/fixtures";
import CenterPanel from "./CenterPanel";

const meeting = sectionFixture.meetings[0]!;
const cs = makeSection(sectionFixture, { crn: "90001", course_id: "CS 3114", title: "Data Structures" });
const math = makeSection(sectionFixture, {
  crn: "90003",
  course_id: "MATH 2534",
  title: "Discrete Mathematics",
  meetings: [{ ...meeting, building: "WHI", room: "230", start_min: 670, end_min: 720 }],
});
const sections: Section[] = [cs, math];
const analysis: AnalyzeResponse = { ...analyzeFixture, sections };

function OpenCourse({ crn }: { crn: string }) {
  const { showCourse } = useCenterView();
  return (
    <button type="button" onClick={() => showCourse(crn)}>
      open {crn}
    </button>
  );
}

function renderPanel(route: string, extra?: { crn: string }) {
  server.use(http.post(`${API_BASE_URL}/analyze`, () => HttpResponse.json(analysis)));
  return renderInApp(
    <>
      <CenterPanel />
      {extra ? <OpenCourse crn={extra.crn} /> : null}
    </>,
    { route, sections },
  );
}

describe("CenterPanel with nothing selected", () => {
  it("welcomes the student with one primary action and two demo weeks", async () => {
    renderPanel("/");

    expect(screen.getByRole("heading", { name: /plan a week you can actually walk/i })).toBeTruthy();
    const search = screen.getByRole("button", { name: "Search for a course" });
    expect(search.className).toContain("bg-maroon");
    expect(await screen.findByRole("button", { name: "Balanced schedule" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "The wall of pain" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /swap/i })).toBeNull();
  });

  it("opens the add-a-course view from the welcome screen", () => {
    renderPanel("/");

    fireEvent.click(screen.getByRole("button", { name: "Search for a course" }));

    expect(screen.getByTestId("view").textContent).toBe("add");
    expect(screen.getByRole("region", { name: "Add a course" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Search for a course"));
  });

  it("loads a demo week from the API's CRNs", async () => {
    renderPanel("/");

    fireEvent.click(await screen.findByTestId("demo-easy"));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001,90003,90008"));
    expect(await screen.findByRole("region", { name: "Schedule overview" })).toBeTruthy();
  });
});

describe("CenterPanel with courses selected", () => {
  it("shows the schedule overview by default", async () => {
    renderPanel("/?crns=90001,90003");

    expect(await screen.findByTestId("risk-score")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Schedule overview" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Course details" })).toBeNull();
  });

  it("shows a course's details in place of the overview when one is opened, and goes back", async () => {
    renderPanel("/?crns=90001,90003", { crn: "90001" });
    await screen.findByTestId("risk-score");

    fireEvent.click(screen.getByRole("button", { name: "open 90001" }));

    const details = await screen.findByRole("region", { name: "Course details" });
    expect(within(details).getByRole("heading", { name: "CS 3114" })).toBeTruthy();
    expect(details.textContent).toContain("Data Structures");
    expect(details.textContent).toContain("3 credits");
    expect(details.textContent).toContain("Lecture");
    expect(details.textContent).toContain("In person");
    expect(details.textContent).toContain("90001");
    expect(details.textContent).toContain("42 of 120 open");
    expect(details.textContent).toContain("MWF 10:10 AM–11:40 AM");
    expect(details.textContent).toContain("MCB 204 · Aug 24 – Dec 9, 2026");
    expect(within(details).getByRole("button", { name: "View instructor details for Ada Lovelace" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Schedule overview" })).toBeNull();

    fireEvent.click(within(details).getByRole("button", { name: "← Schedule overview" }));
    expect(await screen.findByRole("region", { name: "Schedule overview" })).toBeTruthy();
    expect(screen.getByTestId("view").textContent).toBe("overview");
  });

  it("explains why the course is flagged using the backend's own sentences", async () => {
    renderPanel("/?crns=90001,90003", { crn: "90001" });
    fireEvent.click(screen.getByRole("button", { name: "open 90001" }));

    const details = await screen.findByRole("region", { name: "Course details" });
    await waitFor(() => expect(within(details).getByText("High risk")).toBeTruthy());
    expect(details.textContent).toContain("Impossible walk");
    expect(details.textContent).toContain("MCB -> WHI is an 18-minute walk; the schedule provides 10 minutes.");
    expect(details.textContent).toContain("Heavy-course load");
  });

  it("asks for a second course instead of guessing risk when only one is selected", () => {
    renderPanel("/?crns=90001", { crn: "90001" });
    fireEvent.click(screen.getByRole("button", { name: "open 90001" }));

    const details = screen.getByRole("region", { name: "Course details" });
    expect(details.textContent).toContain("Add one more course to see how this one fits your week.");
    expect(within(details).queryByText(/risk$/)).toBeNull();
  });

  it("removes the open course and falls back to the overview", async () => {
    renderPanel("/?crns=90001,90003", { crn: "90001" });
    fireEvent.click(screen.getByRole("button", { name: "open 90001" }));

    fireEvent.click(
      await screen.findByRole("button", { name: "Remove CS 3114 (CRN 90001) from Your Courses" }),
    );

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90003"));
    expect(screen.getByTestId("view").textContent).toBe("overview");
    expect(screen.queryByRole("region", { name: "Course details" })).toBeNull();
  });

  it("marks a full section and folds long descriptions behind a control", () => {
    const full = makeSection(sectionFixture, {
      crn: "90005",
      course_id: "PHYS 2305",
      seats: { max: 30, available: 0 },
      description: "Mechanics and waves.",
      prereqs_text: "Prerequisite: MATH 1225.",
      grade_mode: "pass_fail",
    });
    server.use(http.post(`${API_BASE_URL}/analyze`, () => HttpResponse.json(analysis)));
    renderInApp(
      <>
        <CenterPanel />
        <OpenCourse crn="90005" />
      </>,
      { route: "/?crns=90005", sections: [full] },
    );
    fireEvent.click(screen.getByRole("button", { name: "open 90005" }));

    const details = screen.getByRole("region", { name: "Course details" });
    expect(details.textContent).toContain("Full (0 of 30 open)");
    expect(details.textContent).toContain("Pass/fail");
    const notes = within(details).getByText("Description and notes").closest("details") as HTMLDetailsElement;
    expect(notes.open).toBe(false);
    expect(notes.textContent).toContain("Mechanics and waves.");
    expect(notes.textContent).toContain("Prerequisite: MATH 1225.");
  });
});
