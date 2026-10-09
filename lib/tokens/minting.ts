import type { SupabaseClient } from "@supabase/supabase-js";

import { getTokenPepper } from "@/lib/supabase/server-env";
import { generateCode, normalizeCodeLetters, type Code } from "./format";
import { hashLetters, type TokenHash } from "./hashing";

/**
 * Shared Token minting mechanics (spec §6, §14 tasks 8, 11).
 *
 * Consolidates the randomized Code generation, unambiguous symbol checks,
 * pepper hashing, and unique constraint retry loop shared between faculty
 * and student token creation.
 */

export const MAX_HASH_RETRIES = 5;

export interface MintTokenParams {
  electionId: string;
  departmentId: string;
  tokenType: "FACULTY" | "STUDENT";
  facultyId?: string | null;
  batchLetters?: Set<string>;
  maxRetries?: number;
  pepper?: string;
}

export type MintTokenResult =
  | {
      ok: true;
      code: Code;
      tokenHash: TokenHash;
      letters: string;
    }
  | {
      ok: false;
      error: "UNIQUE_COLLISION" | "DB_ERROR";
      dbErrorCode?: string;
    };

/**
 * Mints one voting token in the database with retry on unique collision (code 23505).
 * Letters are extracted and normalized via lib/tokens/format (normalizeCodeLetters).
 * Returns the generated raw Code and token hash upon successful insertion.
 */
export async function mintVotingToken(
  supabase: SupabaseClient,
  params: MintTokenParams,
): Promise<MintTokenResult> {
  const maxRetries = params.maxRetries ?? MAX_HASH_RETRIES;
  const batchLetters = params.batchLetters ?? new Set<string>();
  const pepper = params.pepper ?? getTokenPepper();

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const code = generateCode();
    const letters = normalizeCodeLetters(code);
    if (!letters) {
      continue;
    }
    if (batchLetters.has(letters)) {
      continue;
    }

    const tokenHash = hashLetters(letters, pepper);
    const { error: insertError } = await supabase
      .from("voting_tokens")
      .insert({
        election_id: params.electionId,
        department_id: params.departmentId,
        token_hash: tokenHash,
        token_type: params.tokenType,
        faculty_id: params.facultyId ?? null,
      });

    if (insertError) {
      if (insertError.code === "23505") {
        continue;
      }
      return {
        ok: false,
        error: "DB_ERROR",
        dbErrorCode: insertError.code,
      };
    }

    batchLetters.add(letters);
    return {
      ok: true,
      code,
      tokenHash,
      letters,
    };
  }

  return {
    ok: false,
    error: "UNIQUE_COLLISION",
  };
}
