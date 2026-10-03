import { z } from "zod";

/**
 * Faculty vote flow validation (spec §14 task 9, security model §8, UX §10).
 *
 * Glossary (GLOSSARY.md): Code is the human-readable form of a Token; Token
 * is the single-use credential; Candidate is a faculty member eligible to
 * receive votes. This module is deliberately pure (no `server-only`, no I/O)
 * so the `/vote` Client Component can import its types. Hashing with the
 * pepper and all database access live in `./actions.js`, which is
 * server-only.
 *
 * Never trust the browser (locked, spec §8): `department_id`,
 * `candidate_id`, `stage`, and `token_type` from the client are hints at
 * most. The ballot resolver and the `cast_vote` transaction re-derive the
 * department from the Token row, check the election stage, check the Token
 * type, and validate the candidate server-side. The client submits only the
 * Code and the chosen candidate id.
 */

/**
 * Uniform non-oracling failure string (spec §§8, 10). Every token, stage,
 * type, and candidate validation failure returns exactly this message, so
 * failures reveal nothing about which check failed (unknown vs used vs
 * wrong stage vs ineligible candidate).
 */
export const VOTE_UNIFORM_ERROR = "Invalid or unusable voting code.";

/**
 * Server-misconfiguration string. Returned only when the vote path itself
 * is unwired (pepper env missing) — independent of any presented Code, so
 * it oracles nothing about token validity. Never carries secret material.
 */
export const VOTE_UNAVAILABLE_ERROR =
  "Voting is temporarily unavailable. Try again later.";

/**
 * Rate-limit string (spec §8, task 16). Returned for every budget denial —
 * per-IP window and per-token-hash lockout alike, for valid and invalid
 * Codes alike — so throttling reveals nothing about token validity. The
 * accompanying `retryAfterSeconds` field is the Server-Action equivalent of
 * `429 + Retry-After`; it carries backoff timing only, never a validity
 * signal. Deliberately distinct from VOTE_UNIFORM_ERROR so honest clients
 * can back off instead of re-guessing.
 */
export const VOTE_RATE_LIMITED_ERROR = "Too many attempts. Try again later.";

/**
 * Throttled outcome. `retryAfterSeconds` is at least 1: wait that long
 * before retrying. A future Route Handler wrapper must map this to HTTP 429
 * with a `Retry-After` header.
 */
export type RateLimitedResult = {
  ok: false;
  code: "RATE_LIMITED";
  message: string;
  retryAfterSeconds: number;
};

/** Raw Code as typed by the voter (format checked via hashing, not here). */
export const voteCodeInputSchema = z.string().trim().min(1).max(64);

export const voteCandidateInputSchema = z.uuid();

/** One ballot Candidate: eligible fellow faculty, self already excluded. */
export const ballotCandidateSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  pictureUrl: z.string().nullable().optional(),
});

export type BallotCandidate = z.infer<typeof ballotCandidateSchema>;

export const ballotDepartmentSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  pictureUrl: z.string().nullable().optional(),
});

export type BallotDepartment = z.infer<typeof ballotDepartmentSchema>;

/** Server-resolved faculty ballot: department label + fellow faculty. */
export const facultyBallotSchema = z.object({
  electionId: z.uuid(),
  department: ballotDepartmentSchema,
  candidates: ballotCandidateSchema.array(),
});

export type FacultyBallot = z.infer<typeof facultyBallotSchema>;

export type ResolveFacultyBallotResult =
  | { ok: true; ballot: FacultyBallot }
  | { ok: false; code: "INVALID"; message: string }
  | { ok: false; code: "UNAVAILABLE"; message: string }
  | RateLimitedResult;

export type CastFacultyVoteResult =
  | { ok: true }
  | { ok: false; code: "INVALID"; message: string }
  | { ok: false; code: "UNAVAILABLE"; message: string }
  | RateLimitedResult;

/**
 * Server-resolved student ballot (spec §§11, 14 task 12).
 *
 * Same three-step shape as the faculty ballot, but the Candidates are the
 * voter's department Finalists only — the frozen Top-3 snapshot — with the
 * department label derived server-side from the Token (never submitted).
 * Glossary (GLOSSARY.md) is used exactly: Finalist is a Candidate advanced
 * to student voting as one of a department's Top-3.
 */
export const studentBallotSchema = z.object({
  electionId: z.uuid(),
  department: ballotDepartmentSchema,
  candidates: ballotCandidateSchema.array(),
});

export type StudentBallot = z.infer<typeof studentBallotSchema>;

export type ResolveStudentBallotResult =
  | { ok: true; ballot: StudentBallot }
  | { ok: false; code: "INVALID"; message: string }
  | { ok: false; code: "UNAVAILABLE"; message: string }
  | RateLimitedResult;

export type CastStudentVoteResult =
  | { ok: true }
  | { ok: false; code: "INVALID"; message: string }
  | { ok: false; code: "UNAVAILABLE"; message: string }
  | RateLimitedResult;

/** Which voter flow a Code resolved to (Token type, server-derived). */
export const voterTypeSchema = z.enum(["FACULTY", "STUDENT"]);

export type VoterType = z.infer<typeof voterTypeSchema>;

/**
 * Unified `/vote` ballot (spec §§10–11): one Code entry accepts either a
 * faculty or a student Code; the server derives the voter type from the
 * Token row and returns the matching ballot. The client submits only the
 * Code and the chosen id — department, stage, and token type are never
 * accepted from the browser.
 */
export type ResolveVoteBallotResult =
  | { ok: true; voterType: "FACULTY"; ballot: FacultyBallot }
  | { ok: true; voterType: "STUDENT"; ballot: StudentBallot }
  | { ok: false; code: "INVALID"; message: string }
  | { ok: false; code: "UNAVAILABLE"; message: string }
  | RateLimitedResult;

/** Deep module interface aliases for the unified ballot seam. */
export type ResolveBallotResult = ResolveVoteBallotResult;
export type CastBallotResult = CastFacultyVoteResult;

