import { expect, test, type Page, type Route } from "@playwright/test";
import {
  analyzeFixture,
  demoSchedulesFixture,
  healthFixture,
  sectionFixture,
  stressFixture,
  swapFixture,
  vibesFixture,
} from "../src/test/fixtures";
import type {
  BuildingsMatrixResponse,
  CourseSearchResponse,
  Meeting,
  Section,
  Weekday,
} from "../src/api/types";

/**
 * Frontend end-to-end smoke test (frontend PRD §15.3) plus responsive/state
 * coverage (§15.4).
 *
 * The documented backend routes are fulfilled at the browser boundary with
 * contract-matching fixtures. No backend process is started and no Python or
 * server command is run by the frontend; `VITE_API_BASE_URL=/api` keeps the
 * requests same-origin so they can be intercepted without CORS shims.
 *
 * Demo CRNs are never hardcoded in the UI: they arrive from the stubbed
 * `GET /api/demo/schedules`. The catalog fixture below only makes the matching
 * Section objects available, the same way real search results would, because
 * the documented contract has no section-by-CRN endpoint.
 */

// ---------------------------------------------------------------------------
// Contract-shaped catalog fixtures (mirror GET /api/courses/search)
// ---------------------------------------------------------------------------

function meeting(
  days: Weekday[],
  start: number,
  end: number,
  building: string,
  room: string,
): Meeting {
  return {
    days,
    start_min: start,
    end_min: end,
    building,
    room,
    start_date: "2026-08-24",
    end_date: "2026-12-09",
  };
}

function makeSection(partial: Partial<Section>): Section {
  return { ...sectionFixture, ...partial };
}

// CRNs intentionally match `demoSchedulesFixture` (brutal, easy, swap_demo) so a
// demo selection can be hydrated from search results.
const SECTIONS: Section[] = [
  makeSection({}), // 90001 CS 1114, M/W/F 610–700 MCB 204
  makeSection({
    crn: "90002",
    course_id: "MATH 2534",
    subject: "MATH",
    course_no: "2534",
    title: "Introduction to Differential Equations",
    credits: 4,
    instructor_names: ["Grace Hopper"],
    meetings: [meeting(["T", "R"], 720, 810, "WHI", "155")],
  }),
  makeSection({
    crn: "90003",
    course_id: "CS 2114",
    subject: "CS",
    course_no: "2114",
    title: "Software Design and Data Structures",
    credits: 3,
    instructor_names: ["Alan Turing"],
    meetings: [meeting(["M", "W", "F"], 710, 800, "WHI", "160")],
  }),
  makeSection({
    crn: "90004",
    course_id: "CS 2114",
    subject: "CS",
    course_no: "2114",
    title: "Software Design and Data Structures",
    credits: 3,
    instructor_names: ["Alan Turing"],
    meetings: [meeting(["M", "W", "F"], 1115, 1205, "TORG", "100")],
  }),
  makeSection({
    crn: "90005",
    course_id: "PHYS 2305",
    subject: "PHYS",
    course_no: "2305",
    title: "Foundations of Physics",
    credits: 4,
    instructor_names: ["Richard Feynman"],
    meetings: [meeting(["T", "R"], 900, 950, "TORG", "200")],
  }),
  makeSection({
    crn: "90007",
    course_id: "ENGL 1105",
    subject: "ENGL",
    course_no: "1105",
    title: "First-Year Writing",
    credits: 3,
    instructor_names: ["Maya Angelou"],
    meetings: [meeting(["M", "W"], 1000, 1050, "MCB", "100")],
  }),
  makeSection({
    crn: "90008",
    course_id: "PSYC 1004",
    subject: "PSYC",
    course_no: "1004",
    title: "Introductory Psychology",
    credits: 3,
    instructor_names: ["B. F. Skinner"],
    meetings: [meeting(["T", "R"], 1130, 1220, "TORG", "300")],
  }),
];

function sectionByCrn(crn: string): Section {
  const found = SECTIONS.find((section) => section.crn === crn);
  if (!found) throw new Error(`Test fixture missing section ${crn}`);
  return found;
}

