import { z } from "zod";

import { logFacultyAudit } from "@/lib/audit/hook";
import { createClient } from "@/lib/supabase/server";
import { getTokenPepper } from "@/lib/supabase/server-env";
import { normalizeCodeLetters, type Code } from "./format";
import { hashLetters, type TokenHash } from "./hashing";
import { mintVotingToken } from "./minting";

/**
 * Token invalidation and rotation mechanics (spec §6, §14 tasks 7, 8, 11).
 *
 * Churn rule: archiving a faculty member invalidates only the UNUSED voting
 * Tokens for that faculty — cast votes stand.
 *
 * Manual invalidation (spec §6): admin can invalidate unused Tokens without
 * archiving. Used Tokens are permanently burned and cannot be invalidated.
 *
 * Rotation (spec §6): invalidates an existing unused Token and issues a fresh
 * replacement Token in an atomic administrative workflow. Used Tokens can
 * never be rotated.
 */

const facultyContextSchema = z.object({
  id: z.string().uuid(),
  department_id: z.string().uuid(),
  full_name: z.string(),
});

type FacultyContext = z.infer<typeof facultyContextSchema>;

export interface InvalidateFacultyTokensOptions {
  /** Auth user id of the acting admin; null only for system writes. */
  actorAdminId?: string | null;
}

export interface InvalidateFacultyTokensResult {
  /** Number of UNUSED Token rows stamped invalidated. */
  invalidated: number;
}

/**
 * Invalidates the unused voting Token(s) for one archived faculty row and
 * writes one `INVALIDATE_FACULTY_TOKENS` audit entry when any row lapsed.
 */
