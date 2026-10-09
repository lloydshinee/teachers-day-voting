import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

import {
  assertNeverLogsChoicePlusIdentity,
  auditRowEnvelopeSchema,
  departmentAuditDetailsSchema,
  electionAuditDetailsSchema,
  facultyAuditDetailsSchema,
  facultyVoteAuditDetailsSchema,
  isCompliantElectionDetailsForAction,
  isCompliantStage1DetailsForAction,
  isCompliantStage2DetailsForAction,
  stage1AuditDetailsSchema,
  stage2AuditDetailsSchema,
  studentAuditDetailsSchema,
  studentVoteAuditDetailsSchema,
} from "./details";
import type { AUDIT_DETAILS_SCHEMAS } from "./details";

/**
 * Audit-log persistence (spec §14 task 15, §§3, 7).
 *
 * Every TODO hook from earlier tasks is implemented here. Each hook writes
 * exactly one row to `public.audit_logs` per call:
 * `(election_id, actor_admin_id, action, details)`.
 *
 * Column mapping (spec §3 direction):
 * - Global roster actions (departments, faculty CRUD) carry no election
 *   scope, so `election_id` is NULL by design — the migration documents
 *   this nullability for operator-level actions outside one election.
 * - Per-election actions (code generation batches, token-use, stage closes,
 *   Tie flags/picks, finalist freeze, re-opens, Winner publish) store the
 *   caller's `electionId`.
 * - Token-use rows (`FACULTY_VOTE_CAST`, `STUDENT_VOTE_CAST`) are anonymous
 *   voter actions, so `actor_admin_id` is NULL (system write); admin actions
 *   store the acting admin's auth user id.
 *
 * Failure policy is best-effort (fail-open): no hook ever throws. A failed
 * audit write is skipped — the election flow (vote atomicity, committed
 * admin mutations) never depends on audit availability. Nothing on any
 * path logs secret or key material.
 *
 * Never-log rule (locked, spec §7): enforced by the strict details schemas
 * plus `assertNeverLogsChoicePlusIdentity` in `./details` — token-use
 * payloads carry election + department + stage only (never the choice,
 * never voter identity, never the Code, never the hash); Tie picks carry
 * the picked ids plus the frozen policy version with no voter identity and
 * no secret. The input types below declare no field for the forbidden side
 * of each pair, and per-action narrowing (only `RESOLVE_*` members may
 * carry picks; only `REOPEN_STAGE1` may carry a superseded snapshot; only
 * `DELETE_DEPARTMENT` may carry a null name) makes illegal states
 * unrepresentable in the types, not just avoided by callers.
 *
 * Call sites already invoke these hooks after successful writes, so no
 * call-site changes were required — wiring persistence only.
 */

// ---------------------------------------------------------------------------
// Shared writer (best-effort, never throws, never logs secrets).
// ---------------------------------------------------------------------------

async function persistAuditRow(input: {
  electionId: string | null;
  actorAdminId: string | null;
  action: string;
  details: unknown;
}): Promise<void> {
  try {
    const parsed = auditRowEnvelopeSchema.safeParse(input);
    if (!parsed.success) {
      return;
    }
    assertNeverLogsChoicePlusIdentity(parsed.data.details);
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("audit_logs").insert({
      election_id: parsed.data.electionId,
      actor_admin_id: parsed.data.actorAdminId,
      action: parsed.data.action,
      details: parsed.data.details,
    });
    if (error) {
      // Best-effort: a refused audit write is skipped, never thrown and
      // never logged with values (the Postgres code alone reveals nothing
      // actionable here, so nothing is logged at all).
      return;
    }
  } catch {
    // Fail-open by design (see module docs): audit loss is observable via
    // missing rows; a blocked election is not. Never rethrow, never log.
    return;
  }
}

// ---------------------------------------------------------------------------
// Departments (spec §14 task 6).
// ---------------------------------------------------------------------------

export const DEPARTMENT_AUDIT_ACTIONS = [
  "CREATE_DEPARTMENT",
  "RENAME_DEPARTMENT",
  "DELETE_DEPARTMENT",
] as const;

