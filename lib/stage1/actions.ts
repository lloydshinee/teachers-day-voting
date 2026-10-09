"use server";

import { revalidatePath } from "next/cache";

import { logStage1Audit } from "@/lib/audit/hook";
import {
  applyFlagTie,
  applyGlobalAction,
  applyLockFinalists,
  applyReopenStage1,
  applyResolveTie,
  electionStageSchema,
  type ActionError,
  type DepartmentMarkers,
} from "@/lib/election";
import { createClient } from "@/lib/supabase/server";

import { getStage1Results } from "./queries";
import {
  resolveStage1TieSchema,
  stage1DepartmentScopeSchema,
  type Stage1ActionErrorCode,
  type Stage1ActionState,
  type Stage1DepartmentScope,
} from "./schemas";

/**
 * Stage-1 closing, freezing, Tie resolution, and re-open (spec §14 task 10,
 * results architecture §12).
 *
 * - Closing faculty voting is the global `CLOSE_FACULTY_VOTING` step through
 *   the state-machine library (`applyGlobalAction`): FACULTY_VOTING →
 *   FACULTY_RESULTS, audit-logged.
 * - Freezing computes aggregate counts per Candidate (reused from
 *   `./queries`, which reads votes grouped by candidate scoped to
 *   `(election, department, FACULTY)`), then either flags the cutoff Tie
 *   (`applyFlagTie` → `tie_pending`, which renders the `Tie detected`
 *   banner) or writes the frozen `finalists` rows (`stage1_votes`, sequential
 *   `rank`) via `applyLockFinalists`.
 * - The manual Tie pick accepts only ids from exactly the tied set and
 *   exactly as many as seats remain; it writes the Finalists plus one audit
 *   entry referencing the frozen policy version (spec §2d).
 * - Re-open follows the state-machine guardrail (`applyReopenStage1`): only
 *   with zero dependent student votes in the department; it unfreezes the
 *   snapshot (prior snapshot marked superseded in audit) and requires a
 *   fresh freeze. Votes are never deleted — this path receives only counts.
 *
 * Admin-only (same gate as departments/faculty): `public.is_admin()` plus
 * the RLS admin policies as the second layer. Secrets: this module touches
 * no keys and no Codes; error paths return generic messages.
 */

import { ADMIN_PATHS } from "@/lib/admin-paths";
import { requireAdminGate } from "@/lib/auth/admin-session";

const RESULTS_PATH = ADMIN_PATHS.FACULTY_RESULTS;

async function requireAdmin(): Promise<
  | { ok: true; context: { adminId: string } }
  | { ok: false; state: Stage1ActionState }
> {
  return requireAdminGate<Stage1ActionState>({
    unauthenticatedMessage: "Sign in as an admin to manage faculty results.",
  });
}

const STATE_MACHINE_CODES: ReadonlySet<string> = new Set([
  "ILLEGAL_GLOBAL_TRANSITION",
  "ELECTION_CLOSED",
  "STAGE_MISMATCH",
  "TIE_PENDING",
  "TIE_NOT_PENDING",
  "TIE_ALREADY_PENDING",
  "FINALISTS_ALREADY_LOCKED",
  "FINALISTS_NOT_LOCKED",
  "WINNER_ALREADY_PUBLISHED",
  "REOPEN_BLOCKED_BY_DEPENDENT_VOTES",
  "REOPEN_BLOCKED_BY_PUBLISHED_WINNER",
  "REOPEN_NOTHING_TO_REOPEN",
  "INVALID_INPUT",
]);

function stateMachineError(error: ActionError): Stage1ActionState {
  const code: Stage1ActionErrorCode = STATE_MACHINE_CODES.has(error.code)
    ? (error.code as Stage1ActionErrorCode)
    : "DB_ERROR";
  return { ok: false, code, message: error.message };
}

function dbError(code: string | null): Stage1ActionState {
  return {
    ok: false,
    code: "DB_ERROR",
    message:
      code === null
        ? "Database rejected the change. Try again."
        : `Database rejected the change (code ${code}). Try again.`,
  };
}

