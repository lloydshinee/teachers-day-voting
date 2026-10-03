import { z } from "zod";

/**
 * Faculty CRUD validation (spec §14 task 7, DDL direction §3).
 *
 * `faculty(id uuid pk, department_id → departments, full_name text,
 * archived_at timestamptz null)` — department belonging is GLOBAL, exactly
 * one department per faculty row [LOCKED]. `archived_at IS NULL` = eligible
 * (a Candidate able to receive votes and to hold a live Token).
 *
 * Churn rules (locked, spec §§6, 14 task 7):
 * - Archiving sets `archived_at`; it invalidates only the UNUSED voting
 *   Token for that faculty — cast votes stand (votes carry no Token
 *   reference, so nothing is deleted from `votes`).
 * - A department move is archive + re-add in the new department (a new
 *   `faculty` row; the old row stays archived). Direct `department_id`
 *   updates are rejected — moves must go through `moveFacultySchema`.
 */

export const facultyNameSchema = z
  .string()
  .trim()
  .min(1, "Full name is required (e.g. Maria Santos).")
  .max(120, "Full name must be at most 120 characters.");

export const createFacultySchema = z.object({
  departmentId: z.uuid("A department is required — each faculty member belongs to exactly one department."),
  fullName: facultyNameSchema,
  pictureUrl: z.string().trim().url("Invalid picture URL").or(z.literal("")).nullable().optional(),
});

export type CreateFacultyInput = z.infer<typeof createFacultySchema>;

export const renameFacultySchema = z.object({
  id: z.uuid(),
  fullName: facultyNameSchema,
  pictureUrl: z.string().trim().url("Invalid picture URL").or(z.literal("")).nullable().optional(),
});

export type RenameFacultyInput = z.infer<typeof renameFacultySchema>;

export const updateFacultySchema = renameFacultySchema;
export type UpdateFacultyInput = RenameFacultyInput;

export const archiveFacultySchema = z.object({
  id: z.uuid(),
});

export type ArchiveFacultyInput = z.infer<typeof archiveFacultySchema>;

export const moveFacultySchema = z.object({
  id: z.uuid(),
  departmentId: z.uuid(
    "A destination department is required — each faculty member belongs to exactly one department.",
  ),
});

export type MoveFacultyInput = z.infer<typeof moveFacultySchema>;

/** Shape of a `faculty` row as read back from the database. */
export const facultyRowSchema = z.object({
  id: z.uuid(),
  department_id: z.uuid(),
  full_name: z.string(),
  archived_at: z.string().nullable(),
  picture_url: z.string().nullable().optional(),
});

export type FacultyRow = z.infer<typeof facultyRowSchema>;

/** Shape of a `departments` row needed to group faculty by department. */
export const facultyDepartmentRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  picture_url: z.string().nullable().optional(),
});

export type FacultyDepartmentRow = z.infer<typeof facultyDepartmentRowSchema>;

export interface FacultyWithDepartment extends FacultyRow {
  departmentCode: string;
  departmentName: string;
}

export interface DepartmentFacultyGroup {
  department: FacultyDepartmentRow;
  /** Eligible (non-archived) faculty, ordered by name. */
  faculty: FacultyRow[];
  /** Archived faculty, ordered by name. */
  archived: FacultyRow[];
  /** Count of eligible (non-archived) faculty in the department. */
  eligibleCount: number;
}

export const FACULTY_ACTION_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "NOT_FOUND",
  "ALREADY_ARCHIVED",
  "SAME_DEPARTMENT",
  "DB_ERROR",
] as const;

export type FacultyActionErrorCode =
  (typeof FACULTY_ACTION_ERROR_CODES)[number];

/**
 * Serializable Server Action state. Domain failures are values, never
 * thrown, so forms can render them with `useActionState`.
 */
export type FacultyActionState =
  | { ok: true; message: string }
  | { ok: false; code: FacultyActionErrorCode; message: string };

/**
 * Faculty Code generation input (spec §6, task 8).
 *
 * - `electionId` scopes every Token row (Tokens are per-election).
 * - `departmentId` narrows a batch to one department; omit for all missing.
 * - `facultyId` issues exactly one Code (one-click generation for a
 *   newcomer); omit for the missing-only batch. When present, the faculty
 *   member must be eligible and must hold no live Token — otherwise the
 *   action fails with NOT_MISSING instead of duplicating.
 */
export const generateFacultyCodesSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid().optional(),
  facultyId: z.uuid().optional(),
});

export type GenerateFacultyCodesInput = z.infer<
  typeof generateFacultyCodesSchema
>;

/**
 * One issued Code. Raw `code` values exist ONLY in the generation response
 * (and the admin's one-time export/print of it) — they are never stored
 * (only the SHA-256 hash is) and never logged.
 */
export interface IssuedFacultyCode {
  facultyId: string;
  fullName: string;
  departmentId: string;
  departmentCode: string;
  code: string;
}

export const FACULTY_CODE_ACTION_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "NOT_FOUND",
  "NOT_MISSING",
  "CONFIG_ERROR",
  "DB_ERROR",
] as const;

export type FacultyCodeActionErrorCode =
  (typeof FACULTY_CODE_ACTION_ERROR_CODES)[number];

/**
 * Generation result state. On success `issued` carries exactly the shortfall
 * (empty when nothing was missing); on failure it is absent.
 */
export type FacultyCodeActionState =
  | {
      ok: true;
      message: string;
      electionId: string;
      issued: IssuedFacultyCode[];
    }
  | { ok: false; code: FacultyCodeActionErrorCode; message: string };
