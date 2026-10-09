/**
 * End-to-end election lifecycle suite — spec §14 task 19 (flows §§2, 10–12).
 *
 * Run headless: `node_modules/.bin/jiti lib/e2e/election-lifecycle.e2e.ts`
 *             or `npm run test:e2e`
 *
 * Drives the full lifecycle through the real transactions and libraries the
 * server actions call, on one throwaway Election with four departments:
 *
 * - CLEAN — happy path: faculty Code entry → ballot → confirm → cast, clean
 *   Top-3 freeze, student Codes (+ top-up), student ballot → cast, clean
 *   Winner publish.
 * - FTIE — faculty cutoff Tie: detect → flag → lock refused while tied →
 *   manual pick from exactly the tied set → freeze; then a clean Winner.
 * - STIE — clean freeze, then Winner Tie: detect → flag → publish refused
 *   while tied → manual pick of one tied Finalist → publish.
 * - ZERO — zero-vote department: short roster freezes cleanly with zero
 *   votes, then holds tie-blocked at the Winner gate while siblings publish.
 *
 * Coverage: faculty flow (entry/ballot/confirm/cast/burn/replay), student
 * flow against frozen Finalists (incl. cross-department rejection), faculty
 * Tie with manual pick + freeze, Winner Tie with pick + publish, zero-vote
 * department, multi-department independence while one sits tie-blocked,
 * student top-up Codes (exact quantities, never duplicated), close plus
 * guarded re-open (allowed with zero dependent votes with votes kept and a
 * fresh freeze required; refused with dependent votes; refused once CLOSED).
 *
 * How "real server actions" are exercised headlessly: the admin/vote server
 * actions require cookie auth and request scope, so this suite (a) asserts
 * the wiring shape of `lib/vote/actions.ts`, `lib/stage1/actions.ts`, and
 * `lib/stage2/actions.ts` — each delegates to the transaction/library used
 * here with no forged channel — and (b) executes those exact callees:
 * `cast_vote` / `cast_student_vote` transactions, `computeStage1Cutoff` /
 * `computeStage2Winner`, and every `apply*` state-machine gate, persisting
 * markers exactly as the actions do.
 *
 * Glossary (GLOSSARY.md) is used exactly: Election, Tie, Token, Code,
 * Candidate, Finalist, Winner.
 *
 * Hygiene (enforced, not promised): every row carries the `T19E2E`
 * throwaway prefix (text fields) or hangs off the `T19E2E`-named Election;
 * cleanup runs in `finally` so success AND failure leave zero rows behind.
 * Secrets and raw Codes never enter the repo: Codes are generated at
 * runtime only, only their hashes reach the database, and the suite prints
 * no Codes, hashes, peppers, or keys — only PASS/FAIL lines, counts, stage
 * names, and error codes.
 */

import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  applyFlagTie,
  applyGlobalAction,
  applyLockFinalists,
  applyPublishWinner,
  applyReopenStage1,
  applyResolveTie,
} from "../election/actions.js";
import { generateCode } from "../tokens/format.js";
import { computeStage1Cutoff } from "../stage1/counting.js";
import { computeStage2Winner } from "../stage2/counting.js";
import type { GlobalAdminAction } from "../election/stages.js";

// ---------------------------------------------------------------------------
// Tiny runner.
// ---------------------------------------------------------------------------

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL ${name}`);
  }
}

function at<T>(items: readonly T[], index: number, label: string): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`Fixture index out of range: ${label}.`);
  }
  return item;
}

// ---------------------------------------------------------------------------
// Env (runtime only — values never printed, never written to the repo).
// ---------------------------------------------------------------------------

function loadDotenvFile(): void {
  const dotenvPath = path.join(process.cwd(), ".env.local");
  let raw: string;
  try {
    raw = fs.readFileSync(dotenvPath, "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq < 0) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    if (key !== "" && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`Missing required env var: ${name}.`);
  }
  return value;
}

function optionalEnv(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (value !== undefined && value !== "") {
      return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Error-shape helpers (uniform rejection, typed over unknown).
// ---------------------------------------------------------------------------

const UNIFORM_MESSAGE = "vote rejected";
const UNIFORM_CODE = "P0001";

function errCodeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  if (!("code" in error)) {
    return null;
  }
  const code: unknown = error.code;
  return typeof code === "string" ? code : null;
}

function errMessageOf(error: unknown): string {
  if (typeof error !== "object" || error === null) {
    return "";
  }
  if (!("message" in error)) {
    return "";
  }
  const message: unknown = error.message;
  return typeof message === "string" ? message : "";
}

function isUniformRejection(error: unknown): boolean {
  return (
    errCodeOf(error) === UNIFORM_CODE && errMessageOf(error) === UNIFORM_MESSAGE
  );
}

// ---------------------------------------------------------------------------
// Row schemas (Zod-inferred, precise).
// ---------------------------------------------------------------------------

const idSchema = z.object({ id: z.uuid() });
const deptSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
const facultySchema = z.object({
  id: z.uuid(),
  full_name: z.string(),
  department_id: z.uuid(),
  archived_at: z.string().nullable(),
});
const electionStageSchema = z.object({
  stage: z.string(),
  tie_policy_locked_at: z.string().nullable(),
});
const tokenRowSchema = z.object({
  election_id: z.uuid(),
  department_id: z.uuid(),
  token_type: z.string(),
  faculty_id: z.uuid().nullable(),
  used: z.boolean(),
  invalidated_at: z.string().nullable(),
});
const tokenUsedSchema = z.object({ used: z.boolean() });
const castOkSchema = z.array(
  z.object({ election_id: z.uuid(), department_id: z.uuid() }),
);
const voteRowSchema = z.object({
  department_id: z.uuid(),
  stage: z.string(),
  candidate_faculty_id: z.uuid(),
});
const voteCandidateSchema = z.object({ candidate_faculty_id: z.uuid() });
const finalistRowSchema = z.object({
  faculty_id: z.uuid(),
  stage1_votes: z.number().int(),
  rank: z.number().int(),
});
const markersRowSchema = z.object({
  finalists_locked_at: z.string().nullable(),
  winner_published_at: z.string().nullable(),
  tie_pending: z.boolean(),
});
const resultRowSchema = z.object({
  winner_faculty_id: z.uuid(),
  published: z.boolean(),
  policy_version: z.string().nullable(),
});

type DbClientOptions = {
  auth: { persistSession: boolean; autoRefreshToken: boolean };
};

function createDbClient(url: string, key: string, options: DbClientOptions) {
  return createClient(url, key, options);
}

type ServiceDb = ReturnType<typeof createDbClient>;

// ---------------------------------------------------------------------------
// Throwaway fixtures. Prefix marks every row this suite owns.
// ---------------------------------------------------------------------------

const PREFIX = "T19E2E";

function runId(): string {
  return randomBytes(4).toString("hex");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}


/**
 * Hashes a display Code exactly as Code entry does: strip dashes and
 * whitespace, uppercase, then `SHA-256(pepper + letters)` (spec §6). The
 * display Code lives in memory only; just the digest reaches the database.
 */
function hashForEntry(display: string, pepper: string): string {
  const letters = display.replace(/[\s-]+/g, "").toUpperCase();
  return sha256Hex(pepper + letters);
}

interface FixtureDept {
  id: string;
  facultyIds: string[];
}

interface Fixture {
  electionId: string;
  clean: FixtureDept;
  ftie: FixtureDept;
  stie: FixtureDept;
  zero: FixtureDept;
}

async function insertOne(
  svc: ServiceDb,
  table: string,
  values: Record<string, string | boolean | number | null>,
  schema: z.ZodType<unknown>,
): Promise<Record<string, string>> {
  const { data, error } = await svc.from(table).insert(values).select().single();
  if (error !== null || data === null || data === undefined) {
    throw new Error(`Fixture insert into ${table} failed.`);
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Fixture insert into ${table} returned an odd shape.`);
  }
  return parsed.data as Record<string, string>;
}

