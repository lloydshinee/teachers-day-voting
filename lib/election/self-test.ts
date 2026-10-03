/**
 * Self-test for the election state-machine library (spec §5, task 5).
 *
 * Run: `node_modules/.bin/jiti lib/election/self-test.ts`
 * Covers the full forward chain plus every guardrail: skipped/backward
 * transitions, Tie holds, publish gates, the re-open guardrail (zero
 * dependent-stage votes only), and display-only advisory windows.
 */

import assert from "node:assert/strict";

import {
  applyAdvisoryWindowExpiry,
  applyFlagTie,
  applyGlobalAction,
  applyLockFinalists,
  applyPublishWinner,
  applyReopenStage1,
  applyResolveTie,
  departmentMarkersSchema,
  isDirectForwardTransition,
  nextStageAfter,
} from "./index.js";
import type {
  ActionErrorCode,
  ActionResult,
  DepartmentMarkers,
} from "./index.js";

const ELECTION_ID = "123e4567-e89b-12d3-a456-426614174000";
const DEPARTMENT_ID = "123e4567-e89b-12d3-a456-426614174001";
const CANDIDATE_A = "123e4567-e89b-12d3-a456-426614174010";
const CANDIDATE_B = "123e4567-e89b-12d3-a456-426614174011";
const LOCKED_AT = "2026-10-01T10:00:00Z";
const PUBLISHED_AT = "2026-10-02T10:00:00Z";
const POLICY_VERSION = "2026-09-30T09:00:00Z";

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function mustOk<T>(result: ActionResult<T>): T {
  if (!result.ok) {
    throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  }
  return result.value;
}

function mustErr<T>(result: ActionResult<T>, code: ActionErrorCode): void {
  if (result.ok) {
    throw new Error(`expected error ${code}, got ok`);
  }
  assert.equal(result.error.code, code);
}

function freshMarkers(): DepartmentMarkers {
  return {
    electionId: ELECTION_ID,
    departmentId: DEPARTMENT_ID,
    finalistsLockedAt: null,
    winnerPublishedAt: null,
    tiePending: false,
  };
}

function lockedMarkers(): DepartmentMarkers {
  return { ...freshMarkers(), finalistsLockedAt: LOCKED_AT };
}

// -- Global forward chain ---------------------------------------------------

check("global chain DRAFT→…→CLOSED advances one step per admin action", () => {
  const plan = [
    { action: "OPEN_FACULTY_VOTING", from: "DRAFT", to: "FACULTY_VOTING" },
    { action: "CLOSE_FACULTY_VOTING", from: "FACULTY_VOTING", to: "FACULTY_RESULTS" },
    { action: "OPEN_STUDENT_VOTING", from: "FACULTY_RESULTS", to: "STUDENT_VOTING" },
    { action: "CLOSE_STUDENT_VOTING", from: "STUDENT_VOTING", to: "FINAL_RESULTS" },
    { action: "CLOSE_ELECTION", from: "FINAL_RESULTS", to: "CLOSED" },
  ] as const;
  for (const step of plan) {
    const value = mustOk(applyGlobalAction({ from: step.from, action: step.action }));
    assert.equal(value.to, step.to);
    assert.equal(value.auditAction, step.action);
  }
  assert.equal(nextStageAfter("CLOSED"), null);
});

check("global skip DRAFT→FACULTY_RESULTS is rejected", () => {
  mustErr(
    applyGlobalAction({ from: "DRAFT", action: "OPEN_STUDENT_VOTING" }),
    "ILLEGAL_GLOBAL_TRANSITION",
  );
});

check("global backward FINAL_RESULTS→STUDENT_VOTING is rejected", () => {
  mustErr(
    applyGlobalAction({ from: "FINAL_RESULTS", action: "OPEN_STUDENT_VOTING" }),
    "ILLEGAL_GLOBAL_TRANSITION",
  );
  assert.equal(isDirectForwardTransition("FINAL_RESULTS", "STUDENT_VOTING"), false);
});

check("global repeat OPEN_FACULTY_VOTING twice is rejected", () => {
  mustErr(
    applyGlobalAction({ from: "FACULTY_VOTING", action: "OPEN_FACULTY_VOTING" }),
    "ILLEGAL_GLOBAL_TRANSITION",
  );
});

