import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

import { computeStage2Winner, type Stage2WinnerResult } from "./counting";
import {
  stage2ElectionRowSchema,
  stage2FacultyRowSchema,
  stage2FinalistRowSchema,
  stage2MarkersRowSchema,
  stage2ResultRowSchema,
  stage2VoteRowSchema,
} from "./schemas";

/**
 * Per-department Stage-2 results for one Election (spec §14 task 13).
 *
 * Aggregates only (spec §7): student-vote rows are counted per Finalist in
 * memory — the query selects `candidate_faculty_id` + `department_id` for
 * `(election, STUDENT)` and never touches `voting_tokens`, so no
 * voter→choice path exists on this read. Counts are validated against the
 * frozen `finalists` snapshot: only votes whose candidate is a frozen
 * Finalist enter the Winner math. Votes for non-Finalists cannot be cast
 * (the `cast_student_vote` transaction rejects them); when such rows appear
 * anyway they are reported as `ignoredVotes` and excluded.
 *
 * Participation scope matches the Stage-1 query: departments attached via
 * `election_departments` only, or every department when nothing is attached
 * yet.
 */

const departmentRowSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  picture_url: z.string().nullable().optional(),
});

const voteScopeRowSchema = stage2VoteRowSchema.extend({
  department_id: z.uuid(),
});

const finalistScopeRowSchema = stage2FinalistRowSchema.extend({
  department_id: z.uuid(),
});

const resultScopeRowSchema = stage2ResultRowSchema.extend({
  department_id: z.uuid(),
});

export interface Stage2DepartmentTally {
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
  /** STUDENT votes for frozen Finalists in this department. */
  totalVotes: number;
  /** STUDENT votes for non-Finalists (excluded from Winner math; expected 0). */
  ignoredVotes: number;
  /** Per-Finalist aggregates, sorted (votes desc, name, id). */
  counts: Array<{ finalistId: string; fullName: string; votes: number }>;
  winnerResult: Stage2WinnerResult;
  /** Frozen snapshot rows (empty until Stage-1 freeze), ordered by rank. */
  finalists: Array<{
    facultyId: string;
    fullName: string;
    stage1Votes: number;
    rank: number;
  }>;
  /** Published-Winner row when one exists (published or staged by Tie pick). */
  published: {
    winnerFacultyId: string;
    winnerFullName: string;
    published: boolean;
    policyVersion: string | null;
  } | null;
}

export interface Stage2ResultsTotals {
  studentVotes: number;
  departments: number;
  tied: number;
  locked: number;
  published: number;
}

export interface Stage2ResultsData {
  electionId: string;
  stage: string;
  /** Frozen `tie_policy_locked_at` (null when the policy is not frozen yet). */
  policyVersion: string | null;
  departments: Stage2DepartmentTally[];
  totals: Stage2ResultsTotals;
}

export type Stage2ResultsResult =
  | { ok: true; results: Stage2ResultsData }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "DB_ERROR";
      message: string;
    };

