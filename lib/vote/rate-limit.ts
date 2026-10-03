/**
 * Vote rate limiting + lockout (spec §8, task 16; research §4 Layers 1–2).
 *
 * Two budgets, both enforced BEFORE any token validation runs (no database
 * lookup happens while gated):
 *
 * - Per-IP sliding window: at most VOTE_IP_MAX_ATTEMPTS attempts per
 *   VOTE_IP_WINDOW_MS from one client IP. Generous enough for a NAT/lab full
 *   of legitimate voters, tight enough that guessing a 60-bit Code stays
 *   infeasible (60 attempts / 10 min ≈ 8.6k guesses/day/IP vs 2^60 Codes).
 * - Per-token-hash failure budget: at most VOTE_TOKEN_MAX_FAILURES failures
 *   per VOTE_TOKEN_WINDOW_MS against one token hash, then a
 *   VOTE_TOKEN_LOCKOUT_MS temporary lockout. Stricter per-hash, so repeated
 *   probing of one Code is cut off fast while honest typos (a handful) never
 *   trip it. A successful validation clears the hash's failure count.
 *
 * Non-oracling: the gate never consults token validity — its decision
 * depends only on (ip, token-hash, budget clocks). Denied callers all receive
 * the single VOTE_RATE_LIMITED_ERROR string (see `./schemas.js`), identical
 * for the IP and token budgets and for valid vs invalid Codes. Denials carry
 * `retryAfterSeconds`: the Server-Action equivalent of `429 + Retry-After`.
 * A future Route Handler wrapper must map code "RATE_LIMITED" to HTTP 429
 * with a `Retry-After: <seconds>` header from that field.
 *
 * SINGLE-INSTANCE STORE: budgets live in module-global Maps, which is
 * correct for a single-instance deployment only. When scaling past one
 * instance, replace this module's backing with shared storage (e.g. Upstash
 * Redis sliding-window counters) behind the same exported function
 * signatures — callers in `./actions.js` must not change. The Maps are
 * size-bounded (oldest-first eviction) so random-guess floods cannot grow
 * memory without limit; unknown-hash tracking is failure-only, and every
 * entry expires by the window/lockout clocks.
 *
 * This module is deliberately pure (no `server-only`, no I/O, injectable
 * clock) so the self-test can run it under plain Node. Client-IP resolution
 * (headers) lives in `./actions.js`, which is server-only.
 *
 * Glossary (GLOSSARY.md) is used exactly: Token is the single-use
 * credential; Code is its human-readable form; only the hash ever keys here
 * — raw Codes never enter this module.
 */

/** Max attempts from one IP per sliding window (generous for shared NAT). */
export const VOTE_IP_MAX_ATTEMPTS = 60;

/** Sliding-window length for the per-IP budget. */
export const VOTE_IP_WINDOW_MS = 10 * 60 * 1000;

/** Max failures against one token hash per window before lockout. */
export const VOTE_TOKEN_MAX_FAILURES = 10;

/** Window in which per-token-hash failures are counted. */
export const VOTE_TOKEN_WINDOW_MS = 10 * 60 * 1000;

/** How long a token hash stays locked once its failure budget is spent. */
export const VOTE_TOKEN_LOCKOUT_MS = 15 * 60 * 1000;

/** Memory-exhaustion guard: oldest IP buckets are evicted past this size. */
export const VOTE_RATE_LIMIT_MAX_TRACKED_IPS = 5000;

/** Memory-exhaustion guard: oldest token buckets are evicted past this size. */
export const VOTE_RATE_LIMIT_MAX_TRACKED_TOKENS = 20000;

export type VoteRateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

type TokenBucket = {
  failures: number[];
  lockedUntilMs: number;
};

/** Attempt timestamps (epoch ms) per client IP. */
const ipAttempts = new Map<string, number[]>();

/** Failure timestamps + lockout deadline per token hash. */
const tokenBuckets = new Map<string, TokenBucket>();

