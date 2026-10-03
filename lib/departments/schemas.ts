import { z } from "zod";

/**
 * Department CRUD validation (spec §14 task 6, DDL direction §3).
 *
 * `departments(id uuid pk, code text unique, name text)` — e.g.
 * CCS / College of Computing Studies. Codes are normalized to uppercase
 * on the Zod boundary so `ccs` and `CCS` cannot become two rows; the
 * database unique constraint on `code` remains authoritative.
 */

/** Short unique key, e.g. CCS. Stored uppercase; letters and digits only. */
export const departmentCodeSchema = z
  .string()
  .trim()
  .min(2, "Code must be at least 2 characters (e.g. CCS).")
  .max(10, "Code must be at most 10 characters.")
  .regex(
    /^[A-Za-z0-9]+$/,
    "Code may contain only letters and digits (e.g. CCS).",
  )
  .transform((value) => value.toUpperCase());

export const departmentNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required (e.g. College of Computing Studies).")
  .max(120, "Name must be at most 120 characters.");

export const createDepartmentSchema = z.object({
  code: departmentCodeSchema,
  name: departmentNameSchema,
  picture_url: z.string().url("Please provide a valid image URL.").nullable().optional(),
});

export type CreateDepartmentInput = z.infer<typeof createDepartmentSchema>;

export const renameDepartmentSchema = z.object({
  id: z.uuid(),
  code: departmentCodeSchema,
  name: departmentNameSchema,
  picture_url: z.string().url("Please provide a valid image URL.").nullable().optional(),
});

export type RenameDepartmentInput = z.infer<typeof renameDepartmentSchema>;

export const deleteDepartmentSchema = z.object({
  id: z.uuid(),
});

export type DeleteDepartmentInput = z.infer<typeof deleteDepartmentSchema>;

/** Shape of a `departments` row as read back from the database. */
export const departmentRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  picture_url: z.string().nullable().optional(),
});

export type DepartmentRow = z.infer<typeof departmentRowSchema>;

/** Minimal faculty shape needed for per-department counts. */
export const facultyDepartmentRowSchema = z.object({
  department_id: z.uuid(),
});

export type FacultyDepartmentRow = z.infer<typeof facultyDepartmentRowSchema>;

export interface DepartmentWithFacultyCount extends DepartmentRow {
  /** Eligible (non-archived) faculty belonging to the department. */
  facultyCount: number;
}

export const DEPARTMENT_ACTION_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "CODE_TAKEN",
  "NOT_FOUND",
  "REFERENCED",
  "DB_ERROR",
] as const;

export type DepartmentActionErrorCode =
  (typeof DEPARTMENT_ACTION_ERROR_CODES)[number];

/**
 * Serializable Server Action state. Domain failures are values, never
 * thrown, so forms can render them with `useActionState`.
 */
export type DepartmentActionState =
  | { ok: true; message: string }
  | { ok: false; code: DepartmentActionErrorCode; message: string };
