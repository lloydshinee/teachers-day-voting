"use server";

import { revalidatePath } from "next/cache";

import { logFacultyAudit } from "@/lib/audit/hook";
import { createClient } from "@/lib/supabase/server";
import { getTokenPepper } from "@/lib/supabase/server-env";

import { generateFacultyCode } from "./code-format";
import { hashNormalizedCodeLetters } from "./codes";
import {
  facultyDepartmentRowSchema,
  facultyRowSchema,
  generateFacultyCodesSchema,
  type FacultyCodeActionState,
  type IssuedFacultyCode,
} from "./schemas";

/**
 * Faculty Code generation (spec §14 task 8).
 *
 * Missing-only rule (locked, spec §6): eligible faculty (non-archived, in
 * participating departments) minus holders of any live Token record; used
 * never counts as missing. This explicit admin action creates exactly the
 * shortfall — never silent bulk creation, never duplicates.
 *
 * Storage (locked per research): each Code is random (`crypto.randomInt`,
 * 12 letters from the 32-symbol unambiguous alphabet = 60 bits), stored ONLY
 * as `SHA-256(pepper + Code)` hex in `voting_tokens.token_hash`. The pepper
 * comes from the server-only `VOTING_TOKEN_PEPPER` env var (setup docs land
 * with spec task 20) and never leaves the server process. Raw Codes exist
 * only in the returned `issued` list — the controlled generation moment —
 * for the admin's one-time export/print. They are never logged (no log call
 * in this module carries a Code) and never stored.
 *
 * 1:1 faculty↔Token: a live row (invalidated_at IS NULL, any used state)
 * for (election, faculty) blocks regeneration. Uniqueness backstop is the
 * `token_hash` unique constraint — on conflict the Code is discarded and a
 * fresh one generated.
 */

const CODES_PATH = "/admin/faculty/codes";

const MAX_HASH_RETRIES = 5;

import { requireAdminSession } from "@/lib/auth/admin-session";

interface AdminContext {
  adminId: string;
}

async function requireAdmin(): Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; state: FacultyCodeActionState }
> {
  const result = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to manage faculty Codes.",
  });
  if (!result.ok) {
    return { ok: false, state: result };
  }
  return { ok: true, context: { adminId: result.session.adminId } };
}

function dbError(code: string | null): FacultyCodeActionState {
  return {
    ok: false,
    code: "DB_ERROR",
    message:
      code === null
        ? "Database rejected the change. Try again."
        : `Database rejected the change (code ${code}). Try again.`,
  };
}

/**
 * Generates faculty Codes for exactly the missing shortfall (or one Code
 * for a single missing faculty member). Raw Codes are returned once in
 * `issued` — export or print them immediately; they cannot be recovered.
 */