export type DepartmentAuditAction =
  (typeof DEPARTMENT_AUDIT_ACTIONS)[number];

interface DepartmentAuditBase {
  departmentId: string;
  code: string;
  /** Auth user id of the acting admin; null only for system writes. */
  actorAdminId: string | null;
}

/**
 * Per-action narrowing: only `DELETE_DEPARTMENT` may carry a null name
 * (the row is gone); creates and renames always name the row. No member
 * can carry a choice, Token, Code, or hash — those fields do not exist.
 */
export type DepartmentAuditInput =
  | (DepartmentAuditBase & {
      action: "CREATE_DEPARTMENT";
      /** Name after the write. */
      name: string;
    })
  | (DepartmentAuditBase & {
      action: "RENAME_DEPARTMENT";
      /** Name after the write. */
      name: string;
    })
  | (DepartmentAuditBase & {
      action: "DELETE_DEPARTMENT";
      /** Null: the department was deleted. */
      name: null;
    });

/** Records one audit entry for a department mutation. */
export async function logDepartmentAudit(
  input: DepartmentAuditInput,
): Promise<void> {
  // `code` here is the department short key (e.g. CCS), never a voting
  // Code; it is stored under `departmentCode` so the details shape carries
  // no bare `code` key at all.
  const details = departmentAuditDetailsSchema.safeParse({
    departmentId: input.departmentId,
    departmentCode: input.code,
    name: input.name,
  });
  if (!details.success) {
    return;
  }
  await persistAuditRow({
    electionId: null,
    actorAdminId: input.actorAdminId,
    action: input.action,
    details: details.data,
  });
}

// ---------------------------------------------------------------------------
// Faculty roster + faculty Code lifecycle (spec §14 tasks 7–8).
// ---------------------------------------------------------------------------

export const FACULTY_AUDIT_ACTIONS = [
  "CREATE_FACULTY",
  "RENAME_FACULTY",
  "ARCHIVE_FACULTY",
  "MOVE_FACULTY",
  // Spec §14 task 8: one entry per issued Code (identity + action only,
  // never the Code or a choice) and one entry per faculty invalidation.
  "GENERATE_FACULTY_CODES",
  "INVALIDATE_FACULTY_TOKENS",
] as const;

export type FacultyAuditAction = (typeof FACULTY_AUDIT_ACTIONS)[number];

export interface FacultyAuditInput {
  action: FacultyAuditAction;
  /** Id of the faculty row written (for MOVE_FACULTY: the new row). */
  facultyId: string;
  /** For MOVE_FACULTY: the archived source row; null otherwise. */
  archivedFacultyId: string | null;
  departmentId: string;
  fullName: string | null;
  /** Auth user id of the acting admin; null only for system writes. */
  actorAdminId: string | null;
}

/**
 * Records one audit entry for a faculty mutation or faculty Token
 * lifecycle step. Payloads carry roster identity + action only — the type
 * has no field for a choice, Code, Token, or hash, so a call site cannot
 * record a choice↔identity pair through this function.
 */
export async function logFacultyAudit(
  input: FacultyAuditInput,
): Promise<void> {
  const details = facultyAuditDetailsSchema.safeParse({
    facultyId: input.facultyId,
    archivedFacultyId: input.archivedFacultyId,
    departmentId: input.departmentId,
    fullName: input.fullName,
  });
  if (!details.success) {
    return;
  }
  await persistAuditRow({
    electionId: null,
    actorAdminId: input.actorAdminId,
    action: input.action,
    details: details.data,
  });
}

// ---------------------------------------------------------------------------
// Token-use without choice (spec §§3, 7; tasks 9 and 12).
// ---------------------------------------------------------------------------

export const VOTE_AUDIT_ACTIONS = [
  "FACULTY_VOTE_CAST",
  "STUDENT_VOTE_CAST",
] as const;

export type VoteAuditAction = (typeof VOTE_AUDIT_ACTIONS)[number];

