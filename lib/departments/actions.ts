"use server";

import { revalidatePath } from "next/cache";

import { logDepartmentAudit } from "@/lib/audit/hook";
import { createClient } from "@/lib/supabase/server";

import {
  createDepartmentSchema,
  deleteDepartmentSchema,
  departmentRowSchema,
  renameDepartmentSchema,
  type DepartmentActionState,
} from "./schemas";

/**
 * Department mutations for admins (spec §14 task 6).
 *
 * - Zod-validated on the server boundary; domain failures are returned as
 *   `DepartmentActionState`, never thrown.
 * - Admin-only: every mutation requires an authenticated user whose
 *   `public.is_admin()` check passes (the `admins` allowlist from
 *   `db/migrations/001_admins_allowlist.sql`). RLS policies
 *   (`departments_admin_all`, `USING (public.is_admin())`) enforce the same
 *   rule at the database as a second layer.
 * - Every successful mutation calls `logDepartmentAudit` (currently the
 *   TODO hook that spec task 15 will plug the real helper into).
 * - Secrets: this module touches no keys. Key values are never logged;
 *   error paths return generic messages plus the Postgres error code only.
 */

const DEPARTMENTS_PATH = "/admin/departments";

import { requireAdminSession } from "@/lib/auth/admin-session";

interface AdminContext {
  adminId: string;
}

async function requireAdmin(): Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; state: DepartmentActionState }
> {
  const result = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to manage departments.",
  });
  if (!result.ok) {
    return { ok: false, state: result };
  }
  return { ok: true, context: { adminId: result.session.adminId } };
}

function invalidInput(issues: Array<{ message: string }>): DepartmentActionState {
  const detail = issues.map((issue) => issue.message).join(" ");
  return {
    ok: false,
    code: "INVALID_INPUT",
    message: detail === "" ? "Invalid department input." : detail,
  };
}

function dbError(code: string | null): DepartmentActionState {
  return {
    ok: false,
    code: "DB_ERROR",
    message:
      code === null
        ? "Database rejected the change. Try again."
        : `Database rejected the change (code ${code}). Try again.`,
  };
}
import { processImageUpload } from "@/lib/storage/upload-image";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/svg+xml",
];

async function processDepartmentPictureUpload(
  formData: FormData,
  departmentId?: string,
): Promise<{ ok: true; url?: string | null } | { ok: false; message: string }> {
  const result = await processImageUpload({
    formData,
    bucket: "department-photos",
    folder: "departments",
    entityId: departmentId,
    allowedTypes: ALLOWED_IMAGE_TYPES,
    entityLabel: "Department",
  });
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, url: result.url };
}

export async function createDepartment(
  _prevState: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const parsed = createDepartmentSchema.safeParse({
    code: formData.get("code"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const pictureResult = await processDepartmentPictureUpload(formData);
  if (!pictureResult.ok) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: pictureResult.message,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .insert({
      code: parsed.data.code,
      name: parsed.data.name,
      picture_url: pictureResult.url ?? null,
    })
    .select("id, code, name, picture_url")
    .single();
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        code: "CODE_TAKEN",
        message: `Department code "${parsed.data.code}" is already taken. Codes must be unique.`,
      };
    }
    return dbError(error.code);
  }

  const row = departmentRowSchema.safeParse(data);
  if (!row.success) {
    return dbError(null);
  }

  await logDepartmentAudit({
    action: "CREATE_DEPARTMENT",
    departmentId: row.data.id,
    code: row.data.code,
    name: row.data.name,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(DEPARTMENTS_PATH);
  return {
    ok: true,
    message: `Department ${row.data.code} created.`,
  };
}

export async function renameDepartment(
  _prevState: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const parsed = renameDepartmentSchema.safeParse({
    id: formData.get("id"),
    code: formData.get("code"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const pictureResult = await processDepartmentPictureUpload(
    formData,
    parsed.data.id,
  );
  if (!pictureResult.ok) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: pictureResult.message,
    };
  }

  const updatePayload: {
    code: string;
    name: string;
    picture_url?: string | null;
  } = {
    code: parsed.data.code,
    name: parsed.data.name,
  };
  if (pictureResult.url !== undefined) {
    updatePayload.picture_url = pictureResult.url;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("departments")
    .update(updatePayload)
    .eq("id", parsed.data.id)
    .select("id, code, name, picture_url")
    .maybeSingle();
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        code: "CODE_TAKEN",
        message: `Department code "${parsed.data.code}" is already taken. Codes must be unique.`,
      };
    }
    return dbError(error.code);
  }
  if (!data) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found. It may have been deleted already.",
    };
  }

  const row = departmentRowSchema.safeParse(data);
  if (!row.success) {
    return dbError(null);
  }

  await logDepartmentAudit({
    action: "RENAME_DEPARTMENT",
    departmentId: row.data.id,
    code: row.data.code,
    name: row.data.name,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(DEPARTMENTS_PATH);
  return {
    ok: true,
    message: `Department updated to ${row.data.code}.`,
  };
}

export async function deleteDepartment(
  _prevState: DepartmentActionState,
  formData: FormData,
): Promise<DepartmentActionState> {
  const parsed = deleteDepartmentSchema.safeParse({
    id: formData.get("id"),
  });
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const supabase = await createClient();

  // Read the row first so the audit entry and messages can name it.
  // (RLS already restricts this read to admins.)
  const { data: existing, error: readError } = await supabase
    .from("departments")
    .select("id, code, name")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (readError) {
    return dbError(readError.code);
  }
  const existingRow = departmentRowSchema.nullable().safeParse(existing);
  if (!existingRow.success || !existingRow.data) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found. It may have been deleted already.",
    };
  }

  const { error } = await supabase
    .from("departments")
    .delete()
    .eq("id", parsed.data.id);
  if (error) {
    if (error.code === "23503") {
      return {
        ok: false,
        code: "REFERENCED",
        message:
          `Cannot delete ${existingRow.data.code}: faculty, election, token, ` +
          `vote, finalist, or result records still reference it. The database ` +
          `blocks deletion while references exist (RESTRICT) — reassign or ` +
          `remove those references first.`,
      };
    }
    return dbError(error.code);
  }

  await logDepartmentAudit({
    action: "DELETE_DEPARTMENT",
    departmentId: existingRow.data.id,
    code: existingRow.data.code,
    name: null,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(DEPARTMENTS_PATH);
  return {
    ok: true,
    message: `Department ${existingRow.data.code} deleted.`,
  };
}
