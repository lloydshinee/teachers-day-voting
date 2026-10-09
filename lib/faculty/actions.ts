"use server";

import { revalidatePath } from "next/cache";

import { logFacultyAudit } from "@/lib/audit/hook";
import { createClient } from "@/lib/supabase/server";

import {
  archiveFacultySchema,
  createFacultySchema,
  facultyRowSchema,
  moveFacultySchema,
  renameFacultySchema,
  type FacultyActionState,
} from "./schemas";
import { invalidateUnusedFacultyTokens } from "./tokens";

/**
 * Faculty mutations for admins (spec §14 task 7).
 *
 * - Zod-validated on the server boundary; domain failures are returned as
 *   `FacultyActionState`, never thrown.
 * - Admin-only: every mutation requires an authenticated user whose
 *   `public.is_admin()` check passes (the `admins` allowlist from
 *   `db/migrations/001_admins_allowlist.sql`). RLS policies
 *   (`faculty_admin_all`, `USING (public.is_admin())`) enforce the same
 *   rule at the database as a second layer.
 * - Locked churn rules (spec §§6, 14 task 7): archiving sets `archived_at`
 *   and invalidates only the UNUSED voting Token for that faculty via
 *   `invalidateUnusedFacultyTokens` (spec task 8); cast votes stand because
 *   vote rows carry no Token reference and are never touched here. A
 *   department move is archive + re-add in the new department — direct
 *   `department_id` updates are rejected, moves must go through
 *   `moveFaculty`.
 * - Every successful mutation calls `logFacultyAudit` (currently the
 *   TODO hook that spec task 15 will plug the real helper into).
 * - Secrets: this module touches no keys. Key values are never logged;
 *   error paths return generic messages plus the Postgres error code only.
 */

const FACULTY_PATH = "/admin/faculty";

import { requireAdminSession } from "@/lib/auth/admin-session";

interface AdminContext {
  adminId: string;
}

async function requireAdmin(): Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; state: FacultyActionState }
> {
  const result = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to manage faculty.",
  });
  if (!result.ok) {
    return { ok: false, state: result };
  }
  return { ok: true, context: { adminId: result.session.adminId } };
}

function invalidInput(issues: Array<{ message: string }>): FacultyActionState {
  const detail = issues.map((issue) => issue.message).join(" ");
  return {
    ok: false,
    code: "INVALID_INPUT",
    message: detail === "" ? "Invalid faculty input." : detail,
  };
}

function dbError(code: string | null): FacultyActionState {
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
import { generateMissingFacultyCodes } from "./code-actions";

const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

async function processPictureUpload(
  formData: FormData,
  facultyId?: string,
): Promise<{ ok: true; url?: string | null } | { ok: false; message: string }> {
  const result = await processImageUpload({
    formData,
    bucket: "faculty-photos",
    folder: "faculty",
    entityId: facultyId,
    allowedTypes: ALLOWED_IMAGE_TYPES,
    entityLabel: "Faculty",
  });
  if (!result.ok) {
    return { ok: false, message: result.message };
  }
  return { ok: true, url: result.url };
}

export async function createFaculty(
  _prevState: FacultyActionState,
  formData: FormData,
): Promise<FacultyActionState> {
  const parsed = createFacultySchema.safeParse({
    departmentId: formData.get("departmentId"),
    fullName: formData.get("fullName"),
    pictureUrl: formData.get("pictureUrl") || undefined,
  });
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }

  const pictureUpload = await processPictureUpload(formData);
  if (!pictureUpload.ok) {
    return invalidInput([{ message: pictureUpload.message }]);
  }
  const pictureUrl = pictureUpload.url ?? (parsed.data.pictureUrl || null);

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const supabase = await createClient();

  // Each faculty member belongs to exactly one department — the target
  // must exist before the row is created.
  const { data: department, error: departmentError } = await supabase
    .from("departments")
    .select("id")
    .eq("id", parsed.data.departmentId)
    .maybeSingle();
  if (departmentError) {
    return dbError(departmentError.code);
  }
  if (!department) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found. It may have been deleted already.",
    };
  }

  const { data, error } = await supabase
    .from("faculty")
    .insert({
      department_id: parsed.data.departmentId,
      full_name: parsed.data.fullName,
      picture_url: pictureUrl,
    })
    .select("id, department_id, full_name, archived_at, picture_url")
    .single();
  if (error) {
    return dbError(error.code);
  }

  const row = facultyRowSchema.safeParse(data);
  if (!row.success) {
    return dbError(null);
  }

  await logFacultyAudit({
    action: "CREATE_FACULTY",
    facultyId: row.data.id,
    archivedFacultyId: null,
    departmentId: row.data.department_id,
    fullName: row.data.full_name,
    actorAdminId: gate.context.adminId,
  });

  const rawElectionId = formData.get("electionId");
  const generateCode = formData.get("generateCode") === "true";
  let codeSuffix = "";

  if (generateCode && typeof rawElectionId === "string" && rawElectionId !== "") {
    const codeFormData = new FormData();
    codeFormData.set("electionId", rawElectionId);
    codeFormData.set("departmentId", parsed.data.departmentId);
    codeFormData.set("facultyId", row.data.id);
    const codeResult = await generateMissingFacultyCodes(
      { ok: true, message: "", electionId: rawElectionId, issued: [] },
      codeFormData,
    );
    if (codeResult.ok && codeResult.issued.length > 0) {
      const issued = codeResult.issued[0];
      codeSuffix = ` Generated voting code: ${issued?.code}`;
    }
  }

  revalidatePath(FACULTY_PATH);
  return {
    ok: true,
    message: `${row.data.full_name} added.${codeSuffix}`,
  };
}

