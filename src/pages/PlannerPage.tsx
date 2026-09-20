import AppHeader from "../components/AppHeader";
import CampusMap from "../components/CampusMap";
import CenterPanel from "../components/CenterPanel";
import PrintSchedule from "../components/PrintSchedule";
import WeeklyCalendar from "../components/WeeklyCalendar";
import YourCourses from "../components/YourCourses";
import { CenterViewProvider } from "../context/CenterViewContext";
import { CourseSearchProvider, useCourseSearch } from "../context/CourseSearchContext";
import { MapSelectionProvider } from "../context/MapSelectionContext";
import { ProfessorDrawerProvider } from "../context/ProfessorDrawerContext";
import { ScheduleProvider } from "../context/ScheduleContext";
import { ToastProvider } from "../context/ToastContext";
import { useHydrateFromAnalysis } from "../hooks/useScheduleAnalysis";

function Disclaimers() {
  return (
    <footer className="shrink-0 border-t border-line bg-panel px-4 py-2 text-center text-xs text-ink-secondary">
      HokieLens is a student-built planning tool and is not an official Virginia Tech registration
      service.
    </footer>
  );
}

/**
 * The desktop workspace: Your Courses on the left, one focused panel in the
 * middle, and the map and calendar on the right. The page itself never scrolls;
 * each column scrolls on its own only when its content is taller than the window.
 */
function Workspace() {
  const { isPending: catalogPending } = useCourseSearch();
  useHydrateFromAnalysis();

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-maroon focus:shadow-lg"
      >
        Skip to main content
      </a>
      <div className="print:hidden">
        <div className="flex h-dvh flex-col overflow-hidden bg-warm text-ink-primary">
          <AppHeader />
          <main id="main-content" className="min-h-0 flex-1">
            <div className="mx-auto grid h-full max-w-[1800px] grid-cols-[minmax(280px,320px)_minmax(0,1fr)_minmax(460px,36%)] gap-5 px-6 py-5">
              <aside className="min-h-0">
                <YourCourses />
              </aside>
              <div className="min-h-0 overflow-y-auto hl-scroll">
                <CenterPanel />
              </div>
              <div className="flex min-h-0 flex-col gap-5 overflow-y-auto hl-scroll">
                <CampusMap />
                <div className="flex min-h-[21.5rem] flex-1 flex-col">
                  <WeeklyCalendar hydrating={catalogPending} />
                </div>
              </div>
            </div>
          </main>
          <Disclaimers />
        </div>
      </div>
      <PrintSchedule />
    </>
  );
}

export default function PlannerPage() {
  return (
    <ScheduleProvider>
      <CourseSearchProvider>
        <CenterViewProvider>
          <MapSelectionProvider>
            <ProfessorDrawerProvider>
              <ToastProvider>
                <Workspace />
              </ToastProvider>
            </ProfessorDrawerProvider>
          </MapSelectionProvider>
        </CenterViewProvider>
      </CourseSearchProvider>
    </ScheduleProvider>
  );
}
