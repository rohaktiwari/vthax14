/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the provider component and its hook together. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * Cross-panel highlight state for the map ↔ calendar connection (PRD §10.4,
 * §10.5): clicking a building marker emphasizes its calendar events. The default
 * value is a no-op so panels can render without a provider (e.g. isolated tests).
 */
export interface MapSelection {
  highlightedBuilding: string | null;
  highlightedCrns: string[];
  setHighlightedBuilding: (building: string | null, crns?: string[]) => void;
  clearHighlight: () => void;
}

const DEFAULT_SELECTION: MapSelection = {
  highlightedBuilding: null,
  highlightedCrns: [],
  setHighlightedBuilding: () => {},
  clearHighlight: () => {},
};

const MapSelectionContext = createContext<MapSelection>(DEFAULT_SELECTION);

export function MapSelectionProvider({ children }: { children: ReactNode }) {
  const [highlightedBuilding, setBuilding] = useState<string | null>(null);
  const [highlightedCrns, setCrns] = useState<string[]>([]);

  const setHighlightedBuilding = useCallback((building: string | null, crns: string[] = []) => {
    setBuilding(building);
    setCrns(building ? crns : []);
  }, []);

  const clearHighlight = useCallback(() => {
    setBuilding(null);
    setCrns([]);
  }, []);

  const value = useMemo<MapSelection>(
    () => ({ highlightedBuilding, highlightedCrns, setHighlightedBuilding, clearHighlight }),
    [highlightedBuilding, highlightedCrns, setHighlightedBuilding, clearHighlight],
  );

  return <MapSelectionContext.Provider value={value}>{children}</MapSelectionContext.Provider>;
}

export function useMapSelection(): MapSelection {
  return useContext(MapSelectionContext);
}