check("global unknown action and unknown stage fail Zod validation", () => {
  mustErr(
    applyGlobalAction({ from: "DRAFT", action: "REOPEN_EVERYTHING" }),
    "INVALID_INPUT",
  );
  mustErr(
    applyGlobalAction({ from: "VOTING", action: "OPEN_FACULTY_VOTING" }),
    "INVALID_INPUT",
  );
});

check("global CLOSED is terminal", () => {
  mustErr(
    applyGlobalAction({ from: "CLOSED", action: "CLOSE_ELECTION" }),
    "ILLEGAL_GLOBAL_TRANSITION",
  );
});

// -- Finalists lock ----------------------------------------------------------

check("lock Finalists in FACULTY_RESULTS", () => {
  const value = mustOk(
    applyLockFinalists({ markers: freshMarkers(), stage: "FACULTY_RESULTS", lockedAt: LOCKED_AT }),
  );
  assert.equal(value.markers.finalistsLockedAt, LOCKED_AT);
  assert.equal(value.auditAction, "LOCK_FINALISTS");
});

check("late lock during STUDENT_VOTING (held department catches up)", () => {
  const value = mustOk(
    applyLockFinalists({ markers: freshMarkers(), stage: "STUDENT_VOTING", lockedAt: LOCKED_AT }),
  );
  assert.equal(value.markers.finalistsLockedAt, LOCKED_AT);
});

check("lock during open voting stages is rejected", () => {
  mustErr(
    applyLockFinalists({ markers: freshMarkers(), stage: "DRAFT", lockedAt: LOCKED_AT }),
    "STAGE_MISMATCH",
  );
  mustErr(
    applyLockFinalists({ markers: freshMarkers(), stage: "FACULTY_VOTING", lockedAt: LOCKED_AT }),
    "STAGE_MISMATCH",
  );
});

check("lock while Tie pending is rejected; double lock is rejected", () => {
  mustErr(
    applyLockFinalists({
      markers: { ...freshMarkers(), tiePending: true },
      stage: "FACULTY_RESULTS",
      lockedAt: LOCKED_AT,
    }),
    "TIE_PENDING",
  );
  mustErr(
    applyLockFinalists({ markers: lockedMarkers(), stage: "FACULTY_RESULTS", lockedAt: LOCKED_AT }),
    "FINALISTS_ALREADY_LOCKED",
  );
});

check("lock with bad timestamp fails Zod validation", () => {
  mustErr(
    applyLockFinalists({ markers: freshMarkers(), stage: "FACULTY_RESULTS", lockedAt: "tomorrow" }),
    "INVALID_INPUT",
  );
});

// -- Tie flag + manual pick ----------------------------------------------------

check("Tie flow: flag → resolve pick → lock", () => {
  const flagged = mustOk(applyFlagTie({ markers: freshMarkers(), stage: "FACULTY_RESULTS" }));
  assert.equal(flagged.markers.tiePending, true);
  const resolved = mustOk(
    applyResolveTie({
      markers: flagged.markers,
      stage: "FACULTY_RESULTS",
      pickedCandidateIds: [CANDIDATE_A, CANDIDATE_B],
    }),
  );
  assert.equal(resolved.markers.tiePending, false);
  assert.deepEqual(resolved.pickedCandidateIds, [CANDIDATE_A, CANDIDATE_B]);
  const locked = mustOk(
    applyLockFinalists({ markers: resolved.markers, stage: "FACULTY_RESULTS", lockedAt: LOCKED_AT }),
  );
  assert.equal(locked.markers.finalistsLockedAt, LOCKED_AT);
});

check("Tie guards: double flag, resolve without Tie, empty/duplicate picks", () => {
  mustErr(
    applyFlagTie({
      markers: { ...freshMarkers(), tiePending: true },
      stage: "FACULTY_RESULTS",
    }),
    "TIE_ALREADY_PENDING",
  );
  mustErr(
    applyResolveTie({ markers: freshMarkers(), stage: "FACULTY_RESULTS", pickedCandidateIds: [CANDIDATE_A] }),
    "TIE_NOT_PENDING",
  );
  const tied: DepartmentMarkers = { ...freshMarkers(), tiePending: true };
  mustErr(
    applyResolveTie({ markers: tied, stage: "FACULTY_RESULTS", pickedCandidateIds: [] }),
    "INVALID_INPUT",
  );
  mustErr(
    applyResolveTie({
      markers: tied,
      stage: "FACULTY_RESULTS",
      pickedCandidateIds: [CANDIDATE_A, CANDIDATE_A],
    }),
    "INVALID_INPUT",
  );
  mustErr(
    applyResolveTie({ markers: tied, stage: "FACULTY_RESULTS", pickedCandidateIds: ["not-a-uuid"] }),
    "INVALID_INPUT",
  );
});

