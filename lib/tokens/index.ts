/**
 * Unified Token & Code Module (spec §6, §14 tasks 7, 8, 11).
 *
 * Consolidates all voting credential mechanics:
 * - Code alphabet, formatting, and normalization
 * - Server-side pepper hashing at rest
 * - QR link payload construction
 * - Token invalidation for faculty churn
 */

export * from "./format";
export * from "./hashing";
export * from "./vote-link";
export * from "./invalidation";
export * from "./minting";
