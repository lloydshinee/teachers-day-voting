import { z } from "zod";

import {
  departmentMarkersSchema,
  type DepartmentMarkers,
} from "./department";
import {
  electionStageSchema,
  GLOBAL_ADMIN_ACTIONS,
  globalAdminActionSchema,
  type ElectionStage,
  type GlobalAdminAction,
} from "./stages";

/**
 * Election state machine — spec §5 (Zod-validated actions).
 *
 * Every public `apply*` function takes `unknown`, validates it against a Zod
 * schema first, and returns an `ActionResult` — domain failures are values,
 * never thrown. Callers persist the returned markers and write one audit row
 * per success using `auditAction` (+ `auditDetails` where present).
 *
 * Glossary terms (GLOSSARY.md) are used exactly: Tie, Token, Code, Candidate,
 * Finalist, Winner, Election.
 */

export const ACTION_ERROR_CODES = [
  "INVALID_INPUT",
  "ILLEGAL_GLOBAL_TRANSITION",
  "ELECTION_CLOSED",
  "STAGE_MISMATCH",
  "TIE_PENDING",
  "TIE_NOT_PENDING",
  "TIE_ALREADY_PENDING",
  "FINALISTS_ALREADY_LOCKED",
  "FINALISTS_NOT_LOCKED",
  "WINNER_ALREADY_PUBLISHED",
  "REOPEN_BLOCKED_BY_DEPENDENT_VOTES",
  "REOPEN_BLOCKED_BY_PUBLISHED_WINNER",
  "REOPEN_NOTHING_TO_REOPEN",
] as const;

export type ActionErrorCode = (typeof ACTION_ERROR_CODES)[number];

export interface ActionError {
  code: ActionErrorCode;
  message: string;
}

export type ActionResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ActionError };

function fail<T>(code: ActionErrorCode, message: string): ActionResult<T> {
  return { ok: false, error: { code, message } };
}

function invalidInput<T>(issues: Array<{ message: string }>): ActionResult<T> {
  const detail = issues.map((issue) => issue.message).join("; ");
  return fail<T>(
    "INVALID_INPUT",
    detail === "" ? "Invalid action input." : `Invalid action input: ${detail}`,
  );
}

// ---------------------------------------------------------------------------
// Global stage transitions (forward-only, one step, explicit admin action).
// ---------------------------------------------------------------------------

export const globalTransitionInputSchema = z.object({
  from: electionStageSchema,
  action: globalAdminActionSchema,
});

export type GlobalTransitionInput = z.infer<typeof globalTransitionInputSchema>;

export interface GlobalTransitionSuccess {
  from: ElectionStage;
  to: ElectionStage;
  action: GlobalAdminAction;
  /** Audit-log `action` value the caller must persist (spec §2a: every step). */
  auditAction: string;
}

export function applyGlobalAction(input: unknown): ActionResult<GlobalTransitionSuccess> {
  const parsed = globalTransitionInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }
  const { from, action } = parsed.data;
  const expected = GLOBAL_ADMIN_ACTIONS[action];
  if (expected.from !== from) {
    return fail<GlobalTransitionSuccess>(
      "ILLEGAL_GLOBAL_TRANSITION",
      `Action ${action} requires stage ${expected.from}, election is at ${from}. ` +
        "Global transitions move exactly one step forward and never backward.",
    );
  }
  return {
    ok: true,
    value: { from, to: expected.to, action, auditAction: action },
  };
}

// ---------------------------------------------------------------------------
// Per-department advancement: Finalists lock.
// Spec §12: frozen Finalist snapshot written on Stage-1 close; a tied
// department holds (tiePending) while others advance, so late locks during
// STUDENT_VOTING are legal — voting in that department simply yields no
// ballot until its Finalists exist.
// ---------------------------------------------------------------------------

