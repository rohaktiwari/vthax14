import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../api/client";
import type { AnalyzeRequest, AnalyzeResponse, CommuteWarning, Section } from "../api/types";
import { useSchedule } from "../context/ScheduleContext";
import { makeSection, renderInApp } from "../test/harness";
import { server } from "../test/msw/server";
import { analyzeFixture, sectionFixture } from "../test/fixtures";
import ScheduleOverview from "./ScheduleOverview";

const sectionA = makeSection(sectionFixture, { crn: "90001", course_id: "CS 3114" });
const sectionB = makeSection(sectionFixture, { crn: "90002", course_id: "CS 2505" });
const sections: Section[] = [sectionA, sectionB];

let posts: AnalyzeRequest[];

function mockAnalyze(respond: () => Response) {
  server.use(
    http.post(`${API_BASE_URL}/analyze`, async ({ request }) => {
      posts.push((await request.json()) as AnalyzeRequest);
      return respond();
    }),
  );
}

function warning(day: CommuteWarning["day"], verdict: CommuteWarning["verdict"]): CommuteWarning {
  return {
    ...analyzeFixture.commute_warnings[0]!,
    day,
    from: { crn: "90001", building: "MCB", ends: "11:00" },
    to: { crn: "90002", building: "WHI", starts: "11:10" },
    verdict,
  };
}

function AddThirdCourse() {
  const { addCrn } = useSchedule();
  return (
    <button type="button" onClick={() => addCrn("90003")}>
      add third course
    </button>
  );
}

const withSections = (overrides: Partial<AnalyzeResponse> = {}): AnalyzeResponse => ({
  ...analyzeFixture,
  sections,
  ...overrides,
});

beforeEach(() => {
  posts = [];
});

