import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

import { computeStage1Cutoff, type Stage1CutoffResult } from "./counting";
import {
  stage1ElectionRowSchema,
  stage1FacultyRowSchema,
  stage1FinalistRowSchema,
  stage1MarkersRowSchema,
  stage1VoteRowSchema,
} from "./schemas";

/**
 * Per-department Stage-1 results for one Election (spec §14 task 10).
 *
 * Aggregates only (spec §7): vote rows are counted per Candidate in memory
 * — the query selects `candidate_faculty_id` + `department_id` for
 * `(election, FACULTY)` and never touches `voting_tokens`, so no
 * voter→choice path exists on this read. Candidate names come from the
 * `faculty` roster admins already manage; raw Codes and token hashes appear
 * nowhere here.
 *
 * Zero-vote Candidates are included: every eligible (non-archived) faculty
 * member in a participating department appears in `counts` even with no
 * votes, because a 3rd-place total of zero shared by more Candidates than
 * seats remain is still a cutoff Tie. Votes standing on since-archived
 * faculty are also tallied (votes stand per the churn rules); the counts
 * report what was cast, honestly.
 *
 * Participation scope matches the faculty Code status query: departments
 * attached via `election_departments` only, or every department when nothing
 * is attached yet.
 */

const departmentRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  picture_url: z.string().nullable().optional(),
});

const voteScopeRowSchema = stage1VoteRowSchema.extend({
  department_id: z.uuid(),
});

const facultyScopeRowSchema = stage1FacultyRowSchema.extend({
  department_id: z.uuid(),
  archived_at: z.string().nullable(),
});

const finalistScopeRowSchema = stage1FinalistRowSchema.extend({
  department_id: z.uuid(),
});

export interface Stage1DepartmentTally {
  department: {
    id: string;
    code: string;
    name: string;
    picture_url?: string | null;
  };
  participating: boolean;
  hasParticipationRow: boolean;
  finalistsLockedAt: string | null;
  winnerPublishedAt: string | null;
  tiePending: boolean;
  totalVotes: number;
  /** Per-Candidate aggregates, sorted (votes desc, name, id). Zero votes included. */
  counts: Array<{ candidateId: string; fullName: string; votes: number }>;
  cutoff: Stage1CutoffResult;
  /** Frozen snapshot rows (empty until frozen), ordered by rank. */
  finalists: Array<{
    facultyId: string;
    fullName: string;
    stage1Votes: number;
    rank: number;
  }>;
}

export interface Stage1ResultsTotals {
  facultyVotes: number;
  departments: number;
  tied: number;
  locked: number;
}

export interface Stage1ResultsData {
  electionId: string;
  stage: string;
  /** Frozen `tie_policy_locked_at` (null when the policy is not frozen yet). */
  policyVersion: string | null;
  departments: Stage1DepartmentTally[];
  totals: Stage1ResultsTotals;
}

export type Stage1ResultsResult =
  | { ok: true; results: Stage1ResultsData }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "DB_ERROR";
      message: string;
    };