export async function getStage2Results(
  electionId: string,
): Promise<Stage2ResultsResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in as an admin to view final results.",
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
  const election = stage2ElectionRowSchema.safeParse(electionData);
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
  const markersParse = stage2MarkersRowSchema
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
    .select("id, full_name")
    .order("full_name", { ascending: true });
  if (facultyError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty. Try again.",
    };
  }
  const facultyParse = stage2FacultyRowSchema
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
    facultyParse.data.map((row) => [row.id, row.full_name] as const),
  );

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
      fullName: facultyById.get(row.faculty_id) ?? "Unknown faculty",
      stage1Votes: row.stage1_votes,
      rank: row.rank,
    });
    finalistsByDepartment.set(row.department_id, list);
  }

  // Aggregate-only student-vote read: candidate + department scope, counted
  // in memory below against the frozen snapshot. No token/voter column is
  // selected (none exists).
  const allVoteRows: Array<unknown> = [];
  const VOTE_PAGE_SIZE = 1000;
  let voteFrom = 0;
  while (true) {
    const { data: page, error: votesError } = await supabase
      .from("votes")
      .select("candidate_faculty_id, department_id")
      .eq("election_id", electionId)
      .eq("stage", "STUDENT")
      .range(voteFrom, voteFrom + VOTE_PAGE_SIZE - 1);
    if (votesError) {
      return {
        ok: false,
        code: "DB_ERROR",
        message: "Could not load student votes. Try again.",
      };
    }
    if (!page || page.length === 0) {
      break;
    }
    allVoteRows.push(...page);
    if (page.length < VOTE_PAGE_SIZE) {
      break;
    }
    voteFrom += VOTE_PAGE_SIZE;
  }
  const votesParse = voteScopeRowSchema.array().safeParse(allVoteRows);
  if (!votesParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load student votes. Try again.",
    };
  }
  const votesByDepartment = new Map<string, Map<string, number>>();
  for (const vote of votesParse.data) {
    let perFinalist = votesByDepartment.get(vote.department_id);
    if (!perFinalist) {
      perFinalist = new Map();
      votesByDepartment.set(vote.department_id, perFinalist);
    }
    perFinalist.set(
      vote.candidate_faculty_id,
      (perFinalist.get(vote.candidate_faculty_id) ?? 0) + 1,
    );
  }

  const { data: publishedRows, error: publishedError } = await supabase
    .from("election_results")
    .select("department_id, winner_faculty_id, published, policy_version")
    .eq("election_id", electionId);
  if (publishedError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load published Winners. Try again.",
    };
  }
  const publishedParse = resultScopeRowSchema
    .array()
    .safeParse(publishedRows ?? []);
  if (!publishedParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load published Winners. Try again.",
    };
  }
  const publishedByDepartment = new Map(
    publishedParse.data.map((row) => [row.department_id, row]),
  );

  const tallies: Stage2DepartmentTally[] = departmentsParse.data.map(
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
          ignoredVotes: 0,
          counts: [],
          winnerResult: {
            kind: "clean",
            winner: null,
            ranking: [],
          } as Stage2WinnerResult,
          finalists: [],
          published: null,
        };
      }
      const snapshot = finalistsByDepartment.get(department.id) ?? [];
      const snapshotIds = new Set(
        snapshot.map((entry) => entry.facultyId),
      );
      const perFinalist =
        votesByDepartment.get(department.id) ?? new Map<string, number>();
      // Snapshot-validated counts: only frozen Finalists enter the Winner
      // math. Anything else is reported as ignored (expected: none).
      const counts = snapshot.map((entry) => ({
        finalistId: entry.facultyId,
        fullName: entry.fullName,
        votes: perFinalist.get(entry.facultyId) ?? 0,
      }));
      let ignoredVotes = 0;
      for (const [candidateId, votes] of perFinalist) {
        if (!snapshotIds.has(candidateId)) {
          ignoredVotes += votes;
        }
      }
      const winnerResult = computeStage2Winner(counts);
      // Display order matches the counting order (votes desc, name, id).
      const sorted = [...counts].sort((a, b) => {
        if (b.votes !== a.votes) {
          return b.votes - a.votes;
        }
        if (a.fullName !== b.fullName) {
          return a.fullName < b.fullName ? -1 : 1;
        }
        return a.finalistId < b.finalistId ? -1 : 1;
      });
      const totalVotes = [...perFinalist.entries()]
        .filter(([candidateId]) => snapshotIds.has(candidateId))
        .reduce((sum, [, votes]) => sum + votes, 0);
      const publishedRow = publishedByDepartment.get(department.id) ?? null;
      return {
        department,
        participating,
        hasParticipationRow: markers !== null,
        finalistsLockedAt: markers?.finalists_locked_at ?? null,
        winnerPublishedAt: markers?.winner_published_at ?? null,
        tiePending: markers?.tie_pending ?? false,
        totalVotes,
        ignoredVotes,
        counts: sorted,
        winnerResult,
        finalists: snapshot,
        published:
          publishedRow === null
            ? null
            : {
                winnerFacultyId: publishedRow.winner_faculty_id,
                winnerFullName:
                  facultyById.get(publishedRow.winner_faculty_id) ??
                  "Unknown faculty",
                published: publishedRow.published,
                policyVersion: publishedRow.policy_version,
              },
      };
    },
  );

  const totals: Stage2ResultsTotals = {
    studentVotes: tallies.reduce((sum, tally) => sum + tally.totalVotes, 0),
    departments: tallies.filter((tally) => tally.participating).length,
    tied: tallies.filter(
      (tally) => tally.participating && tally.winnerResult.kind === "tie",
    ).length,
    locked: tallies.filter(
      (tally) => tally.participating && tally.finalistsLockedAt !== null,
    ).length,
    published: tallies.filter(
      (tally) => tally.participating && tally.published?.published === true,
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

// ---------------------------------------------------------------------------
// Published results (public): `election_results` + `finalists` only.
// ---------------------------------------------------------------------------

/**
 * Published Winners for one Election, for the public results page
 * (spec §12: published pages read `election_results` + `finalists` only —
 * never live vote rows).
 *
 * This function never queries `votes` or `voting_tokens`: the only data
 * sources are the per-department published `election_results` rows
 * (`published = true`), the frozen `finalists` snapshot, and the faculty
 * names admins already publish. It runs through the service-role client so
 * the public page needs no admin session, but it is still aggregate-safe
 * by construction — Winner names plus the frozen snapshot, nothing else.
 * Raw Codes and token hashes appear nowhere here.
 */

const publishedElectionRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  academic_year: z.string(),
  stage: z.string(),
});

