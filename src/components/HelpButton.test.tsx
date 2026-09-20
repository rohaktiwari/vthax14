import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import type { Section } from "../api/types";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import { sectionFixture } from "../test/fixtures";
import HelpButton from "./HelpButton";

function Seed({ sections }: { sections: Section[] }) {
  const { registerSections } = useSchedule();
  useEffect(() => {
    registerSections(sections);
  }, [registerSections, sections]);
  return null;
}

function renderHelp(initialEntry = "/?crns=90001,90002") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <Seed sections={[sectionFixture]} />
          <HelpButton />
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("HelpButton", () => {
  it("offers exactly the predefined prompts and no free-text chat input", async () => {
    renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "Open Ask HokieLens help" }));

    const dialog = await screen.findByRole("dialog", { name: "Ask HokieLens" });
    expect(within(dialog).getByText("Why is my risk high?")).toBeTruthy();
    expect(within(dialog).getByText("Which commute is hardest?")).toBeTruthy();
    expect(within(dialog).getByText("What does GPA confidence mean?")).toBeTruthy();
    expect(within(dialog).getByText("How can I compare sections?")).toBeTruthy();
    expect(within(dialog).queryByRole("textbox")).toBeNull();
    expect(dialog.textContent).toMatch(/no generative AI/i);
  });

  it("answers a predefined prompt from the current backend analysis", async () => {
    renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "Open Ask HokieLens help" }));
    await screen.findByRole("dialog", { name: "Ask HokieLens" });

    fireEvent.click(screen.getByRole("button", { name: "Why is my risk high?" }));

    expect(await screen.findByText(/41\/100/)).toBeTruthy();
    expect(screen.getByText(/Heavy-course load/)).toBeTruthy();
    expect(screen.getByText(/not a prediction/)).toBeTruthy();
  });

  it("explains how to compare sections deterministically", async () => {
    renderHelp();
    fireEvent.click(screen.getByRole("button", { name: "Open Ask HokieLens help" }));
    await screen.findByRole("dialog", { name: "Ask HokieLens" });

    fireEvent.click(screen.getByRole("button", { name: "How can I compare sections?" }));

    expect(await screen.findByText(/swap workbench/i)).toBeTruthy();
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    renderHelp();
    const trigger = screen.getByRole("button", { name: "Open Ask HokieLens help" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Ask HokieLens" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Ask HokieLens" })).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
  });
});
