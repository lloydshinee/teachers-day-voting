/**
 * Stage-1 Top-3 counting with cutoff Tie detection (spec §12, task 10).
 *
 * Pure module (no `server-only`, no I/O) so the self-test can run it under
 * plain Node and the admin UI can import its types.
 *
 * Glossary (GLOSSARY.md) is used exactly: Tie, Candidate, Finalist.
 * A Tie is two or more Candidates in one department with equal vote counts
 * straddling an advancement cutoff. Ties never auto-resolve — the cutoff
 * check below only *detects* them; a human admin picks (spec §2d).
 *
 * Cutoff rule: sort Candidates by Stage-1 votes descending. When more than
 * three Candidates exist, the 3rd-place total is the cutoff. Candidates
 * strictly above it are locked in; Candidates exactly on it contend for the
 * seats that remain. When more Candidates share the cutoff total than seats
 * remain, the department holds with `tie_pending` and a `Tie detected`
 * banner — no Finalists are written until the manual pick.
 *
 * A Tie strictly *above* the cutoff (e.g. two Candidates tied for 1st) never
 * blocks the Top-3: all three seats are still fillable, so the result is
 * clean. Departments with three or fewer Candidates never tie either —
 * everybody advances.
 *
 * Ranks are sequential positions (1, 2, 3) in the sorted order. This is
 * deliberate: `finalists` carries `UNIQUE (election_id, department_id,
 * rank)`, so shared competition ranks (1, 1, 3) cannot be stored. The stored
 * `stage1_votes` preserves the true totals; rank is the frozen display
 * order only.
 */

export interface Stage1CandidateCount {
  /** `faculty.id` of the Candidate. */
  candidateId: string;
  /** Display name (also the deterministic tie-break after votes). */
  fullName: string;
  /** Aggregate Stage-1 (`FACULTY`) votes for this Candidate. */
  votes: number;
}

export interface Stage1Top3Entry extends Stage1CandidateCount {
  /** Frozen display order, 1-based and sequential. */
  rank: number;
}

export type Stage1CutoffResult =
  | { kind: "clean"; top3: Stage1Top3Entry[] }
  | {
      kind: "tie";
      /** The shared 3rd-place total the tied Candidates sit on. */
      cutoffVotes: number;
      /** Candidates strictly above the cutoff (already locked in). */
      lockedAbove: Stage1CandidateCount[];
      /** Candidates sharing the cutoff total (the admin picks from exactly these). */
      tied: Stage1CandidateCount[];
      /** Seats left after `lockedAbove`: the pick must fill exactly this many. */
      seatsRemaining: number;
    };

/** Number of Finalists per department (spec §12: frozen Top-3 snapshot). */
export const STAGE1_TOP_N = 3;

/**
 * Deterministic ballot order: votes descending, then name (code-unit
 * comparison, so it never varies by locale), then id as the final tie-break.
 */
export function sortStage1Counts(
  counts: readonly Stage1CandidateCount[],
): Stage1CandidateCount[] {
  return [...counts].sort((a, b) => {
    if (b.votes !== a.votes) {
      return b.votes - a.votes;
    }
    if (a.fullName !== b.fullName) {
      return a.fullName < b.fullName ? -1 : 1;
    }
    if (a.candidateId !== b.candidateId) {
      return a.candidateId < b.candidateId ? -1 : 1;
    }
    return 0;
  });
}

function withRanks(sorted: Stage1CandidateCount[]): Stage1Top3Entry[] {
  return sorted.map((entry, index) => ({ ...entry, rank: index + 1 }));
}

/**
 * Applies the Top-3 cutoff rule to aggregate per-Candidate counts.
 * Input is aggregates only (candidate + votes) — no voter-side data exists
 * on this path by construction (spec §7).
 */
export function computeStage1Cutoff(
  counts: readonly Stage1CandidateCount[],
): Stage1CutoffResult {
  const sorted = sortStage1Counts(counts);
  if (sorted.length <= STAGE1_TOP_N) {
    return { kind: "clean", top3: withRanks(sorted) };
  }
  const cutoffEntry = sorted[STAGE1_TOP_N - 1];
  if (!cutoffEntry) {
    return { kind: "clean", top3: [] };
  }
  const cutoffVotes = cutoffEntry.votes;
  const lockedAbove = sorted.filter((entry) => entry.votes > cutoffVotes);
  const tied = sorted.filter((entry) => entry.votes === cutoffVotes);
  const seatsRemaining = STAGE1_TOP_N - lockedAbove.length;
  if (tied.length > seatsRemaining) {
    return { kind: "tie", cutoffVotes, lockedAbove, tied, seatsRemaining };
  }
  return { kind: "clean", top3: withRanks(sorted.slice(0, STAGE1_TOP_N)) };
}