export const lockFinalistsInputSchema = z.object({
  markers: departmentMarkersSchema,
  stage: electionStageSchema,
  lockedAt: z.iso.datetime(),
});

export interface LockFinalistsSuccess {
  markers: DepartmentMarkers;
  auditAction: string;
}

const LOCKABLE_STAGES: readonly ElectionStage[] = [
  "FACULTY_RESULTS",
  "STUDENT_VOTING",
  "FINAL_RESULTS",
];

export function applyLockFinalists(input: unknown): ActionResult<LockFinalistsSuccess> {
  const parsed = lockFinalistsInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }
  const { markers, stage, lockedAt } = parsed.data;
  if (stage === "CLOSED") {
    return fail<LockFinalistsSuccess>(
      "ELECTION_CLOSED",
      "Election is CLOSED; department markers are frozen.",
    );
  }
  if (!LOCKABLE_STAGES.includes(stage)) {
    return fail<LockFinalistsSuccess>(
      "STAGE_MISMATCH",
      `Finalists lock requires Stage-1 counting to be closed (stage ${LOCKABLE_STAGES.join(", ")}); election is at ${stage}.`,
    );
  }
  if (markers.tiePending) {
    return fail<LockFinalistsSuccess>(
      "TIE_PENDING",
      "Department has a pending Tie at the cutoff; resolve the Tie before locking Finalists.",
    );
  }
  if (markers.finalistsLockedAt !== null) {
    return fail<LockFinalistsSuccess>(
      "FINALISTS_ALREADY_LOCKED",
      "Department Finalists are already locked.",
    );
  }
  return {
    ok: true,
    value: {
      markers: { ...markers, finalistsLockedAt: lockedAt },
      auditAction: "LOCK_FINALISTS",
    },
  };
}

// ---------------------------------------------------------------------------
// Per-department advancement: Tie flag + manual Tie pick (spec §2d).
// The admin picks among exactly the tied Candidates; clearing the flag is
// step one — the caller then writes the Finalists (or Winner record) via
// applyLockFinalists / applyPublishWinner and audits the pick with the
// frozen tie-policy version.
// ---------------------------------------------------------------------------

export const flagTieInputSchema = z.object({
  markers: departmentMarkersSchema,
  stage: electionStageSchema,
});

export interface FlagTieSuccess {
  markers: DepartmentMarkers;
  auditAction: string;
}

export function applyFlagTie(input: unknown): ActionResult<FlagTieSuccess> {
  const parsed = flagTieInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }
  const { markers, stage } = parsed.data;
  if (stage === "CLOSED") {
    return fail<FlagTieSuccess>(
      "ELECTION_CLOSED",
      "Election is CLOSED; department markers are frozen.",
    );
  }
  if (markers.tiePending) {
    return fail<FlagTieSuccess>(
      "TIE_ALREADY_PENDING",
      "Department already has a pending Tie.",
    );
  }
  if (markers.winnerPublishedAt !== null) {
    return fail<FlagTieSuccess>(
      "WINNER_ALREADY_PUBLISHED",
      "Department Winner is already published; there is nothing left to tie.",
    );
  }
  return {
    ok: true,
    value: {
      markers: { ...markers, tiePending: true },
      auditAction: "FLAG_TIE",
    },
  };
}

export const resolveTieInputSchema = z.object({
  markers: departmentMarkersSchema,
  stage: electionStageSchema,
  /** The tied Candidates the admin picked from (spec §2d: exactly the tied set). */
  pickedCandidateIds: z
    .array(z.uuid())
    .min(1, "At least one picked Candidate is required.")
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Picked Candidates must be unique.",
    }),
});

export type ResolveTieInput = z.infer<typeof resolveTieInputSchema>;

export interface ResolveTieSuccess {
  markers: DepartmentMarkers;
  pickedCandidateIds: string[];
  auditAction: string;
}

