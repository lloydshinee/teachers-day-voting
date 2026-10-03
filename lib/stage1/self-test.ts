/**
 * Self-test for Stage-1 Top-3 counting with cutoff Tie detection
 * (spec §12, task 10).
 *
 * Run: `node_modules/.bin/jiti lib/stage1/self-test.ts`
 * Proves the tie math on pure aggregates: a clean Top-3, an exact Tie at
 * the cutoff (flags `tie_pending`), and a Tie above the cutoff (clean —
 * shared 1st place never blocks the Top-3), plus the boundary cases around
 * them (exact seat fill, all-tied, short rosters, zero-vote departments,
 * deterministic ordering).
 */

import assert from "node:assert/strict";

import {
  computeStage1Cutoff,
  STAGE1_TOP_N,
  type Stage1CandidateCount,
} from "./counting.js";

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function candidate(
  candidateId: string,
  fullName: string,
  votes: number,
): Stage1CandidateCount {
  return { candidateId, fullName, votes };
}

function ids(counts: readonly Stage1CandidateCount[]): string[] {
  return counts.map((entry) => entry.candidateId);
}

check("clean Top-3 takes the three highest totals with ranks 1-2-3", () => {
  const result = computeStage1Cutoff([
    candidate("a", "Ana", 10),
    candidate("b", "Ben", 8),
    candidate("c", "Cy", 6),
    candidate("d", "Dee", 4),
    candidate("e", "Eli", 2),
  ]);
  assert.equal(result.kind, "clean");
  if (result.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.deepEqual(ids(result.top3), ["a", "b", "c"]);
  assert.deepEqual(
    result.top3.map((entry) => [entry.votes, entry.rank]),
    [
      [10, 1],
      [8, 2],
      [6, 3],
    ],
  );
  assert.equal(STAGE1_TOP_N, 3);
});

check("exact Tie at the cutoff flags tie_pending shape", () => {
  const result = computeStage1Cutoff([
    candidate("a", "Ana", 10),
    candidate("b", "Ben", 8),
    candidate("c", "Cy", 6),
    candidate("d", "Dee", 6),
    candidate("e", "Eli", 4),
  ]);
  assert.equal(result.kind, "tie");
  if (result.kind !== "tie") {
    throw new Error("unreachable");
  }
  assert.equal(result.cutoffVotes, 6);
  assert.deepEqual(ids(result.lockedAbove), ["a", "b"]);
  assert.deepEqual(ids(result.tied), ["c", "d"]);
  assert.equal(result.seatsRemaining, 1);
});

check("Tie above the cutoff stays clean (shared 1st never blocks Top-3)", () => {
  const result = computeStage1Cutoff([
    candidate("a", "Ana", 10),
    candidate("b", "Ben", 10),
    candidate("c", "Cy", 8),
    candidate("d", "Dee", 6),
  ]);
  assert.equal(result.kind, "clean");
  if (result.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.deepEqual(ids(result.top3), ["a", "b", "c"]);
});

check("tied Candidates exactly filling the seats stay clean", () => {
  const result = computeStage1Cutoff([
    candidate("a", "Ana", 12),
    candidate("b", "Ben", 7),
    candidate("c", "Cy", 7),
    candidate("d", "Dee", 5),
  ]);
  assert.equal(result.kind, "clean");
  if (result.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.deepEqual(ids(result.top3), ["a", "b", "c"]);
});

check("three-way Tie for two remaining seats flags", () => {
  const result = computeStage1Cutoff([
    candidate("a", "Ana", 12),
    candidate("b", "Ben", 7),
    candidate("c", "Cy", 7),
    candidate("d", "Dee", 7),
  ]);
  assert.equal(result.kind, "tie");
  if (result.kind !== "tie") {
    throw new Error("unreachable");
  }
  assert.equal(result.cutoffVotes, 7);
  assert.deepEqual(ids(result.lockedAbove), ["a"]);
  assert.deepEqual(ids(result.tied), ["b", "c", "d"]);
  assert.equal(result.seatsRemaining, 2);
});

check("all Candidates tied above the seat count flags", () => {
  const result = computeStage1Cutoff([
    candidate("a", "Ana", 9),
    candidate("b", "Ben", 9),
    candidate("c", "Cy", 9),
    candidate("d", "Dee", 9),
  ]);
  assert.equal(result.kind, "tie");
  if (result.kind !== "tie") {
    throw new Error("unreachable");
  }
  assert.equal(result.cutoffVotes, 9);
  assert.deepEqual(result.lockedAbove, []);
  assert.equal(result.tied.length, 4);
  assert.equal(result.seatsRemaining, 3);
});

check("short rosters never tie — everybody advances", () => {
  const two = computeStage1Cutoff([
    candidate("a", "Ana", 5),
    candidate("b", "Ben", 5),
  ]);
  assert.equal(two.kind, "clean");
  if (two.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.equal(two.top3.length, 2);

  const threeTied = computeStage1Cutoff([
    candidate("a", "Ana", 7),
    candidate("b", "Ben", 5),
    candidate("c", "Cy", 5),
  ]);
  assert.equal(threeTied.kind, "clean");

  const empty = computeStage1Cutoff([]);
  assert.equal(empty.kind, "clean");
});

check("zero-vote department with more Candidates than seats flags", () => {
  const result = computeStage1Cutoff([
    candidate("a", "Ana", 0),
    candidate("b", "Ben", 0),
    candidate("c", "Cy", 0),
    candidate("d", "Dee", 0),
    candidate("e", "Eli", 0),
  ]);
  assert.equal(result.kind, "tie");
  if (result.kind !== "tie") {
    throw new Error("unreachable");
  }
  assert.equal(result.cutoffVotes, 0);
  assert.equal(result.seatsRemaining, 3);
});

check("equal totals order deterministically by name then id", () => {
  const result = computeStage1Cutoff([
    candidate("z", "Zed", 4),
    candidate("m", "Amy", 4),
    candidate("a", "Amy", 4),
  ]);
  assert.equal(result.kind, "clean");
  if (result.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.deepEqual(ids(result.top3), ["a", "m", "z"]);
});

console.log(`\nAll ${passed} self-test groups passed.`);
