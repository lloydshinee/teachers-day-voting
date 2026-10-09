/**
 * Self-test for audit-log persistence (spec §14 task 15, §§3, 7).
 *
 * Run: `node_modules/.bin/jiti lib/audit/self-test.ts`
 *
 * Suite A proves the locked never-log rule in code: it scans every audit
 * payload shape persisted by `lib/audit/hook.ts` (via the action → schema
 * map in `./details`) and fails if any single shape can carry a vote
 * choice together with a voter identity, Token, Code, or hash. It also
 * probes the strict allowlists (smuggled keys are rejected) and the
 * choice-plus-identity guard directly.
 *
 * Suite B proves the schema carries no join key: it scans the migration
 * DDL and fails if any foreign key or column joins audit rows to votes or
 * tokens in either direction.
 *
 * Placeholder values below are obviously fake (never real Codes, hashes,
 * or keys) and exist only to exercise validation shapes.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

import {
  ALL_AUDIT_ACTIONS,
  AUDIT_CHOICE_KEYS,
  AUDIT_DETAILS_SCHEMAS,
  AUDIT_IDENTITY_KEYS,
  AUDIT_SECRET_KEYS,
  assertNeverLogsChoicePlusIdentity,
  findNeverLogViolation,
  isCompliantStage1DetailsForAction,
  isCompliantStage2DetailsForAction,
  stage1AuditDetailsSchema,
  stage2AuditDetailsSchema,
} from "./details.js";

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

const ELECTION_ID = "123e4567-e89b-12d3-a456-426614174000";
const DEPARTMENT_ID = "123e4567-e89b-12d3-a456-426614174001";
const FACULTY_ID = "123e4567-e89b-12d3-a456-426614174002";
const POLICY_VERSION = "2026-09-30T09:00:00Z";
const SUPERSEDED_AT = "2026-09-29T09:00:00Z";

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/_/g, "");
}

function shapeKeys(action: string, schema: z.ZodType): string[] {
  const candidate = schema as unknown as { shape?: unknown };
  if (
    typeof candidate.shape !== "object" ||
    candidate.shape === null ||
    Array.isArray(candidate.shape)
  ) {
    throw new Error(
      `audit shape for ${action} hides its keys (must stay a plain strict object so the scanner can see every key)`,
    );
  }
  return Object.keys(candidate.shape);
}

// ---------------------------------------------------------------------------
// Suite A: never-log shape scan.
// ---------------------------------------------------------------------------

check("every persisted action has exactly one details schema", () => {
  assert.equal(
    ALL_AUDIT_ACTIONS.length,
    25,
    `expected 25 audit actions, found ${ALL_AUDIT_ACTIONS.length}`,
  );
  const mapped = Object.keys(AUDIT_DETAILS_SCHEMAS).sort();
  assert.deepEqual(mapped, [...ALL_AUDIT_ACTIONS].sort());
});

check("no audit payload shape can carry a choice-plus-identity pair", () => {
  const choice = new Set(AUDIT_CHOICE_KEYS.map(normalizeKey));
  const sensitive = new Set(
    [...AUDIT_IDENTITY_KEYS, ...AUDIT_SECRET_KEYS].map(normalizeKey),
  );
  for (const action of ALL_AUDIT_ACTIONS) {
    const schema = AUDIT_DETAILS_SCHEMAS[action];
    if (!schema) {
      throw new Error(`missing details schema for ${action}`);
    }
    const keys = shapeKeys(action, schema).map(normalizeKey);
    const choiceHits = keys.filter((key) => choice.has(key));
    const sensitiveHits = keys.filter((key) => sensitive.has(key));
    assert.equal(
      choiceHits.length > 0 && sensitiveHits.length > 0,
      false,
      `${action} can carry choice key(s) [${choiceHits.join(", ")}] together ` +
        `with identity/secret key(s) [${sensitiveHits.join(", ")}]`,
    );
  }
});

check("department details use departmentCode, never a bare voting-Code key", () => {
  const keys = shapeKeys(
    "CREATE_DEPARTMENT",
    AUDIT_DETAILS_SCHEMAS["CREATE_DEPARTMENT"],
  ).map(normalizeKey);
  assert.equal(keys.includes("code"), false);
  assert.equal(keys.includes("departmentcode"), true);
});

check("strict allowlists reject smuggled Token/Code/hash/choice keys", () => {
  const smuggled = {
    token_hash: "NOT_A_REAL_HASH",
    code: "NOT-A-REAL-CODE",
    candidateFacultyId: FACULTY_ID,
  };
  for (const action of ALL_AUDIT_ACTIONS) {
    const schema = AUDIT_DETAILS_SCHEMAS[action];
    if (!schema) {
      throw new Error(`missing details schema for ${action}`);
    }
    const valid = validSampleFor(action);
    assert.equal(
      schema.safeParse(valid).success,
      true,
      `${action} must accept its legitimate payload`,
    );
    assert.equal(
      schema.safeParse({ ...valid, ...smuggled }).success,
      false,
      `${action} must reject smuggled Token/Code/choice keys`,
    );
  }
});

check("never-log guard passes clean payloads, throws on pairs", () => {
  // Clean: token-use without choice; Tie pick with policy version and no
  // identity; roster identity with no choice.
  assert.equal(
    findNeverLogViolation({ departmentId: DEPARTMENT_ID, stage: "FACULTY" }),
    null,
  );
  assert.equal(
    findNeverLogViolation({
      departmentId: DEPARTMENT_ID,
      policyVersion: POLICY_VERSION,
      pickedCandidateIds: [FACULTY_ID],
      supersededSnapshotAt: null,
    }),
    null,
  );
  assert.equal(
    findNeverLogViolation({
      facultyId: FACULTY_ID,
      archivedFacultyId: null,
      departmentId: DEPARTMENT_ID,
      fullName: "Ana Santos",
    }),
    null,
  );
  // Violations: choice + identity, choice + secret, nested pairs.
  assert.notEqual(
    findNeverLogViolation({
      pickedCandidateIds: [FACULTY_ID],
      facultyId: FACULTY_ID,
    }),
    null,
  );
  assert.notEqual(
    findNeverLogViolation({ choice: FACULTY_ID, token: "NOT_A_REAL_TOKEN" }),
    null,
  );
  assert.notEqual(
    findNeverLogViolation({
      candidateFacultyId: FACULTY_ID,
      code: "NOT-A-REAL-CODE",
    }),
    null,
  );
  assert.notEqual(
    findNeverLogViolation({
      outer: { voteChoice: FACULTY_ID, voterId: FACULTY_ID },
    }),
    null,
  );
  assert.throws(() =>
    assertNeverLogsChoicePlusIdentity({
      pickedFinalistIds: [FACULTY_ID],
      hash: "NOT_A_REAL_HASH",
    }),
  );
  assert.doesNotThrow(() =>
    assertNeverLogsChoicePlusIdentity({
      departmentId: DEPARTMENT_ID,
      quantity: 300,
    }),
  );
});

check("per-action compliance validators pin picks and snapshots", () => {
  const base = stage1AuditDetailsSchema.parse({
    departmentId: DEPARTMENT_ID,
    policyVersion: POLICY_VERSION,
    pickedCandidateIds: null,
    supersededSnapshotAt: null,
  });
  assert.equal(isCompliantStage1DetailsForAction("CLOSE_FACULTY_VOTING", {
    ...base,
    departmentId: null,
  }), true);
  // A close carrying a department or picks is non-compliant.
  assert.equal(
    isCompliantStage1DetailsForAction("CLOSE_FACULTY_VOTING", base),
    false,
  );
  assert.equal(
    isCompliantStage1DetailsForAction("RESOLVE_STAGE1_TIE", {
      ...base,
      pickedCandidateIds: [],
    }),
    false,
  );
  assert.equal(
    isCompliantStage1DetailsForAction("RESOLVE_STAGE1_TIE", {
      ...base,
      pickedCandidateIds: [FACULTY_ID],
    }),
    true,
  );
  assert.equal(
    isCompliantStage1DetailsForAction("REOPEN_STAGE1", base),
    false,
  );
  assert.equal(
    isCompliantStage1DetailsForAction("REOPEN_STAGE1", {
      ...base,
      supersededSnapshotAt: SUPERSEDED_AT,
    }),
    true,
  );
  assert.equal(isCompliantStage1DetailsForAction("NO_SUCH_ACTION", base), false);

  const stage2Base = stage2AuditDetailsSchema.parse({
    departmentId: DEPARTMENT_ID,
    policyVersion: POLICY_VERSION,
    pickedFinalistIds: null,
  });
  assert.equal(
    isCompliantStage2DetailsForAction("RESOLVE_STAGE2_TIE", {
      ...stage2Base,
      pickedFinalistIds: [FACULTY_ID],
    }),
    true,
  );
  // Two picks are not a single Winner pick.
  assert.equal(
    isCompliantStage2DetailsForAction("RESOLVE_STAGE2_TIE", {
      ...stage2Base,
      pickedFinalistIds: [FACULTY_ID, FACULTY_ID],
    }),
    false,
  );
  assert.equal(
    isCompliantStage2DetailsForAction("PUBLISH_WINNER", {
      ...stage2Base,
      policyVersion: null,
    }),
    false,
  );
  assert.equal(
    isCompliantStage2DetailsForAction("PUBLISH_WINNER", stage2Base),
    true,
  );
});

// ---------------------------------------------------------------------------
// Suite B: no foreign key or column joins audit rows to votes or tokens.
// ---------------------------------------------------------------------------

function readMigrations(): Array<{ file: string; sql: string }> {
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".sql"))
    .sort();
  assert.ok(files.length > 0, "expected migration SQL files");
  return files.map((file) => ({
    file,
    sql: fs.readFileSync(path.join(dir, file), "utf8"),
  }));
}

/** Extracts the parenthesized CREATE TABLE body for one table. */
function createTableBody(sql: string, table: string): string {
  const marker = `public.${table} (`;
  const start = sql.indexOf(marker);
  assert.notEqual(start, -1, `CREATE TABLE for ${table} not found`);
  let depth = 0;
  let end = -1;
  for (let i = start + marker.length - 1; i < sql.length; i += 1) {
    const char = sql[i];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `unbalanced parens in CREATE TABLE ${table}`);
  return sql.slice(start, end ?? start);
}