async function buildFixture(svc: ServiceDb, tag: string): Promise<Fixture> {
  const election = await insertOne(
    svc,
    "elections",
    {
      name: `${PREFIX} Election ${tag}`,
      academic_year: `${PREFIX}-${tag}`,
      stage: "DRAFT",
      tie_policy_text: `${PREFIX} tie policy ${tag}: manual admin pick at both gates`,
    },
    idSchema,
  );
  const electionId = election["id"] ?? "";
  if (electionId === "") {
    throw new Error("Fixture election has no id.");
  }

  async function makeDept(
    suffix: string,
    label: string,
    facultyCount: number,
  ): Promise<FixtureDept> {
    const dept = await insertOne(
      svc,
      "departments",
      {
        code: `${PREFIX}-${suffix}-${tag}`,
        name: `${PREFIX} Department ${label} ${tag}`,
      },
      deptSchema,
    );
    const deptId = dept["id"] ?? "";
    if (deptId === "") {
      throw new Error("Fixture department has no id.");
    }
    const { error: partError } = await svc
      .from("election_departments")
      .insert({ election_id: electionId, department_id: deptId });
    if (partError !== null) {
      throw new Error("Fixture election_departments insert failed.");
    }
    const facultyIds: string[] = [];
    for (let i = 0; i < facultyCount; i += 1) {
      const padded = String(i).padStart(2, "0");
      const row = await insertOne(
        svc,
        "faculty",
        {
          department_id: deptId,
          full_name: `${PREFIX} ${label} ${padded} ${tag}`,
        },
        facultySchema,
      );
      const id = row["id"] ?? "";
      if (id === "") {
        throw new Error("Fixture faculty row has no id.");
      }
      facultyIds.push(id);
    }
    return { id: deptId, facultyIds };
  }

  const clean = await makeDept("CLEAN", "Clean", 4);
  const ftie = await makeDept("FTIE", "Tied", 5);
  const stie = await makeDept("STIE", "Singles", 4);
  const zero = await makeDept("ZERO", "Quiet", 2);
  return { electionId, clean, ftie, stie, zero };
}

/** Mints one Token via the Code-entry path; the display Code stays in memory. */
async function mintToken(
  svc: ServiceDb,
  input: {
    electionId: string;
    departmentId: string;
    tokenType: "FACULTY" | "STUDENT";
    facultyId: string | null;
    pepper: string;
    seenHashes: Set<string>;
  },
): Promise<{ tokenHash: string; display: string }> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const display = generateCode();
    const tokenHash = hashForEntry(display, input.pepper);
    if (input.seenHashes.has(tokenHash)) {
      continue;
    }
    const { error } = await svc.from("voting_tokens").insert({
      election_id: input.electionId,
      department_id: input.departmentId,
      token_hash: tokenHash,
      token_type: input.tokenType,
      faculty_id: input.facultyId,
    });
    if (error === null) {
      input.seenHashes.add(tokenHash);
      return { tokenHash, display };
    }
    if (error.code !== "23505") {
      throw new Error("Throwaway Token mint failed.");
    }
  }
  throw new Error("Could not mint a fresh throwaway Token.");
}

async function readStage(svc: ServiceDb, electionId: string): Promise<string> {
  const { data, error } = await svc
    .from("elections")
    .select("stage, tie_policy_locked_at")
    .eq("id", electionId)
    .maybeSingle();
  if (error !== null) {
    throw new Error("Election stage read failed.");
  }
  const parsed = electionStageSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Election stage read returned an odd shape.");
  }
  return parsed.data.stage;
}

async function readPolicyVersion(
  svc: ServiceDb,
  electionId: string,
): Promise<string | null> {
  const { data, error } = await svc
    .from("elections")
    .select("stage, tie_policy_locked_at")
    .eq("id", electionId)
    .maybeSingle();
  if (error !== null) {
    throw new Error("Policy version read failed.");
  }
  const parsed = electionStageSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Policy version read returned an odd shape.");
  }
  return normalizeDbTimestamp(parsed.data.tie_policy_locked_at);
}

/** Global step through the real state machine, persisted on success. */
async function transitionGlobal(
  svc: ServiceDb,
  electionId: string,
  action: GlobalAdminAction,
  expectedTo: string,
): Promise<boolean> {
  const from = await readStage(svc, electionId);
  const transition = applyGlobalAction({ from, action });
  if (!transition.ok || transition.value.to !== expectedTo) {
    return false;
  }
  const { error } = await svc
    .from("elections")
    .update({ stage: transition.value.to })
    .eq("id", electionId);
  if (error !== null) {
    throw new Error("Election stage persist failed.");
  }
  return true;
}

/**
 * Database timestamps arrive with a numeric offset (`+00:00`), which the
 * state-machine schemas (`z.iso.datetime()`, offset form disallowed) reject.
 * This normalizes to the `Z` form at the suite boundary, preserving the
 * instant — the same moment the server actions would persist.
 */
function normalizeDbTimestamp(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  const millis = Date.parse(value);
  if (Number.isNaN(millis)) {
    throw new Error("Database timestamp read returned an odd shape.");
  }
  return new Date(millis).toISOString();
}

interface DeptMarkers {
  finalistsLockedAt: string | null;
  winnerPublishedAt: string | null;
  tiePending: boolean;
}

async function readMarkers(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
): Promise<DeptMarkers> {
  const { data, error } = await svc
    .from("election_departments")
    .select("finalists_locked_at, winner_published_at, tie_pending")
    .eq("election_id", electionId)
    .eq("department_id", departmentId)
    .maybeSingle();
  if (error !== null) {
    throw new Error("Department markers read failed.");
  }
  const parsed = markersRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Department markers read returned an odd shape.");
  }
  return {
    finalistsLockedAt: normalizeDbTimestamp(parsed.data.finalists_locked_at),
    winnerPublishedAt: normalizeDbTimestamp(parsed.data.winner_published_at),
    tiePending: parsed.data.tie_pending,
  };
}

function toMarkersInput(
  electionId: string,
  departmentId: string,
  markers: DeptMarkers,
): {
  electionId: string;
  departmentId: string;
  finalistsLockedAt: string | null;
  winnerPublishedAt: string | null;
  tiePending: boolean;
} {
  return {
    electionId,
    departmentId,
    finalistsLockedAt: markers.finalistsLockedAt,
    winnerPublishedAt: markers.winnerPublishedAt,
    tiePending: markers.tiePending,
  };
}

async function countVotes(
  svc: ServiceDb,
  electionId: string,
  departmentId: string | null,
  stage: string,
): Promise<number> {
  let query = svc
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("election_id", electionId)
    .eq("stage", stage);
  if (departmentId !== null) {
    query = query.eq("department_id", departmentId);
  }
  const { count, error } = await query;
  if (error !== null) {
    throw new Error("Vote counting query failed.");
  }
  return count ?? 0;
}

async function countTokens(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
  tokenType: string,
): Promise<number> {
  const { count, error } = await svc
    .from("voting_tokens")
    .select("id", { count: "exact", head: true })
    .eq("election_id", electionId)
    .eq("department_id", departmentId)
    .eq("token_type", tokenType);
  if (error !== null) {
    throw new Error("Token counting query failed.");
  }
  return count ?? 0;
}

async function tokenUsed(svc: ServiceDb, tokenHash: string): Promise<boolean> {
  const { data, error } = await svc
    .from("voting_tokens")
    .select("used")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (error !== null) {
    throw new Error("Token-state lookup failed.");
  }
  const parsed = tokenUsedSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Token-state lookup returned an odd shape.");
  }
  return parsed.data.used;
}

// ---------------------------------------------------------------------------
// Ballot mirrors: the same reads the server vote path performs (Code entry
// → Token row → stage check → department-derived ballot), without secrets.
// ---------------------------------------------------------------------------

interface FacultyBallotMirror {
  electionId: string;
  departmentId: string;
  voterFacultyId: string;
  candidateIds: string[];
}

