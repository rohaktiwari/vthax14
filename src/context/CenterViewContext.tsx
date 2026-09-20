/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the provider component and its hook together. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { useSchedule } from "./ScheduleContext";

/** What the center panel is showing. Presentation state only; never written to the URL. */
export type CenterView =
  | { kind: "overview" }
  | { kind: "course"; crn: string }
  | { kind: "add" };

export interface CenterViewState {
  view: CenterView;
  /** The CRN whose details are open, or null. */
  focusedCrn: string | null;
  showOverview: () => void;
  showCourse: (crn: string) => void;
  showAdd: () => void;
}

const OVERVIEW: CenterView = { kind: "overview" };

/** No-op default so calendar, map, and chat render in isolated tests. */
const DEFAULT_STATE: CenterViewState = {
  view: OVERVIEW,
  focusedCrn: null,
  showOverview: () => {},
  showCourse: () => {},
  showAdd: () => {},
};

const CenterViewContext = createContext<CenterViewState>(DEFAULT_STATE);

export function CenterViewProvider({ children }: { children: ReactNode }) {
  const { crns } = useSchedule();
  const [requested, setRequested] = useState<CenterView>(OVERVIEW);

  // A course that is no longer selected cannot stay open.
  const view = requested.kind === "course" && !crns.includes(requested.crn) ? OVERVIEW : requested;

  const showOverview = useCallback(() => setRequested(OVERVIEW), []);
  const showCourse = useCallback((crn: string) => setRequested({ kind: "course", crn }), []);
  const showAdd = useCallback(() => setRequested({ kind: "add" }), []);

  const value = useMemo<CenterViewState>(
    () => ({
      view,
      focusedCrn: view.kind === "course" ? view.crn : null,
      showOverview,
      showCourse,
      showAdd,
    }),
    [view, showOverview, showCourse, showAdd],
  );

  return <CenterViewContext.Provider value={value}>{children}</CenterViewContext.Provider>;
}

export function useCenterView(): CenterViewState {
  return useContext(CenterViewContext);
}