const CATALOG: CourseSearchResponse = {
  courses: [
    { course_id: "CS 1114", title: "Introduction to Software Design", credits: 3, sections: [sectionByCrn("90001")] },
    {
      course_id: "CS 2114",
      title: "Software Design and Data Structures",
      credits: 3,
      sections: [sectionByCrn("90003"), sectionByCrn("90004")],
    },
    {
      course_id: "MATH 2534",
      title: "Introduction to Differential Equations",
      credits: 4,
      sections: [sectionByCrn("90002")],
    },
    { course_id: "PHYS 2305", title: "Foundations of Physics", credits: 4, sections: [sectionByCrn("90005")] },
    { course_id: "ENGL 1105", title: "First-Year Writing", credits: 3, sections: [sectionByCrn("90007")] },
    { course_id: "PSYC 1004", title: "Introductory Psychology", credits: 3, sections: [sectionByCrn("90008")] },
  ],
};

const BUILDINGS: BuildingsMatrixResponse = {
  buildings: {
    MCB: {
      name: "McBryde Hall",
      place_id: null,
      lat: 37.2295,
      lng: -80.421,
      address: null,
      verified: true,
      source: "manual_fix",
      fetched_at: null,
    },
    WHI: {
      name: "Whittemore Hall",
      place_id: null,
      lat: 37.2305,
      lng: -80.4245,
      address: null,
      verified: true,
      source: "manual_fix",
      fetched_at: null,
    },
    TORG: {
      name: "Torgersen Hall",
      place_id: null,
      lat: 37.229,
      lng: -80.423,
      address: null,
      verified: true,
      source: "manual_fix",
      fetched_at: null,
    },
  },
  walk: { "MCB|WHI": 18, "MCB|TORG": 9, "TORG|WHI": 6 },
};