export interface FacultyVoteAuditInput {
  action: VoteAuditAction;
  electionId: string;
  departmentId: string;
}

/**
 * Records one token-use audit entry for a cast faculty vote. The payload
 * carries election + department + stage only — never the choice
 * (Candidate), never the voter identity, never the Code, and never the
 * token hash. The type intentionally has no field for any of those, so a
 * call site cannot record a choice↔identity pair through this function.
 */
export async function logFacultyVoteCast(
  input: FacultyVoteAuditInput,
): Promise<void> {
  const details = facultyVoteAuditDetailsSchema.safeParse({
    departmentId: input.departmentId,
    stage: "FACULTY" as const,
  });
  if (!details.success) {
    return;
  }
  await persistAuditRow({
    electionId: input.electionId,
    // Anonymous voter action: no acting admin.
    actorAdminId: null,
    action: input.action,
    details: details.data,
  });
}

export interface StudentVoteAuditInput {
  action: VoteAuditAction;
  electionId: string;
  departmentId: string;
}

/**
 * Records one token-use audit entry for a cast student vote. Same
 * never-log contract as `logFacultyVoteCast`: the Finalist choice, voter
 * identity, Code, and hash have no field on this input type.
 */
export async function logStudentVoteCast(
  input: StudentVoteAuditInput,
): Promise<void> {
  const details = studentVoteAuditDetailsSchema.safeParse({
    departmentId: input.departmentId,
    stage: "STUDENT" as const,
  });
  if (!details.success) {
    return;
  }
  await persistAuditRow({
    electionId: input.electionId,
    // Anonymous voter action: no acting admin.
    actorAdminId: null,
    action: input.action,
    details: details.data,
  });
}

// ---------------------------------------------------------------------------
// Stage 1: close, Tie flag/pick, finalist freeze, re-open (task 10, §12).
// ---------------------------------------------------------------------------

export const STAGE1_AUDIT_ACTIONS = [
  "CLOSE_FACULTY_VOTING",
  "FLAG_STAGE1_TIE",
  "RESOLVE_STAGE1_TIE",
  "FREEZE_STAGE1_FINALISTS",
  "REOPEN_STAGE1",
] as const;

export type Stage1AuditAction = (typeof STAGE1_AUDIT_ACTIONS)[number];

interface Stage1AuditBase {
  electionId: string;
  /**
   * Frozen `tie_policy_locked_at` version referenced by the entry
   * (spec §2d) — null when the policy is not frozen yet.
   */
  policyVersion: string | null;
  /** Auth user id of the acting admin; null only for system writes. */
  actorAdminId: string | null;
}

/**
 * Per-action narrowing: the global close carries no department and no
 * picks; flag/freeze carry a department but no picks; only the manual Tie
 * pick carries picked Candidate ids; only the re-open carries a superseded
 * snapshot. Payloads carry aggregates + the frozen policy version + (for
 * Tie picks) the picked Candidate ids only — never voter identity, never
 * a Code or token hash. Picked ids are Candidates visible to admins
 * already, not voter→choice links.
 */
export type Stage1AuditInput =
  | (Stage1AuditBase & {
      action: "CLOSE_FACULTY_VOTING";
      /** Null for the global faculty-voting close. */
      departmentId: null;
      pickedCandidateIds: null;
      supersededSnapshotAt: null;
    })
  | (Stage1AuditBase & {
      action: "FLAG_STAGE1_TIE";
      departmentId: string;
      pickedCandidateIds: null;
      supersededSnapshotAt: null;
    })
  | (Stage1AuditBase & {
      action: "RESOLVE_STAGE1_TIE";
      departmentId: string;
      /** Manual Tie pick: the admin-chosen tied Candidates. */
      pickedCandidateIds: string[];
      supersededSnapshotAt: null;
    })
  | (Stage1AuditBase & {
      action: "FREEZE_STAGE1_FINALISTS";
      departmentId: string;
      pickedCandidateIds: null;
      supersededSnapshotAt: null;
    })
  | (Stage1AuditBase & {
      action: "REOPEN_STAGE1";
      departmentId: string;
      pickedCandidateIds: null;
      /** Re-open only: the prior `finalistsLockedAt` marked superseded. */
      supersededSnapshotAt: string;
    });

