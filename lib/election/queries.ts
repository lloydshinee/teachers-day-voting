import "server-only";

import { z } from "zod";

import { requireAdminSession } from "@/lib/auth/admin-session";
import { getFacultyCodeStatus, type DepartmentCodeStatus } from "@/lib/faculty/code-queries";
import { getStage1Results, type Stage1DepartmentTally } from "@/lib/stage1/queries";
import { getStage2Results, type Stage2DepartmentTally } from "@/lib/stage2/queries";
import { getStudentCodeStatus, type DepartmentStudentCodeStatus } from "@/lib/student/code-queries";
import { createClient } from "@/lib/supabase/server";

import { electionStageSchema } from "./stages";

/**
 * Election lookup for admin Code workflows (spec §14 task 8).
 *
 * Voting Tokens are per-election rows, so faculty Code generation and status
 * are always scoped to one Election (GLOSSARY.md: one running of the
 * Teachers' Day vote, with its own departments, tokens, votes, finalists,
 * and results). This module lists Elections for the admin picker and
 * consolidates the Election lifecycle read model.
 */

export const electionRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  academic_year: z.string(),
  stage: electionStageSchema,
});

export type ElectionRow = z.infer<typeof electionRowSchema>;

export type ElectionListResult =
  | { ok: true; elections: ElectionRow[] }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "DB_ERROR";
      message: string;
    };

/** Admin-only Election list, newest academic year first. */
export async function listElections(): Promise<ElectionListResult> {
  const gate = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to view Elections.",
  });
  if (!gate.ok) {
    return gate;
  }

  const supabase = await createClient();
  const { data: rows, error } = await supabase
    .from("elections")
    .select("id, name, academic_year, stage")
    .order("academic_year", { ascending: false })
    .order("name", { ascending: true });
  if (error) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load Elections. Try again.",
    };
  }

  const parsed = electionRowSchema.array().safeParse(rows ?? []);
  if (!parsed.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load Elections. Try again.",
    };
  }
  return { ok: true, elections: parsed.data };
}

const electionMetaRowSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  academic_year: z.string(),
  stage: z.string(),
});

const electionIdSchema = z.uuid();

export interface ElectionLifecycleDepartmentRow {
  department: {
    id: string;
    code: string;
    name: string;
    picture_url?: string | null;
  };
  participating: boolean;
  tiePending: boolean;
  /** Stage-1 cutoff Tie (two or more Candidates sharing the 3rd-place total). */
  stage1Tie: boolean;
  /** Stage-2 Winner Tie (two or more Finalists sharing the top total). */
  stage2Tie: boolean;
  finalistsLockedAt: string | null;
  winnerPublishedAt: string | null;
  winnerPublished: boolean;
  /** Faculty Code aggregates for (Election, department): counts + missing roster names only. */
  facultyCodes: DepartmentCodeStatus;
  /** Student Code aggregates for (Election, department): counts only. */
  studentCodes: DepartmentStudentCodeStatus;
  /** Stage-1 per-Candidate aggregates + cutoff/Tie state + frozen Finalists. */
  stage1: Stage1DepartmentTally;
  /** Stage-2 per-Finalist aggregates + Winner/Tie state + published Winner. */
  stage2: Stage2DepartmentTally;
}

export interface ElectionLifecycleTotals {
  departments: number;
  facultyEligible: number;
  facultyVotes: number;
  studentCodesGenerated: number;
  studentVotes: number;
  departmentsWithStage1Tie: number;
  departmentsWithStage2Tie: number;
  departmentsLocked: number;
  departmentsPublished: number;
}

export interface ElectionLifecycleData {
  election: {
    id: string;
    name: string;
    academicYear: string;
    stage: string;
  };
  policyVersion: string | null;
  departments: ElectionLifecycleDepartmentRow[];
  totals: ElectionLifecycleTotals;
}

export type ElectionLifecycleViewResult =
  | { ok: true; data: ElectionLifecycleData }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_INPUT" | "DB_ERROR";
      message: string;
    };

/**
 * Consolidated Election lifecycle view: status banner, stage, departmental
 * markers (Finalists locked, Winner published, Tie pending), Code statuses,
 * and vote aggregates across all participating departments.
 */
