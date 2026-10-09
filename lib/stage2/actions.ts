"use server";

import { revalidatePath } from "next/cache";

import { logStage2Audit } from "@/lib/audit/hook";
import {
  applyFlagTie,
  applyGlobalAction,
  applyPublishWinner,
  applyResolveTie,
  electionStageSchema,
  type ActionError,
  type DepartmentMarkers,
} from "@/lib/election";
import { createClient } from "@/lib/supabase/server";

import { getStage2Results } from "./queries";
import {
  resolveStage2TieSchema,
  stage2DepartmentScopeSchema,
  type Stage2ActionErrorCode,
  type Stage2ActionState,
  type Stage2DepartmentScope,
} from "./schemas";

/**
 * Stage-2 closing, Winner-Tie resolution, and per-department publish
 * (spec §14 task 13, results architecture §12).
 *
 * - Closing student voting is the global `CLOSE_STUDENT_VOTING` step through
 *   the state-machine library (`applyGlobalAction`): STUDENT_VOTING →
 *   FINAL_RESULTS, audit-logged.
 * - Counting is aggregate-only over STUDENT votes scoped to
 *   `(election, department)` and validated against the frozen `finalists`
 *   snapshot (see `./queries`): only votes for frozen Finalists enter the
 *   Winner math.
 * - A Winner Tie (two or more Finalists sharing the top student-vote total)
 *   never auto-resolves: `flagStage2Tie` sets `tie_pending` (which renders
 *   the `Tie detected for winner` banner) and writes nothing else.
 * - The manual Tie pick accepts exactly one id from the tied Finalists; it
 *   clears `tie_pending`, stages the Winner in `election_results`
 *   (`published = false`) with the frozen policy version, and writes one
 *   audit entry referencing that policy version (spec §2d).
 * - `publishStage2Winner` writes the per-department `election_results` row
 *   (Winner reference, `published = true`, frozen policy version), gated on
 *   FINAL_RESULTS stage plus a locked snapshot plus no pending Tie — via
 *   `applyPublishWinner` — and audit-logged.
 * - Published results pages read `election_results` + `finalists` only
 *   (see `getPublishedResults` in `./queries`) — never live vote rows.
 *
 * Admin-only (same gate as Stage 1): `public.is_admin()` plus the RLS admin
 * policies as the second layer. Secrets: this module touches no keys and
 * no Codes; error paths return generic messages.
 */

import { ADMIN_PATHS, PUBLIC_PATHS } from "@/lib/admin-paths";
import { requireAdminGate } from "@/lib/auth/admin-session";

const RESULTS_PATH = ADMIN_PATHS.FINAL_RESULTS;

async function requireAdmin(): Promise<
  | { ok: true; context: { adminId: string } }
  | { ok: false; state: Stage2ActionState }
> {
  return requireAdminGate<Stage2ActionState>({
    unauthenticatedMessage: "Sign in as an admin to manage final results.",
  });
}

const STATE_MACHINE_CODES: ReadonlySet<string> = new Set([
  "ILLEGAL_GLOBAL_TRANSITION",
  "ELECTION_CLOSED",
  "STAGE_MISMATCH",
  "TIE_PENDING",
  "TIE_NOT_PENDING",
  "TIE_ALREADY_PENDING",
  "FINALISTS_NOT_LOCKED",
  "WINNER_ALREADY_PUBLISHED",
  "INVALID_INPUT",
]);

function stateMachineError(error: ActionError): Stage2ActionState {
  const code: Stage2ActionErrorCode = STATE_MACHINE_CODES.has(error.code)
    ? (error.code as Stage2ActionErrorCode)
    : "DB_ERROR";
  return { ok: false, code, message: error.message };
}

function dbError(code: string | null): Stage2ActionState {
  return {
    ok: false,
    code: "DB_ERROR",
    message:
      code === null
        ? "Database rejected the change. Try again."
        : `Database rejected the change (code ${code}). Try again.`,
  };
}

function parseScope(formData: FormData): Stage2DepartmentScope | null {
  const parsed = stage2DepartmentScopeSchema.safeParse({
    electionId: formData.get("electionId"),
    departmentId: formData.get("departmentId"),
  });
  return parsed.success ? parsed.data : null;
}

/**
 * Closes student voting globally: STUDENT_VOTING → FINAL_RESULTS via the
 * state-machine library. Per-department Winner detection and publishing
 * happen afterwards (`flagStage2Tie` / `publishStage2Winner` — the global
 * stage must be FINAL_RESULTS before any Winner can publish).
 */
