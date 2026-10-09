import { z } from "zod";

/**
 * Audit-log details schemas + never-log guard (spec §14 task 15, §§3, 7).
 *
 * Source of truth for what may be STORED in `public.audit_logs.details`.
 * Every schema below is a `z.strictObject` allowlist: any key not declared
 * here (a Token, Code, hash, voter identity smuggled into a vote payload,
 * or a choice smuggled into a token-use payload) fails validation and the
 * row is never written.
 *
 * Locked never-log rule (spec §7): no payload may carry a vote choice
 * together with a voter identity, Token, Code, or hash. This is enforced in
 * three layers:
 *   1. Types — the hook input types (`lib/audit/hook.ts`) declare no field
 *      for the forbidden side of each pair, and per-action narrowing (e.g.
 *      only `RESOLVE_*` members may carry picks) makes illegal states
 *      unrepresentable, not just avoided by callers.
 *   2. Schemas — strict allowlists reject unknown keys at runtime.
 *   3. Guard — `assertNeverLogsChoicePlusIdentity` re-scans the final
 *      details object key-by-key before insert and throws on any
 *      choice-plus-identity/secret pair, however it got there.
 *
 * Glossary terms (GLOSSARY.md) are used exactly: Tie, Token, Code,
 * Candidate, Finalist, Winner, Election.
 *
 * This module deliberately has NO `server-only` import so that
 * `lib/audit/self-test.ts` can import it under plain node (jiti). The
 * persistence layer (`lib/audit/hook.ts`) stays server-only.
 *
 * Failure policy (fail-open, best-effort): audit writes must never break
 * the election flow. The vote transaction (Token burn + vote insert) is
 * atomic with or without its audit row; admin mutations already committed
 * before their audit call. A failed audit write is therefore skipped, never
 * thrown — a missing row is observable, a blocked election is not.
 * No secret or key material is ever logged on any path.
 */

// ---------------------------------------------------------------------------
// Never-log key vocabulary (normalized: lowercase, underscores stripped).
// Comparison is exact-match on the normalized key, never substring, so
// `departmentCode` (the department short key, e.g. CCS) is NOT the glossary
// `Code` (the human-readable Token form) and never trips the secret set.
// ---------------------------------------------------------------------------

function normalizeAuditKey(key: string): string {
  return key.toLowerCase().replace(/_/g, "");
}

/** Keys that carry a vote choice or an admin pick among tied Candidates. */
export const AUDIT_CHOICE_KEYS = [
  "candidateId",
  "candidateFacultyId",
  "choice",
  "voteChoice",
  "votedFor",
  "selection",
  "selectedCandidate",
  "pickedCandidateIds",
  "pickedFinalistIds",
  "winnerFacultyId",
] as const;

/**
 * Keys that identify the voter-side person. `actorAdminId` (the acting
 * admin, stored in the `actor_admin_id` COLUMN, never in details) is NOT
 * in this set; neither is `departmentId` (a department is not a person).
 */
export const AUDIT_IDENTITY_KEYS = [
  "voterId",
  "voterIdentity",
  "facultyId",
  "archivedFacultyId",
  "fullName",
] as const;

/** Keys that carry Token / Code / hash / pepper material. */
export const AUDIT_SECRET_KEYS = [
  "code",
  "votingCode",
  "rawCode",
  "token",
  "tokenHash",
  "tokenId",
  "hash",
  "pepper",
] as const;

const NORMALIZED_CHOICE_KEYS: ReadonlySet<string> = new Set(
  AUDIT_CHOICE_KEYS.map(normalizeAuditKey),
);
const NORMALIZED_IDENTITY_KEYS: ReadonlySet<string> = new Set(
  AUDIT_IDENTITY_KEYS.map(normalizeAuditKey),
);
const NORMALIZED_SECRET_KEYS: ReadonlySet<string> = new Set(
  AUDIT_SECRET_KEYS.map(normalizeAuditKey),
);

function collectObjectKeys(value: unknown, into: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectObjectKeys(entry, into);
    }
    return;
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      into.push(key);
      collectObjectKeys(nested, into);
    }
  }
}

