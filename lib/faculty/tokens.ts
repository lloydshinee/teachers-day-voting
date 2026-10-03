import "server-only";

/**
 * @deprecated Re-exported from @/lib/tokens/invalidation for backwards compatibility.
 * Prefer importing directly from @/lib/tokens.
 */

export {
  invalidateUnusedFacultyTokens,
  type InvalidateFacultyTokensOptions,
  type InvalidateFacultyTokensResult,
} from "../tokens/invalidation";