const CONFLICT_BODY = {
  detail: {
    code: "meeting_overlap",
    message: "Two selected sections meet at the same time.",
    conflicts: [
      { crns: ["90001", "90003"], day: "M", start: "11:40", end: "11:50" },
      { crns: ["90002", "90005"], day: "T", start: "12:00", end: "12:10" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Route stubbing helpers
// ---------------------------------------------------------------------------

interface StubOptions {
  searchStatus?: number;
  searchBody?: unknown;
  searchDelayMs?: number;
  demoDelayMs?: number;
  /** Return the analyze status/body for the requested CRNs. */
  analyze?: (crns: string[]) => { status: number; body: unknown };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function crnsFrom(request: { postData: () => string | null }): string[] {
  const raw = request.postData();
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRecord(parsed) && Array.isArray(parsed.crns)) {
      return parsed.crns.filter((value): value is string => typeof value === "string");
    }
  } catch {
    // Fall through to an empty list; the route still returns a valid response.
  }
  return [];
}

function json(route: Route, status: number, body: unknown): Promise<void> {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stubApi(page: Page, options: StubOptions = {}): Promise<void> {
  const {
    searchStatus = 200,
    searchBody = CATALOG,
    searchDelayMs = 0,
    demoDelayMs = 0,
    analyze = (crns: string[]) => ({
      status: 200,
      body: crns.includes("90004") ? { ...analyzeFixture, risk_score: 25 } : analyzeFixture,
    }),
  } = options;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();

    if (path === "/api/health") return json(route, 200, healthFixture);
    if (path === "/api/demo/schedules") {
      if (demoDelayMs > 0) await delay(demoDelayMs);
      return json(route, 200, demoSchedulesFixture);
    }
    if (path === "/api/courses/search") {
      if (searchDelayMs > 0) await delay(searchDelayMs);
      return json(route, searchStatus, searchBody);
    }
    if (path === "/api/buildings/matrix") return json(route, 200, BUILDINGS);
    if (path.startsWith("/api/professors/")) return json(route, 200, vibesFixture);
    if (method === "POST" && path === "/api/analyze") {
      const result = analyze(crnsFrom(request));
      return json(route, result.status, result.body);
    }
    if (method === "POST" && path === "/api/swap") return json(route, 200, swapFixture);
    if (method === "POST" && path === "/api/stress") return json(route, 200, stressFixture);

    return route.fallback();
  });
}

const VIEWPORTS = [
  { label: "1440x900-desktop", width: 1440, height: 900 },
  { label: "1024x768-tablet-landscape", width: 1024, height: 768 },
  { label: "768x1024-tablet-portrait", width: 768, height: 1024 },
  { label: "390x844-mobile", width: 390, height: 844 },
] as const;

async function expectNoPageOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page-level horizontal overflow").toBeLessThanOrEqual(1);
}

/**
 * Reveal a panel at the current breakpoint. Mobile uses the bottom navigation;
 * the 768–1023px tablet layout hides search behind a header-triggered drawer.
 * At desktop widths (≥1024px) results live in the center column instead of the
 * sidebar and only replace the hero once a search runs, so "Search" submits an
 * empty query (the first page of the catalog).
 */
async function openPanel(page: Page, width: number, tab: "Search" | "Schedule" | "Insights") {
  if (width < 768) {
    await page.getByRole("button", { name: tab, exact: true }).click();
    return;
  }
  if (tab === "Search" && width < 1024) {
    await page.getByRole("button", { name: "Search courses" }).click();
    return;
  }
  if (tab === "Search") {
    await page.getByRole("button", { name: "Search Classes" }).click();
  }
}

async function screenshot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

// ---------------------------------------------------------------------------
// §15.3 End-to-end happy path
// ---------------------------------------------------------------------------

test("happy path: demo, calendar, analysis, commute, stress, swap, share", async ({ page }) => {
  // Force the clipboard fallback so the share flow is deterministic in CI.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    } catch {
      // Ignore: some engines expose a non-configurable share().
    }
  });
  await stubApi(page);

  // 1. Open the planner. The startup catalog request hydrates section details.
  //    Results stay out of the way (hero shown) until the person searches, then
  //    they replace the hero in the center column.
  await page.goto("/");
  await expect(page.locator('[data-testid="schedule-summary"]:visible')).toContainText("Plan, adjust");
  await expect(page.getByText("Burruss Hall").filter({ visible: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add section 90001/ })).toBeHidden();
  await page.getByRole("button", { name: "Search Classes" }).click();
  await expect(page.getByRole("region", { name: "Course search results" })).toBeVisible();
  await expect(page.getByText("Burruss Hall").filter({ visible: true })).toBeHidden();
  await expect(page.getByRole("button", { name: /Add section 90001/ })).toBeVisible();
  await page.getByRole("button", { name: /Back to overview/ }).click();
  await expect(page.getByText("Burruss Hall").filter({ visible: true })).toBeVisible();

  // 2. Load the brutal demo (CRNs come from GET /api/demo/schedules only).
  await page.getByRole("button", { name: "The wall of pain" }).first().click();
  expect(new URL(page.url()).searchParams.get("crns")).toBe("90001,90003,90002,90005,90007");

  // 3. Calendar events and risk analysis appear.
  await expect(page.locator('[data-testid="calendar-grid"]:visible')).toBeVisible();
  await expect(page.locator('[data-crn="90001"]:visible').first()).toBeVisible();
  await expect(page.locator('[data-testid="risk-score"]:visible')).toHaveText("41");

  // 4. Open a commute warning (the interactive textual map equivalent).
  await page.getByRole("button", { name: /CS 1114 \(MCB\).*CS 2114 \(WHI\)/ }).click();
  const transition = page.locator('[data-testid="transition-details"]:visible');
  await expect(transition).toContainText("Verdict: Impossible");
  await expect(transition).toContainText("Walk 18 min");

  // 5. Run the miss-week stress test.
  await page.locator('[data-testid="run-stress"]:visible').click();
  const stress = page.locator('[data-testid="stress-result"]:visible');
  await expect(stress).toContainText("Original: 41");
  await expect(stress).toContainText("Stressed: 46");
  await expect(page.locator('[data-testid="stress-delta"]:visible')).toContainText(
    "Risk increases by 5 points (41 → 46).",
  );
  await expect(page.locator('[data-testid="stress-disclaimer"]:visible')).toContainText(
    "not a forecast",
  );

  // 6. Load the swap demo (confirmation required because a schedule exists).
  await page.getByRole("button", { name: "Swap demo" }).first().click();
  await page.locator('[data-testid="demo-confirm-accept"]:visible').click();
  await page.locator('[data-testid="open-swap-from-demo"]:visible').first().click();

  // 7. Preview and apply the swap.
  const workbench = page.locator('[data-testid="swap-workbench"]:visible');
  await expect(workbench).toBeVisible();
  await expect(page.locator('[data-testid="swap-drop"]:visible')).toHaveValue("90003");
  await page.locator('[data-testid="swap-preview"]:visible').click();
  await expect(page.locator('[data-testid="swap-result"]:visible')).toBeVisible();
  await expect(page.locator('[data-testid="swap-delta"]:visible')).toContainText(
    "Risk decreases by 16 points (41 → 25).",
  );
  await expect(page.locator('[data-testid="swap-summary-risk"]:visible')).toContainText("41 → 25");
  await page.locator('[data-testid="swap-apply"]:visible').click();
  await expect(workbench).toBeHidden();

  // 8. URL and risk result update after the confirmed swap.
  expect(new URL(page.url()).searchParams.get("crns")).toBe("90001,90004,90002");
  await expect(page.locator('[data-testid="risk-score"]:visible')).toHaveText("25");

  // 9. Copy the share link.
  await page.locator('[data-testid="share-schedule"]:visible').click();
  await expect(page.locator("p", { hasText: "copied to your clipboard" }).first()).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("crns=90001,90004,90002");
});

