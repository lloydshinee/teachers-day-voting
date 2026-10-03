/**
 * Self-test for Stage-2 Winner counting with Winner-Tie detection
 * (spec §12, task 13).
 *
 * Run: `node_modules/.bin/jiti lib/stage2/self-test.ts`
 * Proves the Winner-tie math on pure aggregates: a clear Winner, an exact
 * two-way Tie for Winner (flags `tie_pending`), a three-way Tie, a
 * below-the-top Tie that stays clean, plus the boundary cases around them
 * (single Finalist, empty snapshot, zero-vote departments, deterministic
 * ordering).
 */

import assert from "node:assert/strict";

import {
  computeStage2Winner,
  type Stage2FinalistCount,
} from "./counting.js";

let passed = 0;

function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

function finalist(
  finalistId: string,
  fullName: string,
  votes: number,
): Stage2FinalistCount {
  return { finalistId, fullName, votes };
}

function ids(counts: readonly Stage2FinalistCount[]): string[] {
  return counts.map((entry) => entry.finalistId);
}

check("clear Winner takes the highest student total with rank 1", () => {
  const result = computeStage2Winner([
    finalist("a", "Ana", 120),
    finalist("b", "Ben", 90),
    finalist("c", "Cy", 45),
  ]);
  assert.equal(result.kind, "clean");
  if (result.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.equal(result.winner?.finalistId, "a");
  assert.equal(result.winner?.rank, 1);
  assert.deepEqual(
    result.ranking.map((entry) => [entry.finalistId, entry.rank]),
    [
      ["a", 1],
      ["b", 2],
      ["c", 3],
    ],
  );
});

check("exact two-way Tie for Winner flags tie_pending shape", () => {
  const result = computeStage2Winner([
    finalist("a", "Ana", 100),
    finalist("b", "Ben", 100),
    finalist("c", "Cy", 40),
  ]);
  assert.equal(result.kind, "tie");
  if (result.kind !== "tie") {
    throw new Error("unreachable");
  }
  assert.equal(result.topVotes, 100);
  assert.deepEqual(ids(result.tied), ["a", "b"]);
});

check("three-way Tie for Winner flags with all three tied", () => {
  const result = computeStage2Winner([
    finalist("a", "Ana", 55),
    finalist("b", "Ben", 55),
    finalist("c", "Cy", 55),
  ]);
  assert.equal(result.kind, "tie");
  if (result.kind !== "tie") {
    throw new Error("unreachable");
  }
  assert.equal(result.topVotes, 55);
  assert.equal(result.tied.length, 3);
});

check("Tie for 2nd below a clear Winner stays clean", () => {
  const result = computeStage2Winner([
    finalist("a", "Ana", 120),
    finalist("b", "Ben", 60),
    finalist("c", "Cy", 60),
  ]);
  assert.equal(result.kind, "clean");
  if (result.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.equal(result.winner?.finalistId, "a");
});

check("single Finalist always wins, even with zero votes", () => {
  const voted = computeStage2Winner([finalist("a", "Ana", 17)]);
  assert.equal(voted.kind, "clean");
  if (voted.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.equal(voted.winner?.finalistId, "a");

  const zero = computeStage2Winner([finalist("a", "Ana", 0)]);
  assert.equal(zero.kind, "clean");
  if (zero.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.equal(zero.winner?.finalistId, "a");
});

check("empty snapshot has no Winner but stays clean", () => {
  const result = computeStage2Winner([]);
  assert.equal(result.kind, "clean");
  if (result.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.equal(result.winner, null);
  assert.deepEqual(result.ranking, []);
});

check("zero-vote department with several Finalists flags", () => {
  const result = computeStage2Winner([
    finalist("a", "Ana", 0),
    finalist("b", "Ben", 0),
    finalist("c", "Cy", 0),
  ]);
  assert.equal(result.kind, "tie");
  if (result.kind !== "tie") {
    throw new Error("unreachable");
  }
  assert.equal(result.topVotes, 0);
  assert.equal(result.tied.length, 3);
});

check("equal totals order deterministically by name then id", () => {
  const result = computeStage2Winner([
    finalist("z", "Zed", 10),
    finalist("m", "Amy", 4),
    finalist("a", "Amy", 4),
    finalist("w", "Wyn", 12),
  ]);
  assert.equal(result.kind, "clean");
  if (result.kind !== "clean") {
    throw new Error("unreachable");
  }
  assert.equal(result.winner?.finalistId, "w");
  assert.deepEqual(
    result.ranking.map((entry) => entry.finalistId),
    ["w", "z", "a", "m"],
  );
});

console.log(`\nAll ${passed} self-test groups passed.`);
