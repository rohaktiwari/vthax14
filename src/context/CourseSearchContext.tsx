/* eslint-disable react-refresh/only-export-components -- this module intentionally
   exports the provider component and its hook together. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError } from "../api/errors";
import { useCoursesSearch } from "../api/hooks";
import type { CourseGroup } from "../api/types";
import { useDebouncedValue } from "../hooks/useDebouncedValue";
import { collectSubjects, filterCourses, type CourseLevel } from "../lib/courses";
import { useSchedule } from "./ScheduleContext";

export interface CourseSearchState {
  /** Raw text in the search box. */
  text: string;
  /** Update the text; this also cancels any earlier explicit submit. */
  setText: (value: string) => void;
  /** Explicit submit (an empty submit requests the first 20 groups). */
  submit: () => void;

  subject: string;
  setSubject: (value: string) => void;
  level: CourseLevel | "all";
  setLevel: (value: CourseLevel | "all") => void;
  openOnly: boolean;
  setOpenOnly: (value: boolean) => void;
  /** Subjects seen so far, kept stable as filters narrow the results. */
  subjects: string[];

  /** The query actually sent to the API, or null when none is active. */
  activeQuery: string | null;
  hasFilters: boolean;
  /**
   * True once the person has searched (typed 2+ characters, pressed Search
   * Classes, or narrowed with a filter). The planner uses this to swap the hero
   * for the results panel.
   */
  isSearchActive: boolean;

  /** Course groups after client-side level / open-seat filters. */
  courses: CourseGroup[];
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  retry: () => void;
  /** Reset the text, submit state, and every filter (returns to the overview). */
  clearSearch: () => void;
}

const CourseSearchContext = createContext<CourseSearchState | null>(null);

/**
 * Owns course search + filter state.
 *
 * Uses only the documented `q`, `subject`, and `limit` parameters. Course-level
 * and open-seat filters are client-side. The catalog request always runs (even
 * while the hero is showing) because search results are the only source of full
 * Section objects for hydrating selected CRNs and demo schedules.
 *
 * Must be rendered inside `ScheduleProvider`.
 */
export function CourseSearchProvider({ children }: { children: ReactNode }) {
  const { registerSections } = useSchedule();

  const [text, setTextState] = useState("");
  const debouncedText = useDebouncedValue(text, 250);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);

  // Auto-search at two characters; an explicit submit (including an empty one,
  // which requests the first 20 groups) takes precedence.
  const activeQuery =
    submittedQuery !== null
      ? submittedQuery
      : debouncedText.trim().length >= 2
        ? debouncedText.trim()
        : null;

  const [subject, setSubject] = useState("all");
  const [level, setLevel] = useState<CourseLevel | "all">("all");
  const [openOnly, setOpenOnly] = useState(false);

  const params = useMemo(
    () => ({
      q: activeQuery ?? undefined,
      subject: subject === "all" ? undefined : subject,
      limit: 20,
    }),
    [activeQuery, subject],
  );

  const search = useCoursesSearch(params);

  // Accumulate subjects seen so far so options stay stable as filters narrow results.
  const [subjects, setSubjects] = useState<string[]>([]);
  useEffect(() => {
    if (!search.data) return;
    setSubjects((previous) => {
      const next = new Set(previous);
      for (const value of collectSubjects(search.data.courses)) next.add(value);
      return Array.from(next).sort();
    });
  }, [search.data]);

  // Cache every full documented Section returned by search so (a) selected CRNs
  // can be hydrated and (b) the swap workbench can offer same-course
  // alternatives. No section-by-CRN endpoint exists, so search results are the
  // only source of Section objects. The cache is in-memory only.
  useEffect(() => {
    if (!search.data) return;
    const available = search.data.courses.flatMap((group) => group.sections);
    if (available.length > 0) registerSections(available);
  }, [search.data, registerSections]);

  const courses = useMemo(
    () =>
      filterCourses(search.data?.courses ?? [], {
        level: level === "all" ? null : level,
        openOnly,
      }),
    [search.data, level, openOnly],
  );

  const hasFilters = subject !== "all" || level !== "all" || openOnly;
  const isSearchActive = activeQuery !== null || hasFilters;

  const errorMessage = search.isError
    ? search.error instanceof ApiError
      ? search.error.message
      : "The course catalog did not respond."
    : undefined;

  const setText = useCallback((value: string) => {
    setTextState(value);
    setSubmittedQuery(null);
  }, []);

  const submit = useCallback(() => {
    setSubmittedQuery(text.trim());
  }, [text]);

  const clearSearch = useCallback(() => {
    setTextState("");
    setSubmittedQuery(null);
    setSubject("all");
    setLevel("all");
    setOpenOnly(false);
  }, []);

  const { refetch } = search;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const value = useMemo<CourseSearchState>(
    () => ({
      text,
      setText,
      submit,
      subject,
      setSubject,
      level,
      setLevel,
      openOnly,
      setOpenOnly,
      subjects,
      activeQuery,
      hasFilters,
      isSearchActive,
      courses,
      isPending: search.isPending,
      isError: search.isError,
      errorMessage,
      retry,
      clearSearch,
    }),
    [
      text,
      setText,
      submit,
      subject,
      level,
      openOnly,
      subjects,
      activeQuery,
      hasFilters,
      isSearchActive,
      courses,
      search.isPending,
      search.isError,
      errorMessage,
      retry,
      clearSearch,
    ],
  );

  return <CourseSearchContext.Provider value={value}>{children}</CourseSearchContext.Provider>;
}

export function useCourseSearch(): CourseSearchState {
  const context = useContext(CourseSearchContext);
  if (!context) {
    throw new Error("useCourseSearch must be used within a CourseSearchProvider");
  }
  return context;
}
