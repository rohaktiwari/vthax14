import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../api/client";
import type { VibesResponse } from "../api/types";
import { server } from "../test/msw/server";
import { sectionFixture, vibesFixture } from "../test/fixtures";
import { ProfessorDrawerProvider } from "../context/ProfessorDrawerContext";
import ProfessorDrawer from "./ProfessorDrawer";
import SectionCard from "./SectionCard";

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function mockVibes(response: VibesResponse | { detail: string }, status = 200) {
  server.use(
    http.get(`${API_BASE_URL}/professors/:surname/vibes`, () =>
      HttpResponse.json(response, { status }),
    ),
  );
}

function renderDrawer() {
  return render(
    <QueryClientProvider client={makeClient()}>
      <ProfessorDrawer surname="lovelace" displayName="Ada Lovelace" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe("ProfessorDrawer", () => {
  it("renders every returned RMP, grade, tag, confidence, and note value", async () => {
    renderDrawer();

    const rmp = await screen.findByTestId("professor-rmp");
    expect(rmp.textContent).toContain("4.2");
    expect(rmp.textContent).toContain("3.1");
    expect(rmp.textContent).toContain("87");
    expect(rmp.textContent).toContain("78.0%");

    const grades = screen.getByTestId("professor-grades");
    expect(grades.textContent).toContain("3.10");
    expect(grades.textContent).toContain("0.40");
    expect(grades.textContent).toContain("5");
    expect(grades.textContent).toContain("340");
    expect(grades.textContent).toContain("34.2%");

    expect(screen.getByTestId("professor-tags").textContent).toContain("curves");
    expect(screen.getByTestId("professor-confidence").textContent).toContain("Low confidence");
    expect(screen.getByTestId("professor-notes").textContent).toContain(
      "RMP and grade rows are synthetic_filler.",
    );
    expect(screen.queryByText(/RateMyProfessors/i)).toBeNull();
  });

  it("renders the documented fallbacks for partial and empty data", async () => {
    const partial: VibesResponse = {
      instructor: "lovelace",
      rmp: null,
      tags: [],
      grade_stats: {
        avg_gpa: null,
        volatility: null,
        n_sections: 0,
        n_students: 0,
        a_rate: null,
      },
      confidence: "low",
      data_notes: [],
    };
    mockVibes(partial);
    renderDrawer();

    expect(await screen.findByTestId("professor-rmp-empty")).toHaveProperty(
      "textContent",
      "No review summary available",
    );
    expect(screen.getByTestId("professor-grades-empty").textContent).toBe(
      "No matching grade history available",
    );
    expect(screen.getByTestId("professor-tags-empty").textContent).toBe("No vibe tags available");
    expect(screen.getByTestId("professor-notes-empty").textContent).toBe(
      "No data notes were reported for this instructor.",
    );
  });

  it("renders the documented 404 copy", async () => {
    mockVibes({ detail: "No instructor data found" }, 404);
    renderDrawer();

    expect((await screen.findByTestId("professor-not-found")).textContent).toBe(
      "No instructor data found",
    );
  });

  it("renders a retryable error state for non-404 failures", async () => {
    mockVibes({ detail: "boom" }, 500);
    renderDrawer();

    expect(await screen.findByText("Instructor data unavailable")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});

describe("ProfessorDrawer accessibility", () => {
  it("opens from an instructor name, traps initial focus, closes on Escape, and restores focus", async () => {
    server.use(http.get(`${API_BASE_URL}/professors/:surname/vibes`, () => HttpResponse.json(vibesFixture)));

    render(
      <QueryClientProvider client={makeClient()}>
        <ProfessorDrawerProvider>
          <SectionCard section={sectionFixture} selected disabled onToggle={() => {}} />
        </ProfessorDrawerProvider>
      </QueryClientProvider>,
    );

    const trigger = screen.getByRole("button", {
      name: "View instructor details for Ada Lovelace",
    });
    trigger.focus();
    fireEvent.click(trigger);

    const drawer = await screen.findByTestId("professor-drawer");
    expect(within(drawer).getByText("Ada Lovelace")).toBeTruthy();

    await waitFor(() =>
      expect(document.activeElement?.getAttribute("aria-label")).toBe("Close instructor details"),
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("professor-drawer")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