export async function getElectionLifecycleView(
  electionId: string,
): Promise<ElectionLifecycleViewResult> {
  if (!electionIdSchema.safeParse(electionId).success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Election not found. It may have been deleted already.",
    };
  }

  const gate = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to view the Election dashboard.",
  });
  if (!gate.ok) {
    return gate;
  }

  const supabase = await createClient();
  const { data: electionData, error: electionError } = await supabase
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

  const electionParse = electionMetaRowSchema.safeParse(electionData);
  if (!electionParse.success || !electionData) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Election not found. It may have been deleted already.",
    };
  }

  const [stage1, stage2, facultyCodes, studentCodes] = await Promise.all([
    getStage1Results(electionId),
    getStage2Results(electionId),
    getFacultyCodeStatus(electionId),
    getStudentCodeStatus(electionId),
  ]);

  if (!stage1.ok) {
    return stage1.code === "NOT_FOUND"
      ? {
          ok: false,
          code: "NOT_FOUND",
          message: "Election not found. It may have been deleted already.",
        }
      : {
          ok: false,
          code: "DB_ERROR",
          message: "Could not load faculty vote aggregates. Try again.",
        };
  }
  if (!stage2.ok) {
    return stage2.code === "NOT_FOUND"
      ? {
          ok: false,
          code: "NOT_FOUND",
          message: "Election not found. It may have been deleted already.",
        }
      : {
          ok: false,
          code: "DB_ERROR",
          message: "Could not load student vote aggregates. Try again.",
        };
  }
  if (!facultyCodes.ok) {
    return facultyCodes.code === "NOT_FOUND"
      ? {
          ok: false,
          code: "NOT_FOUND",
          message: "Election not found. It may have been deleted already.",
        }
      : {
          ok: false,
          code: "DB_ERROR",
          message: "Could not load faculty Code aggregates. Try again.",
        };
  }
  if (!studentCodes.ok) {
    return studentCodes.code === "NOT_FOUND"
      ? {
          ok: false,
          code: "NOT_FOUND",
          message: "Election not found. It may have been deleted already.",
        }
      : {
          ok: false,
          code: "DB_ERROR",
          message: "Could not load student Code aggregates. Try again.",
        };
  }

  const stage2ByDepartment = new Map(
    stage2.results.departments.map((tally) => [tally.department.id, tally]),
  );
  const facultyCodesByDepartment = new Map(
    facultyCodes.statuses.map((status) => [status.department.id, status]),
  );
  const studentCodesByDepartment = new Map(
    studentCodes.statuses.map((status) => [status.department.id, status]),
  );

  const departments: ElectionLifecycleDepartmentRow[] = [];
  for (const tally of stage1.results.departments) {
    const stage2Tally = stage2ByDepartment.get(tally.department.id);
    const facultyStatus = facultyCodesByDepartment.get(tally.department.id);
    const studentStatus = studentCodesByDepartment.get(tally.department.id);
    if (!stage2Tally || !facultyStatus || !studentStatus) {
      return {
        ok: false,
        code: "DB_ERROR",
        message: "Could not load the Election dashboard. Try again.",
      };
    }
    const stage1Tie =
      tally.participating && tally.cutoff.kind === "tie";
    const stage2Tie =
      stage2Tally.participating && stage2Tally.winnerResult.kind === "tie";
    departments.push({
      department: { ...tally.department },
      participating: tally.participating,
      tiePending: tally.tiePending,
      stage1Tie,
      stage2Tie,
      finalistsLockedAt: tally.finalistsLockedAt,
      winnerPublishedAt: tally.winnerPublishedAt,
      winnerPublished: stage2Tally.published?.published === true,
      facultyCodes: facultyStatus,
      studentCodes: studentStatus,
      stage1: tally,
      stage2: stage2Tally,
    });
  }

  const participating = departments.filter((row) => row.participating);
  const totals: ElectionLifecycleTotals = {
    departments: participating.length,
    facultyEligible: facultyCodes.totals.eligible,
    facultyVotes: stage1.results.totals.facultyVotes,
    studentCodesGenerated: studentCodes.totals.generated,
    studentVotes: stage2.results.totals.studentVotes,
    departmentsWithStage1Tie: participating.filter((row) => row.stage1Tie).length,
    departmentsWithStage2Tie: participating.filter((row) => row.stage2Tie).length,
    departmentsLocked: participating.filter((row) => row.finalistsLockedAt !== null).length,
    departmentsPublished: participating.filter((row) => row.winnerPublished).length,
  };

  return {
    ok: true,
    data: {
      election: {
        id: electionParse.data.id,
        name: electionParse.data.name,
        academicYear: electionParse.data.academic_year,
        stage: electionParse.data.stage,
      },
      policyVersion: stage1.results.policyVersion,
      departments,
      totals,
    },
  };
}
