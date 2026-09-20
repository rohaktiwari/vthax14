/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the provider component and its hook together. */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Section } from "../api/types";
import { useScheduleUrl } from "../hooks/useScheduleUrl";
import { replaceCrnAtSameIndex } from "../lib/swap";

/** Prefilled `swap_demo` payload. UI state only; no swap request is made. */
export interface DemoSwapDraft {
  currentCrns: string[];
  dropCrn: string;
  addCrn: string;
}

export interface ScheduleState {
  /** Ordered, de-duplicated CRNs parsed from the URL. Canonical selection. */
  crns: string[];
  isFull: boolean;
  /** Full documented Section objects currently available in memory, by CRN. */
  sectionsByCrn: Readonly<Record<string, Section>>;
  /** Selected sections in URL order, limited to those we can hydrate. */
  selectedSections: Section[];
  /**
   * Selected CRNs with no in-memory Section. The documented contract has no
   * section-by-CRN lookup, so after a URL restore these cannot be hydrated
   * without fetching search results or calling analyze. UI should surface them
   * as "details unavailable"; never fabricate Section data.
   */
  unavailableCrns: string[];
  /** Append a CRN to the URL when no full Section object is available. */
  addCrn: (crn: string) => void;
  /** Add to the URL and cache the full Section in one step. */
  addSection: (section: Section) => void;
  /** Remove from the URL and prune cached details. */
  removeCrn: (crn: string) => void;
  /** Replace the whole selection (e.g. loading a demo) and prune the cache. */
  setSchedule: (crns: string[]) => void;
  /**
   * Apply a confirmed swap: replace `dropCrn` with `addCrn` at the exact same
   * URL index, then prune cache entries that are no longer selected. The caller
   * is responsible for having confirmed against an authoritative backend result.
   */
  applySwap: (dropCrn: string, addCrn: string) => void;
  /** Clear the URL selection and the in-memory cache. */
  clear: () => void;
  /** Cache one full Section (e.g. from search results). */
  registerSection: (section: Section) => void;
  /** Cache many full Sections. */
  registerSections: (sections: Section[]) => void;
  /** Prefilled swap-demo payload; presentation state only. */
  demoSwapDraft: DemoSwapDraft | null;
  setDemoSwapDraft: (draft: DemoSwapDraft | null) => void;
}

const ScheduleContext = createContext<ScheduleState | null>(null);

/**
 * Provides one URL-backed schedule state plus an ephemeral selected-section
 * cache. The URL `crns` parameter stays the canonical selection and the only
 * durable representation; the cache is never written to local storage and is
 * only filled from already-available documented Section objects.
 */
export function ScheduleProvider({ children }: { children: ReactNode }) {
  const {
    crns,
    isFull,
    addCrn,
    removeCrn: removeUrlCrn,
    setCrns,
    clear: clearUrl,
  } = useScheduleUrl();

  const [sectionsByCrn, setSectionsByCrn] = useState<Record<string, Section>>({});
  const [demoSwapDraft, setDemoSwapDraft] = useState<DemoSwapDraft | null>(null);

  const registerSections = useCallback((sections: Section[]) => {
    if (sections.length === 0) return;
    setSectionsByCrn((previous) => {
      let changed = false;
      const next = { ...previous };
      for (const section of sections) {
        if (!section || !section.crn) continue;
        if (next[section.crn] !== section) {
          next[section.crn] = section;
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, []);

  const registerSection = useCallback(
    (section: Section) => registerSections([section]),
    [registerSections],
  );

  const addSection = useCallback(
    (section: Section) => {
      registerSection(section);
      addCrn(section.crn);
    },
    [addCrn, registerSection],
  );

  const removeCrn = useCallback(
    (crn: string) => {
      removeUrlCrn(crn);
      setSectionsByCrn((previous) => {
        if (!(crn in previous)) return previous;
        const next = { ...previous };
        delete next[crn];
        return next;
      });
    },
    [removeUrlCrn],
  );

  const clear = useCallback(() => {
    clearUrl();
    setSectionsByCrn((previous) => (Object.keys(previous).length === 0 ? previous : {}));
  }, [clearUrl]);

  const setSchedule = useCallback(
    (next: string[]) => {
      setCrns(next);
      // Keep only cached sections that remain selected; demo CRNs arrive without
      // Section objects and stay in `unavailableCrns` until search registers them.
      setSectionsByCrn((previous) => {
        const keep = new Set(next);
        const retained: Record<string, Section> = {};
        let changed = false;
        for (const key of Object.keys(previous)) {
          const section = previous[key];
          if (keep.has(key) && section) {
            retained[key] = section;
          } else {
            changed = true;
          }
        }
        return changed ? retained : previous;
      });
    },
    [setCrns],
  );

  const applySwap = useCallback(
    (dropCrn: string, addCrn: string) => {
      setSchedule(replaceCrnAtSameIndex(crns, dropCrn, addCrn));
    },
    [crns, setSchedule],
  );

  const selectedSections = useMemo(
    () => crns.map((crn) => sectionsByCrn[crn]).filter((section): section is Section => Boolean(section)),
    [crns, sectionsByCrn],
  );

  const unavailableCrns = useMemo(
    () => crns.filter((crn) => !(crn in sectionsByCrn)),
    [crns, sectionsByCrn],
  );

  const value = useMemo<ScheduleState>(
    () => ({
      crns,
      isFull,
      sectionsByCrn,
      selectedSections,
      unavailableCrns,
      addCrn,
      addSection,
      removeCrn,
      setSchedule,
      applySwap,
      clear,
      registerSection,
      registerSections,
      demoSwapDraft,
      setDemoSwapDraft,
    }),
    [
      crns,
      isFull,
      sectionsByCrn,
      selectedSections,
      unavailableCrns,
      addCrn,
      addSection,
      removeCrn,
      setSchedule,
      applySwap,
      clear,
      registerSection,
      registerSections,
      demoSwapDraft,
    ],
  );

  return <ScheduleContext.Provider value={value}>{children}</ScheduleContext.Provider>;
}

/** Access the selected schedule. Must be used inside a `ScheduleProvider`. */
export function useSchedule(): ScheduleState {
  const value = useContext(ScheduleContext);
  if (!value) {
    throw new Error("useSchedule must be used within a ScheduleProvider.");
  }
  return value;
}
