import { useEffect, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import AskGemini from "../components/AskGemini";
import HeroPanel from "../components/HeroPanel";
import CenterPanel from "../components/CenterPanel";
import SearchSidebar from "../components/SearchSidebar";
import EmptyState from "../components/EmptyState";
import CampusMap from "../components/CampusMap";
import RiskOverview from "../components/RiskOverview";
import PrintSchedule from "../components/PrintSchedule";
import WeeklyCalendar from "../components/WeeklyCalendar";
import { CourseSearchProvider } from "../context/CourseSearchContext";
import { MapSelectionProvider } from "../context/MapSelectionContext";
import { ProfessorDrawerProvider } from "../context/ProfessorDrawerContext";
import { ScheduleProvider } from "../context/ScheduleContext";
import { ToastProvider } from "../context/ToastContext";

type MobileView = "search" | "schedule" | "insights";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const MOBILE_TABS: { id: MobileView; label: string }[] = [
  { id: "search", label: "Search" },
  { id: "schedule", label: "Schedule" },
  { id: "insights", label: "Insights" },
];

function Disclaimers() {
  return (
    <footer className="shrink-0 border-t border-line bg-panel px-4 py-3 pb-16 text-center text-xs text-ink-secondary md:pb-3">
      HokieLens is a student-built planning tool and is not an official Virginia Tech registration
      service.
    </footer>
  );
}

/**
 * Single-page planning workspace shell.
 * - Desktop (≥1200px): three columns — search controls, hero/selection (replaced by
 *   course results while a search is active), workspace.
 * - Tablet (768–1199px): search becomes an off-canvas drawer; workspace stays.
 * - Mobile (<768px): single column with bottom Search / Schedule / Insights nav.
 * All regions are static this phase: no API calls, selection, or analysis.
 */
export default function PlannerPage() {
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileView, setMobileView] = useState<MobileView>("schedule");
  const searchDrawerRef = useRef<HTMLDivElement>(null);
  const searchCloseRef = useRef<HTMLButtonElement>(null);

  // Trap focus in the tablet search drawer, close on Escape, and restore focus
  // to the control that opened it (PRD §12.1, §12.4).
  useEffect(() => {
    if (!searchOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    searchCloseRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSearchOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = searchDrawerRef.current;
      if (!drawer) return;
      const focusable = Array.from(drawer.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => !element.hasAttribute("disabled"),
      );
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !drawer.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus?.();
    };
  }, [searchOpen]);

  return (
    <ScheduleProvider>
      <CourseSearchProvider>
      <MapSelectionProvider>
      <ProfessorDrawerProvider>
      <ToastProvider>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-panel focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-maroon focus:shadow-lg"
      >
        Skip to main content
      </a>
      <div className="print:hidden">
      <div className="flex h-dvh flex-col overflow-hidden bg-warm text-ink-primary">
        <AppHeader onOpenSearch={() => setSearchOpen(true)} />

      <main id="main-content" className="min-h-0 flex-1 overflow-y-auto lg:overflow-hidden">
        {/* Desktop three-column shell */}
        <div className="mx-auto hidden h-full max-w-[1800px] lg:grid lg:grid-cols-[290px_minmax(0,1.02fr)_minmax(0,1fr)] lg:gap-5 lg:px-6 lg:py-5 xl:px-8">
          <aside className="min-h-0 overflow-hidden">
            <SearchSidebar showResults={false} />
          </aside>
          {/* Hero + onboarding until the person searches, then course results. */}
          <div className="min-h-0 space-y-5 overflow-y-auto pr-1 hl-scroll">
            <CenterPanel />
          </div>
          <div className="min-h-0 space-y-5 overflow-y-auto hl-scroll">
            <CampusMap />
            <WeeklyCalendar showDemoPicker />
            <RiskOverview />
          </div>
        </div>

        {/* Tablet: compact hero banner + workspace; search lives in the drawer */}
        <div className="mx-auto hidden max-w-6xl space-y-5 px-5 py-5 md:block lg:hidden">
          <HeroPanel compact />
          <div className="grid gap-5 md:grid-cols-2">
            <CampusMap />
            <WeeklyCalendar showDemoPicker />
          </div>
          <RiskOverview />
          <EmptyState />
        </div>

        {/* Mobile: single column driven by the bottom nav */}
        <div className="space-y-4 px-4 py-4 pb-28 md:hidden">
          {mobileView === "search" ? <SearchSidebar /> : null}
          {mobileView === "schedule" ? (
            <>
              <HeroPanel compact />
              <WeeklyCalendar showDemoPicker />
              <CampusMap />
            </>
          ) : null}
          {mobileView === "insights" ? (
            <>
              <RiskOverview />
              <EmptyState />
            </>
          ) : null}
        </div>
      </main>

      <Disclaimers />

      {/* Tablet search drawer (off-canvas; hidden at desktop where the sidebar is visible) */}
      {searchOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Course search">
          <button
            type="button"
            aria-label="Close course search"
            className="absolute inset-0 h-full w-full bg-ink-primary/40"
            onClick={() => setSearchOpen(false)}
          />
          <aside
            ref={searchDrawerRef}
            className="relative h-full w-80 max-w-[85vw] overflow-y-auto border-r border-line bg-warm p-3 shadow-2xl hl-scroll"
          >
            <SearchSidebar />
            <button
              ref={searchCloseRef}
              type="button"
              onClick={() => setSearchOpen(false)}
              className="absolute right-5 top-5 rounded-md bg-panel p-2 text-ink-secondary shadow hover:text-ink-primary"
              aria-label="Close search drawer"
            >
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden="true">
                <path d="M3 3l10 10M13 3 3 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          </aside>
        </div>
      ) : null}

      {/* Mobile bottom navigation */}
      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-panel md:hidden"
      >
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            aria-pressed={mobileView === tab.id}
            onClick={() => setMobileView(tab.id)}
            className={`px-3 py-3 text-xs font-semibold transition-colors ${
              mobileView === tab.id
                ? "bg-soft-maroon text-maroon"
                : "text-ink-secondary hover:text-ink-primary"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <AskGemini />
      </div>
      </div>
      <PrintSchedule />
      </ToastProvider>
      </ProfessorDrawerProvider>
      </MapSelectionProvider>
      </CourseSearchProvider>
    </ScheduleProvider>
  );
}
