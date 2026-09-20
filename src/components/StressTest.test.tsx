import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { StressRequest, StressResponse } from "../api/types";
import { server } from "../test/msw/server";
import { stressFixture } from "../test/fixtures";
import { ScheduleProvider } from "../context/ScheduleContext";
import StressTest from "./StressTest";

function mockStress(response: StressResponse, status = 200) {
  const captured: { body: StressRequest | null } = { body: null };
  server.use(
    http.post(`${API_BASE_URL}/stress`, async ({ request }) => {
      captured.body = (await request.json()) as StressRequest;
      return HttpResponse.json(response, { status });
    }),
  );
  return captured;
}

function renderStress(initialEntry = "/?crns=90001,90002") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <StressTest />
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("StressTest", () => {
  it("always shows the required disclaimer", () => {
    renderStress();
    expect(screen.getByTestId("stress-disclaimer").textContent).toBe(
      "This is a deterministic catch-up-cost heuristic, not a forecast of academic performance.",
    );
  });

  it("sends the documented payload with scenario miss_week and the chosen week", async () => {
    const captured = mockStress(stressFixture);
    renderStress();

    fireEvent.change(screen.getByTestId("stress-week"), { target: { value: "3" } });
    fireEvent.click(screen.getByTestId("run-stress"));

    await screen.findByTestId("stress-result");
    expect(captured.body).toEqual({
      crns: ["90001", "90002"],
      scenario: "miss_week",
      week: 3,
    });
  });

  it("renders backend result values, penalties, and note unchanged", async () => {
    mockStress(stressFixture);
    renderStress();

    fireEvent.click(screen.getByTestId("run-stress"));
    await screen.findByTestId("stress-result");

    expect(screen.getByTestId("stress-delta").textContent).toBe(
      "Risk increases by 5 points (41 → 46).",
    );

    const penalties = screen.getByTestId("stress-penalties");
    expect(penalties.textContent).toContain("CS 1114");
    expect(penalties.textContent).toContain("Medium impact");
    expect(penalties.textContent).toContain("+6 points");
    expect(penalties.textContent).toContain(
      "High instructor difficulty and four credits increase catch-up cost.",
    );

    expect(screen.getByTestId("stress-meta-note").textContent).toBe(
      "This scenario is a deterministic planning heuristic, not a prediction.",
    );
  });

  it("prompts instead of requesting when fewer than two sections are selected", () => {
    renderStress("/?crns=90001");
    expect(screen.getByTestId("stress-prompt")).toBeTruthy();
    expect(screen.queryByTestId("run-stress")).toBeNull();
  });

  it("surfaces a normalized error with retry for a failed request", async () => {
    mockStress(stressFixture, 500);
    renderStress();

    fireEvent.click(screen.getByTestId("run-stress"));

    await waitFor(() =>
      expect(screen.getByText("Stress test could not be run")).toBeTruthy(),
    );
  });
});
