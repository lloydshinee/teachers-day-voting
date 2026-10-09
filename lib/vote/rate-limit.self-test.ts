/**
 * Self-test for vote rate limiting + lockout (spec §8, task 16).
 *
 * Run: `node_modules/.bin/jiti lib/vote/rate-limit.self-test.ts`
 *
 * Proves, with an injected clock (no waiting, no network, no database):
 * budgets trigger (per-IP sliding window + per-token-hash failure budget
 * with temporary lockout), both budgets reset after their windows, success
 * forgives a hash's failures, and denied callers learn nothing about token
 * validity (identical RATE_LIMITED outcomes for distinct hashes, one shared
 * message). A source scan then proves all five token endpoints in
 * `./actions.js` gate BEFORE any token validation runs, for both the
 * faculty and student paths (code validation and vote submission).
 *
 * Placeholder hashes below are obviously fake hex (never real Codes,
 * hashes, or keys) and exist only to exercise budget shapes.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  consumeVoteAttempt,
  recordVoteFailure,
  recordVoteSuccess,
  resetVoteRateLimits,
  VOTE_IP_MAX_ATTEMPTS,
  VOTE_IP_WINDOW_MS,
  VOTE_TOKEN_LOCKOUT_MS,
  VOTE_TOKEN_MAX_FAILURES,
  VOTE_TOKEN_WINDOW_MS,
  type VoteRateLimitDecision,
} from "./rate-limit.js";
import {
  VOTE_RATE_LIMITED_ERROR,
  VOTE_UNIFORM_ERROR,
  type RateLimitedResult,
} from "./schemas.js";

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

// Obviously fake 64-hex placeholders — never real token hashes.
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

let now = 1_000_000;

function advance(ms: number): void {
  now += ms;
}

function deniedAfter(
  decision: VoteRateLimitDecision,
): asserts decision is { allowed: false; retryAfterSeconds: number } {
  assert.equal(decision.allowed, false);
}

/** Action-level mapping mirror: every denial becomes this same shape. */
function toRateLimitedResult(
  decision: VoteRateLimitDecision,
): RateLimitedResult {
  deniedAfter(decision);
  return {
    ok: false,
    code: "RATE_LIMITED",
    message: VOTE_RATE_LIMITED_ERROR,
    retryAfterSeconds: decision.retryAfterSeconds,
  };
}

// ---------------------------------------------------------------------------
// Budgets.
// ---------------------------------------------------------------------------

check("budgets are pinned to the approved envelope", () => {
  assert.equal(VOTE_IP_MAX_ATTEMPTS, 600);
  assert.equal(VOTE_IP_WINDOW_MS, 10 * 60 * 1000);
  assert.equal(VOTE_TOKEN_MAX_FAILURES, 10);
  assert.equal(VOTE_TOKEN_WINDOW_MS, 10 * 60 * 1000);
  assert.equal(VOTE_TOKEN_LOCKOUT_MS, 15 * 60 * 1000);
});

check("per-IP sliding window triggers, isolates callers, then resets", () => {
  resetVoteRateLimits();
  const ip = "203.0.113.7";
  for (let i = 0; i < VOTE_IP_MAX_ATTEMPTS; i += 1) {
    assert.equal(consumeVoteAttempt(ip, null, now).allowed, true);
  }
  const denied = consumeVoteAttempt(ip, null, now);
  deniedAfter(denied);
  assert.ok(denied.retryAfterSeconds >= 1);
  assert.ok(denied.retryAfterSeconds <= VOTE_IP_WINDOW_MS / 1000);

  // A different caller on a different IP is unaffected.
  assert.equal(consumeVoteAttempt("198.51.100.9", null, now).allowed, true);

  // The window slides: past attempts expire and the budget resets.
  advance(VOTE_IP_WINDOW_MS + 1);
  assert.equal(consumeVoteAttempt(ip, null, now).allowed, true);
});