function columnNames(body: string): string[] {
  const names: string[] = [];
  const skipped = new Set([
    "constraint",
    "primary",
    "unique",
    "check",
    "foreign",
  ]);
  for (const line of body.split("\n")) {
    const match = /^\s*([a-z][a-z0-9_]*)\s+/.exec(line);
    if (!match || !match[1]) {
      continue;
    }
    const name = match[1].toLowerCase();
    if (!skipped.has(name)) {
      names.push(name);
    }
  }
  return names;
}

function referencesTargets(body: string): string[] {
  const targets: string[] = [];
  const pattern = /references\s+public\.([a-z_]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    const target = match[1];
    if (target !== undefined) {
      targets.push(target.toLowerCase());
    }
  }
  return targets;
}

check("audit_logs has no column or FK joining it to votes or tokens", () => {
  const migrations = readMigrations();
  const voting = migrations.find((entry) =>
    entry.file.includes("003_voting"),
  );
  assert.ok(voting, "003_voting migration not found");
  const body = createTableBody(voting.sql, "audit_logs");

  assert.deepEqual(columnNames(body).sort(), [
    "action",
    "actor_admin_id",
    "created_at",
    "details",
    "election_id",
    "id",
  ]);
  for (const target of referencesTargets(body)) {
    assert.ok(
      target === "elections" || target === "admins",
      `audit_logs references forbidden table ${target}`,
    );
  }
  assert.equal(/\bvotes\b/i.test(body), false);
  assert.equal(/\bvoting_tokens\b/i.test(body), false);

  // No migration anywhere links the two tables in either direction.
  for (const entry of migrations) {
    const lines = entry.sql.split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      const mentionsAudit = lower.includes("audit_logs");
      const mentionsVoteSide =
        lower.includes("voting_tokens") || /\bvotes\b/.test(lower);
      if (mentionsAudit && mentionsVoteSide && lower.includes("references")) {
        throw new Error(
          `join key between audit_logs and votes/tokens in ${entry.file}: ${line.trim()}`,
        );
      }
    }
  }
});

