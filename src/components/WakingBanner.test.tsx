import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const health = vi.hoisted(() => ({ isPending: true }));
vi.mock("../api/hooks", () => ({ useHealth: () => health }));

import WakingBanner, { SLOW_HEALTH_MS } from "./WakingBanner";

describe("WakingBanner", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    health.isPending = true;
  });
  afterEach(() => vi.useRealTimers());

  it("stays hidden at first, then explains the wait when the health check is slow", () => {
    render(<WakingBanner />);
    expect(screen.queryByTestId("waking-banner")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(SLOW_HEALTH_MS + 50);
    });
    expect(screen.getByTestId("waking-banner").textContent).toMatch(/waking up the server/i);
  });

  it("never shows once the API has answered", () => {
    health.isPending = false;
    render(<WakingBanner />);
    act(() => {
      vi.advanceTimersByTime(SLOW_HEALTH_MS * 3);
    });
    expect(screen.queryByTestId("waking-banner")).toBeNull();
  });
});