export async function renameFaculty(
  _prevState: FacultyActionState,
  formData: FormData,
): Promise<FacultyActionState> {
  const parsed = renameFacultySchema.safeParse({
    id: formData.get("id"),
    fullName: formData.get("fullName"),
    pictureUrl: formData.get("pictureUrl") || undefined,
  });
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }

  const pictureUpload = await processPictureUpload(formData, parsed.data.id);
  if (!pictureUpload.ok) {
    return invalidInput([{ message: pictureUpload.message }]);
  }

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const supabase = await createClient();

  const updatePayload: { full_name: string; picture_url?: string | null } = {
    full_name: parsed.data.fullName,
  };
  if (pictureUpload.url !== undefined) {
    updatePayload.picture_url = pictureUpload.url;
  } else if (parsed.data.pictureUrl !== undefined) {
    updatePayload.picture_url = parsed.data.pictureUrl || null;
  }

  // Archived rows are history — only eligible rows can be edited.
  const { data, error } = await supabase
    .from("faculty")
    .update(updatePayload)
    .eq("id", parsed.data.id)
    .is("archived_at", null)
    .select("id, department_id, full_name, archived_at, picture_url")
    .maybeSingle();
  if (error) {
    return dbError(error.code);
  }
  if (!data) {
    const { data: existing, error: readError } = await supabase
      .from("faculty")
      .select("id, department_id, full_name, archived_at, picture_url")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (readError) {
      return dbError(readError.code);
    }
    const existingRow = facultyRowSchema.nullable().safeParse(existing);
    if (!existingRow.success || !existingRow.data) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Faculty member not found. They may have been moved already.",
      };
    }
    return {
      ok: false,
      code: "ALREADY_ARCHIVED",
      message:
        `${existingRow.data.full_name} is archived and cannot be edited. ` +
        `Re-add them to edit details.`,
    };
  }

  const row = facultyRowSchema.safeParse(data);
  if (!row.success) {
    return dbError(null);
  }

  await logFacultyAudit({
    action: "RENAME_FACULTY",
    facultyId: row.data.id,
    archivedFacultyId: null,
    departmentId: row.data.department_id,
    fullName: row.data.full_name,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(FACULTY_PATH);
  return {
    ok: true,
    message: `Faculty member updated to ${row.data.full_name}.`,
  };
}

export async function updateFaculty(
  prevState: FacultyActionState,
  formData: FormData,
): Promise<FacultyActionState> {
  return renameFaculty(prevState, formData);
}

export async function archiveFaculty(
  _prevState: FacultyActionState,
  formData: FormData,
): Promise<FacultyActionState> {
  const parsed = archiveFacultySchema.safeParse({
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

  // Archiving sets archived_at — cast votes stand (votes carry no Token
  // reference, so nothing is deleted); only the UNUSED Token lapses via
  // the hook below.
  const { data, error } = await supabase
    .from("faculty")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .is("archived_at", null)
    .select("id, department_id, full_name, archived_at")
    .maybeSingle();
  if (error) {
    return dbError(error.code);
  }
  if (!data) {
    const { data: existing, error: readError } = await supabase
      .from("faculty")
      .select("id, department_id, full_name, archived_at")
      .eq("id", parsed.data.id)
      .maybeSingle();
    if (readError) {
      return dbError(readError.code);
    }
    const existingRow = facultyRowSchema.nullable().safeParse(existing);
    if (!existingRow.success || !existingRow.data) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Faculty member not found. They may have been moved already.",
      };
    }
    return {
      ok: false,
      code: "ALREADY_ARCHIVED",
      message: `${existingRow.data.full_name} is already archived.`,
    };
  }

  const row = facultyRowSchema.safeParse(data);
  if (!row.success) {
    return dbError(null);
  }

  // Locked churn: invalidate only the UNUSED voting Token for this
  // faculty (task 8 implements the write); cast votes stand.
  await invalidateUnusedFacultyTokens(row.data.id, {
    actorAdminId: gate.context.adminId,
  });

  await logFacultyAudit({
    action: "ARCHIVE_FACULTY",
    facultyId: row.data.id,
    archivedFacultyId: null,
    departmentId: row.data.department_id,
    fullName: row.data.full_name,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(FACULTY_PATH);
  return {
    ok: true,
    message:
      `${row.data.full_name} archived. Past votes stand; ` +
      `any unused voting Token for them no longer works.`,
  };
}

export async function moveFaculty(
  _prevState: FacultyActionState,
  formData: FormData,
): Promise<FacultyActionState> {
  const parsed = moveFacultySchema.safeParse({
    id: formData.get("id"),
    departmentId: formData.get("departmentId"),
  });
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const supabase = await createClient();

  // Read the source row first so audit entries and messages can name it.
  // (RLS already restricts this read to admins.)
  const { data: source, error: readError } = await supabase
    .from("faculty")
    .select("id, department_id, full_name, archived_at, picture_url")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (readError) {
    return dbError(readError.code);
  }
  const sourceRow = facultyRowSchema.nullable().safeParse(source);
  if (!sourceRow.success || !sourceRow.data) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Faculty member not found. They may have been moved already.",
    };
  }
  if (sourceRow.data.archived_at !== null) {
    return {
      ok: false,
      code: "ALREADY_ARCHIVED",
      message:
        `${sourceRow.data.full_name} is archived and cannot be moved. ` +
        `Re-add them directly in the new department.`,
    };
  }
  if (sourceRow.data.department_id === parsed.data.departmentId) {
    return {
      ok: false,
      code: "SAME_DEPARTMENT",
      message:
        "That is already their department. Choose a different department to move to.",
    };
  }

  const { data: destination, error: destinationError } = await supabase
    .from("departments")
    .select("id")
    .eq("id", parsed.data.departmentId)
    .maybeSingle();
  if (destinationError) {
    return dbError(destinationError.code);
  }
  if (!destination) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message:
        "Destination department not found. It may have been deleted already.",
    };
  }

  // Move = archive + re-add: insert the new row first so a failed insert
  // leaves the source untouched. The old row stays archived as history and
  // its unused Token lapses; the new row holds no Token until task 8's
  // "generate missing codes" covers it.
  const { data: created, error: createError } = await supabase
    .from("faculty")
    .insert({
      department_id: parsed.data.departmentId,
      full_name: sourceRow.data.full_name,
      picture_url: sourceRow.data.picture_url,
    })
    .select("id, department_id, full_name, archived_at, picture_url")
    .single();
  if (createError) {
    return dbError(createError.code);
  }
  const createdRow = facultyRowSchema.safeParse(created);
  if (!createdRow.success) {
    return dbError(null);
  }

  const { error: archiveError } = await supabase
    .from("faculty")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", sourceRow.data.id)
    .is("archived_at", null);
  if (archiveError) {
    // Compensate: the source did not archive, so remove the new row
    // rather than leave two eligible rows for one person.
    await supabase.from("faculty").delete().eq("id", createdRow.data.id);
    return dbError(archiveError.code);
  }

  await invalidateUnusedFacultyTokens(sourceRow.data.id, {
    actorAdminId: gate.context.adminId,
  });

  await logFacultyAudit({
    action: "MOVE_FACULTY",
    facultyId: createdRow.data.id,
    archivedFacultyId: sourceRow.data.id,
    departmentId: createdRow.data.department_id,
    fullName: createdRow.data.full_name,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(FACULTY_PATH);
  return {
    ok: true,
    message:
      `${sourceRow.data.full_name} moved (old record archived, ` +
      `re-added in the new department). Past votes stand.`,
  };
}
