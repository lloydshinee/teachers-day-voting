"use server";

import { revalidatePath } from "next/cache";

import { logStudentAudit } from "@/lib/audit/hook";
import {
  mintVotingToken,
  invalidateStudentToken,
  rotateStudentToken,
} from "@/lib/tokens";
import { facultyDepartmentRowSchema } from "@/lib/faculty/schemas";
import { createClient } from "@/lib/supabase/server";
import { getTokenPepper } from "@/lib/supabase/server-env";

import {
  generateStudentCodesSchema,
  invalidateStudentCodeSchema,
  rotateStudentCodeSchema,
  type IssuedStudentCode,
  type StudentCodeActionState,
} from "./schemas";

/**
 * Student Code generation (spec §14 task 11).
 *
 * Quantity rule (locked, spec §6): the admin names an exact quantity per
 * department (e.g. CCS 300, COED 450) and this explicit action creates
 * exactly that many NEW STUDENT Tokens bound to (election, department)
 * with a NULL faculty link. Top-ups simply call again — previously issued
 * rows are never touched, so generation can never duplicate.
 *
 * Storage (locked per research, identical to faculty Tokens): each Code is
 * random (`crypto.randomInt` via the shared 12-letter / 60-bit format),
 * stored ONLY as `SHA-256(pepper + Code)` hex in
 * `voting_tokens.token_hash`. The pepper comes from the server-only
 * `VOTING_TOKEN_PEPPER` env var and never leaves the server process. Raw
 * Codes exist only in the returned `issued` list — the controlled
 * generation moment — for the admin's one-time export/print (with QR).
 * They are never logged (no log call in this module carries a Code) and
 * never stored.
 *
 * Uniqueness backstop is the `token_hash` unique constraint — on conflict
 * the Code is discarded and a fresh one minted.
 */

const CODES_PATH = "/admin/student/codes";

import { requireAdminSession } from "@/lib/auth/admin-session";

interface AdminContext {
  adminId: string;
}

async function requireAdmin(): Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; state: StudentCodeActionState }
> {
  const result = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to manage student Codes.",
  });
  if (!result.ok) {
    return { ok: false, state: result };
  }
  return { ok: true, context: { adminId: result.session.adminId } };
}

