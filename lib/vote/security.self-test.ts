/**
 * Security test suite — spec §14 task 18 (security model §8, testing §15).
 *
 * Run headless: `node_modules/.bin/jiti lib/vote/security.self-test.ts`
 *             or `npm run test:security`
 *
 * Attacks below the UI, against the exact guarantees in
 * `db/migrations/004_cast_vote.sql` and `005_cast_student_vote.sql`:
 * forged department / candidate / stage / token-type values at every vote
 * entry point; token replay and double submission; concurrent duplicate
 * submits racing one token; cross-department Codes voting outside their
 * department; votes after stage close and before stage open; direct calls
 * to `cast_vote` / `cast_student_vote` with wrong-type tokens; anon and
 * authenticated (non-admin) roles attempting reads, writes, and function
 * execution.
 *
 * Entry points covered: the five server actions in `lib/vote/actions.ts`
 * (`resolveFacultyBallot`, `castFacultyVote`, `resolveStudentBallot`,
 * `castStudentVote`, `resolveVoteBallot`) via source-shape assertions that
 * they accept no department/stage/type input and delegate to the
 * correctly-typed transaction — plus live attacks on the two database
 * transactions those actions call.
 *
 * Glossary (GLOSSARY.md) is used exactly: Token is the single-use
 * credential; Code is its human-readable form; Candidate is a faculty
 * member eligible to receive votes; Finalist is a Candidate advanced as
 * one of a department's Top-3; Winner is a Finalist selected as honoree;
 * Election is one running of the vote.
 *
 * Hygiene (enforced, not promised): every row this suite writes carries
 * the `T18SEC` throwaway prefix (text fields) or hangs off a
 * `T18SEC`-named Election; cleanup runs in `finally` so success AND
 * failure leave zero leftover rows. Secrets and raw Codes never enter the
 * repo: Codes are generated at runtime only, only their hashes reach the
 * database, and the suite prints no Codes, hashes, peppers, or keys —
 * only PASS/FAIL lines, counts, stage names, and Postgres error codes.
 */