check("per-token-hash failure budget locks out, then resets", () => {
  resetVoteRateLimits();
  const ip = "203.0.113.7";
  for (let i = 0; i < VOTE_TOKEN_MAX_FAILURES - 1; i += 1) {
    recordVoteFailure(HASH_A, now);
    assert.equal(consumeVoteAttempt(ip, HASH_A, now).allowed, true);
  }
  recordVoteFailure(HASH_A, now);
  const locked = consumeVoteAttempt(ip, HASH_A, now);
  deniedAfter(locked);
  assert.equal(locked.retryAfterSeconds, VOTE_TOKEN_LOCKOUT_MS / 1000);

  // A different hash from the same caller is unaffected by the lockout.
  assert.equal(consumeVoteAttempt(ip, HASH_B, now).allowed, true);

  // Still locked just before expiry, open just after — the lockout resets.
  advance(VOTE_TOKEN_LOCKOUT_MS - 1000);
  assert.equal(consumeVoteAttempt(ip, HASH_A, now).allowed, false);
  advance(1001);
  assert.equal(consumeVoteAttempt(ip, HASH_A, now).allowed, true);
});

check("stale failures outside the window never accumulate to a lockout", () => {
  resetVoteRateLimits();
  const ip = "203.0.113.7";
  for (let i = 0; i < VOTE_TOKEN_MAX_FAILURES - 1; i += 1) {
    recordVoteFailure(HASH_C, now);
  }
  advance(VOTE_TOKEN_WINDOW_MS + 1);
  recordVoteFailure(HASH_C, now);
  // Only one failure is inside the window — far below budget.
  assert.equal(consumeVoteAttempt(ip, HASH_C, now).allowed, true);
});

check("a successful validation forgives the hash's earlier failures", () => {
  resetVoteRateLimits();
  const ip = "203.0.113.7";
  for (let i = 0; i < VOTE_TOKEN_MAX_FAILURES - 1; i += 1) {
    recordVoteFailure(HASH_A, now);
  }
  recordVoteSuccess(HASH_A);
  recordVoteFailure(HASH_A, now);
  // One fresh failure after forgiveness — nowhere near lockout.
  assert.equal(consumeVoteAttempt(ip, HASH_A, now).allowed, true);
});

check("malformed Codes (no hash) still spend the caller's IP budget", () => {
  resetVoteRateLimits();
  const ip = "203.0.113.7";
  for (let i = 0; i < VOTE_IP_MAX_ATTEMPTS; i += 1) {
    assert.equal(consumeVoteAttempt(ip, null, now).allowed, true);
  }
  assert.equal(consumeVoteAttempt(ip, null, now).allowed, false);
  // Null/empty hashes never create token buckets or throw.
  recordVoteFailure(null, now);
  recordVoteSuccess(null);
  recordVoteFailure("", now);
  recordVoteSuccess("");
});

// ---------------------------------------------------------------------------
// Non-oracling: locked-out callers learn nothing about token validity.
// ---------------------------------------------------------------------------

check("throttled message is shared, and distinct from the invalid message", () => {
  // One string for every denial (IP budget and token lockout alike), so
  // throttling cannot name which budget fired. Distinct from the uniform
  // invalid string so honest clients can back off instead of re-guessing —
  // identical for valid and invalid Codes either way.
  assert.equal(VOTE_RATE_LIMITED_ERROR, "Too many attempts. Try again later.");
  assert.notEqual(VOTE_RATE_LIMITED_ERROR, VOTE_UNIFORM_ERROR);
});

check("IP-exhausted callers get identical outcomes for distinct hashes", () => {
  resetVoteRateLimits();
  const ip = "203.0.113.7";
  for (let i = 0; i < VOTE_IP_MAX_ATTEMPTS; i += 1) {
    consumeVoteAttempt(ip, null, now);
  }
  // Two never-before-seen hashes — one standing in for a valid Code, one
  // for an invalid Code — receive byte-identical throttled outcomes.
  const forValid = toRateLimitedResult(consumeVoteAttempt(ip, HASH_A, now));
  const forInvalid = toRateLimitedResult(consumeVoteAttempt(ip, HASH_B, now));
  assert.deepEqual(forValid, forInvalid);
});