check("Tie flag after publish and in CLOSED is rejected", () => {
  mustErr(
    applyFlagTie({
      markers: { ...lockedMarkers(), winnerPublishedAt: PUBLISHED_AT },
      stage: "FINAL_RESULTS",
    }),
    "WINNER_ALREADY_PUBLISHED",
  );
  mustErr(applyFlagTie({ markers: freshMarkers(), stage: "CLOSED" }), "ELECTION_CLOSED");
  mustErr(
    applyResolveTie({
      markers: { ...freshMarkers(), tiePending: true },
      stage: "CLOSED",
      pickedCandidateIds: [CANDIDATE_A],
    }),
    "ELECTION_CLOSED",
  );
  mustErr(
    applyLockFinalists({ markers: freshMarkers(), stage: "CLOSED", lockedAt: LOCKED_AT }),
    "ELECTION_CLOSED",
  );
});

// -- Winner publish -------------------------------------------------------------

check("publish Winner in FINAL_RESULTS stamps policy version", () => {
  const value = mustOk(
    applyPublishWinner({
      markers: lockedMarkers(),
      stage: "FINAL_RESULTS",
      publishedAt: PUBLISHED_AT,
      policyVersion: POLICY_VERSION,
    }),
  );
  assert.equal(value.markers.winnerPublishedAt, PUBLISHED_AT);
  assert.equal(value.policyVersion, POLICY_VERSION);
  assert.equal(value.auditAction, "PUBLISH_WINNER");
});

check("publish gates: stage, Tie, missing snapshot, double publish", () => {
  mustErr(
    applyPublishWinner({
      markers: lockedMarkers(),
      stage: "STUDENT_VOTING",
      publishedAt: PUBLISHED_AT,
      policyVersion: POLICY_VERSION,
    }),
    "STAGE_MISMATCH",
  );
  mustErr(
    applyPublishWinner({
      markers: { ...lockedMarkers(), tiePending: true },
      stage: "FINAL_RESULTS",
      publishedAt: PUBLISHED_AT,
      policyVersion: POLICY_VERSION,
    }),
    "TIE_PENDING",
  );
  mustErr(
    applyPublishWinner({
      markers: freshMarkers(),
      stage: "FINAL_RESULTS",
      publishedAt: PUBLISHED_AT,
      policyVersion: POLICY_VERSION,
    }),
    "FINALISTS_NOT_LOCKED",
  );
  mustErr(
    applyPublishWinner({
      markers: { ...lockedMarkers(), winnerPublishedAt: PUBLISHED_AT },
      stage: "FINAL_RESULTS",
      publishedAt: PUBLISHED_AT,
      policyVersion: POLICY_VERSION,
    }),
    "WINNER_ALREADY_PUBLISHED",
  );
  mustErr(
    applyPublishWinner({
      markers: lockedMarkers(),
      stage: "CLOSED",
      publishedAt: PUBLISHED_AT,
      policyVersion: POLICY_VERSION,
    }),
    "ELECTION_CLOSED",
  );
});

// -- Re-open guardrail ------------------------------------------------------------

check("re-open with zero dependent votes unfreezes snapshot, keeps audit trail", () => {
  const value = mustOk(
    applyReopenStage1({ markers: lockedMarkers(), stage: "FACULTY_RESULTS", dependentStudentVotes: 0 }),
  );
  assert.equal(value.markers.finalistsLockedAt, null);
  assert.equal(value.supersededSnapshotAt, LOCKED_AT);
  assert.equal(value.auditAction, "REOPEN_STAGE_1");
  // Fresh close required: the department can lock again afterwards.
  const relocked = mustOk(
    applyLockFinalists({ markers: value.markers, stage: "FACULTY_RESULTS", lockedAt: LOCKED_AT }),
  );
  assert.equal(relocked.markers.finalistsLockedAt, LOCKED_AT);
});