describe("ScheduleOverview", () => {
  it("asks for one more course, with a primary button, and makes no analysis request", async () => {
    mockAnalyze(() => HttpResponse.json(withSections()));
    renderInApp(<ScheduleOverview />, { route: "/?crns=90001", sections });

    expect(screen.getByTestId("analyze-prompt").textContent).toBe(
      "Add one more course to see your risk score and walking times.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Add a course" }));
    expect(screen.getByTestId("view").textContent).toBe("add");

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts).toHaveLength(0);
  });

  it("posts the ordered URL CRNs and shows the backend score, band, and summary", async () => {
    mockAnalyze(() => HttpResponse.json(withSections()));
    renderInApp(<ScheduleOverview />, { route: "/?crns=90002,90001", sections });

    expect((await screen.findByTestId("risk-score")).textContent).toBe("41");
    expect(posts[0]?.crns).toEqual(["90002", "90001"]);
    expect(screen.getByTestId("risk-band").textContent).toBe("Moderate");
    expect(screen.getByTestId("risk-summary").textContent).toBe(
      "Moderate risk across 2 courses, with 1 walking warning.",
    );
    expect(screen.getByText(/planning heuristic, not a prediction/i)).toBeTruthy();
  });

  it("shows a loading skeleton while the first analysis is running", async () => {
    server.use(
      http.post(`${API_BASE_URL}/analyze`, async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
        return HttpResponse.json(withSections());
      }),
    );
    renderInApp(<ScheduleOverview />, { route: "/?crns=90001,90002", sections });

    expect(screen.getByText("Checking your schedule…")).toBeTruthy();
    expect(await screen.findByTestId("risk-score")).toBeTruthy();
    expect(screen.queryByText("Checking your schedule…")).toBeNull();
  });

  it("names the courses in each walking warning and folds extras behind one control", async () => {
    mockAnalyze(() =>
      HttpResponse.json(
        withSections({
          commute_warnings: [
            warning("M", "impossible"),
            warning("W", "impossible"),
            warning("F", "tight"),
            warning("T", "tight"),
            warning("R", "tight"),
          ],
        }),
      ),
    );
    renderInApp(<ScheduleOverview />, { route: "/?crns=90001,90002", sections });

    const walking = await screen.findByRole("region", { name: "Commute warnings" });
    expect(within(walking).getByText("Mon · CS 3114 → CS 2505")).toBeTruthy();
    expect(within(walking).getAllByText("Impossible")).toHaveLength(2);
    expect(within(walking).getAllByText(/MCB to WHI: 18 min walk, 10 min between classes/)).toHaveLength(5);
    expect(within(walking).getByText("Show 2 more")).toBeTruthy();
    expect(screen.getByTestId("risk-summary").textContent).toContain("5 walking warnings");
  });

  it("says so plainly when there are no walking warnings", async () => {
    mockAnalyze(() => HttpResponse.json(withSections({ commute_warnings: [] })));
    renderInApp(<ScheduleOverview />, { route: "/?crns=90001,90002", sections });

    expect(await screen.findByText(/No tight or impossible walks/)).toBeTruthy();
    expect(screen.getByTestId("risk-summary").textContent).toContain("and no walking warnings");
  });

  it("keeps expected GPA collapsed until opened, with its caveats inside", async () => {
    mockAnalyze(() => HttpResponse.json(withSections()));
    renderInApp(<ScheduleOverview />, { route: "/?crns=90001,90002", sections });

    const gpa = (await screen.findByLabelText("Expected GPA")) as HTMLDetailsElement;
    expect(gpa.open).toBe(false);
    expect(gpa.textContent).toContain("3.15");
    expect(gpa.textContent).toContain("Low confidence");
    expect(gpa.textContent).toContain("Range 2.90 to 3.40");
    expect(gpa.textContent).toContain("CRN 90008 (pass/fail)");
    expect(gpa.textContent).toContain("not a prediction of your grade");
  });

  it("no longer shows the removed panels", async () => {
    mockAnalyze(() => HttpResponse.json(withSections()));
    renderInApp(<ScheduleOverview />, { route: "/?crns=90001,90002", sections });

    await screen.findByTestId("risk-score");
    expect(screen.queryByText(/factor breakdown/i)).toBeNull();
    expect(screen.queryByText(/data notes/i)).toBeNull();
    expect(screen.queryByText(/synthetic and representative/i)).toBeNull();
    expect(screen.queryByText(/stress/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /improve this schedule/i })).toBeNull();
  });

  it("renders every conflict from a structured 422 meeting-overlap error", async () => {
    mockAnalyze(() =>
      HttpResponse.json(
        {
          detail: {
            code: "meeting_overlap",
            message: "The schedule contains 2 meeting overlaps.",
            conflicts: [
              { crns: ["90002", "90001"], day: "T", start: "09:00", end: "09:30" },
              { crns: ["90001", "90002"], day: "R", start: "11:00", end: "11:30" },
            ],
          },
        },
        { status: 422 },
      ),
    );
    renderInApp(<ScheduleOverview />, { route: "/?crns=90001,90002", sections });

    expect(await screen.findByText("Schedule conflict")).toBeTruthy();
    expect(screen.getAllByTestId("conflict-item")).toHaveLength(2);
    expect(screen.getByText("90002 and 90001 overlap on Tue 09:00–09:30.")).toBeTruthy();
    expect(screen.getByText("The schedule contains 2 meeting overlaps.")).toBeTruthy();
  });

  it("words an outage as a sentence and retries on demand", async () => {
    mockAnalyze(() => HttpResponse.error());
    renderInApp(<ScheduleOverview />, { route: "/?crns=90001,90002", sections });

    const message = await screen.findByText(/Unable to reach the HokieLens API/);
    expect(message.textContent).not.toMatch(/[{}]|TypeError|Failed to fetch/);
    expect(posts).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(posts).toHaveLength(2));
  });

  it("keeps the last score on screen, marked as updating, while a changed selection is re-analyzed", async () => {
    let call = 0;
    server.use(
      http.post(`${API_BASE_URL}/analyze`, async () => {
        call += 1;
        if (call === 1) return HttpResponse.json(withSections({ risk_score: 41 }));
        await new Promise((resolve) => setTimeout(resolve, 80));
        return HttpResponse.json(withSections({ risk_score: 55 }));
      }),
    );
    renderInApp(
      <>
        <ScheduleOverview />
        <AddThirdCourse />
      </>,
      { route: "/?crns=90001,90002", sections },
    );
    expect((await screen.findByTestId("risk-score")).textContent).toBe("41");

    fireEvent.click(screen.getByRole("button", { name: "add third course" }));

    expect(await screen.findByText("Updating for your latest change…")).toBeTruthy();
    expect(screen.getByTestId("risk-score").textContent).toBe("41");
    await waitFor(() => expect(screen.getByTestId("risk-score").textContent).toBe("55"));
    expect(screen.queryByText("Updating for your latest change…")).toBeNull();
  });
});
