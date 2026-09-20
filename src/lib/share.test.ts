import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShareUrl, canUseWebShare, copyToClipboard, shareSchedule } from "./share";

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

describe("buildShareUrl", () => {
  it("keeps the path and writes ordered CRNs as the only query parameter", () => {
    expect(buildShareUrl(["90001", "90002"], "https://plan.example.edu/app?crns=old&panel=insights")).toBe(
      "https://plan.example.edu/app?crns=90001,90002",
    );
  });

  it("omits the query entirely when nothing is selected", () => {
    expect(buildShareUrl([], "https://plan.example.edu/app?crns=90001")).toBe(
      "https://plan.example.edu/app",
    );
  });

  it("trims blanks and preserves selection order", () => {
    expect(buildShareUrl([" 90003 ", "90001", ""], "https://plan.example.edu/")).toBe(
      "https://plan.example.edu/?crns=90003,90001",
    );
  });
});

describe("canUseWebShare", () => {
  it("reflects the presence of navigator.share", () => {
    setShare(undefined);
    expect(canUseWebShare()).toBe(false);
    setShare(() => Promise.resolve());
    expect(canUseWebShare()).toBe(true);
  });
});

describe("copyToClipboard", () => {
  it("uses the async Clipboard API when present", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    await expect(copyToClipboard("hello")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  it("returns false when every copy path fails", async () => {
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("nope")) });
    await expect(copyToClipboard("hello")).resolves.toBe(false);
  });
});

describe("shareSchedule", () => {
  it("uses the Web Share API when available", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setShare(share);
    const result = await shareSchedule(["90001", "90002"], "https://plan.example.edu/");
    expect(result.method).toBe("web-share");
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://plan.example.edu/?crns=90001,90002" }),
    );
  });

  it("treats a user cancel as a clean no-op", async () => {
    setShare(vi.fn().mockRejectedValue({ name: "AbortError" }));
    const result = await shareSchedule(["90001"], "https://plan.example.edu/");
    expect(result.method).toBe("cancelled");
  });

  it("falls back to the clipboard when Web Share is unavailable", async () => {
    setShare(undefined);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard({ writeText });
    const result = await shareSchedule(["90001"], "https://plan.example.edu/");
    expect(result.method).toBe("clipboard");
    expect(writeText).toHaveBeenCalledWith("https://plan.example.edu/?crns=90001");
  });

  it("reports failure when even the clipboard copy fails", async () => {
    setShare(undefined);
    setClipboard({ writeText: vi.fn().mockRejectedValue(new Error("denied")) });
    const result = await shareSchedule(["90001"], "https://plan.example.edu/");
    expect(result.method).toBe("failed");
  });
});
