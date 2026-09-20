import { describe, expect, it } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { ChatRequest, Section } from "../api/types";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import { server } from "../test/msw/server";
import { sectionFixture } from "../test/fixtures";
import AskGemini, { GEMINI_STARTERS } from "./AskGemini";

function Seed({ sections }: { sections: Section[] }) {
  const { registerSections } = useSchedule();
  useEffect(() => {
    registerSections(sections);
  }, [registerSections, sections]);
  return null;
}

function renderChat(initialEntry = "/?crns=90001,90002") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <Seed sections={[sectionFixture]} />
          <AskGemini />
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function openChat() {
  fireEvent.click(screen.getByRole("button", { name: "Open Ask Gemini" }));
  return screen.findByRole("dialog", { name: "Ask Gemini" });
}

describe("AskGemini", () => {
  it("opens a chat with starter questions and a free-text input", async () => {
    renderChat();
    const dialog = await openChat();
    for (const prompt of GEMINI_STARTERS) {
      expect(within(dialog).getByRole("button", { name: prompt })).toBeTruthy();
    }
    expect(within(dialog).getByLabelText("Message Ask Gemini")).toBeTruthy();
  });

  it("offers only the how-to starter until two courses are selected", async () => {
    renderChat("/?crns=90001");
    const dialog = await openChat();
    expect(within(dialog).getByRole("button", { name: "How do I use this planner?" })).toBeTruthy();
    expect(within(dialog).queryByRole("button", { name: "Why is this schedule risky?" })).toBeNull();
  });

  it("sends the current CRNs and shows a grounded reply", async () => {
    const captured: { body: ChatRequest | null } = { body: null };
    server.use(
      http.get(`${API_BASE_URL}/chat/status`, () => HttpResponse.json({ enabled: true })),
      http.post(`${API_BASE_URL}/chat`, async ({ request }) => {
        captured.body = (await request.json()) as ChatRequest;
        return HttpResponse.json({
          reply: "Your risk score is 41. Tuesday looks heavy because of back-to-back density.",
          source: "gemini",
          reason: null,
          notice: null,
        });
      }),
    );

    renderChat();
    const dialog = await openChat();
    fireEvent.click(within(dialog).getByRole("button", { name: "Why is this schedule risky?" }));

    expect(await screen.findByText(/risk score is 41/i)).toBeTruthy();
    await waitFor(() => {
      expect(captured.body?.crns).toEqual(["90001", "90002"]);
      expect(captured.body?.messages[0]?.content).toBe("Why is this schedule risky?");
    });
    expect(screen.queryByText(/not switched on/i)).toBeNull();
  });

  it("says Gemini is off and still shows a usable local answer with the server's notice", async () => {
    renderChat();
    const dialog = await openChat();
    expect(await within(dialog).findByText(/gemini is off here/i)).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "What should I swap?" }));
    expect(await screen.findByText(/your courses is empty/i)).toBeTruthy();
    expect(await screen.findByText(/not switched on for this demo/i)).toBeTruthy();
  });

  it("shows a loading placeholder while waiting and a readable error with retry", async () => {
    let attempts = 0;
    server.use(
      http.post(`${API_BASE_URL}/chat`, async () => {
        attempts += 1;
        if (attempts === 1) {
          return HttpResponse.json(
            { detail: "You are sending questions too fast. Wait a minute and try again." },
            { status: 429 },
          );
        }
        return HttpResponse.json({
          reply: "Second try worked.",
          source: "gemini",
          reason: null,
          notice: null,
        });
      }),
    );

    renderChat();
    const dialog = await openChat();
    fireEvent.click(within(dialog).getByRole("button", { name: "What should I swap?" }));

    expect(screen.getByRole("status", { name: /reading your schedule/i })).toBeTruthy();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/sending questions too fast/i);
    expect(alert.textContent).not.toMatch(/[{}]|429|status/);

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Second try worked.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(attempts).toBe(2);
  });

  it("closes on Escape and restores focus to the trigger", async () => {
    renderChat();
    const trigger = screen.getByRole("button", { name: "Open Ask Gemini" });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole("dialog", { name: "Ask Gemini" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Ask Gemini" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});