check("votes has no column or FK joining it to audit rows or tokens", () => {
  const migrations = readMigrations();
  const voting = migrations.find((entry) =>
    entry.file.includes("003_voting"),
  );
  assert.ok(voting, "003_voting migration not found");
  const body = createTableBody(voting.sql, "votes");

  assert.deepEqual(columnNames(body).sort(), [
    "candidate_faculty_id",
    "created_at",
    "department_id",
    "election_id",
    "id",
    "stage",
  ]);
  for (const target of referencesTargets(body)) {
    assert.ok(
      target === "elections" ||
        target === "departments" ||
        target === "faculty",
      `votes references forbidden table ${target}`,
    );
  }
  assert.equal(/\baudit_logs\b/i.test(body), false);
  assert.equal(/\bvoting_tokens\b/i.test(body), false);
});

check("migration carries the DB-level no-join-key privacy assertions", () => {
  const migrations = readMigrations();
  const voting = migrations.find((entry) =>
    entry.file.includes("003_voting"),
  );
  assert.ok(voting, "003_voting migration not found");
  assert.ok(
    /privacy guard/i.test(voting.sql),
    "003_voting must keep its privacy-guard assertion blocks",
  );
});

function validSampleFor(action: string): Record<string, unknown> {
  switch (action) {
    case "CREATE_DEPARTMENT":
    case "RENAME_DEPARTMENT":
      return {
        departmentId: DEPARTMENT_ID,
        departmentCode: "CCS",
        name: "College of Computing Studies",
      };
    case "DELETE_DEPARTMENT":
      return {
        departmentId: DEPARTMENT_ID,
        departmentCode: "CCS",
        name: null,
      };
    case "CREATE_FACULTY":
    case "RENAME_FACULTY":
    case "ARCHIVE_FACULTY":
    case "GENERATE_FACULTY_CODES":
    case "INVALIDATE_FACULTY_TOKENS":
      return {
        facultyId: FACULTY_ID,
        archivedFacultyId: null,
        departmentId: DEPARTMENT_ID,
        fullName: "Ana Santos",
      };
    case "MOVE_FACULTY":
      return {
        facultyId: FACULTY_ID,
        archivedFacultyId: ELECTION_ID,
        departmentId: DEPARTMENT_ID,
        fullName: "Ana Santos",
      };
    case "FACULTY_VOTE_CAST":
      return { departmentId: DEPARTMENT_ID, stage: "FACULTY" };
    case "STUDENT_VOTE_CAST":
      return { departmentId: DEPARTMENT_ID, stage: "STUDENT" };
    case "CLOSE_FACULTY_VOTING":
      return {
        departmentId: null,
        policyVersion: POLICY_VERSION,
        pickedCandidateIds: null,
        supersededSnapshotAt: null,
      };
    case "FLAG_STAGE1_TIE":
    case "FREEZE_STAGE1_FINALISTS":
      return {
        departmentId: DEPARTMENT_ID,
        policyVersion: POLICY_VERSION,
        pickedCandidateIds: null,
        supersededSnapshotAt: null,
      };
    case "RESOLVE_STAGE1_TIE":
      return {
        departmentId: DEPARTMENT_ID,
        policyVersion: POLICY_VERSION,
        pickedCandidateIds: [FACULTY_ID],
        supersededSnapshotAt: null,
      };
    case "REOPEN_STAGE1":
      return {
        departmentId: DEPARTMENT_ID,
        policyVersion: POLICY_VERSION,
        pickedCandidateIds: null,
        supersededSnapshotAt: SUPERSEDED_AT,
      };
    case "GENERATE_STUDENT_CODES":
      return { departmentId: DEPARTMENT_ID, quantity: 300 };
    case "CLOSE_STUDENT_VOTING":
      return {
        departmentId: null,
        policyVersion: POLICY_VERSION,
        pickedFinalistIds: null,
      };
    case "FLAG_STAGE2_TIE":
      return {
        departmentId: DEPARTMENT_ID,
        policyVersion: POLICY_VERSION,
        pickedFinalistIds: null,
      };
    case "RESOLVE_STAGE2_TIE":
      return {
        departmentId: DEPARTMENT_ID,
        policyVersion: POLICY_VERSION,
        pickedFinalistIds: [FACULTY_ID],
      };
    case "PUBLISH_WINNER":
      return {
        departmentId: DEPARTMENT_ID,
        policyVersion: POLICY_VERSION,
        pickedFinalistIds: null,
      };
    case "CREATE_ELECTION":
      return {
        electionName: "Teachers' Day 2026",
        academicYear: "2026-2027",
        policyVersion: null,
        departmentCount: 5,
        fromStage: null,
        toStage: "DRAFT",
      };
    case "OPEN_FACULTY_VOTING":
      return {
        electionName: null,
        academicYear: null,
        policyVersion: POLICY_VERSION,
        departmentCount: null,
        fromStage: "DRAFT",
        toStage: "FACULTY_VOTING",
      };
    case "OPEN_STUDENT_VOTING":
      return {
        electionName: null,
        academicYear: null,
        policyVersion: POLICY_VERSION,
        departmentCount: null,
        fromStage: "FACULTY_RESULTS",
        toStage: "STUDENT_VOTING",
      };
    case "CLOSE_ELECTION":
      return {
        electionName: null,
        academicYear: null,
        policyVersion: POLICY_VERSION,
        departmentCount: null,
        fromStage: "FINAL_RESULTS",
        toStage: "CLOSED",
      };
    default:
      throw new Error(`no valid sample for unknown action ${action}`);
  }
}

console.log(`\nAll ${passed} self-test groups passed.`);
