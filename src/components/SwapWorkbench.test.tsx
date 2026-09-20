import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { Section, SwapRequest, SwapResponse } from "../api/types";
import { server } from "../test/msw/server";
import { analyzeFixture, demoSchedulesFixture, sectionFixture, swapFixture } from "../test/fixtures";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import { SwapWorkbenchProvider } from "../context/SwapWorkbenchContext";
import DemoPicker from "./DemoPicker";
import SwapWorkbench from "./SwapWorkbench";

function makeSection(crn: string, courseId: string): Section {
  return {
    ...sectionFixture,
    crn,
    course_id: courseId,
    course_no: courseId.split(" ")[1] ?? "0000",
    meetings: sectionFixture.meetings.map((meeting) => ({ ...meeting, building: "MCB" })),
  };
}

const selectedA = makeSection("90003", "MATH 2534");
const selectedB = makeSection("90001", "CS 3114");
const selectedC = makeSection("90002", "CS 2505");
const alternative = makeSection("90004", "CS 3114");
const allSections = [selectedA, selectedB, selectedC, alternative];

function LocationProbe() {
  const [params] = useSearchParams();
  return <output data-testid="crns">{params.get("crns") ?? ""}</output>;
}

function Seed({ sections }: { sections: Section[] }) {
  const { registerSections } = useSchedule();
  useEffect(() => {
    registerSections(sections);
  }, [registerSections, sections]);
  return null;
}

interface RenderOptions {
  initialEntry?: string;
  initialDropCrn?: string | null;
  initialAddCrn?: string | null;
  onClose?: () => void;
}

function renderWorkbench({
  initialEntry = "/?crns=90003,90001,90002",
  initialDropCrn = "90001",
  initialAddCrn = null,
  onClose = () => {},
}: RenderOptions = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <Seed sections={allSections} />
          <LocationProbe />
          <SwapWorkbench
            open
            initialDropCrn={initialDropCrn}
            initialAddCrn={initialAddCrn}
            onClose={onClose}
          />
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockSwap(response: SwapResponse, status = 200) {
  const captured: { body: SwapRequest | null } = { body: null };
  server.use(
    http.post(`${API_BASE_URL}/swap`, async ({ request }) => {
      captured.body = (await request.json()) as SwapRequest;
      return HttpResponse.json(response, { status });
    }),
  );
  return captured;
}

describe("SwapWorkbench", () => {
  it("previews with current_crns in order and does not mutate the URL", async () => {
    const captured = mockSwap(swapFixture);
    renderWorkbench({ initialAddCrn: "90004" });

    fireEvent.click(screen.getByTestId("swap-preview"));

    await screen.findByTestId("swap-result");
    expect(captured.body).toEqual({
      current_crns: ["90003", "90001", "90002"],
      drop_crn: "90001",
      add_crn: "90004",
    });
    // Preview must not change the canonical URL selection.
    expect(screen.getByTestId("crns").textContent).toBe("90003,90001,90002");
    expect(screen.getByTestId("swap-apply")).toBeTruthy();
  });

  it("offers only same-course cached alternatives and hides selected CRNs", () => {
    renderWorkbench();
    const list = screen.getByTestId("swap-alternatives");
    expect(within(list).getByText(/CRN 90004/)).toBeTruthy();
    expect(within(list).queryByText(/CRN 90002/)).toBeNull();
    expect(within(list).queryByText(/CRN 90001/)).toBeNull();
  });

  it("applies a confirmed swap at the exact dropped index", async () => {
    mockSwap(swapFixture);
    const onClose = { called: 0 };
    renderWorkbench({ initialAddCrn: "90004", onClose: () => (onClose.called += 1) });

    fireEvent.click(screen.getByTestId("swap-preview"));
    await screen.findByTestId("swap-result");
    fireEvent.click(screen.getByTestId("swap-apply"));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90003,90004,90002"));
    expect(onClose.called).toBe(1);
  });

  it("renders every backend conflict and cannot apply an invalid swap", async () => {
    const captured = mockSwap(
      {
        detail: {
          code: "meeting_overlap",
          message: "The resulting schedule has a conflict.",
          conflicts: [{ crns: ["90004", "90002"], day: "M", start: "10:00", end: "10:50" }],
        },
      } as unknown as SwapResponse,
      422,
    );
    renderWorkbench({ initialAddCrn: "90004" });

    fireEvent.click(screen.getByTestId("swap-preview"));

    await screen.findByTestId("conflict-item");
    expect(screen.getByText(/90004 and 90002 overlap on Mon 10:00–10:50/)).toBeTruthy();
    expect(screen.queryByTestId("swap-apply")).toBeNull();
    // The body still follows the documented contract even when rejected.
    expect(captured.body?.drop_crn).toBe("90001");
    expect(captured.body?.add_crn).toBe("90004");
  });

  it("describes a negative delta as a risk decrease in text", async () => {
    mockSwap({ ...swapFixture, delta: -16, before: analyzeFixture, after: { ...analyzeFixture, risk_score: 25 } });
    renderWorkbench({ initialAddCrn: "90004" });
    fireEvent.click(screen.getByTestId("swap-preview"));
    expect((await screen.findByTestId("swap-delta")).textContent).toBe(
      "Risk decreases by 16 points (41 → 25).",
    );
  });

  it("describes a zero delta as no score change in text", async () => {
    mockSwap({ ...swapFixture, delta: 0, before: analyzeFixture, after: { ...analyzeFixture, risk_score: 41 } });
    renderWorkbench({ initialAddCrn: "90004" });
    fireEvent.click(screen.getByTestId("swap-preview"));
    expect((await screen.findByTestId("swap-delta")).textContent).toBe(
      "No risk score change (41 → 41).",
    );
  });

  it("describes a positive delta as a risk increase in text", async () => {
    mockSwap({ ...swapFixture, delta: 7, before: analyzeFixture, after: { ...analyzeFixture, risk_score: 48 } });
    renderWorkbench({ initialAddCrn: "90004" });
    fireEvent.click(screen.getByTestId("swap-preview"));
    expect((await screen.findByTestId("swap-delta")).textContent).toBe(
      "Risk increases by 7 points (41 → 48).",
    );
  });
});

describe("swap demo setup", () => {
  it("opens the workbench prefilled from the backend swap_demo payload", async () => {
    server.use(
      http.get(`${API_BASE_URL}/demo/schedules`, () => HttpResponse.json(demoSchedulesFixture)),
    );

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/"]}>
          <ScheduleProvider>
            <SwapWorkbenchProvider>
              <DemoPicker />
            </SwapWorkbenchProvider>
          </ScheduleProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(await screen.findByTestId("demo-swap"));
    fireEvent.click(await screen.findByTestId("open-swap-from-demo"));

    const panel = await screen.findByTestId("swap-workbench");
    expect(within(panel).getByTestId("swap-drop")).toHaveProperty("value", "90003");
    expect(within(panel).getByTestId("swap-prefilled-add").textContent).toContain("90004");
  });
});
