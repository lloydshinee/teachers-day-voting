"use server";

import { headers } from "next/headers";
import { z } from "zod";

import { logFacultyVoteCast, logStudentVoteCast } from "@/lib/audit/hook";
import { hashFacultyCode } from "@/lib/faculty/codes";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import {
  consumeVoteAttempt,
  recordVoteFailure,
  recordVoteSuccess,
  type VoteRateLimitDecision,
} from "./rate-limit";
import {
  VOTE_RATE_LIMITED_ERROR,
  VOTE_UNAVAILABLE_ERROR,
  VOTE_UNIFORM_ERROR,
  voteCandidateInputSchema,
  voteCodeInputSchema,
  type CastFacultyVoteResult,
  type CastStudentVoteResult,
  type RateLimitedResult,
  type ResolveFacultyBallotResult,
  type ResolveStudentBallotResult,
  type ResolveVoteBallotResult,
} from "./schemas";

/**
 * Faculty + student `/vote` server path (spec §14 tasks 9 and 12, security
 * model §8, UX §§10–11).
 *
 * All entries run exclusively on the server through the service-role
 * client (bypasses RLS; anon/authenticated hold no grants on voting
 * tables and no execute grant on `cast_vote` / `cast_student_vote`, so
 * browsers cannot reach the data directly). Browser-submitted department,
 * stage, and token-type values are never accepted — the department is
 * derived from the Token row, the stage is checked against the election
 * row, and the token type is checked inside the transaction. The client
 * submits only the Code and (on submit) the chosen id.
 *
 * Student Codes share the 12-character format and the same server pepper
 * as faculty Codes (spec §6), so hashing reuses `hashFacultyCode` — the
 * function is format-agnostic, not faculty-specific.
 *
 * Uniform non-oracling errors: every token / stage / type / candidate
 * validation failure returns exactly `VOTE_UNIFORM_ERROR`, so failures
 * reveal nothing about which check failed. Raw Codes and token hashes are
 * never logged and never returned; only the hex digest reaches the
 * database as a lookup key.
 *
 * Rate limiting (spec §8 task 16): every entry below is gated by
 * `checkVoteGate` — per-IP sliding window plus per-token-hash failure
 * budget with temporary lockout (see `./rate-limit.js`) — BEFORE any token
 * validation runs (no database lookup happens while gated). Denied callers
 * all receive the single `VOTE_RATE_LIMITED_ERROR` with `retryAfterSeconds`
 * (the Server-Action equivalent of `429 + Retry-After`), identical for
 * valid and invalid Codes. Each entry accepts an optional `clientIp`
 * override for tests; production callers omit it and the IP is resolved
 * from request headers.
 */

const tokenRowSchema = z.object({
  election_id: z.uuid(),
  department_id: z.uuid(),
  token_type: z.string(),
  faculty_id: z.uuid().nullable(),
  used: z.boolean(),
  invalidated_at: z.string().nullable(),
});

const electionStageRowSchema = z.object({
  id: z.uuid(),
  stage: z.string(),
});

const departmentRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  picture_url: z.string().nullable().optional(),
});

const facultyOptionRowSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  picture_url: z.string().nullable().optional(),
});

const castVoteRowSchema = z.object({
  election_id: z.uuid(),
  department_id: z.uuid(),
});

const finalistRowSchema = z.object({
  faculty_id: z.uuid(),
  rank: z.number().int(),
});

const finalistFacultyRowSchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  picture_url: z.string().nullable().optional(),
});

function invalidResult(): { ok: false; code: "INVALID"; message: string } {
  return { ok: false, code: "INVALID", message: VOTE_UNIFORM_ERROR };
}

function unavailableResult(): { ok: false; code: "UNAVAILABLE"; message: string } {
  return { ok: false, code: "UNAVAILABLE", message: VOTE_UNAVAILABLE_ERROR };
}

