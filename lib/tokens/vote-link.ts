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
 * Resolves the configured or ambient application origin (base URL).
 * Resolution order:
 * 1. `NEXT_PUBLIC_APP_URL` env var (browser & server)
 * 2. `APP_URL` env var (server)
 * 3. `window.location.origin` (browser ambient runtime)
 * 4. `VERCEL_URL` env var (`https://${process.env.VERCEL_URL}`)
 * 5. empty string fallback if unknown (yielding relative path)
 */
export function getAppOrigin(): string {
  if (typeof process !== "undefined" && process.env) {
    if (process.env.NEXT_PUBLIC_APP_URL) {
      return process.env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");
    }
    if (process.env.APP_URL) {
      return process.env.APP_URL.replace(/\/+$/, "");
    }
  }
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  if (typeof process !== "undefined" && process.env?.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL.replace(/\/+$/, "")}`;
  }
  return "";
}

/**
 * Builds the exact QR payload for one Code: `<ORIGIN>/vote?token=<CODE>`.
 * Nothing else is encoded.
 *
 * If `origin` is provided, it is normalized (trailing slashes removed).
 * If omitted, `getAppOrigin()` is consulted.
 * If no origin is available (e.g. running in Node without configured env),
 * falls back to the relative path `/vote?token=<CODE>`.
 */
export function buildVoteCodeLink(code: string, origin?: string): string {
  const base =
    origin !== undefined ? origin.replace(/\/+$/, "") : getAppOrigin();
  const query = `${VOTE_PATH}?token=${encodeURIComponent(code)}`;
  return base ? `${base}${query}` : query;
}