export function applyResolveTie(input: unknown): ActionResult<ResolveTieSuccess> {
  const parsed = resolveTieInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }
  const { markers, stage, pickedCandidateIds } = parsed.data;
  if (stage === "CLOSED") {
    return fail<ResolveTieSuccess>(
      "ELECTION_CLOSED",
      "Election is CLOSED; department markers are frozen.",
    );
  }
  if (!markers.tiePending) {
    return fail<ResolveTieSuccess>(
      "TIE_NOT_PENDING",
      "Department has no pending Tie to resolve.",
    );
  }
  return {
    ok: true,
    value: {
      markers: { ...markers, tiePending: false },
      pickedCandidateIds: [...pickedCandidateIds],
      auditAction: "RESOLVE_TIE",
    },
  };
}

// ---------------------------------------------------------------------------
// Per-department advancement: Winner publish (spec §12).
// Only after Stage-2 close (FINAL_RESULTS): publishing earlier would publish
// while student votes are still accepted. Terminal per department — there is
// no unpublish; a published Winner stands.
// ---------------------------------------------------------------------------

export const publishWinnerInputSchema = z.object({
  markers: departmentMarkersSchema,
  stage: electionStageSchema,
  publishedAt: z.iso.datetime(),
  /** Frozen `tie_policy_locked_at` version stamped on the record (spec §§2d, 3). Database-read: offset form accepted. */
  policyVersion: z.iso.datetime({ offset: true }),
});

export interface PublishWinnerSuccess {
  markers: DepartmentMarkers;
  policyVersion: string;
  auditAction: string;
}

export function applyPublishWinner(input: unknown): ActionResult<PublishWinnerSuccess> {
  const parsed = publishWinnerInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }
  const { markers, stage, publishedAt, policyVersion } = parsed.data;
  if (stage === "CLOSED") {
    return fail<PublishWinnerSuccess>(
      "ELECTION_CLOSED",
      "Election is CLOSED; department markers are frozen.",
    );
  }
  if (stage !== "FINAL_RESULTS") {
    return fail<PublishWinnerSuccess>(
      "STAGE_MISMATCH",
      `Winner publish requires stage FINAL_RESULTS (after Stage-2 close); election is at ${stage}.`,
    );
  }
  if (markers.tiePending) {
    return fail<PublishWinnerSuccess>(
      "TIE_PENDING",
      "Department has a pending Tie for Winner; resolve the Tie before publishing.",
    );
  }
  if (markers.finalistsLockedAt === null) {
    return fail<PublishWinnerSuccess>(
      "FINALISTS_NOT_LOCKED",
      "Department Finalists are not locked; there is no snapshot to elect a Winner from.",
    );
  }
  if (markers.winnerPublishedAt !== null) {
    return fail<PublishWinnerSuccess>(
      "WINNER_ALREADY_PUBLISHED",
      "Department Winner is already published.",
    );
  }
  return {
    ok: true,
    value: {
      markers: { ...markers, winnerPublishedAt: publishedAt },
      policyVersion,
      auditAction: "PUBLISH_WINNER",
    },
  };
}

// ---------------------------------------------------------------------------
// Re-open guardrail (spec §5 proposed, locked by approval).
// A stage may re-open only if no dependent-stage votes exist in that
// department: Stage 1 re-opens only with zero student votes there.
// Re-opening unfreezes that department's snapshot (the prior snapshot is
// returned as `supersededSnapshotAt` so the caller marks it superseded in
// audit) and requires a fresh close. Re-opening never un-casts votes — this
// function receives only a vote *count*, never vote rows, so it cannot
// touch them. A published Winner can never be unfrozen.
// ---------------------------------------------------------------------------

export const reopenStage1InputSchema = z.object({
  markers: departmentMarkersSchema,
  stage: electionStageSchema,
  dependentStudentVotes: z.number().int().min(0),
});

export interface ReopenStage1Success {
  markers: DepartmentMarkers;
  /** Prior `finalistsLockedAt` for the superseded-snapshot audit entry. */
  supersededSnapshotAt: string;
  auditAction: string;
}