type PreparedVoteCode =
  | {
      ok: true;
      parsedCode: ReturnType<typeof voteCodeInputSchema.safeParse>;
      tokenHash: string | null;
    }
  | {
      ok: false;
      error: { ok: false; code: "UNAVAILABLE"; message: string };
    };

function prepareVoteCode(code: string): PreparedVoteCode {
  const parsedCode = voteCodeInputSchema.safeParse(code);
  let tokenHash: string | null = null;
  try {
    tokenHash = parsedCode.success ? hashFacultyCode(parsedCode.data) : null;
  } catch {
    // Pepper env missing — server misconfiguration, independent of the
    // presented Code, so this oracles nothing about token validity.
    // Not a voter failure: no rate accounting happens here.
    return { ok: false, error: unavailableResult() };
  }
  return { ok: true, parsedCode, tokenHash };
}

/**
 * Resolves the caller IP for the rate gate. Production callers omit the
 * override and the client IP is extracted safely from request headers;
 * with no request context (background/self-test) every caller shares the
 * `"unknown"` bucket. The optional override exists so tests can simulate
 * distinct callers without a request scope.
 *
 * Security note: The client can manipulate the initial entries of `x-forwarded-for`
 * by setting their own header before reaching our reverse proxy/load balancer.
 * Trusted upstream proxies append the client's actual connecting IP to the end
 * of the `x-forwarded-for` chain. We inspect the last entry (the one set by the
 * trusted upstream proxy) rather than the client-controlled first entry,
 * falling back to `x-real-ip` or "unknown".
 */
export async function resolveClientIp(override?: string): Promise<string> {
  const trimmed = override?.trim();
  if (trimmed !== undefined && trimmed !== "") {
    return trimmed;
  }
  try {
    const store = await headers();
    const forwarded = store.get("x-forwarded-for");
    if (forwarded) {
      const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean);
      const lastForwarded = parts[parts.length - 1];
      if (lastForwarded !== undefined && lastForwarded !== "") {
        return lastForwarded;
      }
    }
    const realIp = store.get("x-real-ip")?.trim();
    if (realIp !== undefined && realIp !== "") {
      return realIp;
    }
  } catch {
    // No request context — callers share the "unknown" bucket.
  }
  return "unknown";
}

/**
 * Rate gate for all token endpoints. Records one IP attempt and denies when
 * either the per-IP window or the per-token-hash lockout is spent. Must run
 * before any token validation (no DB); hashing the Code first is fine —
 * it is a deterministic transform, not validation.
 */
export async function checkVoteGate(
  tokenHash: string | null,
  clientIp?: string,
): Promise<VoteRateLimitDecision> {
  const ip = await resolveClientIp(clientIp);
  return consumeVoteAttempt(ip, tokenHash);
}

function rateLimitedResult(retryAfterSeconds: number): RateLimitedResult {
  return {
    ok: false,
    code: "RATE_LIMITED",
    message: VOTE_RATE_LIMITED_ERROR,
    retryAfterSeconds,
  };
}

/**
 * Resolves a presented Code to its department ballot (step 1 → step 2).
 * Validates the Token (exists, FACULTY, unused, live), the election stage
 * (FACULTY_VOTING), then returns the department label plus fellow faculty
 * (self excluded, archived excluded, ordered by name). Any failure looks
 * identical to the voter.
 */
