import { z } from "zod";

/**
 * Election state machine — spec §5 (global stage).
 *
 * Global stage on the election, forward-only:
 *   DRAFT → FACULTY_VOTING → FACULTY_RESULTS → STUDENT_VOTING → FINAL_RESULTS → CLOSED
 *
 * Transitions move exactly one step forward, via explicit admin actions only
 * (each audit-logged by the caller). There is no backward global transition:
 * per-department re-opening unfreezes that department's snapshot markers
 * (see ./actions.ts) but never steps the global stage back.
 */

export const ELECTION_STAGES = [
  "DRAFT",
  "FACULTY_VOTING",
  "FACULTY_RESULTS",
  "STUDENT_VOTING",
  "FINAL_RESULTS",
  "CLOSED",
] as const;

export type ElectionStage = (typeof ELECTION_STAGES)[number];

export const electionStageSchema = z.enum(ELECTION_STAGES);

export type ElectionStageParse = z.infer<typeof electionStageSchema>;

/** Position of each stage in the forward chain. */
const STAGE_ORDER: Record<ElectionStage, number> = {
  DRAFT: 0,
  FACULTY_VOTING: 1,
  FACULTY_RESULTS: 2,
  STUDENT_VOTING: 3,
  FINAL_RESULTS: 4,
  CLOSED: 5,
};

/** The single legal successor of each non-terminal stage. */
const DIRECT_SUCCESSOR: Record<Exclude<ElectionStage, "CLOSED">, ElectionStage> = {
  DRAFT: "FACULTY_VOTING",
  FACULTY_VOTING: "FACULTY_RESULTS",
  FACULTY_RESULTS: "STUDENT_VOTING",
  STUDENT_VOTING: "FINAL_RESULTS",
  FINAL_RESULTS: "CLOSED",
};

/** Explicit admin action driving each forward step (audit-logged by the caller). */
export const GLOBAL_ADMIN_ACTIONS = {
  OPEN_FACULTY_VOTING: { from: "DRAFT", to: "FACULTY_VOTING" },
  CLOSE_FACULTY_VOTING: { from: "FACULTY_VOTING", to: "FACULTY_RESULTS" },
  OPEN_STUDENT_VOTING: { from: "FACULTY_RESULTS", to: "STUDENT_VOTING" },
  CLOSE_STUDENT_VOTING: { from: "STUDENT_VOTING", to: "FINAL_RESULTS" },
  CLOSE_ELECTION: { from: "FINAL_RESULTS", to: "CLOSED" },
} as const satisfies Record<string, { from: ElectionStage; to: ElectionStage }>;

export type GlobalAdminAction = keyof typeof GLOBAL_ADMIN_ACTIONS;

export const globalAdminActionSchema = z.enum(
  Object.keys(GLOBAL_ADMIN_ACTIONS) as [
    GlobalAdminAction,
    ...GlobalAdminAction[],
  ],
);

export function stageOrder(stage: ElectionStage): number {
  return STAGE_ORDER[stage];
}

/** The next stage after `stage`, or null when terminal (CLOSED). */
export function nextStageAfter(stage: ElectionStage): ElectionStage | null {
  if (stage === "CLOSED") {
    return null;
  }
  return DIRECT_SUCCESSOR[stage];
}

/**
 * True only for an exact one-step forward move. Skips (DRAFT → FACULTY_RESULTS),
 * repeats, and backward moves are all false — the machine is forward-only.
 */
export function isDirectForwardTransition(
  from: ElectionStage,
  to: ElectionStage,
): boolean {
  return nextStageAfter(from) === to;
}
