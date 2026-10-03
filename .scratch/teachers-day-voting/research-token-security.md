# Research: token hashing, atomic vote, RLS and rate-limit options

Ticket: `.scratch/teachers-day-voting/issues/06-token-security-research.md`
Branch: `research/token-security` (throwaway — findings only, no implementation, no migrations)
Date: 2026-10-01
Repo state verified: Next.js 16.3.8 + React 19.2.8 (`package.json`), no `supabase-js`/`zod`/`shadcn` in dependencies,
empty `public` schema on local Postgres 17.6, `pgcrypto` 1.3 present (verified by live SQL query, see §1).

> Scope note: this file answers the ticket's ## Question with facts and options.
> It deliberately makes no policy decision (that belongs to the privacy / token-linkage tickets).

## 1. Token hashing at rest

**Repo fact (verified live, 2026-10-01):** local Postgres reports
`PostgreSQL 17.6`, and `pg_available_extensions` shows `pgcrypto` default 1.3 / installed 1.3,
`public` schema has zero tables. So `pgcrypto` is available with no install step; any future
migration only needs `create extension if not exists pgcrypto` for reproducibility across environments.

**Primary source — PostgreSQL pgcrypto docs** (`https://www.postgresql.org/docs/17/pgcrypto.html`,
also `/current/` and `/18/` — content identical on the points below):

- `digest(data text, type text) returns bytea` computes a binary hash; standard `type` values include
  `sha256`/`sha384`/`sha512` (plus anything OpenSSL supports). Hex text form via `encode(digest(...), 'hex')`
  — the docs give exactly this `encode(digest($1, 'sha1'), 'hex')` recipe.
- `crypt(password text, salt text)` + `gen_salt(type [, iter_count])` are the password-hashing pair.
  Supported `crypt()` algorithms: `bf` (blowfish variant 2a = bcrypt, adaptive, 128 salt bits, 60-char output,
  **max password length 72**), `sha256crypt`/`sha512crypt` (adaptive, outputs 80/123 chars), plus legacy
  `des`/`xdes`/`md5` (not adaptive — unsuitable). Check-a-secret recipe from the docs: pass the stored hash
  back as `salt` and compare (`crypt(input, stored_hash) = stored_hash`).

**Options for vote tokens (facts, not a decision):**

- (a) **Deterministic SHA-256 (+ app pepper):** store `encode(digest(pepper || raw_token, 'sha256'), 'hex')`;
  validate by recomputing on the presented token and equality-matching. Deterministic hashing is what makes
  "validate without storing raw tokens" a plain indexed lookup (`WHERE token_hash = ...`). Fast hashes are
  acceptable here *only if* tokens are high-entropy random (e.g. ≥128-bit from `gen_random_bytes`), because
  brute force then means guessing the token itself, not cracking a weak secret. Pepper = server-side secret
  concatenated before hashing, kept out of the DB (env var or Supabase Vault — Vault is listed in Supabase's
  own "Securing your data" access/security pages), so a DB dump alone is insufficient to test guesses.
- (b) **Adaptive hash (`crypt` + `gen_salt('bf', …)`):** per-row salt, deliberately slow, designed for
  low-entropy human passwords. Downside for tokens: non-deterministic output means no direct indexed lookup —
  you must first locate the candidate row by some other selector, then check. Also note the 72-byte input cap
  on `bf`. Better fit for admin passwords than for single-use bearer tokens.
- Timing side-channel hygiene: compare hashes in constant time (Node `crypto.timingSafeEqual`; Postgres-side
  `crypt()` comparison is already hash-compare, but app-side hex compare should use `timingSafeEqual`).
  Return a single generic "invalid" response regardless of *why* validation failed (unknown vs used vs expired).

## 2. Atomic vote submission (row locking + transaction pattern)

**Primary source — PostgreSQL docs:** `explicit-locking.html` ("`FOR UPDATE` causes the rows retrieved by
the `SELECT` to be locked as though for update… other transactions that attempt `UPDATE/DELETE/SELECT FOR UPDATE/…`
on these rows block until the current transaction ends"); `sql-select.html` (locking clause requires `UPDATE`
privilege; `NOWAIT` errors instead of waiting, `SKIP LOCKED` skips locked rows — the latter gives an
inconsistent view, unsuitable here); `applevel-consistency.html` ("to ensure the current validity of a row and
protect it against concurrent updates one must use `SELECT FOR UPDATE`…", and the caveat that the lock alone
does not stop a later concurrent update — you must actually `UPDATE` the row while holding the lock).

**Pattern shape the decision tickets can rely on (standard READ COMMITTED):**

1. `BEGIN` → `SELECT … FROM vote_tokens WHERE token_hash = … FOR UPDATE` (second concurrent submitter blocks
   on this row lock; in READ COMMITTED it then re-reads the *updated* row version after the first txn commits).
2. Still inside the txn, in order: validate token (exists / not used / not expired) → check election stage is
   open → resolve department/finalist **from the token row and election config, not from client input** →
   `INSERT` the vote → `UPDATE vote_tokens SET used = true …` (the actual row modification that makes the
   lock protective, per the docs caveat) → `COMMIT`.
3. Backstops independent of the lock: a `UNIQUE` constraint on the one-vote-per-token key (and/or partial unique
   index), so even a lock-ordering bug degrades to a clean constraint violation instead of a double vote.
   Keep the txn short (never hold it across user input — the docs warn lock waiters block indefinitely) and
   acquire Boulevard: locks in a consistent order; retry on Postgres deadlock aborts.
4. Cheaper alternative with identical single-winner semantics: one-statement compare-and-set
   (`UPDATE vote_tokens SET used = true WHERE token_hash = … AND used = false … RETURNING …`) and only
   `INSERT` the vote if a row was returned — atomic without an explicit multi-statement txn. The docs' model
   supports both; the choice is a complexity-vs-clarity decision for later.

