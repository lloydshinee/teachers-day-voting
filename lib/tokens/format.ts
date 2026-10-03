import { randomInt } from "node:crypto";
import { z } from "zod";

/**
 * Token Code format (spec §6, task 8).
 *
 * Approved form: 12 characters in 3 groups of 4, e.g. `7K9P-X2MA-Q4LT`.
 * The alphabet drops easily confused characters (`0`/`O`, `1`/`I`),
 * leaving 32 symbols: exactly 60 bits of entropy per Code
 * (12 × log2(32) = 60), on top of the server pepper plus rate limits.
 *
 * This module is deliberately pure (no `server-only`, no I/O) so tests
 * can run under plain Node / jiti.
 *
 * Glossary (GLOSSARY.md): Code is the human-readable form of a Token — what
 * is typed, printed, or QR-encoded. (Voting code is the colloquial alias).
 */

/** Unambiguous alphabet: A–Z minus I/O, plus digits 2–9 (no 0/1). */
export const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const CODE_LETTER_COUNT = 12;
export const CODE_GROUP_SIZE = 4;
export const CODE_GROUP_COUNT = 3;

/** Display form: `XXXX-XXXX-XXXX` (dashes are presentation only). */
export function formatCode(letters: string): string {
  const groups: string[] = [];
  for (let i = 0; i < CODE_GROUP_COUNT; i += 1) {
    groups.push(letters.slice(i * CODE_GROUP_SIZE, (i + 1) * CODE_GROUP_SIZE));
  }
  return groups.join("-");
}

/**
 * Normalizes user/operator input to canonical display form:
 * uppercases, strips whitespace and dashes, then regroups.
 * Returns null when the input cannot be a Code (wrong length or character outside alphabet).
 */
export function normalizeCode(input: string): string | null {
  const stripped = input.replace(/[\s-]+/g, "").toUpperCase();
  if (stripped.length !== CODE_LETTER_COUNT) {
    return null;
  }
  for (const char of stripped) {
    if (!CODE_ALPHABET.includes(char)) {
      return null;
    }
  }
  return formatCode(stripped);
}

/** Zod schema for a Code in canonical display form (`XXXX-XXXX-XXXX`). */
export const codeSchema = z
  .string()
  .regex(
    /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/,
    "Code must look like XXXX-XXXX-XXXX using the unambiguous alphabet (no 0/O, 1/I).",
  );

export type VotingCode = z.infer<typeof codeSchema>;

/**
 * Generates one random Code using `crypto.randomInt` (uniform per symbol, never `Math.random`).
 * Dashes are presentation only — the 12 letters carry the entropy.
 */
export function generateCode(): string {
  let letters = "";
  for (let i = 0; i < CODE_LETTER_COUNT; i += 1) {
    letters += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return formatCode(letters);
}