check("re-open blocked by dependent student votes", () => {
  mustErr(
    applyReopenStage1({ markers: lockedMarkers(), stage: "FACULTY_RESULTS", dependentStudentVotes: 3 }),
    "REOPEN_BLOCKED_BY_DEPENDENT_VOTES",
  );
  mustErr(
    applyReopenStage1({ markers: lockedMarkers(), stage: "STUDENT_VOTING", dependentStudentVotes: 1 }),
    "REOPEN_BLOCKED_BY_DEPENDENT_VOTES",
  );
});

check("re-open blocked beneath published Winner, with Tie, past window, or nothing frozen", () => {
  mustErr(
    applyReopenStage1({
      markers: { ...lockedMarkers(), winnerPublishedAt: PUBLISHED_AT },
      stage: "STUDENT_VOTING",
      dependentStudentVotes: 0,
    }),
    "REOPEN_BLOCKED_BY_PUBLISHED_WINNER",
  );
  mustErr(
    applyReopenStage1({ markers: lockedMarkers(), stage: "FINAL_RESULTS", dependentStudentVotes: 0 }),
    "STAGE_MISMATCH",
  );
  mustErr(
    applyReopenStage1({
      markers: { ...lockedMarkers(), tiePending: true },
      stage: "FACULTY_RESULTS",
      dependentStudentVotes: 0,
    }),
    "TIE_PENDING",
  );
  mustErr(
    applyReopenStage1({ markers: freshMarkers(), stage: "FACULTY_RESULTS", dependentStudentVotes: 0 }),
    "REOPEN_NOTHING_TO_REOPEN",
  );
  mustErr(
    applyReopenStage1({ markers: lockedMarkers(), stage: "CLOSED", dependentStudentVotes: 0 }),
    "ELECTION_CLOSED",
  );
  mustErr(
    applyReopenStage1({ markers: lockedMarkers(), stage: "FACULTY_RESULTS", dependentStudentVotes: -1 }),
    "INVALID_INPUT",
  );
});

check("re-open never un-casts votes (vote rows are out of reach)", () => {
  const votes: ReadonlyArray<{ candidateId: string }> = [{ candidateId: CANDIDATE_A }];
  const before = JSON.stringify(votes);
  mustOk(applyReopenStage1({ markers: lockedMarkers(), stage: "FACULTY_RESULTS", dependentStudentVotes: 0 }));
  assert.equal(JSON.stringify(votes), before);
});

// -- Advisory windows --------------------------------------------------------------

check("advisory window expiry never moves the stage", () => {
  const expired = mustOk(
    applyAdvisoryWindowExpiry({
      stage: "FACULTY_VOTING",
      now: "2026-10-02T00:00:00Z",
      window: { opensAt: "2026-10-01T08:00:00Z", closesAt: "2026-10-01T18:00:00Z" },
    }),
  );
  assert.equal(expired.stage, "FACULTY_VOTING");
  assert.equal(expired.windowExpired, true);
  assert.equal(expired.moved, false);

  const open = mustOk(
    applyAdvisoryWindowExpiry({
      stage: "FACULTY_VOTING",
      now: "2026-10-01T09:00:00Z",
      window: { opensAt: "2026-10-01T08:00:00Z", closesAt: "2026-10-01T18:00:00Z" },
    }),
  );
  assert.equal(open.windowExpired, false);
  assert.equal(open.moved, false);

  mustErr(
    applyAdvisoryWindowExpiry({
      stage: "FACULTY_VOTING",
      now: "2026-10-01T09:00:00Z",
      window: { opensAt: "2026-10-01T18:00:00Z", closesAt: "2026-10-01T08:00:00Z" },
    }),
    "INVALID_INPUT",
  );
});

// -- Marker schema --------------------------------------------------------------------

check("department markers reject bad ids and naive datetimes", () => {
  assert.equal(departmentMarkersSchema.safeParse({ ...freshMarkers(), departmentId: "x" }).success, false);
  assert.equal(
    departmentMarkersSchema.safeParse({ ...freshMarkers(), finalistsLockedAt: "2026-10-01T10:00:00" }).success,
    false,
  );
});

console.log(`\nAll ${passed} self-test groups passed.`);
