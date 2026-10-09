import { z } from "zod";

/**
 * Student Code generation validation (spec §14 task 11, DDL direction §3).
 *
 * STUDENT Tokens are per-election rows bound to exactly one department with
 * a NULL faculty link [LOCKED]:
 * `voting_tokens(election_id, department_id, token_hash unique,
 * token_type='STUDENT', faculty_id NULL, used, used_at, invalidated_at)`.
 *
 * Unlike faculty Codes (missing-only, 1:1 faculty↔Token), student Codes are
 * issued in admin-specified quantities per department (e.g. CCS 300,
 * COED 450). Every generation call creates exactly the requested number of
 * NEW rows — top-ups never duplicate: previously issued rows are untouched,
 * and the `token_hash` unique constraint backstops hash collisions (a
 * colliding Code is discarded and a fresh one minted).
 */

export const MAX_STUDENT_CODES_PER_CALL = 2000;

/**
 * Student Code generation input (spec §6, task 11).
 *
 * - `electionId` scopes every Token row (Tokens are per-election).
 * - `departmentId` binds every issued Token to exactly one department —
 *   the server re-derives the ballot department from the Token at vote
 *   time, never from browser input (spec §11).
 * - `quantity` is the exact number of NEW STUDENT Tokens to create.
 */
export const generateStudentCodesSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid(),
  quantity: z.coerce
    .number()
    .int("Quantity must be a whole number of Codes.")
    .min(1, "Quantity must be at least 1 Code.")
    .max(
      MAX_STUDENT_CODES_PER_CALL,
      `Quantity must be at most ${MAX_STUDENT_CODES_PER_CALL} Codes per generation — split larger runs into smaller batches.`,
    ),
});

export type GenerateStudentCodesInput = z.infer<
  typeof generateStudentCodesSchema
>;

/**
 * One issued student Code. Raw `code` values exist ONLY in the generation
 * response (and the admin's one-time export/print of it) — they are never
 * stored (only the SHA-256 hash is) and never logged. There is no holder
 * name: STUDENT Tokens carry no faculty link.
 */
export interface IssuedStudentCode {
  departmentId: string;
  departmentCode: string;
  code: string;
}

export const STUDENT_CODE_ACTION_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "NOT_FOUND",
  "NOT_PARTICIPATING",
  "ALREADY_USED",
  "NO_TOKEN",
  "CONFIG_ERROR",
  "DB_ERROR",
] as const;

export type StudentCodeActionErrorCode =
  (typeof STUDENT_CODE_ACTION_ERROR_CODES)[number];

export const invalidateStudentCodeSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid(),
  code: z.string().optional(),
  tokenId: z.uuid().optional(),
});

export type InvalidateStudentCodeInput = z.infer<
  typeof invalidateStudentCodeSchema
>;

export const rotateStudentCodeSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid(),
  code: z.string().optional(),
  tokenId: z.uuid().optional(),
});

export type RotateStudentCodeInput = z.infer<typeof rotateStudentCodeSchema>;

/**
 * Generation / Invalidation / Rotation result state.
 */
export type StudentCodeActionState =
  | {
      ok: true;
      message: string;
      electionId: string;
      departmentId: string;
      issued: IssuedStudentCode[];
    }
  | { ok: false; code: StudentCodeActionErrorCode; message: string };
