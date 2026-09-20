import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Section } from "../api/types";
import { sectionFixture } from "../test/fixtures";
import { ScheduleProvider, useSchedule } from "./ScheduleContext";

const section90002: Section = { ...sectionFixture, crn: "90002", course_id: "MATH 2534" };
const section90009: Section = { ...sectionFixture, crn: "90009", course_id: "CS 4094" };

/** Exposes the context to assertions without rendering the whole planner. */
function Harness() {
  const schedule = useSchedule();
  return (
    <div>
      <output data-testid="crns">{schedule.crns.join(",")}</output>
      <output data-testid="selected">{schedule.selectedSections.map((s) => s.crn).join(",")}</output>
      <output data-testid="unavailable">{schedule.unavailableCrns.join(",")}</output>
      <button type="button" onClick={() => schedule.addSection(sectionFixture)}>
        add-90001
      </button>
      <button type="button" onClick={() => schedule.addSection(section90002)}>
        add-90002
      </button>
      <button type="button" onClick={() => schedule.registerSection(section90009)}>
        register-90009
      </button>
      <button type="button" onClick={() => schedule.removeCrn(sectionFixture.crn)}>
        remove-90001
      </button>
      <button type="button" onClick={schedule.clear}>
        clear
      </button>
    </div>
  );
}

function renderSchedule(initialEntry = "/") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <ScheduleProvider>
        <Harness />
      </ScheduleProvider>
    </MemoryRouter>,
  );
}

describe("ScheduleProvider selected-section cache", () => {
  it("reports URL-restored CRNs as unavailable until a Section is registered", () => {
    renderSchedule("/?crns=90009");

    expect(screen.getByTestId("crns").textContent).toBe("90009");
    expect(screen.getByTestId("selected").textContent).toBe("");
    expect(screen.getByTestId("unavailable").textContent).toBe("90009");

    fireEvent.click(screen.getByRole("button", { name: "register-90009" }));

    expect(screen.getByTestId("selected").textContent).toBe("90009");
    expect(screen.getByTestId("unavailable").textContent).toBe("");
  });

  it("addSection writes the URL and caches the full Section", async () => {
    renderSchedule("/");

    fireEvent.click(screen.getByRole("button", { name: "add-90001" }));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001"));
    expect(screen.getByTestId("selected").textContent).toBe("90001");
    expect(screen.getByTestId("unavailable").textContent).toBe("");
  });

  it("preserves URL selection order across adds", async () => {
    renderSchedule("/");

    fireEvent.click(screen.getByRole("button", { name: "add-90001" }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001"));
    fireEvent.click(screen.getByRole("button", { name: "add-90002" }));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001,90002"));
    expect(screen.getByTestId("selected").textContent).toBe("90001,90002");
  });

  it("prunes cached details when a CRN is removed", async () => {
    renderSchedule("/?crns=90001");

    // Hydrate the restored selection from an available Section object.
    fireEvent.click(screen.getByRole("button", { name: "register-90009" }));
    expect(screen.getByTestId("unavailable").textContent).toBe("90001");

    fireEvent.click(screen.getByRole("button", { name: "remove-90001" }));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe(""));
    expect(screen.getByTestId("selected").textContent).toBe("");
    expect(screen.getByTestId("unavailable").textContent).toBe("");
  });

  it("clears the URL selection and the cache", async () => {
    renderSchedule("/");

    fireEvent.click(screen.getByRole("button", { name: "add-90001" }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001"));
    fireEvent.click(screen.getByRole("button", { name: "add-90002" }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001,90002"));

    fireEvent.click(screen.getByRole("button", { name: "clear" }));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe(""));
    expect(screen.getByTestId("selected").textContent).toBe("");
    expect(screen.getByTestId("unavailable").textContent).toBe("");
  });

  it("never persists schedule data to local storage", async () => {
    renderSchedule("/");
    window.localStorage.clear();

    fireEvent.click(screen.getByRole("button", { name: "add-90001" }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001"));

    expect(window.localStorage.length).toBe(0);
  });
});
