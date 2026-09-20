import { expect, test, type Page, type Route } from "@playwright/test";
import {
  analyzeFixture,
  demoSchedulesFixture,
  healthFixture,
  sectionFixture,
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
 * Frontend end-to-end smoke test (frontend PRD §15.3) plus state coverage
 * (§15.4) for the desktop-only workspace: Your Courses, one center panel, the map
 * with walking chips, and the calendar.
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
      body: { ...analyzeFixture, sections: crns.map(sectionByCrn) },
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
    if (path === "/api/chat/status") return json(route, 200, { enabled: false });
    if (method === "POST" && path === "/api/chat") {
      return json(route, 200, {
        reply: "This schedule scores 41 out of 100, a moderate week.",
        source: "unavailable",
        reason: "disabled",
        notice: "Ask Gemini is not switched on for this demo, so this is HokieLens's own read.",
      });
    }

    return route.fallback();
  });
}

// Desktop only: a wide window and the smallest supported one.
const VIEWPORTS = [
  { label: "1440x900", width: 1440, height: 900 },
  { label: "1280x720", width: 1280, height: 720 },
] as const;

/** The page itself never scrolls, in either direction; panels scroll on their own. */
async function expectPageDoesNotScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(overflow.x, "page-level horizontal overflow").toBeLessThanOrEqual(1);
  expect(overflow.y, "page-level vertical overflow").toBeLessThanOrEqual(1);
}

async function screenshot(page: Page, testInfo: { outputPath: (name: string) => string }, name: string) {
  await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
}

// ---------------------------------------------------------------------------
// §15.3 End-to-end happy path
// ---------------------------------------------------------------------------

test("happy path: demo week, per-course risk, walk chip, calendar details, chat, share", async ({ page }) => {
  // Force the clipboard fallback so the share flow is deterministic in CI.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    } catch {
      // Ignore: some engines expose a non-configurable share().
    }
  });
  await stubApi(page);

  // 1. Welcome screen: one primary action, an empty cart, and no header search.
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /plan a week you can actually walk/i })).toBeVisible();
  await expect(page.getByText("0 of 12 courses selected")).toBeVisible();
  await expect(page.getByRole("banner").first().getByRole("searchbox")).toHaveCount(0);

  // 2. Load the brutal demo (CRNs come from GET /api/demo/schedules only).
  await page.getByRole("button", { name: "The wall of pain" }).click();
  expect(new URL(page.url()).searchParams.get("crns")).toBe("90001,90003,90002,90005,90007");
  await expect(page.getByText("5 of 12 courses selected")).toBeVisible();
  await expect(page.locator('[data-testid="risk-score"]')).toHaveText("41");

  // 3. Every course shows its own risk, taken from the backend analysis.
  const cs1114 = page.getByRole("button", { name: /Open details for CS 1114/ });
  await expect(cs1114).toContainText("High risk");
  await expect(cs1114).toContainText("Impossible walk");

  // 4. Walking time is drawn on the map with the backend's verdict.
  const chip = page.getByRole("button", { name: /CS 1114 to CS 2114: 18 minute walk, impossible/ });
  await expect(chip).toContainText("18 min · Impossible");
  await chip.click();
  await expect(page.getByTestId("transition-details")).toContainText("Impossible");

  // 5. Clicking a class on the calendar opens its details in the center panel.
  await page.locator('[data-testid="calendar-grid"] [data-crn="90001"][data-day="M"]').click();
  const details = page.getByRole("region", { name: "Course details" });
  await expect(details.getByRole("heading", { name: "CS 1114" })).toBeVisible();
  await expect(details).toContainText("Ada Lovelace");
  await expect(details).toContainText("MCB 204");
  await expect(details).toContainText("Impossible walk");
  await details.getByRole("button", { name: "← Schedule overview" }).click();
  await expect(page.getByRole("region", { name: "Schedule overview" })).toBeVisible();

  // 6. Ask Gemini answers from the server, with a plain-language notice when it is off.
  await page.getByRole("button", { name: "Open Ask Gemini" }).click();
  await page.getByRole("button", { name: "Why is my schedule risky?" }).click();
  await expect(page.getByText("This schedule scores 41 out of 100, a moderate week.")).toBeVisible();
  await expect(page.getByText(/not switched on for this demo/)).toBeVisible();
  await page.keyboard.press("Escape");

  // 7. Remove a course from the cart; the URL follows.
  await page.getByRole("button", { name: "Remove ENGL 1105 (CRN 90007)" }).click();
  expect(new URL(page.url()).searchParams.get("crns")).toBe("90001,90003,90002,90005");

  // 8. Copy the share link.
  await page.locator('[data-testid="share-schedule"]').click();
  await expect(page.locator("p", { hasText: "copied to your clipboard" }).first()).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("crns=90001,90003,90002,90005");
});