export interface PublishedDepartmentResult {
  department: {
    id: string;
    code: string;
    name: string;
    pictureUrl?: string | null;
  };
  winner: { facultyId: string; fullName: string; pictureUrl?: string | null };
  policyVersion: string | null;
  finalists: Array<{
    facultyId: string;
    fullName: string;
    stage1Votes: number;
    rank: number;
    pictureUrl?: string | null;
  }>;
}

export interface PublishedResultsData {
  electionId: string;
  electionName: string;
  academicYear: string;
  departments: PublishedDepartmentResult[];
}

export type PublishedResultsResult =
  | { ok: true; results: PublishedResultsData }
  | { ok: false; code: "NOT_FOUND" | "DB_ERROR"; message: string };

export async function getPublishedResults(
  electionId: string,
): Promise<PublishedResultsResult> {
  const serviceRole = createServiceRoleClient();

  const { data: electionData, error: electionError } = await serviceRole
    .from("elections")
    .select("id, name, academic_year, stage")
    .eq("id", electionId)
    .maybeSingle();
  if (electionError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load the Election. Try again.",
    };
  }
  const election = publishedElectionRowSchema.safeParse(electionData);
  if (!election.success || !electionData) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Election not found. It may have been deleted already.",
    };
  }

  const { data: departmentRows, error: departmentsError } = await serviceRole
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

  const { data: facultyRows, error: facultyError } = await serviceRole
    .from("faculty")
    .select("id, full_name, picture_url");
  if (facultyError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty. Try again.",
    };
  }
  const facultyParse = stage2FacultyRowSchema
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
    facultyParse.data.map(
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

  const { data: finalistRows, error: finalistsError } = await serviceRole
    .from("finalists")
    .select("department_id, faculty_id, stage1_votes, rank")
    .eq("election_id", electionId)
    .order("rank", { ascending: true });
  if (finalistsError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load Finalists. Try again.",
    };
  }
  const finalistsParse = finalistScopeRowSchema
    .array()
    .safeParse(finalistRows ?? []);
  if (!finalistsParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load Finalists. Try again.",
    };
  }
  const finalistsByDepartment = new Map<
    string,
    PublishedDepartmentResult["finalists"]
  >();
  for (const row of finalistsParse.data) {
    const list = finalistsByDepartment.get(row.department_id) ?? [];
    const faculty = facultyById.get(row.faculty_id);
    list.push({
      facultyId: row.faculty_id,
      fullName: faculty?.fullName ?? "Unknown faculty",
      stage1Votes: row.stage1_votes,
      rank: row.rank,
      pictureUrl: faculty?.pictureUrl ?? null,
    });
    finalistsByDepartment.set(row.department_id, list);
  }

  // Published Winners only. No `votes` table read exists in this function.
  const { data: publishedRows, error: publishedError } = await serviceRole
    .from("election_results")
    .select("department_id, winner_faculty_id, published, policy_version")
    .eq("election_id", electionId)
    .eq("published", true);
  if (publishedError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load published Winners. Try again.",
    };
  }
  const publishedParse = resultScopeRowSchema
    .array()
    .safeParse(publishedRows ?? []);
  if (!publishedParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load published Winners. Try again.",
    };
  }

  const departments: PublishedDepartmentResult[] = [];
  for (const row of publishedParse.data) {
    const department = departmentsParse.data.find(
      (entry) => entry.id === row.department_id,
    );
    if (!department) {
      continue;
    }
    const winnerFaculty = facultyById.get(row.winner_faculty_id);
    departments.push({
      department: {
        id: department.id,
        code: department.code,
        name: department.name,
        pictureUrl: department.picture_url ?? null,
      },
      winner: {
        facultyId: row.winner_faculty_id,
        fullName: winnerFaculty?.fullName ?? "Unknown faculty",
        pictureUrl: winnerFaculty?.pictureUrl ?? null,
      },
      policyVersion: row.policy_version,
      finalists: finalistsByDepartment.get(row.department_id) ?? [],
    });
  }
  departments.sort((a, b) =>
    a.department.code < b.department.code
      ? -1
      : a.department.code > b.department.code
        ? 1
        : 0,
  );

  return {
    ok: true,
    results: {
      electionId,
      electionName: election.data.name,
      academicYear: election.data.academic_year,
      departments,
    },
  };
}