export async function resolveFacultyBallot(
  code: string,
  clientIp?: string,
): Promise<ResolveFacultyBallotResult> {
  const prep = prepareVoteCode(code);
  if (!prep.ok) {
    return prep.error;
  }
  const { parsedCode, tokenHash } = prep;

  // Rate gate before any token validation (no database lookup while
  // gated). The IP attempt is recorded even for malformed Codes; the token
  // budget only applies once a hash exists.
  const gate = await checkVoteGate(tokenHash, clientIp);
  if (!gate.allowed) {
    return rateLimitedResult(gate.retryAfterSeconds);
  }

  // Every INVALID outcome below counts one failure against this hash, so
  // repeated probing locks the hash while the message stays uniform.
  const fail = (): ResolveFacultyBallotResult => {
    recordVoteFailure(tokenHash);
    return invalidResult();
  };

  if (!parsedCode.success) {
    return fail();
  }
  if (tokenHash === null) {
    return fail();
  }

  const serviceRole = createServiceRoleClient();

  const { data: tokenData, error: tokenError } = await serviceRole
    .from("voting_tokens")
    .select("election_id, department_id, token_type, faculty_id, used, invalidated_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (tokenError) {
    return fail();
  }
  const token = tokenRowSchema.safeParse(tokenData);
  if (!token.success) {
    return fail();
  }
  if (
    token.data.token_type !== "FACULTY" ||
    token.data.used ||
    token.data.invalidated_at !== null ||
    token.data.faculty_id === null
  ) {
    return fail();
  }

  const { data: electionData, error: electionError } = await serviceRole
    .from("elections")
    .select("id, stage")
    .eq("id", token.data.election_id)
    .maybeSingle();
  if (electionError) {
    return fail();
  }
  const election = electionStageRowSchema.safeParse(electionData);
  if (!election.success) {
    return fail();
  }
  if (election.data.stage !== "FACULTY_VOTING") {
    return fail();
  }

  const { data: departmentData, error: departmentError } = await serviceRole
    .from("departments")
    .select("id, code, name, picture_url")
    .eq("id", token.data.department_id)
    .maybeSingle();
  if (departmentError) {
    return fail();
  }
  const department = departmentRowSchema.safeParse(departmentData);
  if (!department.success) {
    return fail();
  }

  const { data: facultyData, error: facultyError } = await serviceRole
    .from("faculty")
    .select("id, full_name, picture_url")
    .eq("department_id", token.data.department_id)
    .is("archived_at", null)
    .order("full_name", { ascending: true });
  if (facultyError) {
    return fail();
  }
  const faculty = facultyOptionRowSchema.array().safeParse(facultyData ?? []);
  if (!faculty.success) {
    return fail();
  }

  // Self-exclusion: the voter's own row never appears (spec §10).
  const candidates = faculty.data
    .filter((row) => row.id !== token.data.faculty_id)
    .map((row) => ({
      id: row.id,
      fullName: row.full_name,
      pictureUrl: row.picture_url ?? null,
    }));

  // Success forgives earlier typos against this hash.
  recordVoteSuccess(tokenHash);

  return {
    ok: true,
    ballot: {
      electionId: token.data.election_id,
      department: {
        id: department.data.id,
        code: department.data.code,
        name: department.data.name,
        pictureUrl: department.data.picture_url ?? null,
      },
      candidates,
    },
  };
}

/**
 * Casts one faculty vote atomically (confirm → success).
 * Re-hashes the Code server-side and delegates to the `cast_vote`
 * SECURITY DEFINER transaction (migration 004), which locks the token
 * row, re-validates election stage + FACULTY type + unused state,
 * derives the department from the token, validates the candidate
 * (same-department eligible faculty, never self), inserts the
 * secret-ballot vote, and burns the token — all-or-nothing. Then writes
 * one token-use audit entry WITHOUT any choice.
 */
