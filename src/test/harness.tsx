/* eslint-disable react-refresh/only-export-components -- test helpers export components and functions together. */
import { useEffect, type ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import { API_BASE_URL } from "../api/client";
import type { CourseGroup, Section } from "../api/types";
import { CenterViewProvider, useCenterView } from "../context/CenterViewContext";
import { CourseSearchProvider } from "../context/CourseSearchContext";
import { MapSelectionProvider } from "../context/MapSelectionContext";
import { ScheduleProvider, useSchedule } from "../context/ScheduleContext";
import { ToastProvider } from "../context/ToastContext";
import { server } from "./msw/server";

/** Seeds the in-memory section cache the way catalog search results would. */
function Seed({ sections }: { sections: Section[] }) {
  const { registerSections } = useSchedule();
  useEffect(() => {
    if (sections.length > 0) registerSections(sections);
  }, [sections, registerSections]);
  return null;
}

/** Exposes the URL's `crns` parameter. */
export function UrlProbe() {
  const [params] = useSearchParams();
  return <output data-testid="crns">{params.get("crns") ?? ""}</output>;
}

/** Exposes what the center panel is showing, for example `overview`, `add`, or `course:90001`. */
export function ViewProbe() {
  const { view } = useCenterView();
  return <output data-testid="view">{view.kind === "course" ? `course:${view.crn}` : view.kind}</output>;
}

interface HarnessOptions {
  route?: string;
  /**
   * Sections the catalog knows about. They are cached up front and the mocked catalog
   * search returns the same sections, so a later search can never overwrite them.
   * Omit to keep whatever search handler the test installed itself.
   */
  sections?: Section[];
}

/** Renders `ui` inside every provider the workspace uses, plus URL and view probes. */
export function renderInApp(ui: ReactElement, { route = "/", sections = [] }: HarnessOptions = {}) {
  if (sections.length > 0) {
    const groups = new Map<string, CourseGroup>();
    for (const section of sections) {
      const group = groups.get(section.course_id);
      if (group) group.sections.push(section);
      else
        groups.set(section.course_id, {
          course_id: section.course_id,
          title: section.title,
          credits: section.credits,
          sections: [section],
        });
    }
    server.use(
      http.get(`${API_BASE_URL}/courses/search`, () => HttpResponse.json({ courses: [...groups.values()] })),
    );
  }
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <ScheduleProvider>
          <CourseSearchProvider>
            <CenterViewProvider>
              <MapSelectionProvider>
                <ToastProvider>
                  <Seed sections={sections} />
                  {ui}
                  <UrlProbe />
                  <ViewProbe />
                </ToastProvider>
              </MapSelectionProvider>
            </CenterViewProvider>
          </CourseSearchProvider>
        </ScheduleProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

export function makeSection(
  base: Section,
  overrides: Partial<Section> & { crn: string; course_id: string },
): Section {
  return { ...base, title: `${overrides.course_id} title`, ...overrides };
}