/**
 * Elections with at least one published Winner, for the public results
 * picker. Election names with published Winners are public by definition;
 * no vote, token, or audit data is read here.
 */
export interface PublishedElectionEntry {
  id: string;
  name: string;
  academicYear: string;
}

export type PublishedElectionListResult =
  | { ok: true; elections: PublishedElectionEntry[] }
  | { ok: false; code: "DB_ERROR"; message: string };

const publishedElectionEntrySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  academic_year: z.string(),
});

export async function listPublishedElections(): Promise<PublishedElectionListResult> {
  const serviceRole = createServiceRoleClient();

  const { data: resultRows, error: resultsError } = await serviceRole
    .from("election_results")
    .select("election_id")
    .eq("published", true);
  if (resultsError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load published results. Try again.",
    };
  }
  const idsParse = z
    .object({ election_id: z.uuid() })
    .array()
    .safeParse(resultRows ?? []);
  if (!idsParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load published results. Try again.",
    };
  }
  const publishedIds = [...new Set(idsParse.data.map((row) => row.election_id))];
  if (publishedIds.length === 0) {
    return { ok: true, elections: [] };
  }

  const { data: electionRows, error: electionsError } = await serviceRole
    .from("elections")
    .select("id, name, academic_year")
    .in("id", publishedIds)
    .order("academic_year", { ascending: false })
    .order("name", { ascending: true });
  if (electionsError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load published results. Try again.",
    };
  }
  const electionsParse = publishedElectionEntrySchema
    .array()
    .safeParse(electionRows ?? []);
  if (!electionsParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load published results. Try again.",
    };
  }
  return {
    ok: true,
    elections: electionsParse.data.map((row) => ({
      id: row.id,
      name: row.name,
      academicYear: row.academic_year,
    })),
  };
}