export async function generateMissingFacultyCodes(
  _prevState: FacultyCodeActionState,
  formData: FormData,
): Promise<FacultyCodeActionState> {
  const rawDepartment = formData.get("departmentId");
  const rawFaculty = formData.get("facultyId");
  const parsed = generateFacultyCodesSchema.safeParse({
    electionId: formData.get("electionId"),
    ...(typeof rawDepartment === "string" && rawDepartment !== ""
      ? { departmentId: rawDepartment }
      : {}),
    ...(typeof rawFaculty === "string" && rawFaculty !== ""
      ? { facultyId: rawFaculty }
      : {}),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid generation request. Check the Election and try again.",
    };
  }
  const { electionId, departmentId, facultyId } = parsed.data;

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  // Fail fast on a misconfigured server (pepper is task-20 setup): never
  // proceed to issue Codes that could not be validated later, and never
  // include secret material in the message.
  try {
    getTokenPepper();
  } catch {
    return {
      ok: false,
      code: "CONFIG_ERROR",
      message:
        "Code issuance is not configured on this server. Ask the operator to check the setup.",
    };
  }

  const supabase = await createClient();

  const { data: election, error: electionError } = await supabase
    .from("elections")
    .select("id")
    .eq("id", electionId)
    .maybeSingle();
  if (electionError) {
    return dbError(electionError.code);
  }
  if (!election) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Election not found. It may have been deleted already.",
    };
  }

  const { data: departmentRows, error: departmentsError } = await supabase
    .from("departments")
    .select("id, code, name")
    .order("code", { ascending: true });
  if (departmentsError) {
    return dbError(departmentsError.code);
  }
  const departmentsParse = facultyDepartmentRowSchema
    .array()
    .safeParse(departmentRows ?? []);
  if (!departmentsParse.success) {
    return dbError(null);
  }
  const departmentById = new Map(
    departmentsParse.data.map((department) => [department.id, department]),
  );
  if (departmentId !== undefined && !departmentById.has(departmentId)) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found. It may have been deleted already.",
    };
  }

  // Participation scope (same rule as the status query): attached
  // departments only, or every department when nothing is attached yet.
  const { data: participationRows, error: participationError } = await supabase
    .from("election_departments")
    .select("department_id")
    .eq("election_id", electionId);
  if (participationError) {
    return dbError(participationError.code);
  }
  const participatingIds =
    (participationRows ?? []).length === 0
      ? null
      : new Set(
          (participationRows ?? []).flatMap((row: { department_id: unknown }) =>
            typeof row.department_id === "string" ? [row.department_id] : [],
          ),
        );

  const { data: facultyRows, error: facultyError } = await supabase
    .from("faculty")
    .select("id, department_id, full_name, archived_at")
    .is("archived_at", null)
    .order("full_name", { ascending: true });
  if (facultyError) {
    return dbError(facultyError.code);
  }
  const facultyParse = facultyRowSchema.array().safeParse(facultyRows ?? []);
  if (!facultyParse.success) {
    return dbError(null);
  }

  const { data: tokenRows, error: tokensError } = await supabase
    .from("voting_tokens")
    .select("faculty_id, invalidated_at")
    .eq("election_id", electionId)
    .eq("token_type", "FACULTY");
  if (tokensError) {
    return dbError(tokensError.code);
  }
  const liveHolderIds = new Set(
    (tokenRows ?? []).flatMap(
      (row: { faculty_id: unknown; invalidated_at: unknown }) =>
        typeof row.faculty_id === "string" && row.invalidated_at === null
          ? [row.faculty_id]
          : [],
    ),
  );

  // The shortfall: eligible, in scope, holding no live Token record.
  let candidates = facultyParse.data.filter((row) => {
    if (departmentId !== undefined && row.department_id !== departmentId) {
      return false;
    }
    if (
      participatingIds !== null &&
      !participatingIds.has(row.department_id)
    ) {
      return false;
    }
    return !liveHolderIds.has(row.id);
  });

  if (facultyId !== undefined) {
    const single = facultyParse.data.find((row) => row.id === facultyId);
    if (
      !single ||
      (departmentId !== undefined && single.department_id !== departmentId) ||
      (participatingIds !== null &&
        !participatingIds.has(single.department_id))
    ) {
      return {
        ok: false,
        code: "NOT_FOUND",
        message:
          "Faculty member not found in scope. They may have been archived or moved already.",
      };
    }
    if (liveHolderIds.has(single.id)) {
      return {
        ok: false,
        code: "NOT_MISSING",
        message: `${single.full_name} already holds a live voting Token — no second Code is issued.`,
      };
    }
    candidates = [single];
  }

  if (candidates.length === 0) {
    return {
      ok: true,
      message: "No missing Codes — every eligible faculty member already holds a live voting Token.",
      electionId,
      issued: [],
    };
  }

  // Issue sequentially with a per-row live check, so a retried submit cannot
  // stack two live Tokens on one faculty member. (Residual concurrent-submit
  // races are an accepted admin-only edge; the security suite in task 18 may
  // add a partial-unique backstop.)
  const issued: IssuedFacultyCode[] = [];
  const batchLetters = new Set<string>();
  for (const member of candidates) {
    const { data: existing, error: existingError } = await supabase
      .from("voting_tokens")
      .select("id")
      .eq("election_id", electionId)
      .eq("faculty_id", member.id)
      .is("invalidated_at", null)
      .limit(1);
    if (existingError) {
      return dbError(existingError.code);
    }
    if ((existing ?? []).length > 0) {
      continue;
    }

    let inserted = false;
    for (let attempt = 0; attempt < MAX_HASH_RETRIES && !inserted; attempt += 1) {
      const code = generateFacultyCode();
      const letters = code.replace(/-/g, "");
      if (batchLetters.has(letters)) {
        continue;
      }
      // Hash only — the raw Code never reaches the database.
      const tokenHash = hashNormalizedCodeLetters(letters);
      const { error: insertError } = await supabase
        .from("voting_tokens")
        .insert({
          election_id: electionId,
          department_id: member.department_id,
          token_hash: tokenHash,
          token_type: "FACULTY",
          faculty_id: member.id,
        });
      if (insertError) {
        // Unique-violation backstop (code 23505): discard the Code and mint
        // a fresh one. Any other rejection aborts the batch — Codes already
        // issued stay valid and are still returned below.
        if (insertError.code === "23505") {
          continue;
        }
        if (issued.length === 0) {
          return dbError(insertError.code);
        }
        return {
          ok: true,
          message:
            `Issued ${issued.length} of ${candidates.length} Codes before the database refused a write ` +
            `(code ${insertError.code}). The Codes below are valid — export or print them now, then retry for the rest.`,
          electionId,
          issued,
        };
      }
      inserted = true;
      batchLetters.add(letters);
      const department = departmentById.get(member.department_id);
      issued.push({
        facultyId: member.id,
        fullName: member.full_name,
        departmentId: member.department_id,
        departmentCode: department?.code ?? "",
        code,
      });
      // Token-use audit WITHOUT choice (spec §§3, 7): identity + action
      // only. The raw Code is never part of any audit payload.
      await logFacultyAudit({
        action: "GENERATE_FACULTY_CODES",
        facultyId: member.id,
        archivedFacultyId: null,
        departmentId: member.department_id,
        fullName: member.full_name,
        actorAdminId: gate.context.adminId,
      });
    }
    if (!inserted) {
      return {
        ok: true,
        message:
          `Issued ${issued.length} of ${candidates.length} Codes. A fresh unique Code could not be minted ` +
          `for the rest — the Codes below are valid, export or print them now, then retry.`,
        electionId,
        issued,
      };
    }
  }

  revalidatePath(CODES_PATH);
  revalidatePath("/admin/faculty");
  const scope =
    facultyId !== undefined
      ? ` for ${candidates[0]?.full_name ?? "the faculty member"}`
      : departmentId !== undefined
        ? ` in ${departmentById.get(departmentId)?.code ?? "the department"}`
        : "";
  return {
    ok: true,
    message:
      issued.length === candidates.length
        ? `Issued ${issued.length} Code${issued.length === 1 ? "" : "s"}${scope}. ` +
          `Shown once below — export or print now; they cannot be recovered.`
        : `Issued ${issued.length} of ${candidates.length} Codes${scope} (the rest already held live Tokens). ` +
          `Shown once below — export or print now; they cannot be recovered.`,
    electionId,
    issued,
  };
}
