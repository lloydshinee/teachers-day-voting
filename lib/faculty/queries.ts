import "server-only";

import { createClient } from "@/lib/supabase/server";

import {
  facultyDepartmentRowSchema,
  facultyRowSchema,
  type DepartmentFacultyGroup,
} from "./schemas";

/**
 * Admin-only faculty list grouped by department (spec §14 task 7).
 * Runs on the server; RLS (`faculty_admin_all`, `departments_admin_all`,
 * both `USING (public.is_admin())`) denies non-admins at the database, and
 * this function additionally gates on `public.is_admin()` first so
 * non-admins get a clear FORBIDDEN result instead of an empty list.
 *
 * Each group carries its eligible count (non-archived faculty). Archived
 * rows are listed separately per department so admins can see churn
 * history; they are never eligible as Candidates and hold no live Token.
 */

export type FacultyListResult =
  | {
      ok: true;
      groups: DepartmentFacultyGroup[];
      totalEligible: number;
      totalArchived: number;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "DB_ERROR";
      message: string;
    };

export async function listFacultyByDepartment(): Promise<FacultyListResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in as an admin to view faculty.",
    };
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError ?? isAdmin !== true) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Admin access required. Sign in with an admin account.",
    };
  }

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

  const departmentsParse = facultyDepartmentRowSchema
    .array()
    .safeParse(departmentRows ?? []);
  if (!departmentsParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load departments. Try again.",
    };
  }

  const { data: facultyRows, error: facultyError } = await supabase
    .from("faculty")
    .select("id, department_id, full_name, archived_at, picture_url")
    .order("full_name", { ascending: true });
  if (facultyError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty. Try again.",
    };
  }

  const facultyParse = facultyRowSchema.array().safeParse(facultyRows ?? []);
  if (!facultyParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty. Try again.",
    };
  }

  let totalEligible = 0;
  let totalArchived = 0;
  const groups: DepartmentFacultyGroup[] = departmentsParse.data.map(
    (department) => {
      const inDepartment = facultyParse.data.filter(
        (row) => row.department_id === department.id,
      );
      const faculty = inDepartment.filter((row) => row.archived_at === null);
      const archived = inDepartment.filter((row) => row.archived_at !== null);
      totalEligible += faculty.length;
      totalArchived += archived.length;
      return {
        department,
        faculty,
        archived,
        eligibleCount: faculty.length,
      };
    },
  );

  return { ok: true, groups, totalEligible, totalArchived };
}