export async function castFacultyVote(
  code: string,
  candidateId: string,
  clientIp?: string,
): Promise<CastFacultyVoteResult> {
  const prep = prepareVoteCode(code);
  if (!prep.ok) {
    return prep.error;
  }
  const { parsedCode, tokenHash } = prep;
  const parsedCandidate = voteCandidateInputSchema.safeParse(candidateId);

  // Rate gate before the `cast_vote` transaction runs.
  const gate = await checkVoteGate(tokenHash, clientIp);
  if (!gate.allowed) {
    return rateLimitedResult(gate.retryAfterSeconds);
  }

  const fail = (): CastFacultyVoteResult => {
    recordVoteFailure(tokenHash);
    return invalidResult();
  };

  if (!parsedCode.success || !parsedCandidate.success) {
    return fail();
  }
  if (tokenHash === null) {
    return fail();
  }

  const serviceRole = createServiceRoleClient();

  const { data, error } = await serviceRole.rpc("cast_vote", {
    p_token_hash: tokenHash,
    p_candidate_id: parsedCandidate.data,
  });
  if (error) {
    // All rejections (unknown/used/wrong-stage/ineligible candidate plus
    // concurrent double-submit losers) surface here as one uniform error.
    // The Postgres code is deliberately not returned to the voter.
    return fail();
  }
  const rows = castVoteRowSchema.array().safeParse(data ?? []);
  if (!rows.success || rows.data.length !== 1) {
    return fail();
  }
  const committed = rows.data[0];
  if (!committed) {
    return fail();
  }

  // Token-use audit WITHOUT choice (spec §§3, 7): election + department +
  // action only. The candidate, voter identity, Code, and hash have no
  // field on this input type, so they cannot be recorded here.
  await logFacultyVoteCast({
    action: "FACULTY_VOTE_CAST",
    electionId: committed.election_id,
    departmentId: committed.department_id,
  });

  // The vote committed: forgive earlier typos against this hash.
  recordVoteSuccess(tokenHash);

  return { ok: true };
}

/**
 * Resolves a presented student Code to its department Finalists
 * (step 1 → step 2, spec §11, task 12).
 *
 * The department is derived server-side from the Token row — never
 * submitted — and only that department's frozen Finalists (ordered by
 * rank) are returned. Validates the Token (exists, STUDENT, unused, live,
 * no faculty link), the election stage (STUDENT_VOTING), then the snapshot.
 * Any failure looks identical to the voter (uniform, non-oracling).
 */
export async function resolveStudentBallot(
  code: string,
  clientIp?: string,
): Promise<ResolveStudentBallotResult> {
  const prep = prepareVoteCode(code);
  if (!prep.ok) {
    return prep.error;
  }
  const { parsedCode, tokenHash } = prep;

  // Rate gate before any token validation (no database lookup while gated).
  const gate = await checkVoteGate(tokenHash, clientIp);
  if (!gate.allowed) {
    return rateLimitedResult(gate.retryAfterSeconds);
  }

  // Every INVALID outcome below counts one failure against this hash, so
  // repeated probing locks the hash while the message stays uniform.
  const fail = (): ResolveStudentBallotResult => {
    recordVoteFailure(tokenHash);
    return invalidResult();
  };

  if (!parsedCode.success) {
    return fail();
  }
  if (tokenHash === null) {
    return fail();
  }

  const serviceRole = createServiceRoleClient();

  const { data: tokenData, error: tokenError } = await serviceRole
    .from("voting_tokens")
    .select(
      "election_id, department_id, token_type, faculty_id, used, invalidated_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (tokenError) {
    return fail();
  }
  const token = tokenRowSchema.safeParse(tokenData);
  if (!token.success) {
    return fail();
  }
  if (
    token.data.token_type !== "STUDENT" ||
    token.data.used ||
    token.data.invalidated_at !== null ||
    token.data.faculty_id !== null
  ) {
    return fail();
  }

  const { data: electionData, error: electionError } = await serviceRole
    .from("elections")
    .select("id, stage")
    .eq("id", token.data.election_id)
    .maybeSingle();
  if (electionError) {
    return fail();
  }
  const election = electionStageRowSchema.safeParse(electionData);
  if (!election.success) {
    return fail();
  }
  if (election.data.stage !== "STUDENT_VOTING") {
    return fail();
  }

  const { data: departmentData, error: departmentError } = await serviceRole
    .from("departments")
    .select("id, code, name, picture_url")
    .eq("id", token.data.department_id)
    .maybeSingle();
  if (departmentError) {
    return fail();
  }
  const department = departmentRowSchema.safeParse(departmentData);
  if (!department.success) {
    return fail();
  }

  // Frozen Finalists for exactly the token's (election, department),
  // ordered by rank. The snapshot is authoritative — no archived filter,
  // matching the `cast_student_vote` transaction which validates against
  // this same table.
  const { data: finalistData, error: finalistError } = await serviceRole
    .from("finalists")
    .select("faculty_id, rank")
    .eq("election_id", token.data.election_id)
    .eq("department_id", token.data.department_id)
    .order("rank", { ascending: true });
  if (finalistError) {
    return fail();
  }
  const finalists = finalistRowSchema.array().safeParse(finalistData ?? []);
  if (!finalists.success) {
    return fail();
  }

  const facultyIds = finalists.data.map((row) => row.faculty_id);
  let candidates: Array<{
    id: string;
    fullName: string;
    pictureUrl?: string | null;
  }> = [];
  if (facultyIds.length > 0) {
    const { data: facultyData, error: facultyError } = await serviceRole
      .from("faculty")
      .select("id, full_name, picture_url")
      .in("id", facultyIds);
    if (facultyError) {
      return fail();
    }
    const faculty = finalistFacultyRowSchema
      .array()
      .safeParse(facultyData ?? []);
    if (!faculty.success) {
      return fail();
    }
    const namesById = new Map(
      faculty.data.map(
        (row) =>
          [
            row.id,
            {
              fullName: row.full_name,
              pictureUrl: row.picture_url ?? null,
            },
          ] as const,
      ),
    );
    candidates = finalists.data.flatMap((row) => {
      const match = namesById.get(row.faculty_id);
      return match === undefined
        ? []
        : [
            {
              id: row.faculty_id,
              fullName: match.fullName,
              pictureUrl: match.pictureUrl,
            },
          ];
    });
  }

  // Success forgives earlier typos against this hash.
  recordVoteSuccess(tokenHash);

  return {
    ok: true,
    ballot: {
      electionId: token.data.election_id,
      department: {
        id: department.data.id,
        code: department.data.code,
        name: department.data.name,
        pictureUrl: department.data.picture_url ?? null,
      },
      candidates,
    },
  };
}

