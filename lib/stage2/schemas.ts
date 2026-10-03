import { z } from "zod";

/**
 * Stage-2 results validation (spec §14 task 13, results architecture §12).
 *
 * Deliberately pure (no `server-only`, no I/O) so the admin Client Component
 * can import the action-state types. All database access lives in
 * `./queries.js` / `./actions.js`, which are server-only.
 *
 * Glossary (GLOSSARY.md) is used exactly: Tie, Finalist, Winner, Election.
 */

/** One aggregate student-vote row as read from `votes` (candidate side only). */
export const stage2VoteRowSchema = z.object({
  candidate_faculty_id: z.uuid(),
});

export type Stage2VoteRow = z.infer<typeof stage2VoteRowSchema>;

/** Faculty name lookup for aggregate display (admins already see these). */
export const stage2FacultyRowSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  picture_url: z.string().nullable().optional(),
});

export type Stage2FacultyRow = z.infer<typeof stage2FacultyRowSchema>;

/** Election row fields the Stage-2 close/publish path needs. */
export const stage2ElectionRowSchema = z.object({
  id: z.uuid(),
  stage: z.string(),
  tie_policy_locked_at: z.string().nullable(),
});

export type Stage2ElectionRow = z.infer<typeof stage2ElectionRowSchema>;

/** `election_departments` participation + gate row (snake_case as stored). */
export const stage2MarkersRowSchema = z.object({
  election_id: z.uuid(),
  department_id: z.uuid(),
  finalists_locked_at: z.string().nullable(),
  winner_published_at: z.string().nullable(),
  tie_pending: z.boolean(),
});

export type Stage2MarkersRow = z.infer<typeof stage2MarkersRowSchema>;

/** Frozen `finalists` snapshot row as read back. */
export const stage2FinalistRowSchema = z.object({
  faculty_id: z.uuid(),
  stage1_votes: z.number().int(),
  rank: z.number().int(),
});

export type Stage2FinalistRow = z.infer<typeof stage2FinalistRowSchema>;

/** Per-department `election_results` published-Winner row as read back. */
export const stage2ResultRowSchema = z.object({
  winner_faculty_id: z.uuid(),
  published: z.boolean(),
  policy_version: z.string().nullable(),
});

export type Stage2ResultRow = z.infer<typeof stage2ResultRowSchema>;

/**
 * Manual Winner Tie pick input: exactly one Finalist from the tied set
 * (spec §2d). A single uuid field — not an array — so the schema itself
 * enforces "exactly one"; the action additionally requires the id to
 * belong to the computed tied set (never trusted from the browser).
 */
export const resolveStage2TieSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid(),
  pickedFinalistId: z.uuid(),
});

export type ResolveStage2TieInput = z.infer<typeof resolveStage2TieSchema>;

/** Department scope for close/flag/publish actions. */
export const stage2DepartmentScopeSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid(),
});

export type Stage2DepartmentScope = z.infer<typeof stage2DepartmentScopeSchema>;

export const STAGE2_ACTION_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "NOT_FOUND",
  "STAGE_MISMATCH",
  "ELECTION_CLOSED",
  "TIE_PENDING",
  "TIE_NOT_PENDING",
  "TIE_ALREADY_PENDING",
  "FINALISTS_NOT_LOCKED",
  "NOT_TIED_FINALIST",
  "NO_WINNER",
  "POLICY_NOT_FROZEN",
  "WINNER_ALREADY_PUBLISHED",
  "DB_ERROR",
] as const;

export type Stage2ActionErrorCode =
  (typeof STAGE2_ACTION_ERROR_CODES)[number];

/**
 * Serializable Server Action state. Domain failures are values, never
 * thrown, so forms can render them with `useActionState`.
 */
export type Stage2ActionState =
  | { ok: true; message: string }
  | { ok: false; code: Stage2ActionErrorCode; message: string };
