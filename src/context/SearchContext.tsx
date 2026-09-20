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

/** Documented catalog limit (1–100, default 20); the only server-side filter. */
const SEARCH_LIMIT = 20;

export interface SearchState {
  /** Raw search box text (debounced before it becomes an active query). */
  text: string;
  /** Update the search box; also clears any explicitly submitted query. */
  setText: (value: string) => void;
  /** Submit the current text as an explicit query (empty string requests the catalog). */
  submit: () => void;
  subject: string;
  setSubject: (value: string) => void;
  level: CourseLevel | "all";
  setLevel: (value: CourseLevel | "all") => void;
  openOnly: boolean;
  setOpenOnly: (value: boolean) => void;
  /** Subjects observed so far, so filter options stay stable as results narrow. */
  subjects: string[];
  /** Active query string, or null when no user search is in effect. */
  activeQuery: string | null;
  /** True once the user has searched (typed ≥2 chars or submitted). */
  hasActiveSearch: boolean;
  /** True when the center panel should present the course-results surface. */
  showResults: boolean;
  /** Client-side filtered course groups for the current results. */
  filteredCourses: CourseGroup[];
  isPending: boolean;
  isError: boolean;
  errorMessage?: string;
  hasFilters: boolean;
  clearFilters: () => void;
  retry: () => void;
}

const SearchContext = createContext<SearchState | null>(null);

/**
 * Owns course-search state so the sidebar (controls) and the center panel
 * (results) can be composed separately. Only the documented `q`, `subject`, and
 * `limit` query parameters are ever sent; course-level and open-seat filters stay
 * client-side. Full Section objects are cached through `ScheduleContext` so
 * selected CRNs and swap alternatives can be hydrated. In-memory only.
 */
export function SearchProvider({ children }: { children: ReactNode }) {
  const { registerSections } = useSchedule();

  const [text, setSearchText] = useState("");
  const debouncedText = useDebouncedValue(text, 250);
  const [submittedQuery, setSubmittedQuery] = useState<string | null>(null);
  const [subject, setSubject] = useState("all");
  const [level, setLevel] = useState<CourseLevel | "all">("all");
  const [openOnly, setOpenOnly] = useState(false);
  const [subjects, setSubjects] = useState<string[]>([]);

  // Auto-search at two characters; an explicit submit (including an empty one,
  // which requests the first 20 groups) takes precedence.
  const activeQuery =
    submittedQuery !== null
      ? submittedQuery
      : debouncedText.trim().length >= 2
        ? debouncedText.trim()
        : null;

  const params = useMemo(
    () => ({
      q: activeQuery ?? undefined,
      subject: subject === "all" ? undefined : subject,
      limit: SEARCH_LIMIT,
    }),
    [activeQuery, subject],
  );

  const search = useCoursesSearch(params);

  // Accumulate subjects seen so far so options stay stable as filters narrow results.
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

  const filteredCourses = useMemo(
    () =>
      filterCourses(search.data?.courses ?? [], {
        level: level === "all" ? null : level,
        openOnly,
      }),
    [search.data, level, openOnly],
  );

  const setText = useCallback((value: string) => {
    setSearchText(value);
    setSubmittedQuery(null);
  }, []);

  const submit = useCallback(() => {
    setSubmittedQuery(text.trim());
  }, [text]);

  const clearFilters = useCallback(() => {
    setSearchText("");
    setSubmittedQuery(null);
    setSubject("all");
    setLevel("all");
    setOpenOnly(false);
  }, []);

  const retry = useCallback(() => {
    void search.refetch();
  }, [search]);

  const hasFilters = subject !== "all" || level !== "all" || openOnly;
  const errorMessage = search.isError
    ? search.error instanceof ApiError
      ? search.error.message
      : "The course catalog did not respond."
    : undefined;

  // The Burruss hero stays the default surface until the user actually searches.
  // A catalog error is surfaced in the results surface even without a query so a
  // broken search is never silent.
  const hasActiveSearch = activeQuery !== null;
  const showResults = hasActiveSearch || search.isError;

  const value = useMemo<SearchState>(
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
      hasActiveSearch,
      showResults,
      filteredCourses,
      isPending: search.isPending,
      isError: search.isError,
      errorMessage,
      hasFilters,
      clearFilters,
      retry,
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
      hasActiveSearch,
      showResults,
      filteredCourses,
      search.isPending,
      search.isError,
      errorMessage,
      hasFilters,
      clearFilters,
      retry,
    ],
  );

  return <SearchContext.Provider value={value}>{children}</SearchContext.Provider>;
}

export function useSearch(): SearchState {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error("useSearch must be used within a SearchProvider.");
  }
  return context;
}
