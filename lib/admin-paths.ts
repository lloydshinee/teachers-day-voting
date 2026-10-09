/**
 * Centralised route paths for admin pages and public voting/results pages.
 * Used for cache revalidation (revalidatePath) and navigation.
 */

export const ADMIN_PATHS = {
  DASHBOARD: "/admin",
  DEPARTMENTS: "/admin/departments",
  FACULTY: "/admin/faculty",
  FACULTY_CODES: "/admin/faculty/codes",
  FACULTY_RESULTS: "/admin/faculty/results",
  STUDENT: "/admin/student",
  STUDENT_CODES: "/admin/student/codes",
  FINAL_RESULTS: "/admin/final/results",
} as const;

export const PUBLIC_PATHS = {
  VOTE: "/vote",
  RESULTS: "/results",
} as const;

// Convenient direct exports
export const ADMIN_DASHBOARD_PATH = ADMIN_PATHS.DASHBOARD;
export const ADMIN_DEPARTMENTS_PATH = ADMIN_PATHS.DEPARTMENTS;
export const ADMIN_FACULTY_PATH = ADMIN_PATHS.FACULTY;
export const ADMIN_FACULTY_CODES_PATH = ADMIN_PATHS.FACULTY_CODES;
export const ADMIN_FACULTY_RESULTS_PATH = ADMIN_PATHS.FACULTY_RESULTS;
export const ADMIN_STUDENT_PATH = ADMIN_PATHS.STUDENT;
export const ADMIN_STUDENT_CODES_PATH = ADMIN_PATHS.STUDENT_CODES;
export const ADMIN_FINAL_RESULTS_PATH = ADMIN_PATHS.FINAL_RESULTS;
export const PUBLIC_VOTE_PATH = PUBLIC_PATHS.VOTE;
export const PUBLIC_RESULTS_PATH = PUBLIC_PATHS.RESULTS;
