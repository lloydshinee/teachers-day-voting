"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdminSession } from "../auth/admin-session";
import {
  closeFacultyVoting,
  freezeStage1Finalists,
  reopenStage1,
  resolveStage1Tie,
} from "../stage1/actions";
import {
  closeStudentVoting,
  flagStage2Tie,
  publishStage2Winner,
  resolveStage2Tie,
} from "../stage2/actions";
import { createClient } from "../supabase/server";
import { applyGlobalAction } from "./actions";
import {
  electionStageSchema,
  globalAdminActionSchema,
  type ElectionStage,
  type GlobalAdminAction,
} from "./stages";

export interface LifecycleActionState {
  ok: boolean;
  code?: string;
  message?: string;
  electionId?: string;
}

const createElectionInputSchema = z.object({
  name: z.string().trim().min(1, "Election name is required."),
  academicYear: z
    .string()
    .trim()
    .min(1, "Academic year is required (e.g. 2026-2027)."),
  tiePolicyText: z
    .string()
    .trim()
    .min(1, "Tie policy description is required.")
    .default(
      "Manual admin pick from tied candidates at both stages (Top-3 cutoff and winner)",
    ),
  departmentIds: z.array(z.string().uuid()).optional(),
});

interface AdminContext {
  adminId: string;
}

async function requireAdmin(): Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; state: LifecycleActionState }
> {
  const result = await requireAdminSession({
    unauthenticatedMessage: "Sign in as an admin to manage elections.",
  });
  if (!result.ok) {
    return { ok: false, state: result };
  }
  return { ok: true, context: { adminId: result.session.adminId } };
}

/**
 * Creates a new Election in DRAFT stage and links participating departments.
 */
export async function createElection(
  _prevState: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const rawDeptIds = formData.getAll("departmentIds").filter(
    (val): val is string => typeof val === "string" && val.length > 0,
  );

  const parsed = createElectionInputSchema.safeParse({
    name: formData.get("name"),
    academicYear: formData.get("academicYear"),
    tiePolicyText:
      formData.get("tiePolicyText") ||
      "Manual admin pick from tied candidates at both stages (Top-3 cutoff and winner)",
    departmentIds: rawDeptIds.length > 0 ? rawDeptIds : undefined,
  });

  if (!parsed.success) {
    const errorDetails = parsed.error.issues.map((i) => i.message).join("; ");
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: errorDetails || "Invalid election details.",
    };
  }

  const supabase = await createClient();

  // Insert election row in DRAFT stage
  const { data: newElection, error: electionError } = await supabase
    .from("elections")
    .insert({
      name: parsed.data.name,
      academic_year: parsed.data.academicYear,
      stage: "DRAFT",
      tie_policy_text: parsed.data.tiePolicyText,
    })
    .select("id")
    .single();

  if (electionError || !newElection) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: `Failed to create election: ${electionError?.message ?? "Database error"}`,
    };
  }

  // Determine participating departments
  let departmentIdsToLink = parsed.data.departmentIds;
  if (!departmentIdsToLink || departmentIdsToLink.length === 0) {
    // If none specified, include all active departments
    const { data: allDepts } = await supabase
      .from("departments")
      .select("id")
      .order("code", { ascending: true });
    departmentIdsToLink = (allDepts ?? []).map((d) => d.id);
  }

  if (departmentIdsToLink.length > 0) {
    const electionDeptRows = departmentIdsToLink.map((deptId) => ({
      election_id: newElection.id,
      department_id: deptId,
    }));

    const { error: deptLinkError } = await supabase
      .from("election_departments")
      .insert(electionDeptRows);

    if (deptLinkError) {
      return {
        ok: false,
        code: "DB_ERROR",
        message: `Election created, but failed to link departments: ${deptLinkError.message}`,
        electionId: newElection.id,
      };
    }
  }

  revalidatePath("/admin");
  revalidatePath("/admin/faculty/codes");
  revalidatePath("/admin/student/codes");
  revalidatePath("/vote");

  return {
    ok: true,
    message: "Election created successfully in DRAFT stage.",
    electionId: newElection.id,
  };
}

export interface TransitionElectionStageInput {
  electionId: string;
  action: GlobalAdminAction;
}

