import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../api/client";
import type { CourseSearchResponse } from "../api/types";
import { useCenterView } from "../context/CenterViewContext";
import { renderInApp } from "../test/harness";
import { server } from "../test/msw/server";
import { courseSearchFixture, sectionFixture } from "../test/fixtures";
import CenterPanel from "./CenterPanel";

let searches: URLSearchParams[];

function mockSearch(respond: (params: URLSearchParams) => Response | Promise<Response>) {
  server.use(
    http.get(`${API_BASE_URL}/courses/search`, ({ request }) => {
      const params = new URL(request.url).searchParams;
      searches.push(params);
      return respond(params);
    }),
  );
}

function OpenAdd() {
  const { showAdd } = useCenterView();
  return (
    <button type="button" onClick={showAdd}>
      open add view
    </button>
  );
}

function renderAdd(route = "/") {
  const utils = renderInApp(
    <>
      <CenterPanel />
      <OpenAdd />
    </>,
    { route },
  );
  fireEvent.click(screen.getByRole("button", { name: "open add view" }));
  return utils;
}

beforeEach(() => {
  searches = [];
  mockSearch(() => HttpResponse.json(courseSearchFixture));
});

describe("AddCourses", () => {
  it("starts with a focused search box and a browse option, not a wall of options", () => {
    renderAdd();

    expect(document.activeElement).toBe(screen.getByLabelText("Search for a course"));
    expect(screen.getByRole("button", { name: "Browse all courses" })).toBeTruthy();
    const filters = screen.getByText(/^Filters/).closest("details") as HTMLDetailsElement;
    expect(filters.open).toBe(false);
  });

  it("searches as you type once there are two characters and lists sections to add", async () => {
    renderAdd();

    fireEvent.change(screen.getByLabelText("Search for a course"), { target: { value: "cs" } });

    expect(await screen.findByText("CS 1114")).toBeTruthy();
    await waitFor(() => expect(searches.some((params) => params.get("q") === "cs")).toBe(true));
    const add = screen.getByRole("button", { name: "Add section 90001" });
    expect(add.className).toContain("bg-maroon");
    expect(screen.getByText(/42 of 120 seats open/)).toBeTruthy();
  });

  it("adds and removes a section and keeps the progress count in step", async () => {
    renderAdd();
    fireEvent.change(screen.getByLabelText("Search for a course"), { target: { value: "cs" } });

    fireEvent.click(await screen.findByRole("button", { name: "Add section 90001" }));

    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe("90001"));
    expect(screen.getByText("Added")).toBeTruthy();
    expect(screen.getByText("1 of 12 courses selected")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Remove section 90001" }));
    await waitFor(() => expect(screen.getByTestId("crns").textContent).toBe(""));
    expect(screen.getByText("0 of 12 courses selected")).toBeTruthy();
  });

  it("browses the whole catalog with an explicit search", async () => {
    renderAdd();

    fireEvent.click(screen.getByRole("button", { name: "Browse all courses" }));

    expect(await screen.findByText("CS 1114")).toBeTruthy();
    await waitFor(() => expect(searches.some((params) => !params.has("q"))).toBe(true));
  });

  it("filters by open seats on the client and counts active filters", async () => {
    const fullSection = { ...sectionFixture, crn: "90002", seats: { max: 30, available: 0 } };
    const response: CourseSearchResponse = {
      courses: [{ ...courseSearchFixture.courses[0]!, sections: [sectionFixture, fullSection] }],
    };
    mockSearch(() => HttpResponse.json(response));
    renderAdd();
    fireEvent.click(screen.getByRole("button", { name: "Browse all courses" }));
    expect(await screen.findByRole("button", { name: "Add section 90002" })).toBeTruthy();
    expect(screen.getByText("Full", { exact: false })).toBeTruthy();

    fireEvent.click(screen.getByText(/^Filters/));
    fireEvent.click(screen.getByLabelText("Only show classes with open seats"));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Add section 90002" })).toBeNull());
    expect(screen.getByRole("button", { name: "Add section 90001" })).toBeTruthy();
    expect(screen.getByText("Filters (1 on)")).toBeTruthy();
  });

  it("shows loading skeletons while a search is in flight", async () => {
    mockSearch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return HttpResponse.json(courseSearchFixture);
    });
    renderAdd();

    fireEvent.change(screen.getByLabelText("Search for a course"), { target: { value: "cs" } });

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeTruthy());
    expect(await screen.findByText("CS 1114")).toBeTruthy();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it("explains an empty result and a failed search in plain sentences, with a way to retry", async () => {
    mockSearch(() => HttpResponse.json({ courses: [] }));
    renderAdd();
    fireEvent.change(screen.getByLabelText("Search for a course"), { target: { value: "zzz" } });
    expect(await screen.findByText("No matching courses")).toBeTruthy();
    expect(screen.getByText(/Nothing matched “zzz”/)).toBeTruthy();

    mockSearch(() => HttpResponse.json({ detail: "boom" }, { status: 500 }));
    fireEvent.change(screen.getByLabelText("Search for a course"), { target: { value: "zzzz" } });
    const alert = await screen.findByText("Could not load courses");
    const box = alert.closest('[role="alert"]') as HTMLElement;
    expect(box.textContent).not.toMatch(/[{}]|<html|Traceback/);
    expect(within(box).getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("Done clears the search and returns to the overview", async () => {
    renderAdd("/?crns=90001");
    fireEvent.change(screen.getByLabelText("Search for a course"), { target: { value: "cs" } });
    await screen.findByText("CS 1114");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(screen.getByTestId("view").textContent).toBe("overview");
    expect(screen.queryByRole("region", { name: "Add a course" })).toBeNull();
  });

  it("stops offering Add once 12 courses are selected", async () => {
    const crns = Array.from({ length: 12 }, (_, index) => String(91000 + index));
    renderAdd(`/?crns=${crns.join(",")}`);
    fireEvent.click(screen.getByRole("button", { name: "Browse all courses" }));

    const add = await screen.findByRole("button", { name: "Add section 90001" });
    expect(add).toHaveProperty("disabled", true);
    expect(screen.getByText("Maximum of 12 sections selected.")).toBeTruthy();
  });
});
