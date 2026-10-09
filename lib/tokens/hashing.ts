import { createHash } from "node:crypto";
import { normalizeCodeLetters } from "./format";

/**
 * Token Code hashing at rest (spec §6, task 8).
 *
 * Stored value: `SHA-256(pepper + Code)` hex, where `Code` is the normalized
 * 12-letter form (no dashes, uppercase). Hashing runs in the server process
 * so the pepper never leaves the app: it is never written to the database,
 * never logged, and never sent to the browser. Only the hex digest reaches
 * `voting_tokens.token_hash`.
 */

declare const TokenHashBrand: unique symbol;
/** Branded type for SHA-256 peppered token hash (spec §6). */
export type TokenHash = string & { readonly [TokenHashBrand]?: "TokenHash" };

export function asTokenHash(hash: string): TokenHash {
  return hash as TokenHash;
}

function getPepper(): string {
  if (process.env.VOTING_TOKEN_PEPPER) {
    return process.env.VOTING_TOKEN_PEPPER;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getTokenPepper } = require("../supabase/server-env");
    return getTokenPepper();
  } catch {
    throw new Error("VOTING_TOKEN_PEPPER environment variable is not set.");
  }
}

/** Canonical pre-hash form: 12 uppercase letters, no dashes. */
export function canonicalCodeLetters(code: string): string | null {
  return normalizeCodeLetters(code);
}

export function hashLetters(letters: string, pepper: string): TokenHash {
  return asTokenHash(
    createHash("sha256").update(pepper + letters, "utf8").digest("hex"),
  );
}

/**
 * Hashes a Code in canonical display form (`XXXX-XXXX-XXXX`, case and
 * dash tolerant) for storage or lookup. Returns null for malformed input.
 */
export function hashCode(
  code: string,
  customPepper?: string,
): TokenHash | null {
  const letters = canonicalCodeLetters(code);
  if (letters === null) {
    return null;
  }
  const pepper = customPepper ?? getPepper();
  return hashLetters(letters, pepper);
}

/**
 * Hashes already-normalized letters (exactly 12 alphabet characters).
 * Prefer `hashCode` unless the caller has already normalized.
 */
export function hashNormalizedLetters(
  letters: string,
  customPepper?: string,
): TokenHash {
  const pepper = customPepper ?? getPepper();
  return hashLetters(letters, pepper);
}
