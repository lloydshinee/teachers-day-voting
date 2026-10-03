# Research token hashing, atomic vote, RLS and rate-limit options

Type: research
Status: resolved

## Question

Surface the facts the privacy, token-linkage, and security decisions wait on, against this repo's actual stack (Next.js 16.3.8 App Router, empty local Supabase Postgres, no supabase-js/shadcn/zod yet):

- Token hashing at rest: pgcrypto availability + suitable hash (e.g. SHA-256 with app pepper vs bcrypt), and how to validate without storing raw tokens?
- Atomic vote submission: Postgres row-locking / `SELECT ... FOR UPDATE` + transaction pattern for validate-token → check-stage → check-department → check-finalist → record-vote → mark-used with replay/concurrency safety?
- RLS shape for admin-only Auth vs anonymous `/vote` server-side service-role path, so browser-provided `department_id`/`candidate_id`/`stage`/`token_type` are never trusted?
- Rate-limit / brute-force envelope for token guessing on Next.js + Supabase (edge, middleware, Postgres advisory hints)?

Resolve AFK via the research skill. Capture findings on a throwaway `research/token-security` branch with a context pointer from this ticket; do not decide policy here.

## Comments

- Research captured on branch `research/token-security` → `.scratch/teachers-day-voting/research-token-security.md`.
- Gist: (1) pgcrypto 1.3 verified on local PG 17.6 — SHA-256+pepper gives indexed hash lookup, bcrypt fits passwords not tokens;
  (2) `SELECT … FOR UPDATE` + update-while-locked txn (or single-statement compare-and-set) with unique backstop for atomic vote;
  (3) deny-by-default RLS for anon + server-side secret-key `/vote` path that derives all IDs from DB state, never client input.
- Map session: findings file is the close reference; no code or migrations were written on the branch.

## Answer (resolved 2026-10-01, research exception)

Findings verified substantive (146-line report, repo facts checked live against local Postgres 17.6): pgcrypto 1.3 available with no install step; deterministic SHA-256+pepper for tokens (indexed lookup) vs bcrypt for passwords; `SELECT … FOR UPDATE` vote transaction with unique backstop; deny-by-default RLS for anon with server-side service-role `/vote` path; edge + per-route rate-limit envelope. Full detail lives in `.scratch/teachers-day-voting/research-token-security.md`. No policy decided here — the privacy, token-linkage, and reuse tickets consume these facts.
