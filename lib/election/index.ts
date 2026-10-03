/**
 * Election state machine library (spec §5).
 *
 * - `./stages`: forward-only global stage chain + explicit admin actions.
 * - `./department`: per-department advancement markers (Finalists locked,
 *   Winner published, Tie pending).
 * - `./actions`: Zod-validated transitions with the re-open guardrail and
 *   display-only advisory windows.
 */

export {
  ACTION_ERROR_CODES,
  advisoryExpiryInputSchema,
  advisoryWindowSchema,
  applyAdvisoryWindowExpiry,
  applyFlagTie,
  applyGlobalAction,
  applyLockFinalists,
  applyPublishWinner,
  applyReopenStage1,
  applyResolveTie,
  flagTieInputSchema,
  globalTransitionInputSchema,
  lockFinalistsInputSchema,
  publishWinnerInputSchema,
  reopenStage1InputSchema,
  resolveTieInputSchema,
} from "./actions";
export type {
  ActionError,
  ActionErrorCode,
  ActionResult,
  AdvisoryExpirySuccess,
  AdvisoryWindow,
  FlagTieSuccess,
  GlobalTransitionInput,
  GlobalTransitionSuccess,
  LockFinalistsSuccess,
  PublishWinnerSuccess,
  ReopenStage1Success,
  ResolveTieInput,
  ResolveTieSuccess,
} from "./actions";
export {
  departmentMarkersSchema,
  isFinalistsLocked,
  isTiePending,
  isWinnerPublished,
} from "./department";
export type { DepartmentMarkers } from "./department";
export {
  ELECTION_STAGES,
  GLOBAL_ADMIN_ACTIONS,
  globalAdminActionSchema,
  isDirectForwardTransition,
  nextStageAfter,
  stageOrder,
  electionStageSchema,
} from "./stages";
export type { ElectionStage, GlobalAdminAction } from "./stages";

// Re-exported counting math for consolidated pure access
export { computeStage1Cutoff, type Stage1CutoffResult } from "../stage1/counting";
export { computeStage2Winner, type Stage2WinnerResult } from "../stage2/counting";

