/**
 * Stage-2 Winner counting with Winner-Tie detection (spec §12, task 13).
 *
 * Pure module (no `server-only`, no I/O) so the self-test can run it under
 * plain Node and the admin UI can import its types.
 *
 * Glossary (GLOSSARY.md) is used exactly: Tie, Finalist, Winner.
 * A Tie is two or more candidates in one department with equal vote counts
 * straddling an advancement cutoff. In Stage 2 the cutoff is the single
 * Winner seat: two or more Finalists sharing the top student-vote total is
 * a Winner Tie. Ties never auto-resolve — the computation below only
 * *detects* them; a human admin picks (spec §2d) exactly one of the tied
 * Finalists.
 *
 * Input is aggregates only (Finalist + student votes) — no voter-side data
 * exists on this path by construction (spec §7). Callers (see `./queries`)
 * build the input from the frozen `finalists` snapshot plus STUDENT votes
 * scoped to `(election, department)`, counting only votes whose candidate
 * is a frozen Finalist. Votes for non-Finalists cannot be cast (the
 * `cast_student_vote` transaction rejects them) and are excluded from the
 * Winner math when they appear.
 *
 * A Tie strictly *below* the top (e.g. two Finalists tied for 2nd) never
 * blocks the Winner: the top seat is still fillable, so the result is
 * clean. A department with one Finalist always has a clean Winner (even
 * with zero votes); a department with no frozen Finalists has no Winner
 * (clean with `winner: null` — there is nothing to elect from).
 *
 * Ranks are sequential positions (1, 2, 3) in the sorted order, matching
 * the Stage-1 convention: rank is display order only.
 */

export interface Stage2FinalistCount {
  /** `faculty.id` of the Finalist. */
  finalistId: string;
  /** Display name (also the deterministic tie-break after votes). */
  fullName: string;
  /** Aggregate Stage-2 (`STUDENT`) votes for this Finalist. */
  votes: number;
}

export interface Stage2RankedEntry extends Stage2FinalistCount {
  /** Display order, 1-based and sequential. */
  rank: number;
}

export type Stage2WinnerResult =
  | { kind: "clean"; winner: Stage2RankedEntry | null; ranking: Stage2RankedEntry[] }
  | {
      kind: "tie";
      /** The shared top total the tied Finalists sit on. */
      topVotes: number;
      /** Finalists sharing the top total (the admin picks exactly one of these). */
      tied: Stage2FinalistCount[];
      /** Full display ranking (votes desc, name, id). */
      ranking: Stage2RankedEntry[];
    };

/**
 * Deterministic order: votes descending, then name (code-unit comparison,
 * so it never varies by locale), then id as the final tie-break.
 */
export function sortStage2Counts(
  counts: readonly Stage2FinalistCount[],
): Stage2FinalistCount[] {
  return [...counts].sort((a, b) => {
    if (b.votes !== a.votes) {
      return b.votes - a.votes;
    }
    if (a.fullName !== b.fullName) {
      return a.fullName < b.fullName ? -1 : 1;
    }
    if (a.finalistId !== b.finalistId) {
      return a.finalistId < b.finalistId ? -1 : 1;
    }
    return 0;
  });
}

function withRanks(sorted: Stage2FinalistCount[]): Stage2RankedEntry[] {
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * Applies the single-Winner rule to aggregate per-Finalist counts.
 * Input is aggregates only (Finalist + votes) — no voter-side data exists
 * on this path by construction (spec §7).
 */
export function computeStage2Winner(
  counts: readonly Stage2FinalistCount[],
): Stage2WinnerResult {
  const sorted = sortStage2Counts(counts);
  const ranking = withRanks(sorted);
  const top = sorted[0];
  if (!top) {
    return { kind: "clean", winner: null, ranking };
  }
  const topVotes = top.votes;
  const tied = sorted.filter((entry) => entry.votes === topVotes);
  if (tied.length > 1) {
    return { kind: "tie", topVotes, tied, ranking };
  }
  const winner = ranking[0];
  if (!winner) {
    return { kind: "clean", winner: null, ranking };
  }
  return { kind: "clean", winner, ranking };
}