/** Records one audit entry for a Stage-1 counting step. */
export async function logStage1Audit(input: Stage1AuditInput): Promise<void> {
  const details = stage1AuditDetailsSchema.safeParse({
    departmentId: input.departmentId,
    policyVersion: input.policyVersion,
    pickedCandidateIds: input.pickedCandidateIds,
    supersededSnapshotAt: input.supersededSnapshotAt,
  });
  if (!details.success) {
    return;
  }
  if (!isCompliantStage1DetailsForAction(input.action, details.data)) {
    return;
  }
  await persistAuditRow({
    electionId: input.electionId,
    actorAdminId: input.actorAdminId,
    action: input.action,
    details: details.data,
  });
}

// ---------------------------------------------------------------------------
// Student Code generation batches (task 11, §6).
// ---------------------------------------------------------------------------

export const STUDENT_AUDIT_ACTIONS = ["GENERATE_STUDENT_CODES"] as const;

export type StudentAuditAction = (typeof STUDENT_AUDIT_ACTIONS)[number];

export interface StudentAuditInput {
  action: StudentAuditAction;
  electionId: string;
  departmentId: string;
  /** Number of STUDENT Codes issued by the generation call. */
  quantity: number;
  /** Auth user id of the acting admin; null only for system writes. */
  actorAdminId: string | null;
}

/**
 * Records one audit entry per student Code generation batch. The payload
 * carries election + department + quantity + action only — never a Code
 * or token hash, never a choice, and never a choice↔identity pair.
 */
export async function logStudentAudit(
  input: StudentAuditInput,
): Promise<void> {
  const details = studentAuditDetailsSchema.safeParse({
    departmentId: input.departmentId,
    quantity: input.quantity,
  });
  if (!details.success) {
    return;
  }
  await persistAuditRow({
    electionId: input.electionId,
    actorAdminId: input.actorAdminId,
    action: input.action,
    details: details.data,
  });
}

// ---------------------------------------------------------------------------
// Stage 2: close, Winner-Tie flag/pick, per-department publish (task 13).
// ---------------------------------------------------------------------------

export const STAGE2_AUDIT_ACTIONS = [
  "CLOSE_STUDENT_VOTING",
  "FLAG_STAGE2_TIE",
  "RESOLVE_STAGE2_TIE",
  "PUBLISH_WINNER",
] as const;

export type Stage2AuditAction = (typeof STAGE2_AUDIT_ACTIONS)[number];

interface Stage2AuditBase {
  electionId: string;
  /**
   * Frozen `tie_policy_locked_at` version referenced by the entry
   * (spec §2d) — null when the policy is not frozen yet.
   */
  policyVersion: string | null;
  /** Auth user id of the acting admin; null only for system writes. */
  actorAdminId: string | null;
}

/**
 * Per-action narrowing: the global close carries no department and no
 * pick; the flag carries a department but no pick; only the manual Winner
 * Tie pick carries the picked Finalist id; the publish carries the frozen
 * policy version with no pick. Never voter identity, never a Code or token
 * hash — picked ids are Finalists visible to admins already, not
 * voter→choice links.
 */
export type Stage2AuditInput =
  | (Stage2AuditBase & {
      action: "CLOSE_STUDENT_VOTING";
      /** Null for the global student-voting close. */
      departmentId: null;
      pickedFinalistIds: null;
    })
  | (Stage2AuditBase & {
      action: "FLAG_STAGE2_TIE";
      departmentId: string;
      pickedFinalistIds: null;
    })
  | (Stage2AuditBase & {
      action: "RESOLVE_STAGE2_TIE";
      departmentId: string;
      /** Manual Winner Tie pick: the single admin-chosen tied Finalist. */
      pickedFinalistIds: string[];
    })
  | (Stage2AuditBase & {
      action: "PUBLISH_WINNER";
      departmentId: string;
      pickedFinalistIds: null;
    });