/**
 * Casts one student vote atomically (confirm → success, spec §11).
 * Re-hashes the Code server-side and delegates to the
 * `cast_student_vote` SECURITY DEFINER transaction (migration 005), which
 * locks the token row, re-validates election stage + STUDENT type + unused
 * state, derives the department from the token, validates the candidate
 * (frozen Finalist for exactly that election + department — so a
 * cross-department id fails inside the transaction no matter what the
 * browser submits), inserts the secret-ballot vote, and burns the token —
 * all-or-nothing. Then writes one token-use audit entry WITHOUT any
 * choice.
 */
export async function castStudentVote(
  code: string,
  candidateId: string,
  clientIp?: string,
): Promise<CastStudentVoteResult> {
  const prep = prepareVoteCode(code);
  if (!prep.ok) {
    return prep.error;
  }
  const { parsedCode, tokenHash } = prep;
  const parsedCandidate = voteCandidateInputSchema.safeParse(candidateId);

  // Rate gate before the `cast_student_vote` transaction runs.
  const gate = await checkVoteGate(tokenHash, clientIp);
  if (!gate.allowed) {
    return rateLimitedResult(gate.retryAfterSeconds);
  }

  const fail = (): CastStudentVoteResult => {
    recordVoteFailure(tokenHash);
    return invalidResult();
  };

  if (!parsedCode.success || !parsedCandidate.success) {
    return fail();
  }
  if (tokenHash === null) {
    return fail();
  }

  const serviceRole = createServiceRoleClient();

  const { data, error } = await serviceRole.rpc("cast_student_vote", {
    p_token_hash: tokenHash,
    p_candidate_id: parsedCandidate.data,
  });
  if (error) {
    // All rejections (unknown/used/wrong-stage/wrong-type/non-finalist
    // candidate plus concurrent double-submit losers) surface here as one
    // uniform error. The Postgres code is deliberately not returned.
    return fail();
  }
  const rows = castVoteRowSchema.array().safeParse(data ?? []);
  if (!rows.success || rows.data.length !== 1) {
    return fail();
  }
  const committed = rows.data[0];
  if (!committed) {
    return fail();
  }

  // Token-use audit WITHOUT choice (spec §§3, 7): election + department +
  // action only. The Finalist choice, voter identity, Code, and hash have
  // no field on this input type, so they cannot be recorded here.
  await logStudentVoteCast({
    action: "STUDENT_VOTE_CAST",
    electionId: committed.election_id,
    departmentId: committed.department_id,
  });

  // The vote committed: forgive earlier typos against this hash.
  recordVoteSuccess(tokenHash);

  return { ok: true };
}