export async function closeStudentVoting(
  _prevState: Stage2ActionState,
  formData: FormData,
): Promise<Stage2ActionState> {
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

  const loaded = await getStage2Results(electionId);
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
    action: "CLOSE_STUDENT_VOTING",
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

  await logStage2Audit({
    action: "CLOSE_STUDENT_VOTING",
    electionId,
    departmentId: null,
    policyVersion: loaded.results.policyVersion,
    pickedFinalistIds: null,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(RESULTS_PATH);
  return {
    ok: true,
    message:
      "Student voting closed. Resolve any Winner Ties below, then publish each department's Winner.",
  };
}

/**
 * Flags one department's Winner Tie. The department holds with
 * `tie_pending` (the `Tie detected for winner` banner appears on
 * revalidation) until the admin picks exactly one tied Finalist via
 * `resolveStage2Tie`. Nothing else is written.
 */
export async function flagStage2Tie(
  _prevState: Stage2ActionState,
  formData: FormData,
): Promise<Stage2ActionState> {
  const scope = parseScope(formData);
  if (!scope) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid Tie request. Check the Election and try again.",
    };
  }
  const { electionId, departmentId } = scope;

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const loaded = await getStage2Results(electionId);
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
  if (loaded.results.stage !== "FINAL_RESULTS") {
    return {
      ok: false,
      code: "STAGE_MISMATCH",
      message:
        "Winner Ties are resolved after student voting closes (stage FINAL_RESULTS).",
    };
  }
  if (tally.finalistsLockedAt === null) {
    return {
      ok: false,
      code: "FINALISTS_NOT_LOCKED",
      message:
        "Department Finalists are not locked; there is no snapshot to elect a Winner from.",
    };
  }
  if (tally.winnerResult.kind !== "tie") {
    return {
      ok: false,
      code: "TIE_NOT_PENDING",
      message: "Department has no Winner Tie — the top Finalist is a clear Winner.",
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
  const flagged = applyFlagTie({ markers, stage: stage.data });
  if (!flagged.ok) {
    return stateMachineError(flagged.error);
  }

  const supabase = await createClient();
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

  await logStage2Audit({
    action: "FLAG_STAGE2_TIE",
    electionId,
    departmentId,
    policyVersion: loaded.results.policyVersion,
    pickedFinalistIds: null,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(RESULTS_PATH);
  return {
    ok: true,
    message: `Tie detected for winner (${tally.winnerResult.tied.length} Finalists share ${tally.winnerResult.topVotes} votes). Pick exactly one tied Finalist below.`,
  };
}

/**
 * Resolves a Winner Tie by manual pick. The pick is valid only when it is
 * exactly one id from the tied Finalists — then `tie_pending` clears, the
 * Winner is staged in `election_results` (`published = false`) with the
 * frozen policy version, and one audit entry references the pick plus the
 * frozen policy version (spec §2d).
 */
export async function resolveStage2Tie(
  _prevState: Stage2ActionState,
  formData: FormData,
): Promise<Stage2ActionState> {
  const parsed = resolveStage2TieSchema.safeParse({
    electionId: formData.get("electionId"),
    departmentId: formData.get("departmentId"),
    pickedFinalistId: formData.get("pickedFinalistId"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: parsed.error.issues.map((issue) => issue.message).join(" "),
    };
  }
  const { electionId, departmentId, pickedFinalistId } = parsed.data;

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  // Fresh aggregate read at submit time is the source of truth — the tied
  // set is never trusted from the browser.
  const loaded = await getStage2Results(electionId);
  if (!loaded.ok) {
    return loaded.code === "NOT_FOUND"
      ? {
          ok: false,
          code: "NOT_FOUND",
          message: "Election not found. It may have been deleted already.",
        }
      : dbError(null);
  }
  if (loaded.results.stage !== "FINAL_RESULTS") {
    return {
      ok: false,
      code: "STAGE_MISMATCH",
      message:
        "Winner Ties are resolved after student voting closes (stage FINAL_RESULTS).",
    };
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
  if (tally.winnerResult.kind !== "tie" || !tally.tiePending) {
    return {
      ok: false,
      code: "TIE_NOT_PENDING",
      message: "Department has no pending Winner Tie to resolve.",
    };
  }

  const stage = electionStageSchema.safeParse(loaded.results.stage);
  if (!stage.success) {
    return dbError(null);
  }

  const tiedIds = new Set(
    tally.winnerResult.tied.map((entry) => entry.finalistId),
  );
  if (!tiedIds.has(pickedFinalistId)) {
    return {
      ok: false,
      code: "NOT_TIED_FINALIST",
      message: "The pick must be exactly one of the tied Finalists.",
    };
  }
  if (loaded.results.policyVersion === null) {
    return {
      ok: false,
      code: "POLICY_NOT_FROZEN",
      message:
        "The tie policy is not frozen yet — freeze it before resolving Ties.",
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
    pickedCandidateIds: [pickedFinalistId],
  });
  if (!resolved.ok) {
    return stateMachineError(resolved.error);
  }

  const supabase = await createClient();
  // Stage the picked Winner (unpublished): publish flips `published` to
  // true afterwards. The raw counts still show the Tie — the staged row is
  // the resolved record, mirroring how Stage 1 writes the resolved
  // snapshot over still-tied raw counts.
  const { error: resultError } = await supabase
    .from("election_results")
    .upsert(
      {
        election_id: electionId,
        department_id: departmentId,
        winner_faculty_id: pickedFinalistId,
        published: false,
        policy_version: loaded.results.policyVersion,
      },
      { onConflict: "election_id,department_id" },
    );
  if (resultError) {
    return dbError(resultError.code);
  }
  const { error } = await supabase
    .from("election_departments")
    .update({ tie_pending: false })
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (error) {
    return dbError(error.code);
  }

  await logStage2Audit({
    action: "RESOLVE_STAGE2_TIE",
    electionId,
    departmentId,
    policyVersion: loaded.results.policyVersion,
    pickedFinalistIds: [pickedFinalistId],
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(RESULTS_PATH);
  return {
    ok: true,
    message: `Winner Tie resolved for ${tally.department.code} — publish the Winner below.`,
  };
}

/**
 * Publishes one department's Winner. Gated on FINAL_RESULTS plus a locked
 * Finalists snapshot plus no pending Tie (via `applyPublishWinner`) plus a
 * frozen tie policy: writes the per-department `election_results` row with
 * the Winner reference, `published = true`, and the frozen policy version,
 * stamps `winner_published_at`, and audit-logs the publish.
 *
 * The Winner is the clear top Finalist — or the staged Tie pick when the
 * raw counts still Tie but the admin already resolved it (the staged
 * `election_results` row from `resolveStage2Tie`). A computed Tie with no
 * staged pick blocks publishing.
 */
export async function publishStage2Winner(
  _prevState: Stage2ActionState,
  formData: FormData,
): Promise<Stage2ActionState> {
  const scope = parseScope(formData);
  if (!scope) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid publish request. Check the Election and try again.",
    };
  }
  const { electionId, departmentId } = scope;

  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const loaded = await getStage2Results(electionId);
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
  if (loaded.results.policyVersion === null) {
    return {
      ok: false,
      code: "POLICY_NOT_FROZEN",
      message:
        "The tie policy is not frozen yet — freeze it before publishing Winners.",
    };
  }

  const stage = electionStageSchema.safeParse(loaded.results.stage);
  if (!stage.success) {
    return dbError(null);
  }

  // Resolve the Winner id: a staged Tie pick (unpublished row whose Winner
  // is a frozen Finalist — and, when the counts Tie, one of the tied
  // Finalists) wins over the recomputed top, because the raw counts still
  // show the Tie after a manual pick.
  const finalistIds = new Set(
    tally.finalists.map((entry) => entry.facultyId),
  );
  const stagedWinnerId =
    tally.published && !tally.published.published
      ? tally.published.winnerFacultyId
      : null;
  const stagedValid =
    stagedWinnerId !== null &&
    finalistIds.has(stagedWinnerId) &&
    (tally.winnerResult.kind !== "tie" ||
      tally.winnerResult.tied.some(
        (entry) => entry.finalistId === stagedWinnerId,
      ));

  let winnerId: string | null = null;
  if (stagedValid && stagedWinnerId !== null) {
    winnerId = stagedWinnerId;
  } else if (tally.winnerResult.kind === "clean") {
    winnerId = tally.winnerResult.winner?.finalistId ?? null;
  } else {
    return {
      ok: false,
      code: "TIE_PENDING",
      message:
        "Tie detected for winner — resolve the Tie before publishing.",
    };
  }
  if (winnerId === null) {
    return {
      ok: false,
      code: "NO_WINNER",
      message:
        "No Winner to publish — this department has no frozen Finalists.",
    };
  }

  const markers: DepartmentMarkers = {
    electionId,
    departmentId,
    finalistsLockedAt: tally.finalistsLockedAt,
    winnerPublishedAt: tally.winnerPublishedAt,
    tiePending: tally.tiePending,
  };
  const publishedAt = new Date().toISOString();
  const publishable = applyPublishWinner({
    markers,
    stage: stage.data,
    publishedAt,
    policyVersion: loaded.results.policyVersion,
  });
  if (!publishable.ok) {
    return stateMachineError(publishable.error);
  }

  const supabase = await createClient();
  const { error: resultError } = await supabase
    .from("election_results")
    .upsert(
      {
        election_id: electionId,
        department_id: departmentId,
        winner_faculty_id: winnerId,
        published: true,
        policy_version: loaded.results.policyVersion,
      },
      { onConflict: "election_id,department_id" },
    );
  if (resultError) {
    return dbError(resultError.code);
  }
  const ensured = await ensureParticipationRow(supabase, scope);
  if (!ensured.ok) {
    return ensured.state;
  }
  const { error } = await supabase
    .from("election_departments")
    .update({
      winner_published_at: publishable.value.markers.winnerPublishedAt,
      tie_pending: false,
    })
    .eq("election_id", electionId)
    .eq("department_id", departmentId);
  if (error) {
    return dbError(error.code);
  }

  await logStage2Audit({
    action: "PUBLISH_WINNER",
    electionId,
    departmentId,
    policyVersion: loaded.results.policyVersion,
    pickedFinalistIds: null,
    actorAdminId: gate.context.adminId,
  });

  revalidatePath(RESULTS_PATH);
  revalidatePath(PUBLIC_PATHS.RESULTS);
  return {
    ok: true,
    message: `Winner published for ${tally.department.code}.`,
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
  scope: Stage2DepartmentScope,
): Promise<{ ok: true } | { ok: false; state: Stage2ActionState }> {
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