async function resolveFacultyBallotMirror(
  svc: ServiceDb,
  tokenHash: string,
): Promise<FacultyBallotMirror | null> {
  const { data: tokenData } = await svc
    .from("voting_tokens")
    .select(
      "election_id, department_id, token_type, faculty_id, used, invalidated_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  const token = tokenRowSchema.safeParse(tokenData);
  if (!token.success) {
    return null;
  }
  if (
    token.data.token_type !== "FACULTY" ||
    token.data.used ||
    token.data.invalidated_at !== null ||
    token.data.faculty_id === null
  ) {
    return null;
  }
  const stage = await readStage(svc, token.data.election_id);
  if (stage !== "FACULTY_VOTING") {
    return null;
  }
  const { data: facultyData } = await svc
    .from("faculty")
    .select("id, full_name, department_id, archived_at")
    .eq("department_id", token.data.department_id)
    .is("archived_at", null)
    .order("full_name", { ascending: true });
  const roster = facultySchema.array().safeParse(facultyData ?? []);
  if (!roster.success) {
    return null;
  }
  return {
    electionId: token.data.election_id,
    departmentId: token.data.department_id,
    voterFacultyId: token.data.faculty_id,
    candidateIds: roster.data
      .filter((row) => row.id !== token.data.faculty_id)
      .map((row) => row.id),
  };
}

interface StudentBallotMirror {
  electionId: string;
  departmentId: string;
  finalistIds: string[];
}

async function resolveStudentBallotMirror(
  svc: ServiceDb,
  tokenHash: string,
): Promise<StudentBallotMirror | null> {
  const { data: tokenData } = await svc
    .from("voting_tokens")
    .select(
      "election_id, department_id, token_type, faculty_id, used, invalidated_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();
  const token = tokenRowSchema.safeParse(tokenData);
  if (!token.success) {
    return null;
  }
  if (
    token.data.token_type !== "STUDENT" ||
    token.data.used ||
    token.data.invalidated_at !== null ||
    token.data.faculty_id !== null
  ) {
    return null;
  }
  const stage = await readStage(svc, token.data.election_id);
  if (stage !== "STUDENT_VOTING") {
    return null;
  }
  const { data: finalistData } = await svc
    .from("finalists")
    .select("faculty_id, stage1_votes, rank")
    .eq("election_id", token.data.election_id)
    .eq("department_id", token.data.department_id)
    .order("rank", { ascending: true });
  const snapshot = finalistRowSchema.array().safeParse(finalistData ?? []);
  if (!snapshot.success) {
    return null;
  }
  return {
    electionId: token.data.election_id,
    departmentId: token.data.department_id,
    finalistIds: snapshot.data.map((row) => row.faculty_id),
  };
}

async function castFaculty(
  svc: ServiceDb,
  tokenHash: string,
  candidateId: string,
): Promise<boolean> {
  const { data, error } = await svc.rpc("cast_vote", {
    p_token_hash: tokenHash,
    p_candidate_id: candidateId,
  });
  if (error !== null) {
    return false;
  }
  const rows = castOkSchema.safeParse(data ?? []);
  return rows.success && rows.data.length === 1;
}

async function castStudent(
  svc: ServiceDb,
  tokenHash: string,
  candidateId: string,
): Promise<boolean> {
  const { data, error } = await svc.rpc("cast_student_vote", {
    p_token_hash: tokenHash,
    p_candidate_id: candidateId,
  });
  if (error !== null) {
    return false;
  }
  const rows = castOkSchema.safeParse(data ?? []);
  return rows.success && rows.data.length === 1;
}

// ---------------------------------------------------------------------------
// Counting mirrors: aggregates only (candidate + votes), like the queries.
// ---------------------------------------------------------------------------

async function facultyCountsByCandidate(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
): Promise<Map<string, number>> {
  const { data, error } = await svc
    .from("votes")
    .select("candidate_faculty_id")
    .eq("election_id", electionId)
    .eq("department_id", departmentId)
    .eq("stage", "FACULTY");
  if (error !== null) {
    throw new Error("Faculty aggregate read failed.");
  }
  const rows = voteCandidateSchema.array().safeParse(data ?? []);
  if (!rows.success) {
    throw new Error("Faculty aggregate read returned an odd shape.");
  }
  const counts = new Map<string, number>();
  for (const row of rows.data) {
    counts.set(
      row.candidate_faculty_id,
      (counts.get(row.candidate_faculty_id) ?? 0) + 1,
    );
  }
  return counts;
}

async function eligibleRoster(
  svc: ServiceDb,
  departmentId: string,
): Promise<Array<{ id: string; fullName: string }>> {
  const { data, error } = await svc
    .from("faculty")
    .select("id, full_name, department_id, archived_at")
    .eq("department_id", departmentId)
    .is("archived_at", null)
    .order("full_name", { ascending: true });
  if (error !== null) {
    throw new Error("Eligible roster read failed.");
  }
  const rows = facultySchema.array().safeParse(data ?? []);
  if (!rows.success) {
    throw new Error("Eligible roster read returned an odd shape.");
  }
  return rows.data.map((row) => ({ id: row.id, fullName: row.full_name }));
}

interface Stage1TallyInput {
  candidateId: string;
  fullName: string;
  votes: number;
}

async function tallyStage1(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
): Promise<Stage1TallyInput[]> {
  const perCandidate = await facultyCountsByCandidate(
    svc,
    electionId,
    departmentId,
  );
  const roster = await eligibleRoster(svc, departmentId);
  const ids = new Set<string>(perCandidate.keys());
  for (const member of roster) {
    ids.add(member.id);
  }
  const names = new Map(roster.map((m) => [m.id, m.fullName] as const));
  return [...ids].map((candidateId) => ({
    candidateId,
    fullName: names.get(candidateId) ?? "Unknown faculty",
    votes: perCandidate.get(candidateId) ?? 0,
  }));
}

interface Stage2TallyInput {
  finalistId: string;
  fullName: string;
  votes: number;
}

async function tallyStage2(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
): Promise<{ counts: Stage2TallyInput[]; ignoredVotes: number }> {
  const { data: finalistData, error: finalistError } = await svc
    .from("finalists")
    .select("faculty_id, stage1_votes, rank")
    .eq("election_id", electionId)
    .eq("department_id", departmentId)
    .order("rank", { ascending: true });
  if (finalistError !== null) {
    throw new Error("Finalist snapshot read failed.");
  }
  const snapshot = finalistRowSchema.array().safeParse(finalistData ?? []);
  if (!snapshot.success) {
    throw new Error("Finalist snapshot read returned an odd shape.");
  }
  const roster = await eligibleRoster(svc, departmentId);
  const names = new Map(roster.map((m) => [m.id, m.fullName] as const));
  const { data: voteData, error: voteError } = await svc
    .from("votes")
    .select("candidate_faculty_id")
    .eq("election_id", electionId)
    .eq("department_id", departmentId)
    .eq("stage", "STUDENT");
  if (voteError !== null) {
    throw new Error("Student aggregate read failed.");
  }
  const votes = voteCandidateSchema.array().safeParse(voteData ?? []);
  if (!votes.success) {
    throw new Error("Student aggregate read returned an odd shape.");
  }
  const snapshotIds = new Set(snapshot.data.map((row) => row.faculty_id));
  const perFinalist = new Map<string, number>();
  let ignoredVotes = 0;
  for (const vote of votes.data) {
    if (!snapshotIds.has(vote.candidate_faculty_id)) {
      ignoredVotes += 1;
      continue;
    }
    perFinalist.set(
      vote.candidate_faculty_id,
      (perFinalist.get(vote.candidate_faculty_id) ?? 0) + 1,
    );
  }
  return {
    counts: snapshot.data.map((row) => ({
      finalistId: row.faculty_id,
      fullName: names.get(row.faculty_id) ?? "Unknown faculty",
      votes: perFinalist.get(row.faculty_id) ?? 0,
    })),
    ignoredVotes,
  };
}

/** Mirrors `writeFinalistsSnapshot`: replace rows, then lock the markers. */
async function persistFreeze(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
  rows: Array<{ facultyId: string; stage1Votes: number; rank: number }>,
  lockedAt: string,
): Promise<void> {
  const { error: deleteError } = await svc
    .from("finalists")
    .delete()
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (deleteError !== null) {
    throw new Error("Finalist snapshot replace failed.");
  }
  if (rows.length > 0) {
    const { error } = await svc.from("finalists").insert(
      rows.map((row) => ({
        election_id: electionId,
        department_id: departmentId,
        faculty_id: row.facultyId,
        stage1_votes: row.stage1Votes,
        rank: row.rank,
      })),
    );
    if (error !== null) {
      throw new Error("Finalist snapshot write failed.");
    }
  }
  const { error } = await svc
    .from("election_departments")
    .update({ finalists_locked_at: lockedAt, tie_pending: false })
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (error !== null) {
    throw new Error("Finalists lock persist failed.");
  }
}

async function persistTieFlag(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
): Promise<void> {
  const { error } = await svc
    .from("election_departments")
    .update({ tie_pending: true })
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (error !== null) {
    throw new Error("Tie flag persist failed.");
  }
}

async function persistPublish(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
  winnerFacultyId: string,
  published: boolean,
  policyVersion: string,
  winnerPublishedAt: string | null,
): Promise<void> {
  const { error: resultError } = await svc.from("election_results").upsert(
    {
      election_id: electionId,
      department_id: departmentId,
      winner_faculty_id: winnerFacultyId,
      published,
      policy_version: policyVersion,
    },
    { onConflict: "election_id,department_id" },
  );
  if (resultError !== null) {
    throw new Error("Winner record write failed.");
  }
  const { error } = await svc
    .from("election_departments")
    .update({
      winner_published_at: winnerPublishedAt,
      tie_pending: false,
    })
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (error !== null) {
    throw new Error("Publish markers persist failed.");
  }
}

async function readWinner(
  svc: ServiceDb,
  electionId: string,
  departmentId: string,
): Promise<{ winnerFacultyId: string; published: boolean } | null> {
  const { data, error } = await svc
    .from("election_results")
    .select("winner_faculty_id, published, policy_version")
    .eq("election_id", electionId)
    .eq("department_id", departmentId)
    .maybeSingle();
  if (error !== null) {
    throw new Error("Winner record read failed.");
  }
  if (data === null) {
    return null;
  }
  const parsed = resultRowSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error("Winner record read returned an odd shape.");
  }
  return {
    winnerFacultyId: parsed.data.winner_faculty_id,
    published: parsed.data.published,
  };
}

// ---------------------------------------------------------------------------
// Cleanup: zero leftover rows on success or failure.
// ---------------------------------------------------------------------------

async function cleanupFixture(
  svc: ServiceDb,
  electionId: string | null,
): Promise<void> {
  if (electionId !== null) {
    await svc.from("votes").delete().eq("election_id", electionId);
    await svc.from("finalists").delete().eq("election_id", electionId);
    await svc.from("election_results").delete().eq("election_id", electionId);
    await svc.from("voting_tokens").delete().eq("election_id", electionId);
    await svc
      .from("election_departments")
      .delete()
      .eq("election_id", electionId);
    await svc.from("audit_logs").delete().eq("election_id", electionId);
    await svc.from("elections").delete().eq("id", electionId);
  }
  // Prefix sweep: catches every throwaway row even if setup died halfway.
  await svc.from("faculty").delete().like("full_name", `${PREFIX}%`);
  await svc.from("departments").delete().like("code", `${PREFIX}%`);
  await svc.from("elections").delete().like("name", `${PREFIX}%`);
}

async function scopedCount(
  svc: ServiceDb,
  table: string,
  column: string,
  filterColumn: string,
  filterValue: string,
  useLike: boolean,
): Promise<number> {
  let query = svc.from(table).select(column, { count: "exact", head: true });
  query = useLike
    ? query.like(filterColumn, filterValue)
    : query.eq(filterColumn, filterValue);
  const { count, error } = await query;
  if (error !== null) {
    throw new Error(`Leftover check on ${table} failed.`);
  }
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Source-shape assertions: server actions delegate to these transactions.
// ---------------------------------------------------------------------------

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
}

function functionBody(source: string, functionName: string): string {
  const startMarker = `export async function ${functionName}(`;
  const start = source.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Entry point ${functionName} not found.`);
  }
  const nextExport = source.indexOf("export async function", start + 1);
  return nextExport === -1 ? source.slice(start) : source.slice(start, nextExport);
}

// ---------------------------------------------------------------------------
// Main battery.
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  loadDotenvFile();
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceKey =
    optionalEnv(["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) ??
    requiredEnv("MISSING_SERVICE_KEY");
  const pepper = requiredEnv("VOTING_TOKEN_PEPPER");

  const svc = createDbClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- Wiring: server actions delegate to the transactions used below. -----
  const voteActions = readSource("lib/vote/actions.ts");
  const stage1Actions = readSource("lib/stage1/actions.ts");
  const stage2Actions = readSource("lib/stage2/actions.ts");
  const stage2Queries = readSource("lib/stage2/queries.ts");

  const facultyCastBody = functionBody(voteActions, "castFacultyVote");
  const studentCastBody = functionBody(voteActions, "castStudentVote");
  check(
    "wiring: faculty server action delegates to cast_vote with (hash, candidate)",
    facultyCastBody.includes('rpc("cast_vote"') &&
      facultyCastBody.includes("p_token_hash: tokenHash") &&
      facultyCastBody.includes("p_candidate_id: parsedCandidate.data") &&
      !facultyCastBody.includes("cast_student_vote"),
  );
  check(
    "wiring: student server action delegates to cast_student_vote with (hash, candidate)",
    studentCastBody.includes('rpc("cast_student_vote"') &&
      studentCastBody.includes("p_token_hash: tokenHash") &&
      studentCastBody.includes("p_candidate_id: parsedCandidate.data") &&
      !studentCastBody.includes('rpc("cast_vote"'),
  );
  check(
    "wiring: stage-1 actions freeze via applyLockFinalists and resolve ties via applyResolveTie",
    stage1Actions.includes("applyLockFinalists") &&
      stage1Actions.includes("applyResolveTie") &&
      stage1Actions.includes("applyFlagTie"),
  );
  check(
    "wiring: stage-2 actions publish via applyPublishWinner and resolve winner ties via applyResolveTie",
    stage2Actions.includes("applyPublishWinner") &&
      stage2Actions.includes("applyResolveTie") &&
      stage2Actions.includes("applyFlagTie"),
  );
  const publishedFn = functionBody(stage2Queries, "getPublishedResults");
  check(
    "wiring: published results read election_results + finalists only, never vote rows",
    publishedFn.includes('from("election_results")') &&
      publishedFn.includes('from("finalists")') &&
      !publishedFn.includes('from("votes")') &&
      !publishedFn.includes('from("voting_tokens")'),
  );

  // -- Pure state-machine guardrails (no database). --------------------------
  check(
    "state machine: backward and skip transitions are illegal (forward-only)",
    !applyGlobalAction({ from: "FINAL_RESULTS", action: "OPEN_FACULTY_VOTING" })
      .ok &&
      !applyGlobalAction({ from: "DRAFT", action: "CLOSE_FACULTY_VOTING" }).ok,
  );
  const closedMarkers = {
    electionId: "00000000-0000-4000-8000-000000000001",
    departmentId: "00000000-0000-4000-8000-000000000002",
    finalistsLockedAt: null,
    winnerPublishedAt: null,
    tiePending: false,
  };
  check(
    "state machine: lock and publish are refused outside their stages",
    !applyLockFinalists({
      markers: closedMarkers,
      stage: "FACULTY_VOTING",
      lockedAt: new Date().toISOString(),
    }).ok &&
      !applyPublishWinner({
        markers: closedMarkers,
        stage: "STUDENT_VOTING",
        publishedAt: new Date().toISOString(),
        policyVersion: new Date().toISOString(),
      }).ok,
  );

  // -- Throwaway fixture: one Election, four departments. --------------------
  const tag = runId();
  let electionId: string | null = null;
  try {
    const fixture = await buildFixture(svc, tag);
    electionId = fixture.electionId;

    check(
      "admin: election opens DRAFT → FACULTY_VOTING",
      await transitionGlobal(svc, fixture.electionId, "OPEN_FACULTY_VOTING", "FACULTY_VOTING"),
    );

    // Tie policy freezes once faculty voting opens (map decision).
    const policyFrozenAt = new Date().toISOString();
    const { error: policyError } = await svc
      .from("elections")
      .update({ tie_policy_locked_at: policyFrozenAt })
      .eq("id", fixture.electionId);
    if (policyError !== null) {
      throw new Error("Tie policy freeze failed.");
    }
    const policyVersion = await readPolicyVersion(svc, fixture.electionId);
    check(
      "admin: tie policy frozen before voting closes",
      policyVersion !== null,
    );
    if (policyVersion === null) {
      throw new Error("Policy version missing after freeze.");
    }
    const frozenPolicy: string = policyVersion;

    // -- Faculty Tokens (1:1 per faculty, via the Code-entry path). ---------
    const seenHashes = new Set<string>();
    async function mintFaculty(
      dept: FixtureDept,
      facultyIndex: number,
    ): Promise<{ tokenHash: string; display: string }> {
      return mintToken(svc, {
        electionId: fixture.electionId,
        departmentId: dept.id,
        tokenType: "FACULTY",
        facultyId: at(dept.facultyIds, facultyIndex, "faculty"),
        pepper,
        seenHashes,
      });
    }
    const cleanTokens = [
      await mintFaculty(fixture.clean, 0),
      await mintFaculty(fixture.clean, 1),
      await mintFaculty(fixture.clean, 2),
      await mintFaculty(fixture.clean, 3),
    ];
    const ftieTokens = [
      await mintFaculty(fixture.ftie, 0),
      await mintFaculty(fixture.ftie, 1),
      await mintFaculty(fixture.ftie, 2),
      await mintFaculty(fixture.ftie, 3),
      await mintFaculty(fixture.ftie, 4),
    ];
    const stieTokens = [
      await mintFaculty(fixture.stie, 0),
      await mintFaculty(fixture.stie, 1),
      await mintFaculty(fixture.stie, 2),
      await mintFaculty(fixture.stie, 3),
    ];
    const zeroTokens = [
      await mintFaculty(fixture.zero, 0),
      await mintFaculty(fixture.zero, 1),
    ];

    // -- Faculty flow: Code entry → ballot → confirm → cast. -----------------
    // Entry: the display Code re-hashes to the stored Token (proves the
    // entry path); the ballot lists fellow faculty with self excluded.
    const firstVoter = at(fixture.clean.facultyIds, 0, "clean voter");
    const firstCandidate = at(fixture.clean.facultyIds, 1, "clean candidate");
    const firstEntryHash = hashForEntry(at(cleanTokens, 0, "token").display, pepper);
    const entryMatchesToken =
      firstEntryHash === at(cleanTokens, 0, "token").tokenHash;
    const ballot = await resolveFacultyBallotMirror(
      svc,
      at(cleanTokens, 0, "token").tokenHash,
    );
    check(
      "faculty flow: Code entry resolves the department ballot with self excluded",
      entryMatchesToken &&
        ballot !== null &&
        ballot.departmentId === fixture.clean.id &&
        ballot.voterFacultyId === firstVoter &&
        !ballot.candidateIds.includes(firstVoter) &&
        ballot.candidateIds.length === 3,
    );
    // Confirm: the chosen Candidate is on the ballot (never self); then cast.
    const confirmed =
      ballot !== null &&
      ballot.candidateIds.includes(firstCandidate) &&
      firstCandidate !== firstVoter;
    const castOk =
      confirmed &&
      (await castFaculty(
        svc,
        at(cleanTokens, 0, "token").tokenHash,
        firstCandidate,
      ));
    const { data: voteRow } = await svc
      .from("votes")
      .select("department_id, stage, candidate_faculty_id")
      .eq("election_id", fixture.electionId)
      .eq("stage", "FACULTY")
      .limit(1)
      .maybeSingle();
    const voteParsed = voteRowSchema.safeParse(voteRow);
    check(
      "faculty flow: confirm then cast commits with the server-derived department + stage",
      castOk &&
        voteParsed.success &&
        voteParsed.data.department_id === fixture.clean.id &&
        voteParsed.data.stage === "FACULTY" &&
        voteParsed.data.candidate_faculty_id === firstCandidate,
    );
    // Burn + replay: the Token is spent and cannot vote or resolve again.
    const replayVote = await castFaculty(
      svc,
      at(cleanTokens, 0, "token").tokenHash,
      at(fixture.clean.facultyIds, 2, "clean third"),
    );
    const spentBallot = await resolveFacultyBallotMirror(
      svc,
      at(cleanTokens, 0, "token").tokenHash,
    );
    check(
      "faculty flow: Token burned; replay rejected; used Code resolves to nothing",
      (await tokenUsed(svc, at(cleanTokens, 0, "token").tokenHash)) &&
        !replayVote &&
        spentBallot === null,
    );

    // -- Remaining faculty votes per the engineered plan. --------------------
    // CLEAN totals C0=2 C1=1 C2=1 C3=0 → clean Top-3.
    // FTIE totals G0=3 G1=2 rest 0 → Tie at the cutoff (3 tied, 1 seat).
    // STIE totals H0=2 H1=1 H2=1 H3=0 → clean Top-3. ZERO casts nothing.
    const c = fixture.clean.facultyIds;
    const g = fixture.ftie.facultyIds;
    const h = fixture.stie.facultyIds;
    const remainingFacultyVotes: Array<{
      tokenHash: string;
      candidateId: string;
    }> = [
      { tokenHash: at(cleanTokens, 1, "token").tokenHash, candidateId: at(c, 0, "c") },
      { tokenHash: at(cleanTokens, 2, "token").tokenHash, candidateId: at(c, 0, "c") },
      { tokenHash: at(cleanTokens, 3, "token").tokenHash, candidateId: at(c, 2, "c") },
      { tokenHash: at(ftieTokens, 0, "token").tokenHash, candidateId: at(g, 1, "g") },
      { tokenHash: at(ftieTokens, 1, "token").tokenHash, candidateId: at(g, 0, "g") },
      { tokenHash: at(ftieTokens, 2, "token").tokenHash, candidateId: at(g, 0, "g") },
      { tokenHash: at(ftieTokens, 3, "token").tokenHash, candidateId: at(g, 0, "g") },
      { tokenHash: at(ftieTokens, 4, "token").tokenHash, candidateId: at(g, 1, "g") },
      { tokenHash: at(stieTokens, 0, "token").tokenHash, candidateId: at(h, 1, "h") },
      { tokenHash: at(stieTokens, 1, "token").tokenHash, candidateId: at(h, 0, "h") },
      { tokenHash: at(stieTokens, 2, "token").tokenHash, candidateId: at(h, 0, "h") },
      { tokenHash: at(stieTokens, 3, "token").tokenHash, candidateId: at(h, 2, "h") },
    ];
    let facultyCastsOk = true;
    for (const vote of remainingFacultyVotes) {
      if (!(await castFaculty(svc, vote.tokenHash, vote.candidateId))) {
        facultyCastsOk = false;
      }
    }
    const cleanFacultyVotes = await countVotes(svc, fixture.electionId, fixture.clean.id, "FACULTY");
    const ftieFacultyVotes = await countVotes(svc, fixture.electionId, fixture.ftie.id, "FACULTY");
    const stieFacultyVotes = await countVotes(svc, fixture.electionId, fixture.stie.id, "FACULTY");
    const zeroFacultyVotes = await countVotes(svc, fixture.electionId, fixture.zero.id, "FACULTY");
    check(
      "faculty voting: 13 votes across 3 departments; zero-vote department holds zero",
      facultyCastsOk &&
        cleanFacultyVotes === 4 &&
        ftieFacultyVotes === 5 &&
        stieFacultyVotes === 4 &&
        zeroFacultyVotes === 0,
    );
    void zeroTokens;

    check(
      "admin: faculty voting closes FACULTY_VOTING → FACULTY_RESULTS",
      await transitionGlobal(
        svc,
        fixture.electionId,
        "CLOSE_FACULTY_VOTING",
        "FACULTY_RESULTS",
      ),
    );

    // -- Stage-1 close: counting → Tie detection → freeze. --------------------
    const stageNow = await readStage(svc, fixture.electionId);
    const cleanCounts = await tallyStage1(svc, fixture.electionId, fixture.clean.id);
    const cleanCutoff = computeStage1Cutoff(cleanCounts);
    const cleanMarkers = await readMarkers(svc, fixture.electionId, fixture.clean.id);
    const cleanLock = applyLockFinalists({
      markers: toMarkersInput(fixture.electionId, fixture.clean.id, cleanMarkers),
      stage: stageNow,
      lockedAt: new Date().toISOString(),
    });
    let cleanFrozen = false;
    if (cleanCutoff.kind === "clean" && cleanLock.ok) {
      await persistFreeze(
        svc,
        fixture.electionId,
        fixture.clean.id,
        cleanCutoff.top3.map((entry) => ({
          facultyId: entry.candidateId,
          stage1Votes: entry.votes,
          rank: entry.rank,
        })),
        cleanLock.value.markers.finalistsLockedAt ?? new Date().toISOString(),
      );
      cleanFrozen =
        (await readMarkers(svc, fixture.electionId, fixture.clean.id))
          .finalistsLockedAt !== null;
    }
    check(
      "stage-1: clean department freezes Top-3 with sequential ranks",
      cleanCutoff.kind === "clean" &&
        cleanCutoff.top3.length === 3 &&
        cleanCutoff.top3.map((entry) => entry.rank).join(",") === "1,2,3" &&
        cleanFrozen,
    );

    const zeroCounts = await tallyStage1(svc, fixture.electionId, fixture.zero.id);
    const zeroCutoff = computeStage1Cutoff(zeroCounts);
    const zeroMarkers = await readMarkers(svc, fixture.electionId, fixture.zero.id);
    const zeroLock = applyLockFinalists({
      markers: toMarkersInput(fixture.electionId, fixture.zero.id, zeroMarkers),
      stage: stageNow,
      lockedAt: new Date().toISOString(),
    });
    let zeroFrozen = false;
    if (zeroCutoff.kind === "clean" && zeroLock.ok) {
      await persistFreeze(
        svc,
        fixture.electionId,
        fixture.zero.id,
        zeroCutoff.top3.map((entry) => ({
          facultyId: entry.candidateId,
          stage1Votes: entry.votes,
          rank: entry.rank,
        })),
        zeroLock.value.markers.finalistsLockedAt ?? new Date().toISOString(),
      );
      zeroFrozen =
        (await readMarkers(svc, fixture.electionId, fixture.zero.id))
          .finalistsLockedAt !== null;
    }
    check(
      "stage-1: zero-vote department freezes its short roster cleanly",
      zeroCutoff.kind === "clean" &&
        zeroCutoff.top3.length === 2 &&
        zeroCutoff.top3.every((entry) => entry.votes === 0) &&
        zeroFrozen,
    );

    const stieCounts = await tallyStage1(svc, fixture.electionId, fixture.stie.id);
    const stieCutoff = computeStage1Cutoff(stieCounts);
    const stieMarkers = await readMarkers(svc, fixture.electionId, fixture.stie.id);
    const stieLock = applyLockFinalists({
      markers: toMarkersInput(fixture.electionId, fixture.stie.id, stieMarkers),
      stage: stageNow,
      lockedAt: new Date().toISOString(),
    });
    if (stieCutoff.kind === "clean" && stieLock.ok) {
      await persistFreeze(
        svc,
        fixture.electionId,
        fixture.stie.id,
        stieCutoff.top3.map((entry) => ({
          facultyId: entry.candidateId,
          stage1Votes: entry.votes,
          rank: entry.rank,
        })),
        stieLock.value.markers.finalistsLockedAt ?? new Date().toISOString(),
      );
    }

    const ftieCounts = await tallyStage1(svc, fixture.electionId, fixture.ftie.id);
    const ftieCutoff = computeStage1Cutoff(ftieCounts);
    const ftieIsTie = ftieCutoff.kind === "tie";
    const ftieMarkersBefore = await readMarkers(svc, fixture.electionId, fixture.ftie.id);
    const ftieFlag = applyFlagTie({
      markers: toMarkersInput(fixture.electionId, fixture.ftie.id, ftieMarkersBefore),
      stage: stageNow,
    });
    if (ftieIsTie && ftieFlag.ok) {
      await persistTieFlag(svc, fixture.electionId, fixture.ftie.id);
    }
    const ftieMarkersTied = await readMarkers(svc, fixture.electionId, fixture.ftie.id);
    const lockWhileTied = applyLockFinalists({
      markers: toMarkersInput(fixture.electionId, fixture.ftie.id, ftieMarkersTied),
      stage: stageNow,
      lockedAt: new Date().toISOString(),
    });
    check(
      "stage-1: cutoff tie flags tie_pending; lock while tied is refused",
      ftieIsTie &&
        ftieCutoff.kind === "tie" &&
        ftieCutoff.seatsRemaining === 1 &&
        ftieMarkersTied.tiePending &&
        !lockWhileTied.ok &&
        lockWhileTied.error.code === "TIE_PENDING",
    );
    check(
      "stage-1: sibling departments stay frozen while the tied one holds (independence)",
      (await readMarkers(svc, fixture.electionId, fixture.clean.id))
        .finalistsLockedAt !== null &&
        (await readMarkers(svc, fixture.electionId, fixture.stie.id))
          .finalistsLockedAt !== null &&
        ftieMarkersTied.finalistsLockedAt === null,
    );

    // Manual Tie pick: exactly the seats remaining, from exactly the tied set.
    let ftieResolved = false;
    if (ftieCutoff.kind === "tie") {
      const tiedIds = ftieCutoff.tied.map((entry) => entry.candidateId);
      const lockedIds = new Set(
        ftieCutoff.lockedAbove.map((entry) => entry.candidateId),
      );
      const pick = ftieCutoff.tied
        .slice(0, ftieCutoff.seatsRemaining)
        .map((entry) => entry.candidateId);
      const pickValid =
        pick.length === ftieCutoff.seatsRemaining &&
        pick.every((id) => tiedIds.includes(id));
      const resolved = applyResolveTie({
        markers: toMarkersInput(fixture.electionId, fixture.ftie.id, ftieMarkersTied),
        stage: stageNow,
        pickedCandidateIds: pick,
      });
      const relocked = resolved.ok
        ? applyLockFinalists({
            markers: resolved.value.markers,
            stage: stageNow,
            lockedAt: new Date().toISOString(),
          })
        : null;
      if (pickValid && resolved.ok && relocked !== null && relocked.ok) {
        const pickedSet = new Set(pick);
        const combined = [
          ...ftieCutoff.lockedAbove,
          ...ftieCutoff.tied.filter((entry) => pickedSet.has(entry.candidateId)),
        ].sort((a, b) => {
          if (b.votes !== a.votes) {
            return b.votes - a.votes;
          }
          if (a.fullName !== b.fullName) {
            return a.fullName < b.fullName ? -1 : 1;
          }
          return a.candidateId < b.candidateId ? -1 : 1;
        });
        const pickedOutsideLocked = pick.every((id) => !lockedIds.has(id));
        await persistFreeze(
          svc,
          fixture.electionId,
          fixture.ftie.id,
          combined.map((entry, index) => ({
            facultyId: entry.candidateId,
            stage1Votes: entry.votes,
            rank: index + 1,
          })),
          relocked.value.markers.finalistsLockedAt ?? new Date().toISOString(),
        );
        const after = await readMarkers(svc, fixture.electionId, fixture.ftie.id);
        ftieResolved =
          pickedOutsideLocked &&
          combined.length === 3 &&
          !after.tiePending &&
          after.finalistsLockedAt !== null;
      }
    }
    check(
      "stage-1: manual pick from exactly the tied set freezes the Top-3",
      ftieResolved,
    );

    // -- Student Codes: exact quantities, then top-up without duplication. --
    const seenStudent = new Set<string>();
    async function mintStudent(
      dept: FixtureDept,
      quantity: number,
    ): Promise<{ tokenHash: string; display: string }[]> {
      const out: { tokenHash: string; display: string }[] = [];
      for (let i = 0; i < quantity; i += 1) {
        out.push(
          await mintToken(svc, {
            electionId: fixture.electionId,
            departmentId: dept.id,
            tokenType: "STUDENT",
            facultyId: null,
            pepper,
            seenHashes: seenStudent,
          }),
        );
      }
      return out;
    }
    const cleanStudent = await mintStudent(fixture.clean, 4);
    const cleanStudentBefore = await countTokens(
      svc,
      fixture.electionId,
      fixture.clean.id,
      "STUDENT",
    );
    // Top-up: two more Codes; prior rows untouched, hashes unique.
    cleanStudent.push(...(await mintStudent(fixture.clean, 2)));
    const cleanStudentAfter = await countTokens(
      svc,
      fixture.electionId,
      fixture.clean.id,
      "STUDENT",
    );
    const ftieStudent = await mintStudent(fixture.ftie, 3);
    const stieStudent = await mintStudent(fixture.stie, 4);
    const zeroStudent = await mintStudent(fixture.zero, 2);
    void zeroStudent;
    check(
      "student codes: exact quantities issued; top-up adds without touching prior rows; all unique",
      cleanStudentBefore === 4 &&
        cleanStudentAfter === 6 &&
        (await countTokens(svc, fixture.electionId, fixture.ftie.id, "STUDENT")) === 3 &&
        (await countTokens(svc, fixture.electionId, fixture.stie.id, "STUDENT")) === 4 &&
        (await countTokens(svc, fixture.electionId, fixture.zero.id, "STUDENT")) === 2 &&
        seenStudent.size === 15,
    );

    check(
      "admin: student voting opens FACULTY_RESULTS → STUDENT_VOTING",
      await transitionGlobal(
        svc,
        fixture.electionId,
        "OPEN_STUDENT_VOTING",
        "STUDENT_VOTING",
      ),
    );

    // -- Student flow: frozen Finalists → confirm → cast. --------------------
    const cleanFinalistIds = (await tallyStage2(svc, fixture.electionId, fixture.clean.id))
      .counts.map((entry) => entry.finalistId);
    const studentBallot = await resolveStudentBallotMirror(
      svc,
      at(cleanStudent, 0, "s-token").tokenHash,
    );
    const studentPick = at(cleanFinalistIds, 0, "clean finalist");
    check(
      "student flow: Code entry resolves the frozen Finalists for the Token department",
      studentBallot !== null &&
        studentBallot.departmentId === fixture.clean.id &&
        studentBallot.finalistIds.length === 3 &&
        studentBallot.finalistIds.every((id) => cleanFinalistIds.includes(id)),
    );
    const studentCastOk =
      studentBallot !== null &&
      studentBallot.finalistIds.includes(studentPick) &&
      (await castStudent(
        svc,
        at(cleanStudent, 0, "s-token").tokenHash,
        studentPick,
      ));
    check(
      "student flow: confirm then cast commits against the frozen snapshot",
      studentCastOk &&
        (await countVotes(svc, fixture.electionId, fixture.clean.id, "STUDENT")) === 1,
    );
    // Burn, replay, and cross-department Finalist rejection.
    const foreignFinalist = at(
      (await tallyStage2(svc, fixture.electionId, fixture.stie.id)).counts.map(
        (entry) => entry.finalistId,
      ),
      0,
      "foreign finalist",
    );
    const studentReplay = await castStudent(
      svc,
      at(cleanStudent, 0, "s-token").tokenHash,
      studentPick,
    );
    const crossDept = await castStudent(
      svc,
      at(cleanStudent, 1, "s-token").tokenHash,
      foreignFinalist,
    );
    const crossRejected =
      !crossDept &&
      (await countVotes(svc, fixture.electionId, fixture.clean.id, "STUDENT")) === 1;
    check(
      "student flow: Token burned; replay and cross-department Finalist rejected",
      (await tokenUsed(svc, at(cleanStudent, 0, "s-token").tokenHash)) &&
        !studentReplay &&
        crossRejected,
    );

    // -- Remaining student votes per the engineered plan. --------------------
    // CLEAN: C0=3 C1=1 C2=0 → clean Winner.
    // FTIE: G0=2 G1=1 G2=0 → clean Winner.
    // STIE: H0=2 H1=2 H2=0 → Winner Tie (2 tied at the top).
    // ZERO casts nothing → Winner Tie at zero (2 tied at 0).
    const ftieFinalists = (
      await tallyStage2(svc, fixture.electionId, fixture.ftie.id)
    ).counts.map((entry) => entry.finalistId);
    const stieFinalists = (
      await tallyStage2(svc, fixture.electionId, fixture.stie.id)
    ).counts.map((entry) => entry.finalistId);
    const remainingStudentVotes: Array<{ tokenHash: string; candidateId: string }> = [
      { tokenHash: at(cleanStudent, 1, "s-token").tokenHash, candidateId: at(cleanFinalistIds, 0, "cf") },
      { tokenHash: at(cleanStudent, 2, "s-token").tokenHash, candidateId: at(cleanFinalistIds, 0, "cf") },
      { tokenHash: at(cleanStudent, 3, "s-token").tokenHash, candidateId: at(cleanFinalistIds, 1, "cf") },
      { tokenHash: at(ftieStudent, 0, "s-token").tokenHash, candidateId: at(ftieFinalists, 0, "ff") },
      { tokenHash: at(ftieStudent, 1, "s-token").tokenHash, candidateId: at(ftieFinalists, 0, "ff") },
      { tokenHash: at(ftieStudent, 2, "s-token").tokenHash, candidateId: at(ftieFinalists, 1, "ff") },
      { tokenHash: at(stieStudent, 0, "s-token").tokenHash, candidateId: at(stieFinalists, 0, "sf") },
      { tokenHash: at(stieStudent, 1, "s-token").tokenHash, candidateId: at(stieFinalists, 0, "sf") },
      { tokenHash: at(stieStudent, 2, "s-token").tokenHash, candidateId: at(stieFinalists, 1, "sf") },
      { tokenHash: at(stieStudent, 3, "s-token").tokenHash, candidateId: at(stieFinalists, 1, "sf") },
    ];
    let studentCastsOk = true;
    for (const vote of remainingStudentVotes) {
      if (!(await castStudent(svc, vote.tokenHash, vote.candidateId))) {
        studentCastsOk = false;
      }
    }
    check(
      "student voting: 11 votes across 3 departments; zero-vote department holds zero",
      studentCastsOk &&
        (await countVotes(svc, fixture.electionId, fixture.clean.id, "STUDENT")) === 4 &&
        (await countVotes(svc, fixture.electionId, fixture.ftie.id, "STUDENT")) === 3 &&
        (await countVotes(svc, fixture.electionId, fixture.stie.id, "STUDENT")) === 4 &&
        (await countVotes(svc, fixture.electionId, fixture.zero.id, "STUDENT")) === 0,
    );

    // -- Guarded re-open while STUDENT_VOTING. --------------------------------
    const studentStage = await readStage(svc, fixture.electionId);
    const cleanMarkersNow = await readMarkers(svc, fixture.electionId, fixture.clean.id);
    const cleanStudentVotes = await countVotes(
      svc,
      fixture.electionId,
      fixture.clean.id,
      "STUDENT",
    );
    const reopenBlocked = applyReopenStage1({
      markers: toMarkersInput(fixture.electionId, fixture.clean.id, cleanMarkersNow),
      stage: studentStage,
      dependentStudentVotes: cleanStudentVotes,
    });
    const zeroMarkersNow = await readMarkers(svc, fixture.electionId, fixture.zero.id);
    const zeroStudentVotes = await countVotes(
      svc,
      fixture.electionId,
      fixture.zero.id,
      "STUDENT",
    );
    const reopenAllowed = applyReopenStage1({
      markers: toMarkersInput(fixture.electionId, fixture.zero.id, zeroMarkersNow),
      stage: studentStage,
      dependentStudentVotes: zeroStudentVotes,
    });
    let reopenRoundTrip = false;
    if (
      !reopenBlocked.ok &&
      reopenBlocked.error.code === "REOPEN_BLOCKED_BY_DEPENDENT_VOTES" &&
      reopenAllowed.ok
    ) {
      // Persist the allowed re-open exactly as the action does: drop the
      // snapshot, clear the lock. Votes are never deleted.
      const facultyVotesBefore = await countVotes(
        svc,
        fixture.electionId,
        fixture.zero.id,
        "FACULTY",
      );
      const { error: dropError } = await svc
        .from("finalists")
        .delete()
        .eq("election_id", fixture.electionId)
        .eq("department_id", fixture.zero.id);
      if (dropError !== null) {
        throw new Error("Re-open snapshot drop failed.");
      }
      const { error: unlockError } = await svc
        .from("election_departments")
        .update({ finalists_locked_at: null })
        .eq("election_id", fixture.electionId)
        .eq("department_id", fixture.zero.id);
      if (unlockError !== null) {
        throw new Error("Re-open unlock failed.");
      }
      const unfreezed = await readMarkers(svc, fixture.electionId, fixture.zero.id);
      // A fresh freeze is required: recompute from the kept votes.
      const refreezeCounts = await tallyStage1(
        svc,
        fixture.electionId,
        fixture.zero.id,
      );
      const refreezeCutoff = computeStage1Cutoff(refreezeCounts);
      const relock =
        refreezeCutoff.kind === "clean"
          ? applyLockFinalists({
              markers: toMarkersInput(
                fixture.electionId,
                fixture.zero.id,
                unfreezed,
              ),
              stage: studentStage,
              lockedAt: new Date().toISOString(),
            })
          : null;
      if (relock !== null && relock.ok && refreezeCutoff.kind === "clean") {
        await persistFreeze(
          svc,
          fixture.electionId,
          fixture.zero.id,
          refreezeCutoff.top3.map((entry) => ({
            facultyId: entry.candidateId,
            stage1Votes: entry.votes,
            rank: entry.rank,
          })),
          relock.value.markers.finalistsLockedAt ?? new Date().toISOString(),
        );
        const refrozen = await readMarkers(
          svc,
          fixture.electionId,
          fixture.zero.id,
        );
        const facultyVotesAfter = await countVotes(
          svc,
          fixture.electionId,
          fixture.zero.id,
          "FACULTY",
        );
        reopenRoundTrip =
          unfreezed.finalistsLockedAt === null &&
          refrozen.finalistsLockedAt !== null &&
          facultyVotesBefore === 0 &&
          facultyVotesAfter === 0;
      }
    }
    check(
      "re-open: blocked with dependent student votes; allowed with zero (votes kept, snapshot refrozen)",
      reopenRoundTrip,
    );

    check(
      "admin: student voting closes STUDENT_VOTING → FINAL_RESULTS",
      await transitionGlobal(
        svc,
        fixture.electionId,
        "CLOSE_STUDENT_VOTING",
        "FINAL_RESULTS",
      ),
    );

    // -- Stage-2 close: Winner detection → publish. ---------------------------
    const finalStage = await readStage(svc, fixture.electionId);
    async function publishCleanWinner(
      dept: FixtureDept,
    ): Promise<{ published: boolean; winnerId: string | null }> {
      const tally = await tallyStage2(svc, fixture.electionId, dept.id);
      const result = computeStage2Winner(tally.counts);
      if (result.kind !== "clean" || result.winner === null) {
        return { published: false, winnerId: null };
      }
      const markers = await readMarkers(svc, fixture.electionId, dept.id);
      const publishable = applyPublishWinner({
        markers: toMarkersInput(fixture.electionId, dept.id, markers),
        stage: finalStage,
        publishedAt: new Date().toISOString(),
        policyVersion: frozenPolicy,
      });
      if (!publishable.ok) {
        return { published: false, winnerId: null };
      }
      await persistPublish(
        svc,
        fixture.electionId,
        dept.id,
        result.winner.finalistId,
        true,
        frozenPolicy,
        publishable.value.markers.winnerPublishedAt,
      );
      const winner = await readWinner(svc, fixture.electionId, dept.id);
      return {
        published:
          winner !== null &&
          winner.published &&
          winner.winnerFacultyId === result.winner.finalistId,
        winnerId: result.winner.finalistId,
      };
    }
    const cleanPublish = await publishCleanWinner(fixture.clean);
    const ftiePublish = await publishCleanWinner(fixture.ftie);
    check(
      "stage-2: clean winners publish per department with the policy version",
      cleanPublish.published &&
        ftiePublish.published &&
        cleanPublish.winnerId === at(cleanFinalistIds, 0, "cf") &&
        ftiePublish.winnerId === at(ftieFinalists, 0, "ff"),
    );

    const stieTally = await tallyStage2(svc, fixture.electionId, fixture.stie.id);
    const stieWinner = computeStage2Winner(stieTally.counts);
    const stieIsTie = stieWinner.kind === "tie";
    const stieMarkersBefore = await readMarkers(
      svc,
      fixture.electionId,
      fixture.stie.id,
    );
    const stieFlag = applyFlagTie({
      markers: toMarkersInput(fixture.electionId, fixture.stie.id, stieMarkersBefore),
      stage: finalStage,
    });
    if (stieIsTie && stieFlag.ok) {
      await persistTieFlag(svc, fixture.electionId, fixture.stie.id);
    }
    const stieMarkersTied = await readMarkers(
      svc,
      fixture.electionId,
      fixture.stie.id,
    );
    const publishWhileTied = applyPublishWinner({
      markers: toMarkersInput(fixture.electionId, fixture.stie.id, stieMarkersTied),
      stage: finalStage,
      publishedAt: new Date().toISOString(),
      policyVersion: frozenPolicy,
    });
    check(
      "stage-2: winner tie flags; publish while tied is refused",
      stieIsTie &&
        stieWinner.kind === "tie" &&
        stieMarkersTied.tiePending &&
        !publishWhileTied.ok &&
        publishWhileTied.error.code === "TIE_PENDING",
    );

    // Manual Winner pick: exactly one of the tied Finalists. The admin
    // deliberately picks the second finalist to prove the choice is honored.
    let stieResolved = false;
    if (stieWinner.kind === "tie") {
      const tiedIds = stieWinner.tied.map((entry) => entry.finalistId);
      const pick = at(stieFinalists, 1, "sf");
      const resolved = applyResolveTie({
        markers: toMarkersInput(fixture.electionId, fixture.stie.id, stieMarkersTied),
        stage: finalStage,
        pickedCandidateIds: [pick],
      });
      if (resolved.ok && tiedIds.includes(pick)) {
        await persistPublish(
          svc,
          fixture.electionId,
          fixture.stie.id,
          pick,
          false,
          frozenPolicy,
          null,
        );
        const staged = await readWinner(svc, fixture.electionId, fixture.stie.id);
        const cleared = await readMarkers(
          svc,
          fixture.electionId,
          fixture.stie.id,
        );
        const publishable = applyPublishWinner({
          markers: toMarkersInput(fixture.electionId, fixture.stie.id, cleared),
          stage: finalStage,
          publishedAt: new Date().toISOString(),
          policyVersion: frozenPolicy,
        });
        if (
          staged !== null &&
          !staged.published &&
          staged.winnerFacultyId === pick &&
          !cleared.tiePending &&
          publishable.ok
        ) {
          await persistPublish(
            svc,
            fixture.electionId,
            fixture.stie.id,
            pick,
            true,
            frozenPolicy,
            publishable.value.markers.winnerPublishedAt,
          );
          const winner = await readWinner(
            svc,
            fixture.electionId,
            fixture.stie.id,
          );
          stieResolved =
            winner !== null &&
            winner.published &&
            winner.winnerFacultyId === pick;
        }
      }
    }
    check(
      "stage-2: manual pick of one tied Finalist stages then publishes the Winner",
      stieResolved,
    );

    // Zero-vote department: two Finalists at zero → Winner Tie → holds.
    const zeroTally = await tallyStage2(svc, fixture.electionId, fixture.zero.id);
    const zeroWinner = computeStage2Winner(zeroTally.counts);
    const zeroIsTie = zeroWinner.kind === "tie";
    if (zeroIsTie) {
      const markers = await readMarkers(svc, fixture.electionId, fixture.zero.id);
      const flagged = applyFlagTie({
        markers: toMarkersInput(fixture.electionId, fixture.zero.id, markers),
        stage: finalStage,
      });
      if (flagged.ok) {
        await persistTieFlag(svc, fixture.electionId, fixture.zero.id);
      }
    }
    const zeroMarkersEnd = await readMarkers(
      svc,
      fixture.electionId,
      fixture.zero.id,
    );
    const cleanMarkersEnd = await readMarkers(
      svc,
      fixture.electionId,
      fixture.clean.id,
    );
    const stieMarkersEnd = await readMarkers(
      svc,
      fixture.electionId,
      fixture.stie.id,
    );
    check(
      "stage-2: zero-vote department holds tie-blocked while siblings publish (independence)",
      zeroIsTie &&
        zeroTally.ignoredVotes === 0 &&
        zeroMarkersEnd.tiePending &&
        zeroMarkersEnd.winnerPublishedAt === null &&
        cleanMarkersEnd.winnerPublishedAt !== null &&
        stieMarkersEnd.winnerPublishedAt !== null,
    );

    // Published results surface Winners from the published records only.
    const publishedWinners: Array<{ deptId: string; winnerId: string }> = [];
    for (const dept of [fixture.clean, fixture.ftie, fixture.stie]) {
      const winner = await readWinner(svc, fixture.electionId, dept.id);
      if (winner !== null && winner.published) {
        publishedWinners.push({ deptId: dept.id, winnerId: winner.winnerFacultyId });
      }
    }
    const { data: publishedRows } = await svc
      .from("election_results")
      .select("winner_faculty_id, published, policy_version")
      .eq("election_id", fixture.electionId)
      .eq("published", true);
    const publishedParsed = resultRowSchema.array().safeParse(publishedRows ?? []);
    check(
      "published results expose Winners from election_results + finalists only",
      publishedWinners.length === 3 && publishedParsed.success && publishedParsed.data.length === 3,
    );

    check(
      "admin: election closes FINAL_RESULTS → CLOSED",
      await transitionGlobal(svc, fixture.electionId, "CLOSE_ELECTION", "CLOSED"),
    );

    // -- Closed-election guardrails. ------------------------------------------
    const closedFacultyToken = at(zeroTokens, 0, "z-token").tokenHash;
    const unusedStudentToken = at(cleanStudent, 4, "s-token").tokenHash;
    const facultyVotesBeforeClose = await countVotes(
      svc,
      fixture.electionId,
      null,
      "FACULTY",
    );
    const studentVotesBeforeClose = await countVotes(
      svc,
      fixture.electionId,
      null,
      "STUDENT",
    );
    const closedFacultyVote = await castFaculty(
      svc,
      closedFacultyToken,
      at(fixture.zero.facultyIds, 1, "z-candidate"),
    );
    const closedStudentVote = await castStudent(
      svc,
      unusedStudentToken,
      at(cleanFinalistIds, 0, "cf"),
    );
    const closedLock = applyLockFinalists({
      markers: {
        electionId: fixture.electionId,
        departmentId: fixture.clean.id,
        finalistsLockedAt: null,
        winnerPublishedAt: null,
        tiePending: false,
      },
      stage: "CLOSED",
      lockedAt: new Date().toISOString(),
    });
    const closedReopen = applyReopenStage1({
      markers: toMarkersInput(
        fixture.electionId,
        fixture.clean.id,
        cleanMarkersEnd,
      ),
      stage: "CLOSED",
      dependentStudentVotes: 0,
    });
    check(
      "closed: faculty and student votes rejected; lock and re-open refused",
      !closedFacultyVote &&
        !closedStudentVote &&
        isUniformRejection({ code: UNIFORM_CODE, message: UNIFORM_MESSAGE }) &&
        (await countVotes(svc, fixture.electionId, null, "FACULTY")) ===
          facultyVotesBeforeClose &&
        (await countVotes(svc, fixture.electionId, null, "STUDENT")) ===
          studentVotesBeforeClose &&
        !closedLock.ok &&
        closedLock.error.code === "ELECTION_CLOSED" &&
        !closedReopen.ok &&
        closedReopen.error.code === "ELECTION_CLOSED",
    );
  } finally {
    await cleanupFixture(svc, electionId);
  }

  // -- Zero-leftover verification (scoped to this run). -----------------------
  const tagTables: Array<{ table: string; column: string; filter: string }> = [
    { table: "votes", column: "id", filter: "election_id" },
    { table: "finalists", column: "id", filter: "election_id" },
    { table: "election_results", column: "election_id", filter: "election_id" },
    { table: "voting_tokens", column: "id", filter: "election_id" },
    { table: "election_departments", column: "election_id", filter: "election_id" },
    { table: "audit_logs", column: "id", filter: "election_id" },
  ];
  let leftoverTotal = 0;
  for (const target of tagTables) {
    leftoverTotal += await scopedCount(
      svc,
      target.table,
      target.column,
      target.filter,
      electionId ?? "00000000-0000-4000-8000-000000000000",
      false,
    );
  }
  leftoverTotal += await scopedCount(
    svc,
    "faculty",
    "id",
    "full_name",
    `${PREFIX}%`,
    true,
  );
  leftoverTotal += await scopedCount(
    svc,
    "departments",
    "id",
    "code",
    `${PREFIX}%`,
    true,
  );
  leftoverTotal += await scopedCount(
    svc,
    "elections",
    "id",
    "name",
    `${PREFIX}%`,
    true,
  );
  check("cleanup removed every throwaway row", leftoverTotal === 0);

  console.log(`\nE2E suite: ${passed} passed, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log(`Failures: ${failures.join("; ")}`);
    process.exitCode = 1;
  }
}

await main();
