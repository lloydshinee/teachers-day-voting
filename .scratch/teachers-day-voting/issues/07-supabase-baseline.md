# Repair the local Supabase read path and establish admin-auth baseline

Type: task
Status: resolved

## Question

Unblock decision work that depends on a trustworthy local backend. The discussion is blocked until this manual work is done — nothing to decide, only to establish:

- Diagnose why `supabase_read_only_user` has no password (MCP `list_tables`/`list_extensions` fail while `supabase_execute_sql` succeeds) and either repair it or document `supabase_execute_sql` as the canonical read path for this effort.
- Confirm the baseline others can assume: empty `public` schema (verified 2026-10-01), local URLs/keys location for app wiring, Supabase Auth admin-only posture, and whether a `supabase/` dir + CLI bootstrap is wanted.
- Record resulting facts (working query path, key locations, Auth enablement, row counts = zero tables) so later tickets can depend on them.

Resolved when the work is done and the facts above are recorded — not when the schema is built.

## Answer (resolved 2026-10-01, AFK work + human checklist)

**Diagnosis:** `supabase_read_only_user` exists with a NULL password (`pg_authid` confirms), so SCRAM auth can never succeed — that is the whole of the `list_tables`/`list_extensions` failure. The stack itself is healthy (docker compose project `supabase-teacher`, all containers Up). **Not repaired:** the MCP proxy's expected credential for that role is unknown from inside the repo, so setting a guessed password could not be verified — see human checklist. **Canonical path for this effort: `supabase_execute_sql`, which runs as role `postgres`** (verified live).

**Baseline facts (all verified live 2026-10-01):**
- `public` schema: **0 tables** (greenfield); Postgres 17.6; pgcrypto 1.3 present (per prior research).
- API base `http://localhost:8000`, Auth at `http://localhost:8000/auth/v1` (from compose `.env`); Studio has no host port published — API only.
- Auth service healthy; `auth.users` = **0**. Heads-up for the spec: public signup is currently **open** (`DISABLE_SIGNUP=false`, `ENABLE_EMAIL_SIGNUP=true`) — the admin-only posture must close or gate this.
- Keys (`ANON_KEY`, `SERVICE_ROLE_KEY`, etc.) live in `/home/user/Documents/supabase/teacher/.env` — values deliberately not recorded here.
- No `supabase/` dir and no Supabase CLI in the repo; the stack is owned outside the repo. Do **not** `supabase init` here — it would fight the running compose stack.

**Human checklist (only if `list_tables` repair is ever wanted):** set a password on `supabase_read_only_user` matching the MCP proxy's configured credential, then restart the proxy. Until then, every session uses `supabase_execute_sql`.
