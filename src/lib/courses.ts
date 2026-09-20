import type { CourseGroup } from "../api/types";

/**
 * Client-side catalog filters.
 *
 * The documented search endpoint accepts only `q`, `subject`, and `limit`, so
 * course level and open-seat filtering happen entirely in the browser and are
 * labeled as client-side in the UI. Nothing here calls a backend calculation.
 */

export type CourseLevel = 1000 | 2000 | 3000 | 4000 | 5000;

export const COURSE_LEVELS: { value: CourseLevel; label: string }[] = [
  { value: 1000, label: "1000" },
  { value: 2000, label: "2000" },
  { value: 3000, label: "3000" },
  { value: 4000, label: "4000" },
  { value: 5000, label: "5000+" },
];

/** Infer a display course level from the first digit of `course_no`. */
export function inferCourseLevel(courseNo: string): CourseLevel | null {
  const first = courseNo.trim().charAt(0);
  if (!/^[1-9]$/.test(first)) return null;
  const digit = Number(first);
  return (digit >= 5 ? 5000 : digit * 1000) as CourseLevel;
}

export interface CourseFilters {
  level: CourseLevel | null;
  openOnly: boolean;
}

/**
 * Apply client-side filters to grouped courses. Sections are filtered and any
 * course group left without sections is dropped. Course-level `credits` stays as
 * returned by the backend.
 */
export function filterCourses(courses: CourseGroup[], filters: CourseFilters): CourseGroup[] {
  return courses
    .map((group) => {
      let sections = group.sections;
      if (filters.openOnly) {
        sections = sections.filter((section) => section.seats.available > 0);
      }
      if (filters.level !== null) {
        sections = sections.filter(
          (section) => inferCourseLevel(section.course_no) === filters.level,
        );
      }
      return { ...group, sections };
    })
    .filter((group) => group.sections.length > 0);
}

/** Sorted unique subject codes present in the current results. */
export function collectSubjects(courses: CourseGroup[]): string[] {
  const subjects = new Set<string>();
  for (const group of courses) {
    for (const section of group.sections) {
      subjects.add(section.subject);
    }
  }
  return Array.from(subjects).sort();
}
