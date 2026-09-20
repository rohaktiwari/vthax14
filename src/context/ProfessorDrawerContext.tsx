/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the provider component and its hook together. */
import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// Code-split so the drawer (and its professor UI) is only fetched when opened.
const LazyProfessorDrawer = lazy(() => import("../components/ProfessorDrawer"));

export interface ProfessorDrawerTarget {
  /** Surname used in the documented `/professors/{surname}/vibes` path. */
  surname: string;
  /** Full display name from section data, shown in the drawer heading. */
  displayName: string;
}

export interface ProfessorDrawerController {
  openProfessor: (target: ProfessorDrawerTarget, returnFocusTo?: HTMLElement | null) => void;
  closeProfessor: () => void;
  isOpen: boolean;
  openTarget: ProfessorDrawerTarget | null;
}

/** No-op default so instructor-name triggers render in isolated tests. */
const DEFAULT_CONTROLLER: ProfessorDrawerController = {
  openProfessor: () => {},
  closeProfessor: () => {},
  isOpen: false,
  openTarget: null,
};

const ProfessorDrawerContext = createContext<ProfessorDrawerController>(DEFAULT_CONTROLLER);

interface OpenState {
  target: ProfessorDrawerTarget;
  returnFocusTo: HTMLElement | null;
  key: number;
}

/** Suspense fallback while the lazily-imported drawer chunk loads. */
function DrawerFallback({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink-primary/40">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Instructor details"
        aria-busy="true"
        className="h-full w-full max-w-md overflow-y-auto bg-panel p-5 shadow-xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink-primary">Instructor details</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close instructor details"
            className="rounded-lg border border-line bg-panel px-2.5 py-1 text-xs font-semibold text-ink-secondary hover:text-ink-primary"
          >
            Close
          </button>
        </div>
        <p className="mt-3 text-sm text-ink-secondary">Loading instructor details…</p>
      </div>
    </div>
  );
}

export function ProfessorDrawerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OpenState | null>(null);

  const openProfessor = useCallback(
    (target: ProfessorDrawerTarget, returnFocusTo: HTMLElement | null = null) => {
      setState((previous) => ({
        target,
        returnFocusTo,
        key: (previous?.key ?? 0) + 1,
      }));
    },
    [],
  );

  const closeProfessor = useCallback(() => setState(null), []);

  const value = useMemo<ProfessorDrawerController>(
    () => ({
      openProfessor,
      closeProfessor,
      isOpen: state !== null,
      openTarget: state?.target ?? null,
    }),
    [openProfessor, closeProfessor, state],
  );

  return (
    <ProfessorDrawerContext.Provider value={value}>
      {children}
      {state ? (
        <Suspense fallback={<DrawerFallback onClose={closeProfessor} />}>
          <LazyProfessorDrawer
            key={state.key}
            surname={state.target.surname}
            displayName={state.target.displayName}
            returnFocusTo={state.returnFocusTo}
            onClose={closeProfessor}
          />
        </Suspense>
      ) : null}
    </ProfessorDrawerContext.Provider>
  );
}

export function useProfessorDrawer(): ProfessorDrawerController {
  return useContext(ProfessorDrawerContext);
}