/**
 * Returns a description of the never-log violation in `details`, or null
 * when the payload is clean: it carries no (choice key AND identity/secret
 * key) pair. Either side alone is legal — a faculty roster entry carries
 * identity without choice; a Tie pick carries picked ids plus the frozen
 * policy version without any voter identity or secret.
 */
export function findNeverLogViolation(details: unknown): string | null {
  const keys: string[] = [];
  collectObjectKeys(details, keys);
  const normalized = keys.map(normalizeAuditKey);
  const choiceHits = normalized.filter((key) =>
    NORMALIZED_CHOICE_KEYS.has(key),
  );
  const sensitiveHits = normalized.filter(
    (key) => NORMALIZED_IDENTITY_KEYS.has(key) || NORMALIZED_SECRET_KEYS.has(key),
  );
  if (choiceHits.length > 0 && sensitiveHits.length > 0) {
    const choiceList = [...new Set(choiceHits)].sort().join(", ");
    const sensitiveList = [...new Set(sensitiveHits)].sort().join(", ");
    return (
      `never-log violation: details carries choice key(s) [${choiceList}] ` +
      `together with identity/secret key(s) [${sensitiveList}]`
    );
  }
  return null;
}

/** Throws when `details` violates the never-log rule; returns void when clean. */
export function assertNeverLogsChoicePlusIdentity(details: unknown): void {
  const violation = findNeverLogViolation(details);
  if (violation !== null) {
    // Static text only — never echoes the offending values.
    throw new Error(
      `${violation}. Audit payloads must never join a choice to a voter identity, Token, Code, or hash.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Details schemas (strict allowlists, one per hook family).
// `departmentCode` is the department short key (e.g. CCS) — never a voting
// Code. No schema here declares a Token, Code, hash, or voter-identity
// field alongside a choice field; the self-test proves it per schema.
// ---------------------------------------------------------------------------

export const departmentAuditDetailsSchema = z.strictObject({
  departmentId: z.uuid(),
  departmentCode: z.string().min(1),
  /** Name after the write; null when the department was deleted. */
  name: z.string().nullable(),
});

export type DepartmentAuditDetails = z.infer<typeof departmentAuditDetailsSchema>;

export const facultyAuditDetailsSchema = z.strictObject({
  facultyId: z.uuid(),
  /** For MOVE_FACULTY: the archived source row; null otherwise. */
  archivedFacultyId: z.uuid().nullable(),
  departmentId: z.uuid(),
  fullName: z.string().nullable(),
});

export type FacultyAuditDetails = z.infer<typeof facultyAuditDetailsSchema>;

export const facultyVoteAuditDetailsSchema = z.strictObject({
  departmentId: z.uuid(),
  stage: z.literal("FACULTY"),
});

export type FacultyVoteAuditDetails = z.infer<typeof facultyVoteAuditDetailsSchema>;

export const studentVoteAuditDetailsSchema = z.strictObject({
  departmentId: z.uuid(),
  stage: z.literal("STUDENT"),
});

export type StudentVoteAuditDetails = z.infer<typeof studentVoteAuditDetailsSchema>;

export const stage1AuditDetailsSchema = z.strictObject({
  /** Null for the global faculty-voting close; set for per-department steps. */
  departmentId: z.uuid().nullable(),
  /** Frozen `tie_policy_locked_at` version; null when not frozen yet. Database-read: offset form accepted. */
  policyVersion: z.iso.datetime({ offset: true }).nullable(),
  /** Manual Tie pick only: the admin-chosen tied Candidates. */
  pickedCandidateIds: z.array(z.uuid()).nullable(),
  /** Re-open only: the prior `finalistsLockedAt` marked superseded. Database-read: offset form accepted. */
  supersededSnapshotAt: z.iso.datetime({ offset: true }).nullable(),
});

export type Stage1AuditDetails = z.infer<typeof stage1AuditDetailsSchema>;

export const studentAuditDetailsSchema = z.strictObject({
  departmentId: z.uuid(),
  /** Number of STUDENT Codes issued by the generation call. */
  quantity: z.number().int().min(0),
});

export type StudentAuditDetails = z.infer<typeof studentAuditDetailsSchema>;

export const stage2AuditDetailsSchema = z.strictObject({
  /** Null for the global student-voting close; set for per-department steps. */
  departmentId: z.uuid().nullable(),
  /** Frozen `tie_policy_locked_at` version; null when not frozen yet. Database-read: offset form accepted. */
  policyVersion: z.iso.datetime({ offset: true }).nullable(),
  /** Manual Winner Tie pick only: the single admin-chosen tied Finalist. */
  pickedFinalistIds: z.array(z.uuid()).nullable(),
});

export type Stage2AuditDetails = z.infer<typeof stage2AuditDetailsSchema>;

export const electionAuditDetailsSchema = z.strictObject({
  /** Election name; null for transition actions. */
  electionName: z.string().min(1).nullable(),
  /** Academic year; null for transition actions. */
  academicYear: z.string().min(1).nullable(),
  /** Frozen tie_policy_locked_at version; null when not frozen yet. */
  policyVersion: z.iso.datetime({ offset: true }).nullable(),
  /** Number of linked participating departments; null for transitions. */
  departmentCount: z.number().int().min(0).nullable(),
  /** Prior stage before transition; null for create. */
  fromStage: z.string().min(1).nullable(),
  /** New stage after transition; null for create. */
  toStage: z.string().min(1).nullable(),
});

export type ElectionAuditDetails = z.infer<typeof electionAuditDetailsSchema>;

/** Envelope for the `audit_logs` columns (details validated per family). */
export const auditRowEnvelopeSchema = z.strictObject({
  electionId: z.uuid().nullable(),
  actorAdminId: z.uuid().nullable(),
  action: z.string().min(1),
  details: z.record(z.string(), z.unknown()),
});

export type AuditRowEnvelope = z.infer<typeof auditRowEnvelopeSchema>;

// ---------------------------------------------------------------------------
// Per-action compliance: which nullable fields each action may populate.
// Call sites already construct exactly these shapes; the validators are
// defense-in-depth so a future caller cannot, e.g., attach picks to a
// close event or publish without the frozen policy version.
// ---------------------------------------------------------------------------

export function isCompliantStage1DetailsForAction(
  action: string,
  details: Stage1AuditDetails,
): boolean {
  switch (action) {
    case "CLOSE_FACULTY_VOTING":
      return (
        details.departmentId === null &&
        details.pickedCandidateIds === null &&
        details.supersededSnapshotAt === null
      );
    case "FLAG_STAGE1_TIE":
    case "FREEZE_STAGE1_FINALISTS":
      return (
        details.departmentId !== null &&
        details.pickedCandidateIds === null &&
        details.supersededSnapshotAt === null
      );
    case "RESOLVE_STAGE1_TIE":
      return (
        details.departmentId !== null &&
        details.pickedCandidateIds !== null &&
        details.pickedCandidateIds.length > 0 &&
        details.supersededSnapshotAt === null
      );
    case "REOPEN_STAGE1":
      return (
        details.departmentId !== null &&
        details.pickedCandidateIds === null &&
        details.supersededSnapshotAt !== null
      );
    default:
      return false;
  }
}

export function isCompliantStage2DetailsForAction(
  action: string,
  details: Stage2AuditDetails,
): boolean {
  switch (action) {
    case "CLOSE_STUDENT_VOTING":
      return (
        details.departmentId === null && details.pickedFinalistIds === null
      );
    case "FLAG_STAGE2_TIE":
      return (
        details.departmentId !== null && details.pickedFinalistIds === null
      );
    case "RESOLVE_STAGE2_TIE":
      return (
        details.departmentId !== null &&
        details.policyVersion !== null &&
        details.pickedFinalistIds !== null &&
        details.pickedFinalistIds.length === 1
      );
    case "PUBLISH_WINNER":
      return (
        details.departmentId !== null &&
        details.policyVersion !== null &&
        details.pickedFinalistIds === null
      );
    default:
      return false;
  }
}

export function isCompliantElectionDetailsForAction(
  action: string,
  details: ElectionAuditDetails,
): boolean {
  switch (action) {
    case "CREATE_ELECTION":
      return details.electionName !== null && details.academicYear !== null;
    case "OPEN_FACULTY_VOTING":
    case "OPEN_STUDENT_VOTING":
    case "CLOSE_ELECTION":
      return details.fromStage !== null && details.toStage !== null;
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Action → schema map: the self-test scanner iterates this, so every action
// persisted by `lib/audit/hook.ts` must appear here exactly once.
// ---------------------------------------------------------------------------

export const ALL_AUDIT_ACTIONS = [
  "CREATE_DEPARTMENT",
  "RENAME_DEPARTMENT",
  "DELETE_DEPARTMENT",
  "CREATE_FACULTY",
  "RENAME_FACULTY",
  "ARCHIVE_FACULTY",
  "MOVE_FACULTY",
  "GENERATE_FACULTY_CODES",
  "INVALIDATE_FACULTY_TOKENS",
  "FACULTY_VOTE_CAST",
  "STUDENT_VOTE_CAST",
  "CREATE_ELECTION",
  "OPEN_FACULTY_VOTING",
  "CLOSE_FACULTY_VOTING",
  "FLAG_STAGE1_TIE",
  "RESOLVE_STAGE1_TIE",
  "FREEZE_STAGE1_FINALISTS",
  "REOPEN_STAGE1",
  "GENERATE_STUDENT_CODES",
  "OPEN_STUDENT_VOTING",
  "CLOSE_STUDENT_VOTING",
  "FLAG_STAGE2_TIE",
  "RESOLVE_STAGE2_TIE",
  "PUBLISH_WINNER",
  "CLOSE_ELECTION",
] as const;

export type AuditAction = (typeof ALL_AUDIT_ACTIONS)[number];

export const AUDIT_DETAILS_SCHEMAS: Record<AuditAction, z.ZodType> = {
  CREATE_DEPARTMENT: departmentAuditDetailsSchema,
  RENAME_DEPARTMENT: departmentAuditDetailsSchema,
  DELETE_DEPARTMENT: departmentAuditDetailsSchema,
  CREATE_FACULTY: facultyAuditDetailsSchema,
  RENAME_FACULTY: facultyAuditDetailsSchema,
  ARCHIVE_FACULTY: facultyAuditDetailsSchema,
  MOVE_FACULTY: facultyAuditDetailsSchema,
  GENERATE_FACULTY_CODES: facultyAuditDetailsSchema,
  INVALIDATE_FACULTY_TOKENS: facultyAuditDetailsSchema,
  FACULTY_VOTE_CAST: facultyVoteAuditDetailsSchema,
  STUDENT_VOTE_CAST: studentVoteAuditDetailsSchema,
  CREATE_ELECTION: electionAuditDetailsSchema,
  OPEN_FACULTY_VOTING: electionAuditDetailsSchema,
  CLOSE_FACULTY_VOTING: stage1AuditDetailsSchema,
  FLAG_STAGE1_TIE: stage1AuditDetailsSchema,
  RESOLVE_STAGE1_TIE: stage1AuditDetailsSchema,
  FREEZE_STAGE1_FINALISTS: stage1AuditDetailsSchema,
  REOPEN_STAGE1: stage1AuditDetailsSchema,
  GENERATE_STUDENT_CODES: studentAuditDetailsSchema,
  OPEN_STUDENT_VOTING: electionAuditDetailsSchema,
  CLOSE_STUDENT_VOTING: stage2AuditDetailsSchema,
  FLAG_STAGE2_TIE: stage2AuditDetailsSchema,
  RESOLVE_STAGE2_TIE: stage2AuditDetailsSchema,
  PUBLISH_WINNER: stage2AuditDetailsSchema,
  CLOSE_ELECTION: electionAuditDetailsSchema,
};