/** Records one audit entry for a Stage-2 counting step. */
export async function logStage2Audit(input: Stage2AuditInput): Promise<void> {
  const details = stage2AuditDetailsSchema.safeParse({
    departmentId: input.departmentId,
    policyVersion: input.policyVersion,
    pickedFinalistIds: input.pickedFinalistIds,
  });
  if (!details.success) {
    return;
  }
  if (!isCompliantStage2DetailsForAction(input.action, details.data)) {
    return;
  }
  await persistAuditRow({
    electionId: input.electionId,
    actorAdminId: input.actorAdminId,
    action: input.action,
    details: details.data,
  });
}

// ---------------------------------------------------------------------------
// Election lifecycle: creation, global stage transitions (spec §2a, §5).
// ---------------------------------------------------------------------------

export const ELECTION_AUDIT_ACTIONS = [
  "CREATE_ELECTION",
  "OPEN_FACULTY_VOTING",
  "OPEN_STUDENT_VOTING",
  "CLOSE_ELECTION",
] as const;

export type ElectionAuditAction = (typeof ELECTION_AUDIT_ACTIONS)[number];

interface ElectionAuditBase {
  electionId: string;
  actorAdminId: string | null;
}

export type ElectionAuditInput =
  | (ElectionAuditBase & {
      action: "CREATE_ELECTION";
      electionName: string;
      academicYear: string;
      policyVersion: null;
      departmentCount: number;
      fromStage: null;
      toStage: "DRAFT";
    })
  | (ElectionAuditBase & {
      action: "OPEN_FACULTY_VOTING";
      electionName: null;
      academicYear: null;
      policyVersion: string | null;
      departmentCount: null;
      fromStage: string;
      toStage: "FACULTY_VOTING";
    })
  | (ElectionAuditBase & {
      action: "OPEN_STUDENT_VOTING";
      electionName: null;
      academicYear: null;
      policyVersion: string | null;
      departmentCount: null;
      fromStage: string;
      toStage: "STUDENT_VOTING";
    })
  | (ElectionAuditBase & {
      action: "CLOSE_ELECTION";
      electionName: null;
      academicYear: null;
      policyVersion: string | null;
      departmentCount: null;
      fromStage: string;
      toStage: "CLOSED";
    });

/** Records one audit entry for an election lifecycle mutation or transition. */
export async function logElectionAudit(
  input: ElectionAuditInput,
): Promise<void> {
  const details = electionAuditDetailsSchema.safeParse({
    electionName: input.electionName,
    academicYear: input.academicYear,
    policyVersion: input.policyVersion,
    departmentCount: input.departmentCount,
    fromStage: input.fromStage,
    toStage: input.toStage,
  });
  if (!details.success) {
    return;
  }
  if (!isCompliantElectionDetailsForAction(input.action, details.data)) {
    return;
  }
  await persistAuditRow({
    electionId: input.electionId,
    actorAdminId: input.actorAdminId,
    action: input.action,
    details: details.data,
  });
}

// ---------------------------------------------------------------------------
// Compile-time coverage: every hook action must have a details schema in
// `./details` (the self-test scanner's source of truth). A missing schema
// fails the build here, not in production.
// ---------------------------------------------------------------------------

type AllHookActions =
  | DepartmentAuditAction
  | FacultyAuditAction
  | VoteAuditAction
  | Stage1AuditAction
  | StudentAuditAction
  | Stage2AuditAction
  | ElectionAuditAction;

// Compile-time check ensuring every action has a zod schema in AUDIT_DETAILS_SCHEMAS
type MissingHookSchemas = Exclude<AllHookActions, keyof typeof AUDIT_DETAILS_SCHEMAS>;
type _AssertNoMissingSchemas = [MissingHookSchemas] extends [never]
  ? true
  : { error: "Missing schema for action"; missing: MissingHookSchemas };
const _assertNoMissingSchemas: _AssertNoMissingSchemas = true;
void _assertNoMissingSchemas;
