import "server-only";

import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

import { facultyDepartmentRowSchema, facultyRowSchema } from "./schemas";

/**
 * Per-department faculty Code status for one Election (spec §14 task 8).
 *
 * Missing-only rule (locked, spec §6 + linkage ticket): missing = eligible
 * faculty (non-archived, in participating departments) minus holders of any
 * live Token record. **Used never counts as missing** — a faculty member who
 * already voted keeps their used record and gets no second Code. An
 * invalidated (lapsed) Token is not live, so that faculty IS missing again.
 *
 * Participation scope: departments attached to the Election via
 * `election_departments`. An Election with no participation rows yet (before
 * departments are attached) treats every department as participating, so
 * Codes can be generated ahead of the attach step.
 *
 * Aggregates only, plus the missing roster (names admins already see on the
 * faculty page) so the one-click single generation can target them. Raw
 * Codes never appear here — only hashes live in `voting_tokens`, so issued
 * Codes are unrecoverable after the generation response.
 */

const participationRowSchema = z.object({
  department_id: z.uuid(),
});

const facultyTokenRowSchema = z.object({
  faculty_id: z.uuid(),
  used: z.boolean(),
  invalidated_at: z.string().nullable(),
});

export interface MissingFacultyEntry {
  id: string;
  fullName: string;
}

export interface DepartmentCodeStatus {
  department: { id: string; code: string; name: string };
  participating: boolean;
  eligibleCount: number;
  /** Live (not invalidated) UNUSED Tokens — Codes still able to vote. */
  liveUnused: number;
  /** USED Tokens — vote cast, Code burned, never regenerated. */
  used: number;
  /** Invalidated Tokens — lapsed, holder counts as missing again. */
  invalidated: number;
  missingCount: number;
  /** Eligible faculty holding no live Token record. */
  missing: MissingFacultyEntry[];
}

export interface FacultyCodeStatusTotals {
  eligible: number;
  liveUnused: number;
  used: number;
  invalidated: number;
  missing: number;
}

export type FacultyCodeStatusResult =
  | {
      ok: true;
      electionId: string;
      statuses: DepartmentCodeStatus[];
      totals: FacultyCodeStatusTotals;
    }
  | {
      ok: false;
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "DB_ERROR";
      message: string;
    };

export async function getFacultyCodeStatus(
  electionId: string,
): Promise<FacultyCodeStatusResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      code: "UNAUTHENTICATED",
      message: "Sign in as an admin to view faculty Codes.",
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

  const { data: facultyRows, error: facultyError } = await supabase
    .from("faculty")
    .select("id, department_id, full_name, archived_at")
    .is("archived_at", null)
    .order("full_name", { ascending: true });
  if (facultyError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty. Try again.",
    };
  }
  const facultyParse = facultyRowSchema.array().safeParse(facultyRows ?? []);
  if (!facultyParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty. Try again.",
    };
  }

  const { data: tokenRows, error: tokensError } = await supabase
    .from("voting_tokens")
    .select("faculty_id, used, invalidated_at")
    .eq("election_id", electionId)
    .eq("token_type", "FACULTY");
  if (tokensError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty Tokens. Try again.",
    };
  }
  const tokensParse = facultyTokenRowSchema
    .array()
    .safeParse(tokenRows ?? []);
  if (!tokensParse.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Could not load faculty Tokens. Try again.",
    };
  }

  // Live = any record not invalidated (used rows still count as held, so
  // used faculty are never missing). Invalidated rows are dead history.
  const liveHolderIds = new Set(
    tokensParse.data
      .filter((row) => row.invalidated_at === null)
      .map((row) => row.faculty_id),
  );
  const tokensByFaculty = new Map<string, Array<{ used: boolean; invalidated: boolean }>>();
  for (const row of tokensParse.data) {
    const list = tokensByFaculty.get(row.faculty_id) ?? [];
    list.push({ used: row.used, invalidated: row.invalidated_at !== null });
    tokensByFaculty.set(row.faculty_id, list);
  }

  const totals: FacultyCodeStatusTotals = {
    eligible: 0,
    liveUnused: 0,
    used: 0,
    invalidated: 0,
    missing: 0,
  };

  const statuses: DepartmentCodeStatus[] = departmentsParse.data.map(
    (department) => {
      const participating =
        participatingIds === null || participatingIds.has(department.id);
      const eligible = participating
        ? facultyParse.data.filter(
            (row) => row.department_id === department.id,
          )
        : [];
      let liveUnused = 0;
      let used = 0;
      let invalidated = 0;
      const missing: MissingFacultyEntry[] = [];
      for (const member of eligible) {
        const held = tokensByFaculty.get(member.id) ?? [];
        for (const token of held) {
          if (token.invalidated) {
            invalidated += 1;
          } else if (token.used) {
            used += 1;
          } else {
            liveUnused += 1;
          }
        }
        if (!liveHolderIds.has(member.id)) {
          missing.push({ id: member.id, fullName: member.full_name });
        }
      }
      totals.eligible += eligible.length;
      totals.liveUnused += liveUnused;
      totals.used += used;
      totals.invalidated += invalidated;
      totals.missing += missing.length;
      return {
        department,
        participating,
        eligibleCount: eligible.length,
        liveUnused,
        used,
        invalidated,
        missingCount: missing.length,
        missing,
      };
    },
  );

  return { ok: true, electionId, statuses, totals };
}