/**
 * Transitions an Election forward across global stages.
 * Automatically delegates closing actions to stage-specific audit loggers,
 * enforces state-machine transition guardrails, freezes tie policy timestamp
 * on opening faculty voting, and revalidates relevant paths.
 */
export async function transitionElectionStage(
  input: TransitionElectionStageInput,
): Promise<LifecycleActionState> {
  const gate = await requireAdmin();
  if (!gate.ok) {
    return gate.state;
  }

  const { electionId, action } = input;

  if (action === "CLOSE_FACULTY_VOTING") {
    const formData = new FormData();
    formData.set("electionId", electionId);
    const result = await closeFacultyVoting({ ok: true, message: "" }, formData);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message,
        electionId,
      };
    }
    revalidatePath("/admin");
    return {
      ok: true,
      message: "Faculty voting closed. Election advanced to FACULTY_RESULTS.",
      electionId,
    };
  }

  if (action === "CLOSE_STUDENT_VOTING") {
    const formData = new FormData();
    formData.set("electionId", electionId);
    const result = await closeStudentVoting({ ok: true, message: "" }, formData);
    if (!result.ok) {
      return {
        ok: false,
        code: result.code,
        message: result.message,
        electionId,
      };
    }
    revalidatePath("/admin");
    return {
      ok: true,
      message: "Student voting closed. Election advanced to FINAL_RESULTS.",
      electionId,
    };
  }

  const supabase = await createClient();

  // Read current election stage
  const { data: election, error: readError } = await supabase
    .from("elections")
    .select("stage")
    .eq("id", electionId)
    .single();

  if (readError || !election) {
    return {
      ok: false,
      code: "NOT_FOUND",
      message: "Election not found.",
      electionId,
    };
  }

  const currentStageParsed = electionStageSchema.safeParse(election.stage);
  if (!currentStageParsed.success) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: "Corrupt election stage.",
      electionId,
    };
  }

  const currentStage: ElectionStage = currentStageParsed.data;

  // Validate transition through pure state machine
  const transition = applyGlobalAction({
    from: currentStage,
    action,
  });

  if (!transition.ok) {
    return {
      ok: false,
      code: transition.error.code,
      message: transition.error.message,
      electionId,
    };
  }

  const nextStage = transition.value.to;
  const updatePayload: { stage: ElectionStage; tie_policy_locked_at?: string } = {
    stage: nextStage,
  };

  // When opening faculty voting, freeze tie policy timestamp
  if (action === "OPEN_FACULTY_VOTING") {
    updatePayload.tie_policy_locked_at = new Date().toISOString();
  }

  const { error: updateError } = await supabase
    .from("elections")
    .update(updatePayload)
    .eq("id", electionId);

  if (updateError) {
    return {
      ok: false,
      code: "DB_ERROR",
      message: `Failed to update election stage: ${updateError.message}`,
      electionId,
    };
  }

  revalidatePath("/admin");
  revalidatePath("/admin/faculty/codes");
  revalidatePath("/admin/faculty/results");
  revalidatePath("/admin/student/codes");
  revalidatePath("/admin/final/results");
  revalidatePath("/vote");
  revalidatePath("/results");

  return {
    ok: true,
    message: `Election advanced to ${nextStage}.`,
    electionId,
  };
}

/**
 * Form action wrapper for transitionElectionStage.
 */
export async function advanceElectionStage(
  _prevState: LifecycleActionState,
  formData: FormData,
): Promise<LifecycleActionState> {
  const electionId = formData.get("electionId");
  const actionRaw = formData.get("action");

  if (typeof electionId !== "string" || electionId === "") {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Missing election ID.",
    };
  }

  const parsedAction = globalAdminActionSchema.safeParse(actionRaw);
  if (!parsedAction.success) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Invalid stage action requested.",
    };
  }

  return transitionElectionStage({
    electionId,
    action: parsedAction.data,
  });
}

export interface ResolveElectionTieInput {
  electionId: string;
  departmentId: string;
  pickedCandidateIds: string[];
  stage?: "stage1" | "stage2";
}

/**
 * Resolves a cutoff Tie (Stage 1) or Winner Tie (Stage 2) using explicit manual admin picks.
 */