export async function invalidateUnusedFacultyTokens(
  facultyId: string,
  options?: InvalidateFacultyTokensOptions,
): Promise<InvalidateFacultyTokensResult> {
  const supabase = await createClient();

  const { data: faculty } = await supabase
    .from("faculty")
    .select("id, department_id, full_name")
    .eq("id", facultyId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("voting_tokens")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("faculty_id", facultyId)
    .eq("token_type", "FACULTY")
    .eq("used", false)
    .is("invalidated_at", null)
    .select("id");

  if (error) {
    throw new Error(
      `Faculty Token invalidation failed (code ${error.code}).`,
    );
  }

  const invalidated = data === null ? 0 : data.length;
  if (invalidated > 0) {
    const parsedContext = facultyContextSchema.safeParse(faculty);
    if (parsedContext.success) {
      const context: FacultyContext = parsedContext.data;
      await logFacultyAudit({
        action: "INVALIDATE_FACULTY_TOKENS",
        facultyId,
        archivedFacultyId: null,
        departmentId: context.department_id,
        fullName: context.full_name,
        actorAdminId: options?.actorAdminId ?? null,
      });
    }
  }
  return { invalidated };
}

// ---------------------------------------------------------------------------
// Manual Faculty Token Invalidation & Rotation
// ---------------------------------------------------------------------------

export interface InvalidateFacultyTokenOptions {
  electionId?: string;
  actorAdminId?: string | null;
}

/**
 * Manually invalidates unused faculty Token(s) for a faculty member,
 * optionally scoped to a single Election.
 */
export async function invalidateFacultyToken(
  facultyId: string,
  options?: InvalidateFacultyTokenOptions,
): Promise<InvalidateFacultyTokensResult> {
  const supabase = await createClient();

  const { data: faculty } = await supabase
    .from("faculty")
    .select("id, department_id, full_name")
    .eq("id", facultyId)
    .maybeSingle();

  let query = supabase
    .from("voting_tokens")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("faculty_id", facultyId)
    .eq("token_type", "FACULTY")
    .eq("used", false)
    .is("invalidated_at", null);

  if (options?.electionId) {
    query = query.eq("election_id", options.electionId);
  }

  const { data, error } = await query.select("id");

  if (error) {
    throw new Error(
      `Manual Faculty Token invalidation failed (code ${error.code}).`,
    );
  }

  const invalidated = data === null ? 0 : data.length;
  if (invalidated > 0 && faculty) {
    const parsedContext = facultyContextSchema.safeParse(faculty);
    if (parsedContext.success) {
      const context: FacultyContext = parsedContext.data;
      await logFacultyAudit({
        action: "INVALIDATE_FACULTY_TOKENS",
        facultyId,
        archivedFacultyId: null,
        departmentId: context.department_id,
        fullName: context.full_name,
        actorAdminId: options?.actorAdminId ?? null,
      });
    }
  }

  return { invalidated };
}

export interface RotateFacultyTokenResult {
  ok: boolean;
  code?: Code;
  tokenHash?: TokenHash;
  error?: "NOT_FOUND" | "ALREADY_USED" | "DB_ERROR" | "CONFIG_ERROR";
  message?: string;
}

/**
 * Rotates a faculty Token: invalidates the current live unused Token and issues
 * a brand new replacement Code. Rejects if the token is already used.
 */
export async function rotateFacultyToken(
  electionId: string,
  facultyId: string,
  options?: { actorAdminId?: string | null },
): Promise<RotateFacultyTokenResult> {
  const supabase = await createClient();

  const { data: faculty, error: facultyError } = await supabase
    .from("faculty")
    .select("id, department_id, full_name, archived_at")
    .eq("id", facultyId)
    .maybeSingle();

  if (facultyError || !faculty) {
    return { ok: false, error: "NOT_FOUND", message: "Faculty member not found." };
  }
  if (faculty.archived_at !== null) {
    return { ok: false, error: "NOT_FOUND", message: "Faculty member is archived." };
  }

  const { data: existingTokens, error: tokenError } = await supabase
    .from("voting_tokens")
    .select("id, used, invalidated_at")
    .eq("election_id", electionId)
    .eq("faculty_id", facultyId)
    .eq("token_type", "FACULTY");

  if (tokenError) {
    return { ok: false, error: "DB_ERROR", message: "Database query failed." };
  }

  const activeToken = existingTokens?.find((t) => t.invalidated_at === null);
  if (!activeToken) {
    return { ok: false, error: "NOT_FOUND", message: "No active voting Token found to rotate." };
  }
  if (activeToken.used) {
    return {
      ok: false,
      error: "ALREADY_USED",
      message: "This faculty member has already cast a vote. Used Tokens cannot be rotated.",
    };
  }

  // Invalidate active token
  const { error: invalidateError } = await supabase
    .from("voting_tokens")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("id", activeToken.id)
    .eq("used", false)
    .is("invalidated_at", null);

  if (invalidateError) {
    return { ok: false, error: "DB_ERROR", message: "Failed to invalidate existing Token." };
  }

  await logFacultyAudit({
    action: "INVALIDATE_FACULTY_TOKENS",
    facultyId,
    archivedFacultyId: null,
    departmentId: faculty.department_id,
    fullName: faculty.full_name,
    actorAdminId: options?.actorAdminId ?? null,
  });

  // Mint replacement token
  const mintResult = await mintVotingToken(supabase, {
    electionId,
    departmentId: faculty.department_id,
    tokenType: "FACULTY",
    facultyId,
  });

  if (!mintResult.ok) {
    return { ok: false, error: "DB_ERROR", message: "Failed to mint replacement Token." };
  }

  await logFacultyAudit({
    action: "GENERATE_FACULTY_CODES",
    facultyId,
    archivedFacultyId: null,
    departmentId: faculty.department_id,
    fullName: faculty.full_name,
    actorAdminId: options?.actorAdminId ?? null,
  });

  return {
    ok: true,
    code: mintResult.code,
    tokenHash: mintResult.tokenHash,
  };
}

// ---------------------------------------------------------------------------
// Manual Student Token Invalidation & Rotation
// ---------------------------------------------------------------------------

export interface InvalidateStudentTokenParams {
  electionId: string;
  departmentId: string;
  code?: string;
  tokenId?: string;
}

export interface InvalidateStudentTokenResult {
  ok: boolean;
  invalidated: number;
  error?: "NOT_FOUND" | "ALREADY_USED" | "DB_ERROR";
  message?: string;
}

/**
 * Manually invalidates an unused student Token identified by either `tokenId`
 * or raw `code`. Used Tokens cannot be invalidated.
 */
export async function invalidateStudentToken(
  params: InvalidateStudentTokenParams,
): Promise<InvalidateStudentTokenResult> {
  const supabase = await createClient();

  let targetId: string | null = params.tokenId ?? null;
  if (!targetId && params.code) {
    const letters = normalizeCodeLetters(params.code);
    if (!letters) {
      return { ok: false, invalidated: 0, error: "NOT_FOUND", message: "Invalid Code format." };
    }
    const tokenHash = hashLetters(letters, getTokenPepper());
    const { data: tokenRow } = await supabase
      .from("voting_tokens")
      .select("id, used, invalidated_at")
      .eq("election_id", params.electionId)
      .eq("department_id", params.departmentId)
      .eq("token_hash", tokenHash)
      .eq("token_type", "STUDENT")
      .maybeSingle();

    if (!tokenRow) {
      return { ok: false, invalidated: 0, error: "NOT_FOUND", message: "Token not found." };
    }
    if (tokenRow.used) {
      return { ok: false, invalidated: 0, error: "ALREADY_USED", message: "Token has already been used." };
    }
    targetId = tokenRow.id;
  }

  if (!targetId) {
    return { ok: false, invalidated: 0, error: "NOT_FOUND", message: "No Token identifier provided." };
  }

  const { data, error } = await supabase
    .from("voting_tokens")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("id", targetId)
    .eq("election_id", params.electionId)
    .eq("department_id", params.departmentId)
    .eq("token_type", "STUDENT")
    .eq("used", false)
    .is("invalidated_at", null)
    .select("id");

  if (error) {
    return { ok: false, invalidated: 0, error: "DB_ERROR", message: error.message };
  }

  return { ok: true, invalidated: data === null ? 0 : data.length };
}

export interface RotateStudentTokenParams {
  electionId: string;
  departmentId: string;
  code?: string;
  tokenId?: string;
}

export interface RotateStudentTokenResult {
  ok: boolean;
  code?: Code;
  tokenHash?: TokenHash;
  error?: "NOT_FOUND" | "ALREADY_USED" | "DB_ERROR" | "CONFIG_ERROR";
  message?: string;
}

/**
 * Rotates a student Token: invalidates the current live unused Token and issues
 * a replacement student Code for the same Election and Department.
 */
export async function rotateStudentToken(
  params: RotateStudentTokenParams,
): Promise<RotateStudentTokenResult> {
  const supabase = await createClient();

  let targetId: string | null = params.tokenId ?? null;
  if (!targetId && params.code) {
    const letters = normalizeCodeLetters(params.code);
    if (!letters) {
      return { ok: false, error: "NOT_FOUND", message: "Invalid Code format." };
    }
    const tokenHash = hashLetters(letters, getTokenPepper());
    const { data: tokenRow } = await supabase
      .from("voting_tokens")
      .select("id, used, invalidated_at")
      .eq("election_id", params.electionId)
      .eq("department_id", params.departmentId)
      .eq("token_hash", tokenHash)
      .eq("token_type", "STUDENT")
      .maybeSingle();

    if (!tokenRow) {
      return { ok: false, error: "NOT_FOUND", message: "Token not found." };
    }
    if (tokenRow.used) {
      return { ok: false, error: "ALREADY_USED", message: "Token has already been used and cannot be rotated." };
    }
    targetId = tokenRow.id;
  }

  if (!targetId) {
    return { ok: false, error: "NOT_FOUND", message: "No Token identifier provided." };
  }

  const { data: activeToken, error: tokenError } = await supabase
    .from("voting_tokens")
    .select("id, used, invalidated_at")
    .eq("id", targetId)
    .eq("election_id", params.electionId)
    .eq("department_id", params.departmentId)
    .eq("token_type", "STUDENT")
    .maybeSingle();

  if (tokenError || !activeToken) {
    return { ok: false, error: "NOT_FOUND", message: "Token not found." };
  }
  if (activeToken.used) {
    return { ok: false, error: "ALREADY_USED", message: "Token has already been used and cannot be rotated." };
  }
  if (activeToken.invalidated_at !== null) {
    return { ok: false, error: "NOT_FOUND", message: "Token is already invalidated." };
  }

  const { error: invalidateError } = await supabase
    .from("voting_tokens")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("id", targetId)
    .eq("used", false)
    .is("invalidated_at", null);

  if (invalidateError) {
    return { ok: false, error: "DB_ERROR", message: "Failed to invalidate existing student Token." };
  }

  const mintResult = await mintVotingToken(supabase, {
    electionId: params.electionId,
    departmentId: params.departmentId,
    tokenType: "STUDENT",
    facultyId: null,
  });

  if (!mintResult.ok) {
    return { ok: false, error: "DB_ERROR", message: "Failed to mint replacement student Token." };
  }

  return {
    ok: true,
    code: mintResult.code,
    tokenHash: mintResult.tokenHash,
  };
}
