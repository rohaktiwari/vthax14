import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { DemoSchedulesResponse } from "../api/types";
import { server } from "../test/msw/server";
import { demoSchedulesFixture } from "../test/fixtures";
import { ScheduleProvider } from "../context/ScheduleContext";
import DemoPicker from "./DemoPicker";

function LocationProbe() {
  const [params] = useSearchParams();
  return <output data-testid="crns">{params.get("crns") ?? ""}</output>;
}

function mockDemos(response: DemoSchedulesResponse) {
  server.use(http.get(`${API_BASE_URL}/demo/schedules`, () => HttpResponse.json(response)));
}

function renderPicker(initialEntry = "/") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <DemoPicker />
          <LocationProbe />
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DemoPicker", () => {
  it("renders the demo labels returned by the API", async () => {
    const custom: DemoSchedulesResponse = {
      ...demoSchedulesFixture,
      easy: { crns: ["70001", "70002"], label: "Custom balanced" },
      brutal: { crns: ["70003", "70004"], label: "Custom brutal" },
    };
    mockDemos(custom);
    renderPicker();

    expect(await screen.findByRole("button", { name: "Custom balanced" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Custom brutal" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /swap/i })).toBeNull();
  });

  it("loads a demo without confirmation when nothing is selected", async () => {
    mockDemos(demoSchedulesFixture);
    renderPicker();

    fireEvent.click(await screen.findByTestId("demo-easy"));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001,90003,90008"));
    expect(screen.queryByTestId("demo-confirm")).toBeNull();
  });

  it("uses CRNs only from the API response, never hardcoded values", async () => {
    mockDemos({
      ...demoSchedulesFixture,
      easy: { crns: ["77777", "88888"], label: "Balanced schedule" },
    });
    renderPicker();

    fireEvent.click(await screen.findByTestId("demo-easy"));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("77777,88888"));
  });

  it("requires confirmation before replacing an existing selection", async () => {
    mockDemos(demoSchedulesFixture);
    renderPicker("/?crns=11111");

    fireEvent.click(await screen.findByTestId("demo-easy"));

    expect(await screen.findByTestId("demo-confirm")).toBeTruthy();
    expect(screen.getByTestId("crns").textContent).toBe("11111");

    fireEvent.click(screen.getByTestId("demo-confirm-accept"));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001,90003,90008"));
  });

  it("cancels a replacement without changing the selection", async () => {
    mockDemos(demoSchedulesFixture);
    renderPicker("/?crns=11111");

    fireEvent.click(await screen.findByTestId("demo-brutal"));
    fireEvent.click(await screen.findByTestId("demo-confirm-cancel"));

    expect(screen.queryByTestId("demo-confirm")).toBeNull();
    expect(screen.getByTestId("crns").textContent).toBe("11111");
  });
});
