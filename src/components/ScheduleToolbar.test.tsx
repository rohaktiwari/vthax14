import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ScheduleProvider } from "../context/ScheduleContext";
import { ToastProvider } from "../context/ToastContext";
import ScheduleToolbar from "./ScheduleToolbar";

function setShare(value: unknown) {
  Object.defineProperty(navigator, "share", { configurable: true, writable: true, value });
}

function setClipboard(value: unknown) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, writable: true, value });
}

afterEach(() => {
  setShare(undefined);
  setClipboard(undefined);
  vi.restoreAllMocks();
});

function renderToolbar(initialEntry = "/?crns=90001,90002") {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <ScheduleProvider>
          <ToastProvider>
            <ScheduleToolbar />
          </ToastProvider>
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function shareUrl(crns: string): string {
  return `${window.location.origin}${window.location.pathname}?crns=${crns}`;
}

describe("ScheduleToolbar share", () => {
  it("copies the canonical URL with ordered CRNs when Web Share is unavailable", async () => {
    setShare(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    renderToolbar("/?crns=90002,90001");

    fireEvent.click(screen.getByTestId("share-schedule"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(shareUrl("90002,90001")));
    const toast = await screen.findByText(/copied to your clipboard/i);
    expect(toast.textContent).toContain("not saved");
    expect(toast.textContent).not.toMatch(/publicly saved|saved online|saved to/i);
  });

  it("uses the Web Share API when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    setShare(share);
    setClipboard({ writeText });
    renderToolbar("/?crns=90001,90002");

    fireEvent.click(screen.getByTestId("share-schedule"));

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith(
        expect.objectContaining({ url: shareUrl("90001,90002") }),
      ),
    );
    expect(writeText).not.toHaveBeenCalled();
    expect(await screen.findByText(/link shared/i)).toBeTruthy();
  });

  it("shows an accessible error toast when copying fails", async () => {
    setShare(undefined);
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      writable: true,
      value: vi.fn().mockReturnValue(false),
    });
    renderToolbar();

    fireEvent.click(screen.getByTestId("share-schedule"));

    expect(await screen.findByText(/could not copy the link/i)).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("disables share and print when no sections are selected", () => {
    renderToolbar("/");
    expect(screen.getByTestId("share-schedule")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("print-schedule")).toHaveProperty("disabled", true);
  });
});

describe("ScheduleToolbar print", () => {
  it("invokes the browser print dialog", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    renderToolbar();

    fireEvent.click(screen.getByTestId("print-schedule"));

    expect(print).toHaveBeenCalledTimes(1);
  });
});