check("token-locked callers get identical outcomes however valid the Code", () => {
  resetVoteRateLimits();
  const ip = "203.0.113.7";
  for (let i = 0; i < VOTE_TOKEN_MAX_FAILURES; i += 1) {
    recordVoteFailure(HASH_A, now);
  }
  for (let i = 0; i < VOTE_TOKEN_MAX_FAILURES; i += 1) {
    recordVoteFailure(HASH_B, now);
  }
  // The gate never consults token validity — only (hash, budget clocks) —
  // so a locked valid Code and a locked invalid Code look exactly alike.
  const forValid = toRateLimitedResult(consumeVoteAttempt(ip, HASH_A, now));
  const forInvalid = toRateLimitedResult(consumeVoteAttempt(ip, HASH_B, now));
  assert.deepEqual(forValid, forInvalid);
  assert.equal(forValid.message, VOTE_RATE_LIMITED_ERROR);
});

// ---------------------------------------------------------------------------
// Wiring: every token endpoint gates before any token validation.
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

/** Slices one exported function's body out of a module source. */
function functionBody(source: string, functionName: string): string {
  const startMarker = `export async function ${functionName}(`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${functionName} not found`);
  const nextExport = source.indexOf("export async function", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

check("all five token endpoints gate before any token validation", () => {
  const actions = readSource("lib/vote/actions.ts");
  const entryPoints = [
    "resolveFacultyBallot",
    "castFacultyVote",
    "resolveStudentBallot",
    "castStudentVote",
    "resolveVoteBallot",
  ];
  const dbMarkers = [
    'from("voting_tokens")',
    'rpc("cast_vote"',
    'rpc("cast_student_vote"',
  ];
  for (const entry of entryPoints) {
    const body = functionBody(actions, entry);
    const gateIndex = body.indexOf("checkVoteGate");
    assert.notEqual(gateIndex, -1, `${entry} must call checkVoteGate`);
    let sawDb = false;
    for (const marker of dbMarkers) {
      const dbIndex = body.indexOf(marker);
      if (dbIndex !== -1) {
        sawDb = true;
        assert.ok(
          gateIndex < dbIndex,
          `${entry} must gate before ${marker}`,
        );
      }
    }
    assert.ok(sawDb, `${entry} must still validate tokens after the gate`);
    assert.ok(
      body.includes("clientIp"),
      `${entry} must accept the test clientIp override`,
    );
    assert.ok(
      body.includes("recordVoteFailure"),
      `${entry} must count failures toward the token budget`,
    );
    assert.ok(
      body.includes("recordVoteSuccess"),
      `${entry} must forgive the hash on success`,
    );
    assert.ok(
      body.includes("rateLimited"),
      `${entry} must map denials to the RATE_LIMITED outcome`,
    );
  }
});

check("all five result unions carry the RATE_LIMITED outcome", () => {
  const schemas = readSource("lib/vote/schemas.ts");
  assert.ok(
    schemas.includes("VOTE_RATE_LIMITED_ERROR"),
    "schemas must define the shared throttled message",
  );
  const resultTypes = [
    "ResolveFacultyBallotResult",
    "CastFacultyVoteResult",
    "ResolveStudentBallotResult",
    "CastStudentVoteResult",
    "ResolveVoteBallotResult",
  ];
  for (const typeName of resultTypes) {
    const start = schemas.indexOf(`export type ${typeName} =`);
    assert.notEqual(start, -1, `${typeName} not found`);
    const nextType = schemas.indexOf("export type", start + 1);
    const nextConst = schemas.indexOf("export const", start + 1);
    const candidates = [nextType, nextConst].filter((index) => index !== -1);
    const end = candidates.length > 0 ? Math.min(...candidates) : schemas.length;
    const block = schemas.slice(start, end);
    assert.ok(
      block.includes("RateLimitedResult"),
      `${typeName} must include the RATE_LIMITED outcome`,
    );
  }
});

console.log(`\nAll ${passed} self-test groups passed.`);