function dbError(code: string | null): StudentCodeActionState {
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
 * Generates exactly `quantity` NEW student Codes for one department.
 * Raw Codes are returned once in `issued` — export or print them
 * immediately (QR included); they cannot be recovered.
 */
export async function generateStudentCodes(
  _prevState: StudentCodeActionState,
  formData: FormData,
): Promise<StudentCodeActionState> {
  const parsed = generateStudentCodesSchema.safeParse({
    electionId: formData.get("electionId"),
    departmentId: formData.get("departmentId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return {
      ok: false,
      code: "INVALID_INPUT",
      message:
        firstIssue !== undefined
          ? `Invalid generation request: ${firstIssue.message}`
          : "Invalid generation request. Check the quantity and try again.",
    };
  }
  const { electionId, departmentId, quantity } = parsed.data;

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
  const department = departmentsParse.data.find(
    (row) => row.id === departmentId,
  );
  if (!department) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found. It may have been deleted already.",
    };
  }

  // Participation scope (same rule as the faculty status query): attached
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
          (participationRows ?? []).flatMap(
            (row: { department_id: unknown }) =>
              typeof row.department_id === "string"
                ? [row.department_id]
                : [],
          ),
        );
  if (participatingIds !== null && !participatingIds.has(departmentId)) {
    return {
      ok: false,
      code: "NOT_PARTICIPATING",
      message: `${department.code} is not participating in this Election — no Codes issued here.`,
    };
  }

  // Issue exactly `quantity` NEW rows. Existing rows are never read for
  // dedupe and never written: top-ups only add, so they cannot duplicate.
  // The per-batch set plus the `token_hash` unique backstop guards the
  // residual random-collision case.
  const issued: IssuedStudentCode[] = [];
  const batchLetters = new Set<string>();
  for (let n = 0; n < quantity; n += 1) {
    const mintResult = await mintVotingToken(supabase, {
      electionId,
      departmentId,
      tokenType: "STUDENT",
      facultyId: null,
      batchLetters,
    });
    if (!mintResult.ok) {
      if (mintResult.error === "DB_ERROR") {
        if (issued.length === 0) {
          return dbError(mintResult.dbErrorCode ?? null);
        }
        await logStudentAudit({
          action: "GENERATE_STUDENT_CODES",
          electionId,
          departmentId,
          quantity: issued.length,
          actorAdminId: gate.context.adminId,
        });
        return {
          ok: true,
          message:
            `Issued ${issued.length} of ${quantity} Codes before the database refused a write ` +
            `(code ${mintResult.dbErrorCode}). The Codes below are valid — export or print them now, then generate more for the rest.`,
          electionId,
          departmentId,
          issued,
        };
      }
      await logStudentAudit({
        action: "GENERATE_STUDENT_CODES",
        electionId,
        departmentId,
        quantity: issued.length,
        actorAdminId: gate.context.adminId,
      });
      return {
        ok: true,
        message:
          `Issued ${issued.length} of ${quantity} Codes. A fresh unique Code could not be minted ` +
          `for the rest — the Codes below are valid, export or print them now, then generate more.`,
        electionId,
        departmentId,
        issued,
      };
    }
    issued.push({
      departmentId,
      departmentCode: department.code,
      code: mintResult.code,
    });
  }

  // Token-use audit WITHOUT choice (spec §§3, 7): election + department +
  // quantity only. The raw Codes are never part of any audit payload.
  await logStudentAudit({
    action: "GENERATE_STUDENT_CODES",
    electionId,
    departmentId,
    quantity: issued.length,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(CODES_PATH);
  return {
    ok: true,
    message:
      `Issued ${issued.length} student Code${issued.length === 1 ? "" : "s"} for ${department.code}. ` +
      `Shown once below — export or print now; they cannot be recovered.`,
    electionId,
    departmentId,
    issued,
  };
}

/**
 * Manually invalidates an unused student voting Token (spec §6).
 */
export async function invalidateStudentCode(
  _prevState: StudentCodeActionState,
  formData: FormData,
): Promise<StudentCodeActionState> {
  const parsed = invalidateStudentCodeSchema.safeParse({
    electionId: formData.get("electionId"),
    departmentId: formData.get("departmentId"),
    code: formData.get("code") || undefined,
    tokenId: formData.get("tokenId") || undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid invalidation request. Check parameters and try again.",
    };
  }
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }
  const { electionId, departmentId, code, tokenId } = parsed.data;
  if (!code && !tokenId) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Either a Code or Token ID must be provided to invalidate.",
    };
  }

  const result = await invalidateStudentToken({
    electionId,
    departmentId,
    code,
    tokenId,
  });

  if (!result.ok || result.invalidated === 0) {
    if (result.error === "ALREADY_USED") {
      return {
        ok: false,
        code: "ALREADY_USED",
        message: "This student Token has already been used and cannot be invalidated.",
      };
    }
    return {
      ok: false,
      code: result.error === "DB_ERROR" ? "DB_ERROR" : "NOT_FOUND",
      message: result.message ?? "No matching live unused student Token found.",
    };
  }

  revalidatePath(CODES_PATH);
  return {
    ok: true,
    message: "Student voting Code invalidated successfully.",
    electionId,
    departmentId,
    issued: [],
  };
}

/**
 * Rotates an unused student voting Token (spec §6): invalidates the current
 * Token and generates a replacement Code for the department.
 */
export async function rotateStudentCode(
  _prevState: StudentCodeActionState,
  formData: FormData,
): Promise<StudentCodeActionState> {
  const parsed = rotateStudentCodeSchema.safeParse({
    electionId: formData.get("electionId"),
    departmentId: formData.get("departmentId"),
    code: formData.get("code") || undefined,
    tokenId: formData.get("tokenId") || undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid rotation request. Check parameters and try again.",
    };
  }
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }
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

  const { electionId, departmentId, code, tokenId } = parsed.data;
  if (!code && !tokenId) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Either a Code or Token ID must be provided to rotate.",
    };
  }

  const supabase = await createClient();
  const { data: dept } = await supabase
    .from("departments")
    .select("code")
    .eq("id", departmentId)
    .maybeSingle();

  const result = await rotateStudentToken({
    electionId,
    departmentId,
    code,
    tokenId,
  });

  if (!result.ok || !result.code) {
    if (result.error === "ALREADY_USED") {
      return {
        ok: false,
        code: "ALREADY_USED",
        message:
          result.message ??
          "This student Token has already been used and cannot be rotated.",
      };
    }
    return {
      ok: false,
      code: result.error === "DB_ERROR" ? "DB_ERROR" : "NOT_FOUND",
      message: result.message ?? "Rotation failed. No matching live unused Token found.",
    };
  }

  revalidatePath(CODES_PATH);
  return {
    ok: true,
    message: `Rotated student voting Code. Shown once below — export or print now; it cannot be recovered.`,
    electionId,
    departmentId,
    issued: [
      {
        departmentId,
        departmentCode: dept?.code ?? "",
        code: result.code,
      },
    ],
  };
}
