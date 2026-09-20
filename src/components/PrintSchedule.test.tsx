import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Section } from "../api/types";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import { sectionFixture } from "../test/fixtures";
import PrintSchedule from "./PrintSchedule";

const mathSection: Section = {
  ...sectionFixture,
  crn: "90002",
  course_id: "MATH 2534",
  subject: "MATH",
  course_no: "2534",
  title: "Introduction to Discrete Mathematics",
  meetings: [
    {
      days: ["T", "R"],
      start_min: 720,
      end_min: 810,
      building: "WHI",
      room: "160",
      start_date: "2026-08-24",
      end_date: "2026-12-09",
    },
  ],
};

function Seed({ sections }: { sections: Section[] }) {
  const { registerSections } = useSchedule();
  useEffect(() => {
    registerSections(sections);
  }, [registerSections, sections]);
  return null;
}

function renderPrint(initialEntry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <Seed sections={[sectionFixture, mathSection]} />
          <PrintSchedule />
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("PrintSchedule", () => {
  it("includes the term, selected courses/CRNs, calendar, analysis, warnings, and disclaimer", async () => {
    renderPrint("/?crns=90001,90002");

    expect(await screen.findByText(/Term: 2026-fall/)).toBeTruthy();
    expect(screen.getAllByText("CS 1114").length).toBeGreaterThan(0);
    expect(screen.getAllByText("90001").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/MCB 204/).length).toBeGreaterThan(0);

    const risk = await screen.findByTestId("print-risk");
    expect(risk.textContent).toContain("41/100");
    expect(screen.getByText(/Heavy-course load/)).toBeTruthy();

    const commute = await screen.findByTestId("print-commute");
    expect(commute.textContent).toContain("impossible");
    expect(commute.textContent).toContain("MCB");
    expect(commute.textContent).toContain("WHI");

    expect(screen.getByText(/student-built planning tool/i)).toBeTruthy();
    expect(screen.getByText(/not forecasts of academic performance/i)).toBeTruthy();
  });

  it("prompts for another section instead of printing analysis", async () => {
    renderPrint("/?crns=90001");

    expect(await screen.findByText(/Add at least one more section/)).toBeTruthy();
  });
});
