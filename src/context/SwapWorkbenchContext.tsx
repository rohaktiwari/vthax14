/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the provider component and its hook together. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import SwapWorkbench from "../components/SwapWorkbench";

/**
 * Global opener for the swap workbench (frontend PRD §10.11). Selected-section
 * and insights entry points call `openSwapWorkbench` with an optional prefilled
 * drop/add pair (e.g. from the backend `swap_demo`). The workbench itself owns
 * the request; this only carries presentation state. The default value is a
 * no-op so components can render without the provider in isolated tests.
 */
export interface SwapWorkbenchOpenOptions {
  dropCrn?: string | null;
  addCrn?: string | null;
}

export interface SwapWorkbenchController {
  openSwapWorkbench: (options?: SwapWorkbenchOpenOptions) => void;
  closeSwapWorkbench: () => void;
  isOpen: boolean;
}

const DEFAULT_CONTROLLER: SwapWorkbenchController = {
  openSwapWorkbench: () => {},
  closeSwapWorkbench: () => {},
  isOpen: false,
};

const SwapWorkbenchContext = createContext<SwapWorkbenchController>(DEFAULT_CONTROLLER);

export function SwapWorkbenchProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<SwapWorkbenchOpenOptions | null>(null);
  // A monotonic key guarantees a fresh component (and fresh prefilled state)
  // each time the workbench is opened.
  const [openCount, setOpenCount] = useState(0);

  const openSwapWorkbench = useCallback((options: SwapWorkbenchOpenOptions = {}) => {
    setRequest({ dropCrn: options.dropCrn ?? null, addCrn: options.addCrn ?? null });
    setOpenCount((count) => count + 1);
  }, []);

  const closeSwapWorkbench = useCallback(() => setRequest(null), []);

  const value = useMemo<SwapWorkbenchController>(
    () => ({ openSwapWorkbench, closeSwapWorkbench, isOpen: request !== null }),
    [openSwapWorkbench, closeSwapWorkbench, request],
  );

  return (
    <SwapWorkbenchContext.Provider value={value}>
      {children}
      {request ? (
        <SwapWorkbench
          key={openCount}
          open
          initialDropCrn={request.dropCrn ?? null}
          initialAddCrn={request.addCrn ?? null}
          onClose={closeSwapWorkbench}
        />
      ) : null}
    </SwapWorkbenchContext.Provider>
  );
}

export function useSwapWorkbench(): SwapWorkbenchController {
  return useContext(SwapWorkbenchContext);
}