// ---------------------------------------------------------------------------
// §15.4 Visual / responsive coverage
// ---------------------------------------------------------------------------

test("empty state: no page overflow at required viewports", async ({ page }, testInfo) => {
  await stubApi(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.locator('[data-testid="calendar-empty"]:visible')).toBeVisible();
    await expect(page.locator('[data-testid="map-empty"]:visible')).toBeVisible();
    await expectNoPageOverflow(page);
    await screenshot(page, testInfo, `empty-${viewport.label}`);
  }
});

test("populated state: no page overflow at required viewports", async ({ page }, testInfo) => {
  await stubApi(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?crns=90001,90003,90002");
    await expect(page.locator('[data-testid="calendar-grid"]:visible')).toBeVisible();
    await expectNoPageOverflow(page);
    await screenshot(page, testInfo, `populated-${viewport.label}`);
    await openPanel(page, viewport.width, "Insights");
    await expect(page.locator('[data-testid="risk-score"]:visible')).toHaveText("41");
    await expectNoPageOverflow(page);
    await screenshot(page, testInfo, `populated-insights-${viewport.label}`);
  }
});

test("conflict state lists every backend conflict without overflow", async ({ page }, testInfo) => {
  await stubApi(page, { analyze: () => ({ status: 422, body: CONFLICT_BODY }) });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?crns=90001,90003");
    await openPanel(page, viewport.width, "Insights");
    const conflicts = page.getByTestId("conflict-item").filter({ visible: true });
    // Two conflicts in the insights panel; the map panel adds two more on desktop/tablet.
    await expect(conflicts).toHaveCount(viewport.width < 768 ? 2 : 4);
    await expect(conflicts.first()).toContainText("90001 and 90003 overlap");
    await expectNoPageOverflow(page);
    await screenshot(page, testInfo, `conflict-${viewport.label}`);
  }
});

test("API-error state shows a retry surface without overflow", async ({ page }, testInfo) => {
  await stubApi(page, { searchStatus: 500, searchBody: { detail: "Catalog unavailable" } });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await openPanel(page, viewport.width, "Search");
    await expect(page.getByText("Could not load courses").filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expectNoPageOverflow(page);
    await screenshot(page, testInfo, `api-error-${viewport.label}`);
  }
});

test("loading state renders busy surfaces without overflow", async ({ page }, testInfo) => {
  await stubApi(page, { searchDelayMs: 1500, demoDelayMs: 1500 });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await openPanel(page, viewport.width, "Search");
    await expect(page.locator('[aria-busy="true"]:visible').first()).toBeVisible();
    await expectNoPageOverflow(page);
    await screenshot(page, testInfo, `loading-${viewport.label}`);
  }
});

test("keyboard-only user can reach search and the help panel", async ({ page }) => {
  await stubApi(page);
  await page.goto("/");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);

  await page.getByLabel("Search for a course").focus();
  await page.keyboard.type("CS");
  await expect(page.getByRole("button", { name: "Search Classes" })).toBeVisible();

  await page.getByRole("button", { name: "Open Ask HokieLens help" }).click();
  const help = page.getByRole("dialog", { name: "Ask HokieLens" });
  await expect(help).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toBeHidden();
});
