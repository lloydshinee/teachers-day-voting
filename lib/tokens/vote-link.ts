/**
 * QR link construction for voting Tokens (spec §6, task 11).
 *
 * The QR encodes ONLY `/vote?token=<CODE>` and nothing else — no PII, no
 * department, no election. The server re-validates everything at vote
 * time. Manual entry of the same Code is always available as fallback.
 *
 * This module is deliberately pure (no I/O) so both the admin code-sheet
 * UI and any self-test can import it without server dependencies.
 */

/** Path of the anonymous voting entry page. */
export const VOTE_PATH = "/vote";

/**
 * Builds the exact QR payload for one Code: `/vote?token=<CODE>`.
 * Nothing else is encoded.
 */
export function buildVoteCodeLink(code: string): string {
  return `${VOTE_PATH}?token=${code}`;
}