function parseScope(formData: FormData): Stage1DepartmentScope | null {
  const parsed = stage1DepartmentScopeSchema.safeParse({
    electionId: formData.get("electionId"),
    departmentId: formData.get("departmentId"),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Closes faculty voting globally: FACULTY_VOTING → FACULTY_RESULTS via the
 * state-machine library. Per-department freezing happens afterwards with
 * `freezeStage1Finalists` (the global stage must be FACULTY_RESULTS before
 * any snapshot can lock).
 */
export async function closeFacultyVoting(
  _prevState: Stage1ActionState,
  formData: FormData,
): Promise<Stage1ActionState> {
  const electionId = formData.get("electionId");
  if (typeof electionId !== "string" || electionId === "") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid close request. Check the Election and try again.",
    };
  }

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const loaded = await getStage1Results(electionId);
  if (!loaded.ok) {
    if (loaded.code === "NOT_FOUND") {
      return {
        ok: false,
        code: "NOT_FOUND",
        message: "Election not found. It may have been deleted already.",
      };
    }
    if (loaded.code === "UNAUTHENTICATED" || loaded.code === "FORBIDDEN") {
      return { ok: false, code: loaded.code, message: loaded.message };
    }
    return dbError(null);
  }

  const transition = applyGlobalAction({
    from: loaded.results.stage,
    action: "CLOSE_FACULTY_VOTING",
  });
  if (!transition.ok) {
    return stateMachineError(transition.error);
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("elections")
    .update({ stage: transition.value.to })
    .eq("id", electionId);
  if (error) {
    return dbError(error.code);
  }

  await logStage1Audit({
    action: "CLOSE_FACULTY_VOTING",
    electionId,
    departmentId: null,
    policyVersion: loaded.results.policyVersion,
    pickedCandidateIds: null,
    supersededSnapshotAt: null,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(RESULTS_PATH);
  return {
    ok: true,
    message:
      "Faculty voting closed. Freeze each department's Top-3 below (ties must be resolved first).",
  };
}

/**
 * Freezes one department's Stage-1 snapshot. On a clean Top-3 writes the
 * frozen `finalists` rows (`stage1_votes`, sequential `rank`) and locks the
 * department; on a cutoff Tie flags `tie_pending` instead (the banner +
 * resolve action appear on revalidation) and writes nothing.
 */
export async function freezeStage1Finalists(
  _prevState: Stage1ActionState,
  formData: FormData,
): Promise<Stage1ActionState> {
  const scope = parseScope(formData);
  if (!scope) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid freeze request. Check the Election and try again.",
    };
  }
  const { electionId, departmentId } = scope;

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const loaded = await getStage1Results(electionId);
  if (!loaded.ok) {
    return loaded.code === "NOT_FOUND"
      ? {
          ok: false,
          code: "NOT_FOUND",
          message: "Election not found. It may have been deleted already.",
        }
      : dbError(null);
  }
  const tally = loaded.results.departments.find(
    (entry) => entry.department.id === departmentId,
  );
  if (!tally || !tally.participating) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found in this Election.",
    };
  }

  const stage = electionStageSchema.safeParse(loaded.results.stage);
  if (!stage.success) {
    return dbError(null);
  }
  const markers: DepartmentMarkers = {
    electionId,
    departmentId,
    finalistsLockedAt: tally.finalistsLockedAt,
    winnerPublishedAt: tally.winnerPublishedAt,
    tiePending: tally.tiePending,
  };

  const supabase = await createClient();

  // A cutoff Tie never auto-resolves: flag the department and stop. The
  // admin picks from exactly the tied Candidates via `resolveStage1Tie`.
  if (tally.cutoff.kind === "tie") {
    if (!tally.tiePending) {
      const flagged = applyFlagTie({ markers, stage: stage.data });
      if (!flagged.ok) {
        return stateMachineError(flagged.error);
      }
      const ensured = await ensureParticipationRow(supabase, scope);
      if (!ensured.ok) {
        return ensured.state;
      }
      const { error } = await supabase
        .from("election_departments")
        .update({ tie_pending: true })
        .eq("election_id", electionId)
        .eq("department_id", departmentId);
      if (error) {
        return dbError(error.code);
      }
      await logStage1Audit({
        action: "FLAG_STAGE1_TIE",
        electionId,
        departmentId,
        policyVersion: loaded.results.policyVersion,
        pickedCandidateIds: null,
        supersededSnapshotAt: null,
        actorAdminId: gate.context.adminId,
      });
    }
    revalidatePath(RESULTS_PATH);
    return {
      ok: true,
      message: `Tie detected for 3rd place (${tally.cutoff.tied.length} Candidates share ${tally.cutoff.cutoffVotes} votes with ${tally.cutoff.seatsRemaining} seat${tally.cutoff.seatsRemaining === 1 ? "" : "s"} left). Pick from exactly the tied Candidates below.`,
    };
  }

  const locked = applyLockFinalists({
    markers,
    stage: stage.data,
    lockedAt: new Date().toISOString(),
  });
  if (!locked.ok) {
    return stateMachineError(locked.error);
  }

  const written = await writeFinalistsSnapshot(
    supabase,
    scope,
    tally.cutoff.top3.map((entry) => ({
      facultyId: entry.candidateId,
      stage1Votes: entry.votes,
      rank: entry.rank,
    })),
  );
  if (!written.ok) {
    return written.state;
  }

  const ensured = await ensureParticipationRow(supabase, scope);
  if (!ensured.ok) {
    return ensured.state;
  }
  const { error } = await supabase
    .from("election_departments")
    .update({
      finalists_locked_at: locked.value.markers.finalistsLockedAt,
      tie_pending: false,
    })
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (error) {
    return dbError(error.code);
  }

  await logStage1Audit({
    action: "FREEZE_STAGE1_FINALISTS",
    electionId,
    departmentId,
    policyVersion: loaded.results.policyVersion,
    pickedCandidateIds: null,
    supersededSnapshotAt: null,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(RESULTS_PATH);
  return {
    ok: true,
    message: `Top-${tally.cutoff.top3.length} frozen as Finalists for ${tally.department.code}.`,
  };
}

/**
 * Resolves a cutoff Tie by manual pick. The pick is valid only when every
 * picked id belongs to exactly the tied set and the pick fills exactly the
 * seats that remain — then the Finalists are written and one audit entry
 * references the frozen policy version (spec §2d).
 */
export async function resolveStage1Tie(
  _prevState: Stage1ActionState,
  formData: FormData,
): Promise<Stage1ActionState> {
  const rawPicked = formData.getAll("pickedCandidateIds");
  const parsed = resolveStage1TieSchema.safeParse({
    electionId: formData.get("electionId"),
    departmentId: formData.get("departmentId"),
    pickedCandidateIds: rawPicked.filter(
      (value): value is string => typeof value === "string",
    ),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((issue) => issue.message).join(" "),
    };
  }
  const { electionId, departmentId, pickedCandidateIds } = parsed.data;

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  // Fresh aggregate read at submit time is the source of truth — the tied
  // set is never trusted from the browser.
  const loaded = await getStage1Results(electionId);
  if (!loaded.ok) {
    return loaded.code === "NOT_FOUND"
      ? {
          ok: false,
          code: "NOT_FOUND",
          message: "Election not found. It may have been deleted already.",
        }
      : dbError(null);
  }
  const tally = loaded.results.departments.find(
    (entry) => entry.department.id === departmentId,
  );
  if (!tally || !tally.participating) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found in this Election.",
    };
  }
  if (tally.cutoff.kind !== "tie" || !tally.tiePending) {
    return {
      ok: false,
      code: "TIE_NOT_PENDING",
      message: "Department has no pending Tie to resolve.",
    };
  }

  const stage = electionStageSchema.safeParse(loaded.results.stage);
  if (!stage.success) {
    return dbError(null);
  }

  const tiedIds = new Set(
    tally.cutoff.tied.map((entry) => entry.candidateId),
  );
  if (!pickedCandidateIds.every((id) => tiedIds.has(id))) {
    return {
      ok: false,
      code: "NOT_TIED_CANDIDATE",
      message: "Picks must come from exactly the tied Candidates.",
    };
  }
  if (pickedCandidateIds.length !== tally.cutoff.seatsRemaining) {
    return {
      ok: false,
      code: "WRONG_PICK_COUNT",
      message: `Pick exactly ${tally.cutoff.seatsRemaining} tied Candidate${tally.cutoff.seatsRemaining === 1 ? "" : "s"} to fill the remaining seat${tally.cutoff.seatsRemaining === 1 ? "" : "s"}.`,
    };
  }

  const markers: DepartmentMarkers = {
    electionId,
    departmentId,
    finalistsLockedAt: tally.finalistsLockedAt,
    winnerPublishedAt: tally.winnerPublishedAt,
    tiePending: tally.tiePending,
  };
  const resolved = applyResolveTie({
    markers,
    stage: stage.data,
    pickedCandidateIds,
  });
  if (!resolved.ok) {
    return stateMachineError(resolved.error);
  }
  const locked = applyLockFinalists({
    markers: resolved.value.markers,
    stage: stage.data,
    lockedAt: new Date().toISOString(),
  });
  if (!locked.ok) {
    return stateMachineError(locked.error);
  }

  // Final Top-3: Candidates above the cutoff plus the manual picks, in the
  // deterministic counting order with sequential ranks.
  const pickedSet = new Set(pickedCandidateIds);
  const combined = [
    ...tally.cutoff.lockedAbove,
    ...tally.cutoff.tied.filter((entry) => pickedSet.has(entry.candidateId)),
  ].sort((a, b) => {
    if (b.votes !== a.votes) {
      return b.votes - a.votes;
    }
    if (a.fullName !== b.fullName) {
      return a.fullName < b.fullName ? -1 : 1;
    }
    return a.candidateId < b.candidateId ? -1 : 1;
  });

  const supabase = await createClient();
  const written = await writeFinalistsSnapshot(
    supabase,
    { electionId, departmentId },
    combined.map((entry, index) => ({
      facultyId: entry.candidateId,
      stage1Votes: entry.votes,
      rank: index + 1,
    })),
  );
  if (!written.ok) {
    return written.state;
  }

  const { error } = await supabase
    .from("election_departments")
    .update({
      finalists_locked_at: locked.value.markers.finalistsLockedAt,
      tie_pending: false,
    })
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (error) {
    return dbError(error.code);
  }

  await logStage1Audit({
    action: "RESOLVE_STAGE1_TIE",
    electionId,
    departmentId,
    policyVersion: loaded.results.policyVersion,
    pickedCandidateIds: [...pickedCandidateIds],
    supersededSnapshotAt: null,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(RESULTS_PATH);
  return {
    ok: true,
    message: `Tie resolved for ${tally.department.code} — Top-3 frozen as Finalists.`,
  };
}

/**
 * Re-opens Stage 1 for one department through the state-machine guardrail:
 * allowed only with zero dependent student votes there. Unfreezes the
 * snapshot (deletes the frozen rows; the prior timestamp goes to audit as
 * superseded) and requires a fresh freeze. Votes are never deleted.
 */
export async function reopenStage1(
  _prevState: Stage1ActionState,
  formData: FormData,
): Promise<Stage1ActionState> {
  const scope = parseScope(formData);
  if (!scope) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid re-open request. Check the Election and try again.",
    };
  }
  const { electionId, departmentId } = scope;

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const loaded = await getStage1Results(electionId);
  if (!loaded.ok) {
    return loaded.code === "NOT_FOUND"
      ? {
          ok: false,
          code: "NOT_FOUND",
          message: "Election not found. It may have been deleted already.",
        }
      : dbError(null);
  }
  const tally = loaded.results.departments.find(
    (entry) => entry.department.id === departmentId,
  );
  if (!tally || !tally.participating) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Department not found in this Election.",
    };
  }

  const stage = electionStageSchema.safeParse(loaded.results.stage);
  if (!stage.success) {
    return dbError(null);
  }
  const markers: DepartmentMarkers = {
    electionId,
    departmentId,
    finalistsLockedAt: tally.finalistsLockedAt,
    winnerPublishedAt: tally.winnerPublishedAt,
    tiePending: tally.tiePending,
  };

  const supabase = await createClient();
  const { count: studentVotes, error: countError } = await supabase
    .from("votes")
    .select("id", { count: "exact", head: true })
    .eq("election_id", electionId)
    .eq("department_id", departmentId)
    .eq("stage", "STUDENT");
  if (countError) {
    return dbError(countError.code);
  }

  const reopened = applyReopenStage1({
    markers,
    stage: stage.data,
    dependentStudentVotes: studentVotes ?? 0,
  });
  if (!reopened.ok) {
    return stateMachineError(reopened.error);
  }

  const { error: deleteError } = await supabase
    .from("finalists")
    .delete()
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (deleteError) {
    return dbError(deleteError.code);
  }
  const { error } = await supabase
    .from("election_departments")
    .update({ finalists_locked_at: null })
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (error) {
    return dbError(error.code);
  }

  await logStage1Audit({
    action: "REOPEN_STAGE1",
    electionId,
    departmentId,
    policyVersion: loaded.results.policyVersion,
    pickedCandidateIds: null,
    supersededSnapshotAt: reopened.value.supersededSnapshotAt,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(RESULTS_PATH);
  return {
    ok: true,
    message: `Stage 1 re-opened for ${tally.department.code}. A fresh freeze is required — votes were kept.`,
  };
}

type SupabaseAdminClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Elections with no participation rows yet treat every department as
 * participating. To prevent inserting a single row and dropping all other
 * departments, ensure all departments are linked before updating markers.
 */
async function ensureParticipationRow(
  supabase: SupabaseAdminClient,
  scope: Stage1DepartmentScope,
): Promise<{ ok: true } | { ok: false; state: Stage1ActionState }> {
  const { count, error: countError } = await supabase
    .from("election_departments")
    .select("department_id", { count: "exact", head: true })
    .eq("election_id", scope.electionId);

  if (countError) {
    return { ok: false, state: dbError(countError.code) };
  }

  if (count === 0) {
    const { data: allDepts, error: deptsError } = await supabase
      .from("departments")
      .select("id");

    if (deptsError) {
      return { ok: false, state: dbError(deptsError.code) };
    }

    if (allDepts && allDepts.length > 0) {
      const rows = allDepts.map((d) => ({
        election_id: scope.electionId,
        department_id: d.id,
      }));
      const { error: seedError } = await supabase
        .from("election_departments")
        .upsert(rows, {
          onConflict: "election_id,department_id",
          ignoreDuplicates: true,
        });

      if (seedError) {
        return { ok: false, state: dbError(seedError.code) };
      }
    }
  } else {
    const { error } = await supabase
      .from("election_departments")
      .upsert(
        {
          election_id: scope.electionId,
          department_id: scope.departmentId,
        },
        { onConflict: "election_id,department_id", ignoreDuplicates: true },
      );
    if (error) {
      return { ok: false, state: dbError(error.code) };
    }
  }

  return { ok: true };
}

/**
 * Writes the frozen snapshot. Any rows from a failed earlier attempt are
 * replaced first (the department is not locked yet at that point, so
 * nothing frozen is being rewritten) — afterwards the unique constraints
 * on `(election, department, faculty)` and `(election, department, rank)`
 * hold exactly the frozen Top-3.
 */
async function writeFinalistsSnapshot(
  supabase: SupabaseAdminClient,
  scope: Stage1DepartmentScope,
  rows: Array<{ facultyId: string; stage1Votes: number; rank: number }>,
): Promise<{ ok: true } | { ok: false; state: Stage1ActionState }> {
  const { error: deleteError } = await supabase
    .from("finalists")
    .delete()
    .eq("election_id", scope.electionId)
    .eq("department_id", scope.departmentId);
  if (deleteError) {
    return { ok: false, state: dbError(deleteError.code) };
  }
  if (rows.length === 0) {
    return { ok: true };
  }
  const { error } = await supabase.from("finalists").insert(
    rows.map((row) => ({
      election_id: scope.electionId,
      department_id: scope.departmentId,
      faculty_id: row.facultyId,
      stage1_votes: row.stage1Votes,
      rank: row.rank,
    })),
  );
  if (error) {
    return { ok: false, state: dbError(error.code) };
  }
  return { ok: true };
}
