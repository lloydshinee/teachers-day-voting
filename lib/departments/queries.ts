import "server-only";

import { requireAdminSession } from "@/lib/auth/admin-session";

import {
  departmentRowSchema,
  facultyDepartmentRowSchema,
  type DepartmentWithFacultyCount,
} from "./schemas";

/**
 * Admin-only department list with per-department eligible-faculty counts
 * (spec §14 task 6). Runs on the server; RLS (`departments_admin_all`,
 * `faculty_admin_all`, both `USING (public.is_admin())`) denies non-admins
 * at the database, and this function additionally gates on
 * `public.is_admin()` first so non-admins get a clear FORBIDDEN result
 * instead of an empty list.
 */

export type DepartmentListResult =
  | { ok: true; departments: DepartmentWithFacultyCount[] }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "DB_ERROR";
      message: string;
    };

export async function listDepartmentsWithCounts(): Promise<DepartmentListResult> {
  const auth = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to view departments.",
  });
  if (!auth.ok) {
    return auth;
  }
  const supabase = auth.session.supabase;

  const { data: departmentRows, error: departmentsError } = await supabase
    .from("departments")
    .select("id, code, name, picture_url")
    .order("code", { ascending: true });
  if (departmentsError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load departments. Try again.",
    };
  }

  const departmentsParse = departmentRowSchema
    .array()
    .safeParse(departmentRows ?? []);
  if (!departmentsParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load departments. Try again.",
    };
  }
  const departments = departmentsParse.data;

  // Eligible faculty only (archived_at IS NULL); archive churn rules
  // belong to spec task 7, this count intentionally excludes archived rows.
  const { data: facultyRows, error: facultyError } = await supabase
    .from("faculty")
    .select("department_id")
    .is("archived_at", null);
  if (facultyError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty counts. Try again.",
    };
  }

  const facultyParse = facultyDepartmentRowSchema
    .array()
    .safeParse(facultyRows ?? []);
  if (!facultyParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty counts. Try again.",
    };
  }

  const counts = new Map<string, number>();
  for (const row of facultyParse.data) {
    counts.set(row.department_id, (counts.get(row.department_id) ?? 0) + 1);
  }

  return {
    ok: true,
    departments: departments.map((department) => ({
      ...department,
      facultyCount: counts.get(department.id) ?? 0,
    })),
  };
}
