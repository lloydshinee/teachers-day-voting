import { z } from "zod";

/**
 * Stage-1 results validation (spec §14 task 10, results architecture §12).
 *
 * Deliberately pure (no `server-only`, no I/O) so the admin Client Component
 * can import the action-state types. All database access lives in
 * `./queries.js` / `./actions.js`, which are server-only.
 *
 * Glossary (GLOSSARY.md) is used exactly: Tie, Candidate, Finalist, Election.
 */

export const STAGE1_FACULTY_STAGE = "FACULTY" as const;

/** One aggregate vote row as read from `votes` (candidate side only). */
export const stage1VoteRowSchema = z.object({
  candidate_faculty_id: z.uuid(),
});

export type Stage1VoteRow = z.infer<typeof stage1VoteRowSchema>;

/** Faculty name lookup for aggregate display (admins already see these). */
export const stage1FacultyRowSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
});

export type Stage1FacultyRow = z.infer<typeof stage1FacultyRowSchema>;

/** Election row fields the Stage-1 close/freeze path needs. */
export const stage1ElectionRowSchema = z.object({
  id: z.uuid(),
  stage: z.string(),
  tie_policy_locked_at: z.string().nullable(),
});

export type Stage1ElectionRow = z.infer<typeof stage1ElectionRowSchema>;

/** `election_departments` participation + gate row (snake_case as stored). */
export const stage1MarkersRowSchema = z.object({
  election_id: z.uuid(),
  department_id: z.uuid(),
  finalists_locked_at: z.string().nullable(),
  winner_published_at: z.string().nullable(),
  tie_pending: z.boolean(),
});

export type Stage1MarkersRow = z.infer<typeof stage1MarkersRowSchema>;

/** Frozen `finalists` snapshot row as read back. */
export const stage1FinalistRowSchema = z.object({
  faculty_id: z.uuid(),
  stage1_votes: z.number().int(),
  rank: z.number().int(),
});

export type Stage1FinalistRow = z.infer<typeof stage1FinalistRowSchema>;

/** Manual Tie pick input: admin-chosen Candidates from exactly the tied set. */
export const resolveStage1TieSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid(),
  pickedCandidateIds: z
    .array(z.uuid())
    .min(1, "Pick at least one tied Candidate.")
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Picked Candidates must be unique.",
    }),
});

export type ResolveStage1TieInput = z.infer<typeof resolveStage1TieSchema>;

/** Department scope for close/freeze/re-open actions. */
export const stage1DepartmentScopeSchema = z.object({
  electionId: z.uuid(),
  departmentId: z.uuid(),
});

export type Stage1DepartmentScope = z.infer<typeof stage1DepartmentScopeSchema>;

export const STAGE1_ACTION_ERROR_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "INVALID_INPUT",
  "NOT_FOUND",
  "STAGE_MISMATCH",
  "ELECTION_CLOSED",
  "TIE_PENDING",
  "TIE_NOT_PENDING",
  "TIE_ALREADY_PENDING",
  "FINALISTS_ALREADY_LOCKED",
  "FINALISTS_NOT_LOCKED",
  "NOT_TIED_CANDIDATE",
  "WRONG_PICK_COUNT",
  "REOPEN_BLOCKED_BY_DEPENDENT_VOTES",
  "REOPEN_BLOCKED_BY_PUBLISHED_WINNER",
  "DB_ERROR",
] as const;

export type Stage1ActionErrorCode =
  (typeof STAGE1_ACTION_ERROR_CODES)[number];

/**
 * Serializable Server Action state. Domain failures are values, never
 * thrown, so forms can render them with `useActionState`.
 */
export type Stage1ActionState =
  | { ok: true; message: string }
  | { ok: false; code: Stage1ActionErrorCode; message: string };
