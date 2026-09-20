import { beforeEach, describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { AnalyzeRequest, Section } from "../api/types";
import { server } from "../test/msw/server";
import { analyzeFixture } from "../test/fixtures";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import RiskOverview from "./RiskOverview";

function makeSection(crn: string, building = "MCB"): Section {
  return {
    crn,
    term_id: "2026-fall",
    course_id: `CS ${crn.slice(-4)}`,
    subject: "CS",
    course_no: crn.slice(-4),
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
        building,
        room: "204",
        start_date: "2026-08-24",
        end_date: "2026-12-09",
      },
    ],
    meta: { source: "banner_class_search", verified: true, confidence: "low", fetched_at: null },
  };
}

const sectionA = makeSection("90001");
const sectionB = makeSection("90002", "WHI");
const seedSections = [sectionA, sectionB];

/** Seeds the in-memory selected-section cache (URL CRNs stay canonical). */
function Seed({ sections }: { sections: Section[] }) {
  const { registerSections } = useSchedule();
  useEffect(() => {
    registerSections(sections);
  }, [registerSections, sections]);
  return null;
}

let posts: AnalyzeRequest[];

function mockAnalyze(respond: () => Response) {
  server.use(
    http.post(`${API_BASE_URL}/analyze`, async ({ request }) => {
      posts.push((await request.json()) as AnalyzeRequest);
      return respond();
    }),
  );
}

function renderInsights(initialEntry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <Seed sections={seedSections} />
          <RiskOverview />
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  posts = [];
});

describe("RiskOverview", () => {
  it("shows the add-a-section prompt and makes no analyze request for one section", async () => {
    mockAnalyze(() => HttpResponse.json(analyzeFixture));
    renderInsights("/?crns=90001");

    const prompt = await screen.findByTestId("analyze-prompt");
    expect(prompt.textContent).toBe("Add at least one more section to calculate schedule risk.");

    // Give queued effects/queries a chance to fire before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts).toHaveLength(0);
  });

  it("posts the ordered URL CRNs when two sections are selected", async () => {
    mockAnalyze(() => HttpResponse.json(analyzeFixture));
    renderInsights("/?crns=90002,90001");

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]?.crns).toEqual(["90002", "90001"]);
    expect(await screen.findByTestId("risk-score")).toBeTruthy();
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
    renderInsights("/?crns=90001,90002");

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getAllByTestId("conflict-item")).toHaveLength(2);
    expect(screen.getByText("90002 and 90001 overlap on Tue 09:00–09:30.")).toBeTruthy();
    expect(screen.getByText("90001 and 90002 overlap on Thu 11:00–11:30.")).toBeTruthy();
    expect(screen.getByText("The schedule contains 2 meeting overlaps.")).toBeTruthy();
  });

  it("renders a normalized outage state and retries on demand", async () => {
    mockAnalyze(() => HttpResponse.error());
    renderInsights("/?crns=90001,90002");

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(posts).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(posts).toHaveLength(2));
  });
});