## 3. RLS shape: admin-only Auth vs anonymous `/vote` service-role path

**Primary source — Supabase docs** (`/docs/guides/database/postgres/row-level-security`,
`/docs/guides/database/secure-data`, `/docs/guides/getting-started/api-keys`, troubleshooting note
"Why is my service_role key client getting RLS errors"):

- Every request maps to a Postgres role: publishable key + no session → `anon`; + Auth session → `authenticated`.
  Supabase explicitly warns: policies alone are not enough — **grants are checked first**, so revoke unneeded
  grants per role; a table "protected only by policies still hands `anon` an insert path if you never revoke
  the grant."
- `service_role` (legacy JWT key) / **secret key** (`sb_secret_…`, the replacement Supabase is migrating to by
  end of 2026) carries the `BYPASSRLS` attribute: **policies never run for it**. Never expose it in browser/client
  code (secret keys additionally return 401 on browser `User-Agent`). Subtlety from current docs: a secret key
  bypasses RLS **only when the request carries no user access token** — if a user JWT is also attached, the
  request is evaluated under that user's policies; also, putting `service_role` in a policy's `TO` list does
  nothing since policies never execute for it.
- Views bypass RLS by default (created as `postgres`/security-definer); on PG ≥ 15 use
  `WITH (security_invoker = true)` if a view must obey invoking-role policies.

**Shape that answers the ticket (facts, not schema):**

- Admin path: Supabase Auth users, `authenticated` role, least-privilege policies (e.g. `TO authenticated …
  USING ((select auth.uid()) = …)` — docs recommend the `(select …)` wrap so the planner caches per-statement,
  role in `TO`, and indexes on policy-filtered columns).
- Anonymous `/vote` path: **no direct Data-API access** — enable RLS on vote/token tables with *no* permissive
  `anon` policies (and revoked `anon` grants), so browser calls hit deny-by-default; all vote writes go through a
  server-side Next.js Route Handler / Server Action running with the secret key, which reads the token row,
  derives `department_id`/`candidate_id`/`stage`/`token_type` server-side from DB state, and ignores (or rejects
  on mismatch) any client-supplied copies. This is exactly the "Edge Functions / direct connections with secrets,
  Data API disabled-or-deny" model in Supabase's "Securing your data" page, applied to a Next.js server route.

## 4. Rate-limit / brute-force envelope (Next.js + Supabase)

**Repo fact:** no rate-limiting or Redis dependency exists yet; `middleware.ts`/proxy file not yet present
(App Router default project). Next.js 16 docs in this repo live under `node_modules/next/dist/docs/`
(`01-app/01-getting-started/15-route-handling`, `16-proxy` cover Route Handlers and proxy/middleware).

**Primary/adjacent sources:** Next.js proxy (middleware) runs at the edge before the route — the correct coarse
interception point; Upstash `@upstash/ratelimit` + `@upstash/redis` sliding-window pattern is the consistent
2026 community recommendation across independent write-ups; OWASP Authentication Cheat Sheet controls
(lockout, throttling, uniform responses) are the policy baseline those write-ups cite.

**Envelope options:**

- **Layer 1 (edge, coarse):** Next.js proxy/middleware, per-IP sliding window on `/vote*` + `/api/*`, matcher
  excluding static assets; `429` with `Retry-After` (RFC 6585) and `RateLimit-*` headers; log every 429 with
  identifier for calibration.
- **Layer 2 (route, fine):** in the vote Route Handler, a stricter limiter keyed on composite `ip + token-hash`
  (IP-only keys over-block behind CGNAT; token-only keys let distributed guessing spread out — composite is the
  recommended blend), plus per-token failure counting → temporary token lockout with auto-expiry, progressive
  delay, CAPTCHA (e.g. Turnstile) after N failures, generic error strings, `timingSafeEqual` compare.
- **Layer 3 (database proximity):** Postgres advisory-lock hints (`pg_advisory_xact_lock(hashtext(…))`) can
  serialize per-token vote attempts inside the DB as a complement to §2's row lock; not a substitute for
  edge rate limiting against guessing volume. Supabase platform-level WAF/Edge protections sit outside app code
  and are deployment-dependent — noted, not relied upon.

## Sources (high-trust first)

1. `https://www.postgresql.org/docs/17/pgcrypto.html` — `digest`/`encode`, `crypt`/`gen_salt`, algorithm table.
2. `https://www.postgresql.org/docs/current/explicit-locking.html` — `FOR UPDATE` row-lock semantics.
3. `https://www.postgresql.org/docs/current/oplevel-consistency.html` → `applevel-consistency.html` — must
   `UPDATE` the locked row; lock-then-modify requirement.
4. `https://www.postgresql.org/docs/current/sql-select.html` — locking clause, `NOWAIT`/`SKIP LOCKED`, privilege.
5. `https://supabase.com/docs/guides/database/postgres/row-level-security` — roles, grants-before-policies,
   `service_role` bypass, `(select auth.uid())` + `TO` + index perf guidance.
6. `https://supabase.com/docs/guides/database/secure-data` + `/docs/guides/getting-started/api-keys` —
   secret vs publishable keys, server-only bypass path, 2026 key migration.
7. `https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z`
   — bypass governed by `Authorization` header; `service_role` in policies is a no-op.
8. Local repo + live DB checks: `package.json` (Next 16.3.8, no supabase-js/zod/shadcn), `SELECT version()` →
   PG 17.6, `pg_available_extensions` → pgcrypto 1.3 installed, `pg_tables` → empty `public`.
9. Next.js 16 docs in-repo: `node_modules/next/dist/docs/01-app/01-getting-started/{15-route-handlers,16-proxy}.md`.