/**
 * Unified `/vote` resolver (spec §§10–11): one Code entry accepts either a
 * faculty or a student Code. The Token row is read once; the voter type
 * comes from that row (never from the browser) and selects the ballot:
 * fellow faculty (self excluded) for FACULTY Tokens in FACULTY_VOTING, or
 * frozen Finalists for STUDENT Tokens in STUDENT_VOTING. Every failure —
 * unknown/used/invalid Token, wrong stage, missing department — returns
 * the single uniform error.
 */
export async function resolveVoteBallot(
  code: string,
  clientIp?: string,
): Promise<ResolveVoteBallotResult> {
  const prep = prepareVoteCode(code);
  if (!prep.ok) {
    return prep.error;
  }
  const { parsedCode, tokenHash } = prep;

  // Rate gate before any token validation (no database lookup while gated).
  const gate = await checkVoteGate(tokenHash, clientIp);
  if (!gate.allowed) {
    return rateLimitedResult(gate.retryAfterSeconds);
  }

  // Every INVALID outcome below counts one failure against this hash, so
  // repeated probing locks the hash while the message stays uniform.
  const fail = (): ResolveVoteBallotResult => {
    recordVoteFailure(tokenHash);
    return invalidResult();
  };

  if (!parsedCode.success) {
    return fail();
  }
  if (tokenHash === null) {
    return fail();
  }

  const serviceRole = createServiceRoleClient();

  const { data: tokenData, error: tokenError } = await serviceRole
    .from("voting_tokens")
    .select(
      "election_id, department_id, token_type, faculty_id, used, invalidated_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (tokenError) {
    return fail();
  }
  const token = tokenRowSchema.safeParse(tokenData);
  if (!token.success) {
    return fail();
  }
  if (token.data.used || token.data.invalidated_at !== null) {
    return fail();
  }

  const { data: electionData, error: electionError } = await serviceRole
    .from("elections")
    .select("id, stage")
    .eq("id", token.data.election_id)
    .maybeSingle();
  if (electionError) {
    return fail();
  }
  const election = electionStageRowSchema.safeParse(electionData);
  if (!election.success) {
    return fail();
  }

  const { data: departmentData, error: departmentError } = await serviceRole
    .from("departments")
    .select("id, code, name, picture_url")
    .eq("id", token.data.department_id)
    .maybeSingle();
  if (departmentError) {
    return fail();
  }
  const department = departmentRowSchema.safeParse(departmentData);
  if (!department.success) {
    return fail();
  }

  const mappedDepartment = {
    id: department.data.id,
    code: department.data.code,
    name: department.data.name,
    pictureUrl: department.data.picture_url ?? null,
  };

  if (token.data.token_type === "FACULTY") {
    if (
      token.data.faculty_id === null ||
      election.data.stage !== "FACULTY_VOTING"
    ) {
      return fail();
    }
    const { data: facultyData, error: facultyError } = await serviceRole
      .from("faculty")
      .select("id, full_name, picture_url")
      .eq("department_id", token.data.department_id)
      .is("archived_at", null)
      .order("full_name", { ascending: true });
    if (facultyError) {
      return fail();
    }
    const faculty = facultyOptionRowSchema
      .array()
      .safeParse(facultyData ?? []);
    if (!faculty.success) {
      return fail();
    }
    const candidates = faculty.data
      .filter((row) => row.id !== token.data.faculty_id)
      .map((row) => ({
        id: row.id,
        fullName: row.full_name,
        pictureUrl: row.picture_url ?? null,
      }));
    // Success forgives earlier typos against this hash.
    recordVoteSuccess(tokenHash);
    return {
      ok: true,
      voterType: "FACULTY",
      ballot: {
        electionId: token.data.election_id,
        department: mappedDepartment,
        candidates,
      },
    };
  }

  if (token.data.token_type === "STUDENT") {
    if (
      token.data.faculty_id !== null ||
      election.data.stage !== "STUDENT_VOTING"
    ) {
      return fail();
    }
    const { data: finalistData, error: finalistError } = await serviceRole
      .from("finalists")
      .select("faculty_id, rank")
      .eq("election_id", token.data.election_id)
      .eq("department_id", token.data.department_id)
      .order("rank", { ascending: true });
    if (finalistError) {
      return fail();
    }
    const finalists = finalistRowSchema.array().safeParse(finalistData ?? []);
    if (!finalists.success) {
      return fail();
    }
    const facultyIds = finalists.data.map((row) => row.faculty_id);
    let candidates: Array<{ id: string; fullName: string; pictureUrl?: string | null }> = [];
    if (facultyIds.length > 0) {
      const { data: facultyData, error: facultyError } = await serviceRole
        .from("faculty")
        .select("id, full_name, picture_url")
        .in("id", facultyIds);
      if (facultyError) {
        return fail();
      }
      const faculty = finalistFacultyRowSchema
        .array()
        .safeParse(facultyData ?? []);
      if (!faculty.success) {
        return fail();
      }
      const infoById = new Map(
        faculty.data.map((row) => [row.id, { fullName: row.full_name, pictureUrl: row.picture_url ?? null }] as const),
      );
      candidates = finalists.data.flatMap((row) => {
        const info = infoById.get(row.faculty_id);
        return info === undefined
          ? []
          : [{ id: row.faculty_id, fullName: info.fullName, pictureUrl: info.pictureUrl }];
      });
    }
    // Success forgives earlier typos against this hash.
    recordVoteSuccess(tokenHash);
    return {
      ok: true,
      voterType: "STUDENT",
      ballot: {
        electionId: token.data.election_id,
        department: mappedDepartment,
        candidates,
      },
    };
  }

  return fail();
}