const REOPENABLE_STAGES: readonly ElectionStage[] = [
  "FACULTY_RESULTS",
  "STUDENT_VOTING",
];

export function applyReopenStage1(input: unknown): ActionResult<ReopenStage1Success> {
  const parsed = reopenStage1InputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }
  const { markers, stage, dependentStudentVotes } = parsed.data;
  if (stage === "CLOSED") {
    return fail<ReopenStage1Success>(
      "ELECTION_CLOSED",
      "Election is CLOSED; department markers are frozen.",
    );
  }
  if (!REOPENABLE_STAGES.includes(stage)) {
    return fail<ReopenStage1Success>(
      "STAGE_MISMATCH",
      `Stage-1 re-open is meaningful only at ${REOPENABLE_STAGES.join(", ")}; election is at ${stage}.`,
    );
  }
  if (markers.finalistsLockedAt === null) {
    return fail<ReopenStage1Success>(
      "REOPEN_NOTHING_TO_REOPEN",
      "Department Finalists are not locked; there is no frozen snapshot to re-open.",
    );
  }
  if (markers.winnerPublishedAt !== null) {
    return fail<ReopenStage1Success>(
      "REOPEN_BLOCKED_BY_PUBLISHED_WINNER",
      "Department Winner is already published; the frozen snapshot cannot be unfrozen beneath it.",
    );
  }
  if (markers.tiePending) {
    return fail<ReopenStage1Success>(
      "TIE_PENDING",
      "Department has a pending Tie; resolve or clear it before re-opening.",
    );
  }
  if (dependentStudentVotes > 0) {
    return fail<ReopenStage1Success>(
      "REOPEN_BLOCKED_BY_DEPENDENT_VOTES",
      `Stage 1 re-opens only with zero dependent-stage votes in the department; found ${dependentStudentVotes} student vote(s).`,
    );
  }
  return {
    ok: true,
    value: {
      markers: { ...markers, finalistsLockedAt: null },
      supersededSnapshotAt: markers.finalistsLockedAt,
      auditAction: "REOPEN_STAGE_1",
    },
  };
}

// ---------------------------------------------------------------------------
// Advisory voting windows (spec §5 proposed): display-only countdowns.
// Explicit admin actions are authoritative — a window expiring never moves
// the stage by itself. This function proves it: it always returns the stage
// unchanged (`moved: false`), reporting only whether the window has expired
// so the UI can render a countdown.
// ---------------------------------------------------------------------------

export const advisoryWindowSchema = z
  .object({
    opensAt: z.iso.datetime().nullable(),
    closesAt: z.iso.datetime().nullable(),
  })
  .refine(
    (window) =>
      window.opensAt === null ||
      window.closesAt === null ||
      Date.parse(window.opensAt) <= Date.parse(window.closesAt),
    { message: "Advisory window opensAt must not be after closesAt." },
  );

export type AdvisoryWindow = z.infer<typeof advisoryWindowSchema>;

export const advisoryExpiryInputSchema = z.object({
  stage: electionStageSchema,
  now: z.iso.datetime(),
  window: advisoryWindowSchema,
});

export interface AdvisoryExpirySuccess {
  stage: ElectionStage;
  windowExpired: boolean;
  /** Always false: expiry never moves the stage. */
  moved: false;
}

export function applyAdvisoryWindowExpiry(
  input: unknown,
): ActionResult<AdvisoryExpirySuccess> {
  const parsed = advisoryExpiryInputSchema.safeParse(input);
  if (!parsed.success) {
    return invalidInput(parsed.error.issues);
  }
  const { stage, now, window } = parsed.data;
  const windowExpired =
    window.closesAt !== null && Date.parse(window.closesAt) <= Date.parse(now);
  return { ok: true, value: { stage, windowExpired, moved: false } };
}