export async function resolveElectionTie(
  input: ResolveElectionTieInput,
): Promise<LifecycleActionState> {
  const { electionId, departmentId, pickedCandidateIds, stage } = input;

  let targetStage = stage;
  if (!targetStage) {
    const supabase = await createClient();
    const { data: election } = await supabase
      .from("elections")
      .select("stage")
      .eq("id", electionId)
      .maybeSingle();

    if (election?.stage === "FACULTY_RESULTS") {
      targetStage = "stage1";
    } else if (election?.stage === "FINAL_RESULTS") {
      targetStage = "stage2";
    } else {
      return {
        ok: false,
        code: "STAGE_MISMATCH",
        message: "Ties can only be resolved during FACULTY_RESULTS or FINAL_RESULTS.",
        electionId,
      };
    }
  }

  const formData = new FormData();
  formData.set("electionId", electionId);
  formData.set("departmentId", departmentId);

  if (targetStage === "stage1") {
    for (const id of pickedCandidateIds) {
      formData.append("pickedCandidateIds", id);
    }
    const result = await resolveStage1Tie({ ok: true, message: "" }, formData);
    return {
      ok: result.ok,
      code: result.ok ? undefined : result.code,
      message: result.message,
      electionId,
    };
  } else {
    const pickedFinalistId = pickedCandidateIds[0];
    if (pickedFinalistId) {
      formData.set("pickedFinalistId", pickedFinalistId);
    }
    const result = await resolveStage2Tie({ ok: true, message: "" }, formData);
    return {
      ok: result.ok,
      code: result.ok ? undefined : result.code,
      message: result.message,
      electionId,
    };
  }
}

export interface PublishDepartmentWinnerInput {
  electionId: string;
  departmentId: string;
}

/**
 * Publishes the winning Finalist for a department in Stage 2.
 */
export async function publishDepartmentWinner(
  input: PublishDepartmentWinnerInput,
): Promise<LifecycleActionState> {
  const formData = new FormData();
  formData.set("electionId", input.electionId);
  formData.set("departmentId", input.departmentId);

  const result = await publishStage2Winner({ ok: true, message: "" }, formData);
  return {
    ok: result.ok,
    code: result.ok ? undefined : result.code,
    message: result.message,
    electionId: input.electionId,
  };
}

export interface ReopenDepartmentStage1Input {
  electionId: string;
  departmentId: string;
}

/**
 * Safely reopens Stage 1 for a department, enforcing zero dependent student votes.
 */
export async function reopenDepartmentStage1(
  input: ReopenDepartmentStage1Input,
): Promise<LifecycleActionState> {
  const formData = new FormData();
  formData.set("electionId", input.electionId);
  formData.set("departmentId", input.departmentId);

  const result = await reopenStage1({ ok: true, message: "" }, formData);
  return {
    ok: result.ok,
    code: result.ok ? undefined : result.code,
    message: result.message,
    electionId: input.electionId,
  };
}

export interface FreezeDepartmentFinalistsInput {
  electionId: string;
  departmentId: string;
}

/**
 * Freezes the Stage 1 Top-3 Finalists snapshot for a department.
 */
export async function freezeDepartmentFinalists(
  input: FreezeDepartmentFinalistsInput,
): Promise<LifecycleActionState> {
  const formData = new FormData();
  formData.set("electionId", input.electionId);
  formData.set("departmentId", input.departmentId);

  const result = await freezeStage1Finalists({ ok: true, message: "" }, formData);
  return {
    ok: result.ok,
    code: result.ok ? undefined : result.code,
    message: result.message,
    electionId: input.electionId,
  };
}

export interface FlagDepartmentStage2TieInput {
  electionId: string;
  departmentId: string;
}

/**
 * Flags a Winner Tie in Stage 2 holding publication until manual pick.
 */
export async function flagDepartmentStage2Tie(
  input: FlagDepartmentStage2TieInput,
): Promise<LifecycleActionState> {
  const formData = new FormData();
  formData.set("electionId", input.electionId);
  formData.set("departmentId", input.departmentId);

  const result = await flagStage2Tie({ ok: true, message: "" }, formData);
  return {
    ok: result.ok,
    code: result.ok ? undefined : result.code,
    message: result.message,
    electionId: input.electionId,
  };
}