export async function getStage1Results(
  electionId: string,
): Promise<Stage1ResultsResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in as an admin to view faculty results.",
    };
  }

  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError ?? isAdmin !== true) {
    return {
      ok: false,
      code: "FORBIDDEN",
      message: "Admin access required. Sign in with an admin account.",
    };
  }

  const { data: electionData, error: electionError } = await supabase
    .from("elections")
    .select("id, stage, tie_policy_locked_at")
    .eq("id", electionId)
    .maybeSingle();
  if (electionError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load the Election. Try again.",
    };
  }
  const election = stage1ElectionRowSchema.safeParse(electionData);
  if (!election.success || !electionData) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Election not found. It may have been deleted already.",
    };
  }

  const { data: departmentRows, error: departmentsError } = await supabase
    .from("departments")
    .select("id, code, name, picture_url")
    .order("code", { ascending: true });
  if (departmentsError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load departments. Try again.",
    };
  }
  const departmentsParse = departmentRowSchema
    .array()
    .safeParse(departmentRows ?? []);
  if (!departmentsParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load departments. Try again.",
    };
  }

  const { data: markerRows, error: markersError } = await supabase
    .from("election_departments")
    .select(
      "election_id, department_id, finalists_locked_at, winner_published_at, tie_pending",
    )
    .eq("election_id", electionId);
  if (markersError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load department gates. Try again.",
    };
  }
  const markersParse = stage1MarkersRowSchema
    .array()
    .safeParse(markerRows ?? []);
  if (!markersParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load department gates. Try again.",
    };
  }
  const markersByDepartment = new Map(
    markersParse.data.map((row) => [row.department_id, row]),
  );
  const participatingIds =
    markersParse.data.length === 0
      ? null
      : new Set(markersParse.data.map((row) => row.department_id));

  const { data: facultyRows, error: facultyError } = await supabase
    .from("faculty")
    .select("id, department_id, full_name, archived_at")
    .order("full_name", { ascending: true });
  if (facultyError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty. Try again.",
    };
  }
  const facultyParse = facultyScopeRowSchema
    .array()
    .safeParse(facultyRows ?? []);
  if (!facultyParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty. Try again.",
    };
  }
  const facultyById = new Map(
    facultyParse.data.map((row) => [row.id, row]),
  );

  // Aggregate-only vote read: candidate + department + stage scope, counted
  // in memory below. No token/voter column is selected (none exists).
  const { data: voteRows, error: votesError } = await supabase
    .from("votes")
    .select("candidate_faculty_id, department_id")
    .eq("election_id", electionId)
    .eq("stage", "FACULTY");
  if (votesError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty votes. Try again.",
    };
  }
  const votesParse = voteScopeRowSchema.array().safeParse(voteRows ?? []);
  if (!votesParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty votes. Try again.",
    };
  }

  const { data: finalistRows, error: finalistsError } = await supabase
    .from("finalists")
    .select("department_id, faculty_id, stage1_votes, rank")
    .eq("election_id", electionId)
    .order("rank", { ascending: true });
  if (finalistsError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load frozen Finalists. Try again.",
    };
  }
  const finalistsParse = finalistScopeRowSchema
    .array()
    .safeParse(finalistRows ?? []);
  if (!finalistsParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load frozen Finalists. Try again.",
    };
  }
  const finalistsByDepartment = new Map<
    string,
    Array<{ facultyId: string; fullName: string; stage1Votes: number; rank: number }>
  >();
  for (const row of finalistsParse.data) {
    const list = finalistsByDepartment.get(row.department_id) ?? [];
    list.push({
      facultyId: row.faculty_id,
      fullName: facultyById.get(row.faculty_id)?.full_name ?? "Unknown faculty",
      stage1Votes: row.stage1_votes,
      rank: row.rank,
    });
    finalistsByDepartment.set(row.department_id, list);
  }

  const votesByDepartment = new Map<string, Map<string, number>>();
  for (const vote of votesParse.data) {
    let perCandidate = votesByDepartment.get(vote.department_id);
    if (!perCandidate) {
      perCandidate = new Map();
      votesByDepartment.set(vote.department_id, perCandidate);
    }
    perCandidate.set(
      vote.candidate_faculty_id,
      (perCandidate.get(vote.candidate_faculty_id) ?? 0) + 1,
    );
  }

  const tallies: Stage1DepartmentTally[] = departmentsParse.data.map(
    (department) => {
      const participating =
        participatingIds === null || participatingIds.has(department.id);
      const markers = markersByDepartment.get(department.id) ?? null;
      if (!participating) {
        return {
          department,
          participating,
          hasParticipationRow: markers !== null,
          finalistsLockedAt: markers?.finalists_locked_at ?? null,
          winnerPublishedAt: markers?.winner_published_at ?? null,
          tiePending: markers?.tie_pending ?? false,
          totalVotes: 0,
          counts: [],
          cutoff: { kind: "clean", top3: [] } as Stage1CutoffResult,
          finalists: [],
        };
      }
      const perCandidate =
        votesByDepartment.get(department.id) ?? new Map<string, number>();
      // Eligible roster (zero votes included) plus any vote-getter whose row
      // has since been archived — their votes stand, so they are tallied.
      const candidateIds = new Set<string>(perCandidate.keys());
      for (const member of facultyParse.data) {
        if (
          member.department_id === department.id &&
          member.archived_at === null
        ) {
          candidateIds.add(member.id);
        }
      }
      const counts = [...candidateIds].map((candidateId) => ({
        candidateId,
        fullName: facultyById.get(candidateId)?.full_name ?? "Unknown faculty",
        votes: perCandidate.get(candidateId) ?? 0,
      }));
      const cutoff = computeStage1Cutoff(counts);
      // Display order matches the counting order (votes desc, name, id).
      const sorted = [...counts].sort((a, b) => {
        if (b.votes !== a.votes) {
          return b.votes - a.votes;
        }
        if (a.fullName !== b.fullName) {
          return a.fullName < b.fullName ? -1 : 1;
        }
        return a.candidateId < b.candidateId ? -1 : 1;
      });
      const totalVotes = [...perCandidate.values()].reduce(
        (sum, votes) => sum + votes,
        0,
      );
      return {
        department,
        participating,
        hasParticipationRow: markers !== null,
        finalistsLockedAt: markers?.finalists_locked_at ?? null,
        winnerPublishedAt: markers?.winner_published_at ?? null,
        tiePending: markers?.tie_pending ?? false,
        totalVotes,
        counts: sorted,
        cutoff,
        finalists: finalistsByDepartment.get(department.id) ?? [],
      };
    },
  );

  const totals: Stage1ResultsTotals = {
    facultyVotes: tallies.reduce((sum, tally) => sum + tally.totalVotes, 0),
    departments: tallies.filter((tally) => tally.participating).length,
    tied: tallies.filter(
      (tally) => tally.participating && tally.cutoff.kind === "tie",
    ).length,
    locked: tallies.filter(
      (tally) => tally.participating && tally.finalistsLockedAt !== null,
    ).length,
  };

  return {
    ok: true,
    results: {
      electionId,
      stage: election.data.stage,
      policyVersion: election.data.tie_policy_locked_at,
      departments: tallies,
      totals,
    },
  };
}