import { createHash, randomBytes, randomInt } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  CODE_ALPHABET,
  CODE_LETTER_COUNT,
} from "../faculty/code-format.js";

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
    if (
      value.length >= 2 &&
      value.startsWith('"') &&
      value.endsWith('"')
    ) {
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
// Error-shape helpers (uniform vs grant-level denial, without any).
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

function isGrantDenial(error: unknown): boolean {
  return (
    error !== null &&
    errCodeOf(error) === "42501" &&
    errMessageOf(error).includes("permission denied") &&
    errMessageOf(error) !== UNIFORM_MESSAGE
  );
}

// ---------------------------------------------------------------------------
// Row schemas (Zod-inferred, precise — no any).
// ---------------------------------------------------------------------------

const idSchema = z.object({ id: z.uuid() });
const deptSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
});
const facultySchema = z.object({ id: z.uuid(), full_name: z.string() });
const tokenHashSchema = z.object({ token_hash: z.string() });
const tokenUsedSchema = z.object({ used: z.boolean() });
const castOkSchema = z.array(
  z.object({ election_id: z.uuid(), department_id: z.uuid() }),
);
const voteRowSchema = z.object({
  department_id: z.uuid(),
  stage: z.string(),
  candidate_faculty_id: z.uuid(),
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

const PREFIX = "T18SEC";

function runId(): string {
  return randomBytes(4).toString("hex");
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Fresh random token hash for `SHA-256(pepper + letters)` (spec §6). */
function freshTokenHash(pepper: string): string {
  let letters = "";
  for (let i = 0; i < CODE_LETTER_COUNT; i += 1) {
    const draw = CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    if (draw === undefined) {
      throw new Error("Code alphabet draw out of range.");
    }
    letters += draw;
  }
  return sha256Hex(pepper + letters);
}

interface Fixture {
  electionId: string;
  deptAId: string;
  deptBId: string;
  ccsFacultyIds: string[];
  coedFacultyIds: string[];
  archivedFacultyId: string;
  ccsFinalistIds: string[];
  coedFinalistIds: string[];
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

async function buildFixture(
  svc: ServiceDb,
  tag: string,
): Promise<Fixture> {
  const election = await insertOne(
    svc,
    "elections",
    {
      name: `${PREFIX} Election ${tag}`,
      academic_year: `${PREFIX}-${tag}`,
      stage: "FACULTY_VOTING",
      tie_policy_text: `${PREFIX} tie policy ${tag}`,
    },
    idSchema,
  );
  const electionId = election["id"] ?? "";
  if (electionId === "") {
    throw new Error("Fixture election has no id.");
  }

  const deptA = await insertOne(
    svc,
    "departments",
    { code: `${PREFIX}-A-${tag}`, name: `${PREFIX} Department Alpha ${tag}` },
    deptSchema,
  );
  const deptB = await insertOne(
    svc,
    "departments",
    { code: `${PREFIX}-B-${tag}`, name: `${PREFIX} Department Beta ${tag}` },
    deptSchema,
  );
  const deptAId = deptA["id"] ?? "";
  const deptBId = deptB["id"] ?? "";
  if (deptAId === "" || deptBId === "") {
    throw new Error("Fixture departments have no ids.");
  }

  for (const departmentId of [deptAId, deptBId]) {
    const { error } = await svc
      .from("election_departments")
      .insert({ election_id: electionId, department_id: departmentId });
    if (error !== null) {
      throw new Error("Fixture election_departments insert failed.");
    }
  }

  const ccsFacultyIds: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    const row = await insertOne(
      svc,
      "faculty",
      {
        department_id: deptAId,
        full_name: `${PREFIX} Alpha Faculty ${i} ${tag}`,
      },
      facultySchema,
    );
    const id = row["id"] ?? "";
    if (id === "") {
      throw new Error("Fixture faculty row has no id.");
    }
    ccsFacultyIds.push(id);
  }
  const coedFacultyIds: string[] = [];
  for (let i = 0; i < 6; i += 1) {
    const row = await insertOne(
      svc,
      "faculty",
      {
        department_id: deptBId,
        full_name: `${PREFIX} Beta Faculty ${i} ${tag}`,
      },
      facultySchema,
    );
    const id = row["id"] ?? "";
    if (id === "") {
      throw new Error("Fixture faculty row has no id.");
    }
    coedFacultyIds.push(id);
  }
  const archived = await insertOne(
    svc,
    "faculty",
    {
      department_id: deptAId,
      full_name: `${PREFIX} Archived Faculty ${tag}`,
    },
    facultySchema,
  );
  const archivedFacultyId = archived["id"] ?? "";
  if (archivedFacultyId === "") {
    throw new Error("Fixture archived faculty row has no id.");
  }
  const { error: archiveError } = await svc
    .from("faculty")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", archivedFacultyId);
  if (archiveError !== null) {
    throw new Error("Fixture archive update failed.");
  }

  // Frozen Top-3 snapshots for the student battery (spec §12).
  const ccsFinalistIds = ccsFacultyIds.slice(10, 13);
  const coedFinalistIds = coedFacultyIds.slice(0, 3);
  if (ccsFinalistIds.length !== 3 || coedFinalistIds.length !== 3) {
    throw new Error("Fixture faculty pool too small for finalists.");
  }
  let rank = 1;
  for (const facultyId of ccsFinalistIds) {
    const { error } = await svc.from("finalists").insert({
      election_id: electionId,
      department_id: deptAId,
      faculty_id: facultyId,
      stage1_votes: 10 - rank,
      rank,
    });
    if (error !== null) {
      throw new Error("Fixture finalists insert failed.");
    }
    rank += 1;
  }
  rank = 1;
  for (const facultyId of coedFinalistIds) {
    const { error } = await svc.from("finalists").insert({
      election_id: electionId,
      department_id: deptBId,
      faculty_id: facultyId,
      stage1_votes: 7 - rank,
      rank,
    });
    if (error !== null) {
      throw new Error("Fixture finalists insert failed.");
    }
    rank += 1;
  }

  return {
    electionId,
    deptAId,
    deptBId,
    ccsFacultyIds,
    coedFacultyIds,
    archivedFacultyId,
    ccsFinalistIds,
    coedFinalistIds,
  };
}

async function mintToken(
  svc: ServiceDb,
  input: {
    electionId: string;
    departmentId: string;
    tokenType: "FACULTY" | "STUDENT";
    facultyId: string | null;
    pepper: string;
  },
): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const tokenHash = freshTokenHash(input.pepper);
    const { data, error } = await svc
      .from("voting_tokens")
      .insert({
        election_id: input.electionId,
        department_id: input.departmentId,
        token_hash: tokenHash,
        token_type: input.tokenType,
        faculty_id: input.facultyId,
      })
      .select("token_hash")
      .single();
    if (error === null) {
      const parsed = tokenHashSchema.safeParse(data);
      if (parsed.success) {
        return parsed.data.token_hash;
      }
    }
  }
  throw new Error("Could not mint a fresh throwaway token.");
}

async function setStage(
  svc: ServiceDb,
  electionId: string,
  stage: string,
): Promise<void> {
  const { error } = await svc
    .from("elections")
    .update({ stage })
    .eq("id", electionId);
  if (error !== null) {
    throw new Error(`Could not move the throwaway election to ${stage}.`);
  }
}

async function countVotes(
  svc: ServiceDb,
  electionId: string,
  stage?: string,
): Promise<number> {
  let query = svc
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("election_id", electionId);
  if (stage !== undefined) {
    query = query.eq("stage", stage);
  }
  const { count, error } = await query;
  if (error !== null) {
    throw new Error("Vote counting query failed.");
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
// Cleanup: zero leftover rows on success or failure.
// ---------------------------------------------------------------------------

async function cleanupFixture(
  svc: ServiceDb,
  electionId: string | null,
  probeCode: string | null,
  authUserId: string | null,
): Promise<void> {
  if (authUserId !== null) {
    await svc.auth.admin.deleteUser(authUserId);
  }
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
  if (probeCode !== null) {
    await svc.from("departments").delete().eq("code", probeCode);
    await svc.from("votes").delete().eq("election_id", probeCode);
  }
}

async function leftoverCount(
  svc: ServiceDb,
  table: string,
  column: string,
  pattern: string,
): Promise<number> {
  const { count, error } = await svc
    .from(table)
    .select(column, { count: "exact", head: true })
    .like(column, pattern);
  if (error !== null) {
    throw new Error(`Leftover check on ${table} failed.`);
  }
  return count ?? 0;
}

// ---------------------------------------------------------------------------
// Source-shape assertions: entry points accept no forged channel.
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
  const anonKey =
    optionalEnv([
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    ]) ?? requiredEnv("MISSING_ANON_KEY");
  const pepper = requiredEnv("VOTING_TOKEN_PEPPER");

  const svc = createDbClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createDbClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // -- Entry-point surface (no forged channel exists to abuse). ------------
  const actions = readSource("lib/vote/actions.ts");
  const schemas = readSource("lib/vote/schemas.ts");
  const migration004 = readSource("db/migrations/004_cast_vote.sql");
  const migration005 = readSource("db/migrations/005_cast_student_vote.sql");

  check(
    "entry signatures accept only the Code (+candidate) — no department/stage/type params",
    actions.includes(
      "export async function resolveFacultyBallot(\n  code: string,\n  clientIp?: string,",
    ) &&
      actions.includes(
        "export async function resolveStudentBallot(\n  code: string,\n  clientIp?: string,",
      ) &&
      actions.includes(
        "export async function resolveVoteBallot(\n  code: string,\n  clientIp?: string,",
      ) &&
      actions.includes(
        "export async function castFacultyVote(\n  code: string,\n  candidateId: string,\n  clientIp?: string,",
      ) &&
      actions.includes(
        "export async function castStudentVote(\n  code: string,\n  candidateId: string,\n  clientIp?: string,",
      ),
  );

  const facultyCastBody = functionBody(actions, "castFacultyVote");
  const studentCastBody = functionBody(actions, "castStudentVote");
  check(
    "faculty cast path calls only cast_vote with (hash, candidate)",
    facultyCastBody.includes('rpc("cast_vote"') &&
      facultyCastBody.includes("p_token_hash: tokenHash") &&
      facultyCastBody.includes("p_candidate_id: parsedCandidate.data") &&
      !facultyCastBody.includes("cast_student_vote"),
  );
  check(
    "student cast path calls only cast_student_vote with (hash, candidate)",
    studentCastBody.includes('rpc("cast_student_vote"') &&
      studentCastBody.includes("p_token_hash: tokenHash") &&
      studentCastBody.includes("p_candidate_id: parsedCandidate.data") &&
      !studentCastBody.includes('rpc("cast_vote"'),
  );

  const entryBodies = [
    functionBody(actions, "resolveFacultyBallot"),
    facultyCastBody,
    functionBody(actions, "resolveStudentBallot"),
    studentCastBody,
    functionBody(actions, "resolveVoteBallot"),
  ];
  check(
    "no forged channel: no entry forwards department/stage/type params",
    entryBodies.every(
      (body) =>
        !body.includes("p_department") &&
        !body.includes("p_stage") &&
        !body.includes("p_token_type"),
    ),
  );

  check(
    "all five entries gate before any token validation",
    entryBodies.every((body) => {
      const gateIndex = body.indexOf("checkVoteGate");
      if (gateIndex === -1) {
        return false;
      }
      const markers = [
        'from("voting_tokens")',
        'rpc("cast_vote"',
        'rpc("cast_student_vote"',
      ];
      let sawDb = false;
      for (const marker of markers) {
        const dbIndex = body.indexOf(marker);
        if (dbIndex !== -1) {
          sawDb = true;
          if (gateIndex > dbIndex) {
            return false;
          }
        }
      }
      return sawDb;
    }),
  );

  check(
    "DB transactions take only (hash, candidate); department is token-derived",
    migration004.includes(
      "CREATE OR REPLACE FUNCTION public.cast_vote(\n  p_token_hash text,\n  p_candidate_id uuid\n)",
    ) &&
      migration005.includes(
        "CREATE OR REPLACE FUNCTION public.cast_student_vote(\n  p_token_hash text,\n  p_candidate_id uuid\n)",
      ) &&
      !migration004.includes("p_department") &&
      !migration004.includes("p_stage") &&
      !migration004.includes("p_token_type") &&
      !migration005.includes("p_department") &&
      !migration005.includes("p_stage") &&
      !migration005.includes("p_token_type"),
  );

  check(
    "transactions lock, reject uniformly, and grant execute to service_role only",
    migration004.includes("FOR UPDATE") &&
      migration005.includes("FOR UPDATE") &&
      migration004.includes("RAISE EXCEPTION 'vote rejected'") &&
      migration005.includes("RAISE EXCEPTION 'vote rejected'") &&
      migration004.includes(
        "GRANT EXECUTE ON FUNCTION public.cast_vote(text, uuid) TO service_role",
      ) &&
      migration005.includes(
        "GRANT EXECUTE ON FUNCTION public.cast_student_vote(text, uuid) TO service_role",
      ) &&
      migration004.includes("FROM anon, authenticated") &&
      migration005.includes("FROM anon, authenticated"),
  );

  check(
    "uniform public error string is pinned",
    schemas.includes(
      'VOTE_UNIFORM_ERROR = "Invalid or unusable voting code."',
    ),
  );

  // -- Throwaway fixture. -------------------------------------------------
  const tag = runId();
  const probeCode = `${PREFIX}-PROBE-${tag}`;
  let electionId: string | null = null;
  let authUserId: string | null = null;
  try {
    const fixture = await buildFixture(svc, tag);
    electionId = fixture.electionId;
    const facultyAt = (index: number): string => {
      const id = fixture.ccsFacultyIds[index];
      if (id === undefined) {
        throw new Error("Faculty pool index out of range.");
      }
      return id;
    };

    // -- Faculty battery (election in FACULTY_VOTING). --------------------
    await setStage(svc, fixture.electionId, "FACULTY_VOTING");

    const controlHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(0),
      pepper,
    });
    const controlCandidate = facultyAt(1);
    const control = await svc.rpc("cast_vote", {
      p_token_hash: controlHash,
      p_candidate_id: controlCandidate,
    });
    let controlVoteOk = control.error === null;
    if (controlVoteOk) {
      const rows = castOkSchema.safeParse(control.data);
      controlVoteOk =
        rows.success &&
        rows.data.length === 1 &&
        (rows.data[0]?.election_id ?? "") === fixture.electionId &&
        (rows.data[0]?.department_id ?? "") === fixture.deptAId;
    }
    const { data: controlVote } = await svc
      .from("votes")
      .select("department_id, stage, candidate_faculty_id")
      .eq("election_id", fixture.electionId)
      .eq("stage", "FACULTY")
      .limit(1)
      .maybeSingle();
    const controlRow = voteRowSchema.safeParse(controlVote);
    check(
      "faculty control: valid vote commits with server-derived department + stage",
      controlVoteOk &&
        controlRow.success &&
        controlRow.data.department_id === fixture.deptAId &&
        controlRow.data.stage === "FACULTY" &&
        controlRow.data.candidate_faculty_id === controlCandidate &&
        (await tokenUsed(svc, controlHash)) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const forgeBase = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(2),
      pepper,
    });
    const forgedDept = await svc.rpc("cast_vote", {
      p_token_hash: forgeBase,
      p_candidate_id: facultyAt(3),
      p_department_id: fixture.deptBId,
    });
    check(
      "forged department smuggled into cast_vote is rejected",
      forgedDept.error !== null &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const forgedStage = await svc.rpc("cast_vote", {
      p_token_hash: forgeBase,
      p_candidate_id: facultyAt(3),
      p_stage: "STUDENT",
    });
    check(
      "forged stage smuggled into cast_vote is rejected",
      forgedStage.error !== null &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const forgedType = await svc.rpc("cast_vote", {
      p_token_hash: forgeBase,
      p_candidate_id: facultyAt(3),
      p_token_type: "STUDENT",
    });
    check(
      "forged token-type smuggled into cast_vote is rejected",
      forgedType.error !== null &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const crossDeptCandidate = fixture.coedFacultyIds[3] ?? "";
    const crossHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(4),
      pepper,
    });
    const cross = await svc.rpc("cast_vote", {
      p_token_hash: crossHash,
      p_candidate_id: crossDeptCandidate,
    });
    check(
      "cross-department candidate (dept-A Code, dept-B faculty) is rejected",
      isUniformRejection(cross.error) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const selfHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(5),
      pepper,
    });
    const selfVote = await svc.rpc("cast_vote", {
      p_token_hash: selfHash,
      p_candidate_id: facultyAt(5),
    });
    check(
      "self-vote is rejected",
      isUniformRejection(selfVote.error) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const unknownHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(6),
      pepper,
    });
    const unknownCandidate = await svc.rpc("cast_vote", {
      p_token_hash: unknownHash,
      p_candidate_id: "00000000-0000-4000-8000-000000000000",
    });
    check(
      "unknown candidate id is rejected",
      isUniformRejection(unknownCandidate.error) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const archivedHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(7),
      pepper,
    });
    const archivedVote = await svc.rpc("cast_vote", {
      p_token_hash: archivedHash,
      p_candidate_id: fixture.archivedFacultyId,
    });
    check(
      "archived candidate is rejected",
      isUniformRejection(archivedVote.error) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const wrongTypeStudentHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "STUDENT",
      facultyId: null,
      pepper,
    });
    const wrongTypeOnFaculty = await svc.rpc("cast_vote", {
      p_token_hash: wrongTypeStudentHash,
      p_candidate_id: facultyAt(1),
    });
    check(
      "STUDENT token on cast_vote is rejected (wrong-type)",
      isUniformRejection(wrongTypeOnFaculty.error) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const invalidatedHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(8),
      pepper,
    });
    await svc
      .from("voting_tokens")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("token_hash", invalidatedHash);
    const invalidatedVote = await svc.rpc("cast_vote", {
      p_token_hash: invalidatedHash,
      p_candidate_id: facultyAt(1),
    });
    check(
      "invalidated token is rejected",
      isUniformRejection(invalidatedVote.error) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const ghostVote = await svc.rpc("cast_vote", {
      p_token_hash: "f".repeat(64),
      p_candidate_id: facultyAt(1),
    });
    check(
      "unknown token hash is rejected with the uniform error",
      isUniformRejection(ghostVote.error) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 1,
    );

    const replayHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(9),
      pepper,
    });
    const replayFirst = await svc.rpc("cast_vote", {
      p_token_hash: replayHash,
      p_candidate_id: facultyAt(1),
    });
    const replaySecond = await svc.rpc("cast_vote", {
      p_token_hash: replayHash,
      p_candidate_id: facultyAt(3),
    });
    check(
      "token replay / double submission is rejected; exactly one vote stands",
      replayFirst.error === null &&
        isUniformRejection(replaySecond.error) &&
        (await tokenUsed(svc, replayHash)) &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 2,
    );

    const raceHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(10),
      pepper,
    });
    const raceAttempts = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        svc.rpc("cast_vote", {
          p_token_hash: raceHash,
          p_candidate_id: facultyAt(1),
        }),
      ),
    );
    let raceWins = 0;
    let raceUniformLosses = 0;
    for (const attempt of raceAttempts) {
      if (attempt.status !== "fulfilled") {
        continue;
      }
      if (attempt.value.error === null) {
        raceWins += 1;
      } else if (isUniformRejection(attempt.value.error)) {
        raceUniformLosses += 1;
      }
    }
    check(
      "concurrent race on one token: exactly one winner, rest uniform",
      raceWins === 1 &&
        raceUniformLosses === 7 &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 3,
    );

    const closedStages = [
      "DRAFT",
      "FACULTY_RESULTS",
      "STUDENT_VOTING",
      "FINAL_RESULTS",
      "CLOSED",
    ];
    for (const stage of closedStages) {
      await setStage(svc, fixture.electionId, stage);
      const stageHash = await mintToken(svc, {
        electionId: fixture.electionId,
        departmentId: fixture.deptAId,
        tokenType: "FACULTY",
        facultyId: facultyAt(11),
        pepper,
      });
      const stageVote = await svc.rpc("cast_vote", {
        p_token_hash: stageHash,
        p_candidate_id: facultyAt(1),
      });
      check(
        `faculty vote rejected while election is ${stage} (before open / after close)`,
        isUniformRejection(stageVote.error) &&
          (await countVotes(svc, fixture.electionId, "FACULTY")) === 3,
      );
    }
    await setStage(svc, fixture.electionId, "STUDENT_VOTING");

    // -- Student battery (election in STUDENT_VOTING). ---------------------
    const studentControlHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "STUDENT",
      facultyId: null,
      pepper,
    });
    const studentControlCandidate = fixture.ccsFinalistIds[0] ?? "";
    const studentControl = await svc.rpc("cast_student_vote", {
      p_token_hash: studentControlHash,
      p_candidate_id: studentControlCandidate,
    });
    let studentControlOk = studentControl.error === null;
    if (studentControlOk) {
      const rows = castOkSchema.safeParse(studentControl.data);
      studentControlOk =
        rows.success &&
        rows.data.length === 1 &&
        (rows.data[0]?.election_id ?? "") === fixture.electionId &&
        (rows.data[0]?.department_id ?? "") === fixture.deptAId;
    }
    check(
      "student control: valid Finalist vote commits with server-derived department + stage",
      studentControlOk &&
        (await tokenUsed(svc, studentControlHash)) &&
        (await countVotes(svc, fixture.electionId, "STUDENT")) === 1,
    );

    const studentForgeHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "STUDENT",
      facultyId: null,
      pepper,
    });
    const studentForgedDept = await svc.rpc("cast_student_vote", {
      p_token_hash: studentForgeHash,
      p_candidate_id: studentControlCandidate,
      p_department_id: fixture.deptBId,
    });
    check(
      "forged department smuggled into cast_student_vote is rejected",
      studentForgedDept.error !== null &&
        (await countVotes(svc, fixture.electionId, "STUDENT")) === 1,
    );

    const crossFinalist = fixture.coedFinalistIds[0] ?? "";
    const studentCrossHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "STUDENT",
      facultyId: null,
      pepper,
    });
    const studentCross = await svc.rpc("cast_student_vote", {
      p_token_hash: studentCrossHash,
      p_candidate_id: crossFinalist,
    });
    check(
      "cross-department Finalist (dept-A Code, dept-B Finalist) is rejected",
      isUniformRejection(studentCross.error) &&
        (await countVotes(svc, fixture.electionId, "STUDENT")) === 1,
    );

    const nonFinalist = facultyAt(14);
    const studentNonFinalistHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "STUDENT",
      facultyId: null,
      pepper,
    });
    const studentNonFinalist = await svc.rpc("cast_student_vote", {
      p_token_hash: studentNonFinalistHash,
      p_candidate_id: nonFinalist,
    });
    check(
      "same-department non-Finalist is rejected on the student path",
      isUniformRejection(studentNonFinalist.error) &&
        (await countVotes(svc, fixture.electionId, "STUDENT")) === 1,
    );

    const wrongTypeFacultyHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "FACULTY",
      facultyId: facultyAt(12),
      pepper,
    });
    const wrongTypeOnStudent = await svc.rpc("cast_student_vote", {
      p_token_hash: wrongTypeFacultyHash,
      p_candidate_id: studentControlCandidate,
    });
    check(
      "FACULTY token on cast_student_vote is rejected (wrong-type)",
      isUniformRejection(wrongTypeOnStudent.error) &&
        (await countVotes(svc, fixture.electionId, "STUDENT")) === 1,
    );

    const studentReplayHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "STUDENT",
      facultyId: null,
      pepper,
    });
    const studentReplayFirst = await svc.rpc("cast_student_vote", {
      p_token_hash: studentReplayHash,
      p_candidate_id: studentControlCandidate,
    });
    const studentReplaySecond = await svc.rpc("cast_student_vote", {
      p_token_hash: studentReplayHash,
      p_candidate_id: fixture.ccsFinalistIds[1] ?? "",
    });
    check(
      "student token replay is rejected; exactly two student votes stand",
      studentReplayFirst.error === null &&
        isUniformRejection(studentReplaySecond.error) &&
        (await tokenUsed(svc, studentReplayHash)) &&
        (await countVotes(svc, fixture.electionId, "STUDENT")) === 2,
    );

    const studentRaceHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "STUDENT",
      facultyId: null,
      pepper,
    });
    const studentRace = await Promise.allSettled(
      Array.from({ length: 8 }, () =>
        svc.rpc("cast_student_vote", {
          p_token_hash: studentRaceHash,
          p_candidate_id: studentControlCandidate,
        }),
      ),
    );
    let studentWins = 0;
    let studentLosses = 0;
    for (const attempt of studentRace) {
      if (attempt.status !== "fulfilled") {
        continue;
      }
      if (attempt.value.error === null) {
        studentWins += 1;
      } else if (isUniformRejection(attempt.value.error)) {
        studentLosses += 1;
      }
    }
    check(
      "student concurrent race: exactly one winner, rest uniform",
      studentWins === 1 &&
        studentLosses === 7 &&
        (await countVotes(svc, fixture.electionId, "STUDENT")) === 3,
    );

    const studentClosedStages = [
      "DRAFT",
      "FACULTY_VOTING",
      "FACULTY_RESULTS",
      "FINAL_RESULTS",
      "CLOSED",
    ];
    for (const stage of studentClosedStages) {
      await setStage(svc, fixture.electionId, stage);
      const stageHash = await mintToken(svc, {
        electionId: fixture.electionId,
        departmentId: fixture.deptAId,
        tokenType: "STUDENT",
        facultyId: null,
        pepper,
      });
      const stageVote = await svc.rpc("cast_student_vote", {
        p_token_hash: stageHash,
        p_candidate_id: studentControlCandidate,
      });
      check(
        `student vote rejected while election is ${stage} (before open / after close)`,
        isUniformRejection(stageVote.error) &&
          (await countVotes(svc, fixture.electionId, "STUDENT")) === 3,
      );
    }

    const invalidStudentHash = await mintToken(svc, {
      electionId: fixture.electionId,
      departmentId: fixture.deptAId,
      tokenType: "STUDENT",
      facultyId: null,
      pepper,
    });
    await setStage(svc, fixture.electionId, "STUDENT_VOTING");
    await svc
      .from("voting_tokens")
      .update({ invalidated_at: new Date().toISOString() })
      .eq("token_hash", invalidStudentHash);
    const invalidStudentVote = await svc.rpc("cast_student_vote", {
      p_token_hash: invalidStudentHash,
      p_candidate_id: studentControlCandidate,
    });
    const ghostStudentVote = await svc.rpc("cast_student_vote", {
      p_token_hash: "e".repeat(64),
      p_candidate_id: studentControlCandidate,
    });
    check(
      "invalidated + unknown student tokens rejected uniformly",
      isUniformRejection(invalidStudentVote.error) &&
        isUniformRejection(ghostStudentVote.error) &&
        (await countVotes(svc, fixture.electionId, "STUDENT")) === 3,
    );

    // -- Role battery: anon vs authenticated (non-admin). -----------------
    const votesBeforeRoles =
      (await countVotes(svc, fixture.electionId)) +
      (await countVotes(svc, fixture.electionId, "FACULTY")) +
      (await countVotes(svc, fixture.electionId, "STUDENT"));

    const readableTables: Array<{ table: string; column: string }> = [
      { table: "departments", column: "id" },
      { table: "faculty", column: "id" },
      { table: "elections", column: "id" },
      { table: "voting_tokens", column: "id" },
      { table: "votes", column: "id" },
      { table: "finalists", column: "id" },
      { table: "election_results", column: "election_id" },
      { table: "audit_logs", column: "id" },
    ];
    let anonReadsDenied = 0;
    for (const target of readableTables) {
      const attempt = await anon
        .from(target.table)
        .select(target.column)
        .limit(1);
      if (attempt.error !== null) {
        anonReadsDenied += 1;
      }
    }
    check(
      "anon role: reads denied on every voting table",
      anonReadsDenied === readableTables.length,
    );

    const anonVoteWrite = await anon.from("votes").insert({
      election_id: fixture.electionId,
      department_id: fixture.deptAId,
      candidate_faculty_id: facultyAt(1),
      stage: "FACULTY",
    });
    const anonTokenWrite = await anon.from("voting_tokens").insert({
      election_id: fixture.electionId,
      department_id: fixture.deptAId,
      token_hash: "d".repeat(64),
      token_type: "STUDENT",
      faculty_id: null,
    });
    check(
      "anon role: writes denied, no rows created",
      anonVoteWrite.error !== null &&
        anonTokenWrite.error !== null &&
        (await countVotes(svc, fixture.electionId, "FACULTY")) === 3,
    );

    const anonFacultyRpc = await anon.rpc("cast_vote", {
      p_token_hash: "d".repeat(64),
      p_candidate_id: facultyAt(1),
    });
    const anonStudentRpc = await anon.rpc("cast_student_vote", {
      p_token_hash: "d".repeat(64),
      p_candidate_id: studentControlCandidate,
    });
    check(
      "anon role: function execution denied at grant level (not uniform)",
      isGrantDenial(anonFacultyRpc.error) &&
        isGrantDenial(anonStudentRpc.error),
    );

    // Throwaway non-admin user for the authenticated-role battery.
    const throwawayPassword = randomBytes(24).toString("hex");
    const created = await svc.auth.admin.createUser({
      email: `t18sec-${tag}@example.com`,
      password: throwawayPassword,
      email_confirm: true,
    });
    if (created.error !== null || created.data.user === null) {
      throw new Error("Could not create the throwaway auth user.");
    }
    authUserId = created.data.user.id;
    const authed = createDbClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signedIn = await authed.auth.signInWithPassword({
      email: `t18sec-${tag}@example.com`,
      password: throwawayPassword,
    });
    if (signedIn.error !== null) {
      throw new Error("Could not sign in the throwaway auth user.");
    }

    let authedReadsEmpty = 0;
    for (const target of readableTables) {
      const attempt = await authed
        .from(target.table)
        .select(target.column)
        .limit(1);
      const rows: unknown = attempt.data;
      if (attempt.error === null && Array.isArray(rows) && rows.length === 0) {
        authedReadsEmpty += 1;
      }
    }
    check(
      "authenticated non-admin: reads see zero rows on every voting table",
      authedReadsEmpty === readableTables.length,
    );

    const authedVoteWrite = await authed.from("votes").insert({
      election_id: fixture.electionId,
      department_id: fixture.deptAId,
      candidate_faculty_id: facultyAt(1),
      stage: "FACULTY",
    });
    const authedTokenWrite = await authed.from("voting_tokens").insert({
      election_id: fixture.electionId,
      department_id: fixture.deptAId,
      token_hash: "d".repeat(64),
      token_type: "STUDENT",
      faculty_id: null,
    });
    check(
      "authenticated non-admin: writes denied",
      authedVoteWrite.error !== null && authedTokenWrite.error !== null,
    );

    const authedFacultyRpc = await authed.rpc("cast_vote", {
      p_token_hash: "d".repeat(64),
      p_candidate_id: facultyAt(1),
    });
    const authedStudentRpc = await authed.rpc("cast_student_vote", {
      p_token_hash: "d".repeat(64),
      p_candidate_id: studentControlCandidate,
    });
    check(
      "authenticated non-admin: function execution denied at grant level",
      isGrantDenial(authedFacultyRpc.error) &&
        isGrantDenial(authedStudentRpc.error),
    );

    await authed.auth.signOut();
    const votesAfterRoles =
      (await countVotes(svc, fixture.electionId)) +
      (await countVotes(svc, fixture.electionId, "FACULTY")) +
      (await countVotes(svc, fixture.electionId, "STUDENT"));
    check(
      "denied role attempts wrote zero rows",
      votesAfterRoles === votesBeforeRoles,
    );
  } finally {
    await cleanupFixture(svc, electionId, probeCode, authUserId);
  }

  // -- Zero-leftover verification (post-cleanup, all tables). -------------
  const leftoverTables: Array<{ table: string; column: string }> = [
    { table: "departments", column: "code" },
    { table: "faculty", column: "full_name" },
    { table: "elections", column: "name" },
    { table: "voting_tokens", column: "token_hash" },
    { table: "votes", column: "id" },
    { table: "finalists", column: "id" },
    { table: "election_results", column: "election_id" },
    { table: "audit_logs", column: "id" },
  ];
  let leftoverTotal = 0;
  for (const target of leftoverTables) {
    if (
      target.table === "departments" ||
      target.table === "faculty" ||
      target.table === "elections"
    ) {
      leftoverTotal += await leftoverCount(
        svc,
        target.table,
        target.column,
        `${PREFIX}%`,
      );
    } else if (
      target.table === "audit_logs" ||
      target.table === "voting_tokens" ||
      target.table === "votes" ||
      target.table === "finalists" ||
      target.table === "election_results"
    ) {
      if (electionId !== null) {
        const { count, error } = await svc
          .from(target.table)
          .select(target.column, { count: "exact", head: true })
          .eq("election_id", electionId);
        if (error !== null) {
          throw new Error(`Post-cleanup count on ${target.table} failed.`);
        }
        leftoverTotal += count ?? 0;
      }
    } else {
      const { count, error } = await svc
        .from(target.table)
        .select(target.column, { count: "exact", head: true });
      if (error !== null) {
        throw new Error(`Post-cleanup count on ${target.table} failed.`);
      }
      leftoverTotal += count ?? 0;
    }
  }
  check("cleanup removed every throwaway row", leftoverTotal === 0);
  const { data: strayUsers } = await svc.auth.admin.listUsers({
    page: 1,
    perPage: 100,
  });
  const strayThrowaway = (strayUsers?.users ?? []).filter((user) =>
    user.email?.startsWith("t18sec-"),
  );
  check("throwaway auth user deleted", strayThrowaway.length === 0);

  console.log(
    `\nSecurity suite: ${passed} passed, ${failures.length} failed.`,
  );
  if (failures.length > 0) {
    console.log(`Failures: ${failures.join("; ")}`);
    process.exitCode = 1;
  }
}

await main();