// ---------------------------------------------------------------------------
// Deep Ballot Interface (Candidate 3)
// ---------------------------------------------------------------------------

/**
 * Deep ballot resolution entry point.
 * Given a Code, authenticates and derives the ballot options (fellow faculty
 * or frozen Finalists) without requiring callers to specify voter type or department.
 */
export async function resolveBallot(
  code: string,
  clientIp?: string,
): Promise<ResolveVoteBallotResult> {
  return resolveVoteBallot(code, clientIp);
}

/**
 * Deep ballot casting entry point.
 * Atomically casts a vote for the selected candidate. Server-derives the
 * Token type and dispatches to the corresponding atomic SQL transaction
 * (cast_vote or cast_student_vote), recording failure/success in the rate
 * gate and emitting the non-identifying audit log.
 */
export async function castBallot(
  code: string,
  candidateId: string,
  clientIp?: string,
): Promise<CastFacultyVoteResult> {
  const prep = prepareVoteCode(code);
  if (!prep.ok) {
    return prep.error;
  }
  const { tokenHash } = prep;

  // Rate gate before any token validation (no DB lookup while gated).
  const gate = await checkVoteGate(tokenHash, clientIp);
  if (!gate.allowed) {
    return rateLimitedResult(gate.retryAfterSeconds);
  }

  if (tokenHash) {
    const serviceRole = createServiceRoleClient();
    const { data: token } = await serviceRole
      .from("voting_tokens")
      .select("token_type")
      .eq("token_hash", tokenHash)
      .maybeSingle();

    if (token?.token_type === "STUDENT") {
      return castStudentVote(code, candidateId, clientIp);
    }
  }

  return castFacultyVote(code, candidateId, clientIp);
}