function secondsUntil(targetMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((targetMs - nowMs) / 1000));
}

function pruneOlderThan(timestamps: number[], cutoffMs: number): number[] {
  return timestamps.filter((stamp) => stamp > cutoffMs);
}

function evictOldestEntries<K, V>(store: Map<K, V>, maxEntries: number): void {
  while (store.size > maxEntries) {
    const oldest = store.keys().next();
    if (oldest.done) {
      break;
    }
    store.delete(oldest.value);
  }
}

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  return trimmed === "" ? "unknown" : trimmed;
}

/**
 * Records one attempt and decides whether it may proceed. Call BEFORE any
 * token validation (no DB). The token lockout is checked first because it is
 * the stricter, more specific budget; both denials are identical to the
 * caller except for the backoff duration.
 */
export function consumeVoteAttempt(
  ip: string,
  tokenHash: string | null,
  nowMs: number = Date.now(),
): VoteRateLimitDecision {
  if (tokenHash !== null && tokenHash !== "") {
    const bucket = tokenBuckets.get(tokenHash);
    if (bucket !== undefined && bucket.lockedUntilMs > nowMs) {
      return {
        allowed: false,
        retryAfterSeconds: secondsUntil(bucket.lockedUntilMs, nowMs),
      };
    }
  }

  const key = normalizeIp(ip);
  const windowStartMs = nowMs - VOTE_IP_WINDOW_MS;
  const recent = pruneOlderThan(ipAttempts.get(key) ?? [], windowStartMs);
  if (recent.length >= VOTE_IP_MAX_ATTEMPTS) {
    ipAttempts.set(key, recent);
    const oldest = recent[0] ?? nowMs;
    return {
      allowed: false,
      retryAfterSeconds: secondsUntil(oldest + VOTE_IP_WINDOW_MS, nowMs),
    };
  }
  recent.push(nowMs);
  ipAttempts.set(key, recent);
  evictOldestEntries(ipAttempts, VOTE_RATE_LIMIT_MAX_TRACKED_IPS);
  return { allowed: true };
}

/**
 * Records one failed validation against a token hash. Call for every
 * INVALID outcome (unknown/used/wrong-stage/ineligible — all identical to
 * the voter); never for server-misconfiguration outcomes, which are not the
 * voter's failure. Crossing the budget locks the hash until
 * nowMs + VOTE_TOKEN_LOCKOUT_MS. Null/empty hashes (malformed Codes) record
 * nothing — their IP attempt was already counted by `consumeVoteAttempt`.
 */
export function recordVoteFailure(
  tokenHash: string | null,
  nowMs: number = Date.now(),
): void {
  if (tokenHash === null || tokenHash === "") {
    return;
  }
  const windowStartMs = nowMs - VOTE_TOKEN_WINDOW_MS;
  const previous = tokenBuckets.get(tokenHash);
  const failures = pruneOlderThan(
    previous?.failures ?? [],
    windowStartMs,
  );
  failures.push(nowMs);
  const stillLocked =
    previous !== undefined && previous.lockedUntilMs > nowMs;
  const lockedUntilMs =
    stillLocked || failures.length < VOTE_TOKEN_MAX_FAILURES
      ? (previous?.lockedUntilMs ?? 0)
      : nowMs + VOTE_TOKEN_LOCKOUT_MS;
  tokenBuckets.set(tokenHash, { failures, lockedUntilMs });
  evictOldestEntries(tokenBuckets, VOTE_RATE_LIMIT_MAX_TRACKED_TOKENS);
}

/**
 * Clears a token hash's failure count after a successful validation, so
 * honest typos followed by a correct entry never accumulate toward lockout.
 */
export function recordVoteSuccess(tokenHash: string | null): void {
  if (tokenHash === null || tokenHash === "") {
    return;
  }
  tokenBuckets.delete(tokenHash);
}

/** Test-only reset. Not called outside self-tests. */
export function resetVoteRateLimits(): void {
  ipAttempts.clear();
  tokenBuckets.clear();
}
