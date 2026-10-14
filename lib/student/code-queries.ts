import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

import { facultyDepartmentRowSchema } from "@/lib/faculty/schemas";

/**
 * Per-department student Code status for one Election (spec §14 task 11).
 *
 * Counts over `voting_tokens` rows with `token_type='STUDENT'`, grouped by
 * department — aggregates only. Raw Codes never appear here: only
 * `SHA-256(pepper + Code)` hashes live in `voting_tokens`, so issued Codes
 * are unrecoverable after the generation response. The one-time export is
 * built client-side from that response and never re-fetched.
 *
 * Participation scope mirrors the faculty status query: departments
 * attached to the Election via `election_departments`. An Election with no
 * participation rows yet treats every department as participating, so Codes
 * can be generated ahead of the attach step.
 */

const participationRowSchema = z.object({
  department_id: z.uuid(),
});

const studentTokenRowSchema = z.object({
  department_id: z.uuid(),
  used: z.boolean(),
  invalidated_at: z.string().nullable(),
});

export interface DepartmentStudentCodeStatus {
  department: { id: string; code: string; name: string };
  participating: boolean;
  /** All STUDENT Token rows ever issued for (election, department). */
  generated: number;
  /** USED Tokens — vote cast, Code burned, never regenerated. */
  used: number;
  /** Live unused Tokens — Codes still able to vote. */
  remaining: number;
  /** Invalidated Tokens — lapsed history, counted in generated only. */
  invalidated: number;
}

export interface StudentCodeStatusTotals {
  generated: number;
  used: number;
  remaining: number;
  invalidated: number;
}

export type StudentCodeStatusResult =
  | {
      ok: true;
      electionId: string;
      statuses: DepartmentStudentCodeStatus[];
      totals: StudentCodeStatusTotals;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "DB_ERROR";
      message: string;
    };

export async function getStudentCodeStatus(
  electionId: string,
): Promise<StudentCodeStatusResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in as an admin to view student Codes.",
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

  const { data: election, error: electionError } = await supabase
    .from("elections")
    .select("id")
    .eq("id", electionId)
    .maybeSingle();
  if (electionError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load the Election. Try again.",
    };
  }
  if (!election) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Election not found. It may have been deleted already.",
    };
  }

  const { data: departmentRows, error: departmentsError } = await supabase
    .from("departments")
    .select("id, code, name")
    .order("code", { ascending: true });
  if (departmentsError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load departments. Try again.",
    };
  }
  const departmentsParse = facultyDepartmentRowSchema
    .array()
    .safeParse(departmentRows ?? []);
  if (!departmentsParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load departments. Try again.",
    };
  }

  const { data: participationRows, error: participationError } = await supabase
    .from("election_departments")
    .select("department_id")
    .eq("election_id", electionId);
  if (participationError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load Election participation. Try again.",
    };
  }
  const participationParse = participationRowSchema
    .array()
    .safeParse(participationRows ?? []);
  if (!participationParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load Election participation. Try again.",
    };
  }
  const participatingIds =
    participationParse.data.length === 0
      ? null
      : new Set(participationParse.data.map((row) => row.department_id));

  const allTokenRows: Array<unknown> = [];
  const PAGE_SIZE = 1000;
  let from = 0;
  while (true) {
    const { data: page, error: tokensError } = await supabase
      .from("voting_tokens")
      .select("department_id, used, invalidated_at")
      .eq("election_id", electionId)
      .eq("token_type", "STUDENT")
      .range(from, from + PAGE_SIZE - 1);
    if (tokensError) {
      return {
        ok: false,
        code: "DB_ERROR",
        message: "Could not load student Tokens. Try again.",
      };
    }
    if (!page || page.length === 0) {
      break;
    }
    allTokenRows.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
    from += PAGE_SIZE;
  }

  const tokensParse = studentTokenRowSchema
    .array()
    .safeParse(allTokenRows);
  if (!tokensParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load student Tokens. Try again.",
    };
  }

  const totals: StudentCodeStatusTotals = {
    generated: 0,
    used: 0,
    remaining: 0,
    invalidated: 0,
  };

  const statuses: DepartmentStudentCodeStatus[] = departmentsParse.data.map(
    (department) => {
      const participating =
        participatingIds === null || participatingIds.has(department.id);
      let generated = 0;
      let used = 0;
      let remaining = 0;
      let invalidated = 0;
      if (participating) {
        for (const token of tokensParse.data) {
          if (token.department_id !== department.id) {
            continue;
          }
          generated += 1;
          if (token.invalidated_at !== null) {
            invalidated += 1;
          } else if (token.used) {
            used += 1;
          } else {
            remaining += 1;
          }
        }
      }
      totals.generated += generated;
      totals.used += used;
      totals.remaining += remaining;
      totals.invalidated += invalidated;
      return {
        department,
        participating,
        generated,
        used,
        remaining,
        invalidated,
      };
    },
  );

  return { ok: true, electionId, statuses, totals };
}