test("adding a course: search from the cart, add a section, and finish", async ({ page }) => {
  await stubApi(page);
  await page.goto("/?crns=90001,90003");

  await page.getByRole("region", { name: "Your Courses" }).getByRole("button", { name: "Add a course" }).click();
  await expect(page.getByLabel("Search for a course")).toBeFocused();
  await page.getByLabel("Search for a course").fill("phys");
  await page.getByRole("button", { name: "Add section 90005" }).click();

  expect(new URL(page.url()).searchParams.get("crns")).toBe("90001,90003,90005");
  await expect(page.getByText("3 of 12 courses selected").first()).toBeVisible();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("region", { name: "Schedule overview" })).toBeVisible();
});

// ---------------------------------------------------------------------------
// §15.4 Visual / state coverage (desktop viewports only)
// ---------------------------------------------------------------------------

test("empty state: nothing overflows the page", async ({ page }, testInfo) => {
  await stubApi(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.locator('[data-testid="calendar-empty"]')).toBeVisible();
    await expect(page.locator('[data-testid="map-empty"]')).toBeVisible();
    await expectPageDoesNotScroll(page);
    await screenshot(page, testInfo, `empty-${viewport.label}`);
  }
});

test("populated state: the page never scrolls, and the calendar and cart are visible", async ({ page }, testInfo) => {
  await stubApi(page);
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?crns=90001,90003,90002");
    await expect(page.locator('[data-testid="calendar-grid"]')).toBeVisible();
    await expect(page.locator('[data-testid="risk-score"]')).toHaveText("41");
    await expect(page.getByRole("region", { name: "Your Courses" })).toBeVisible();
    await expectPageDoesNotScroll(page);
    await screenshot(page, testInfo, `populated-${viewport.label}`);
  }
});

test("conflict state lists every backend conflict once, without overflow", async ({ page }, testInfo) => {
  await stubApi(page, { analyze: () => ({ status: 422, body: CONFLICT_BODY }) });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/?crns=90001,90003");
    const conflicts = page.getByTestId("conflict-item");
    await expect(conflicts).toHaveCount(2);
    await expect(conflicts.first()).toContainText("90001 and 90003 overlap");
    await expect(page.getByTestId("map-analysis-error")).toBeVisible();
    await expectPageDoesNotScroll(page);
    await screenshot(page, testInfo, `conflict-${viewport.label}`);
  }
});

test("API-error state shows a plain retry surface", async ({ page }, testInfo) => {
  await stubApi(page, { searchStatus: 500, searchBody: { detail: "Catalog unavailable" } });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await page.getByRole("button", { name: "Search for a course" }).click();
    await page.getByRole("button", { name: "Browse all courses" }).click();
    await expect(page.getByText("Could not load courses")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expectPageDoesNotScroll(page);
    await screenshot(page, testInfo, `api-error-${viewport.label}`);
  }
});

test("loading state renders busy surfaces", async ({ page }, testInfo) => {
  await stubApi(page, { searchDelayMs: 1500, demoDelayMs: 1500 });
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/");
    await expect(page.locator('[aria-busy="true"]').first()).toBeVisible();
    await expectPageDoesNotScroll(page);
    await screenshot(page, testInfo, `loading-${viewport.label}`);
  }
});

test("keyboard-only user can reach search, open a class, and use the chat", async ({ page }) => {
  await stubApi(page);
  await page.goto("/?crns=90001,90003");

  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content/);

  await page.getByRole("button", { name: "Add a course" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Search for a course")).toBeFocused();
  await page.keyboard.type("CS");
  await expect(page.getByRole("button", { name: "Add section 90004" })).toBeVisible();

  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /CS 1114, Mon .*Open details/ }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("region", { name: "Course details" })).toBeVisible();

  await page.getByRole("button", { name: "Open Ask Gemini" }).click();
  const chat = page.getByRole("dialog", { name: "Ask Gemini" });
  await expect(chat).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(chat).toBeHidden();
});
