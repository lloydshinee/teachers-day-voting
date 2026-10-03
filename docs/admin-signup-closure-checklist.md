# Human checklist — close public signup (spec task 2)

The agent does not restart infrastructure and does not edit the compose env.
A human operator runs every step below. Do this immediately after seeding the
first admin (`docs/admin-first-seeding.md` step 2).

## Why this exact change

- Verified wiring in the compose stack: service `auth`
  (`container_name: supabase-auth`, `supabase/gotrue`) sets
  `GOTRUE_DISABLE_SIGNUP: ${DISABLE_SIGNUP}`. So `DISABLE_SIGNUP` in the
  compose `.env` is the single effective switch for public signup.
- Baseline fact: signup is currently open. Until this checklist is done, anyone
  can create an Auth user against the local API.

## Steps

1. Open `/home/user/Documents/supabase/teacher/.env` (outside this repo —
   never copy values into the repo).
2. Find the line `DISABLE_SIGNUP=false` and change it to:
   `DISABLE_SIGNUP=true`
   Change nothing else.
3. From `/home/user/Documents/supabase/teacher`, recreate the auth service so
   it picks up the new env (a plain `restart` does NOT re-read `.env`):
   `docker compose up -d auth`
4. Confirm the container is healthy: `docker ps --filter name=supabase-auth`
   shows `supabase-auth` Up (healthy).
5. Confirm signup is disabled:
   `curl -s http://localhost:8000/auth/v1/settings` shows signup disabled,
   and a test sign-up attempt:
   `curl -s http://localhost:8000/auth/v1/signup -H "apikey: <PUBLISHABLE_KEY>" -H "Content-Type: application/json" -d '{"email":"probe@example.com","password":"<STRONG_PASSWORD>"}'`
   fails with a signup-disabled error (no user is created).
6. Confirm the first admin still signs in with their existing credentials, and
   that `public.admins` still holds exactly their row.

## After

- Public `/auth/v1/signup` stays closed for the life of the election system.
  New admins are created only through a controlled path plus an operator
  `INSERT INTO public.admins`.
- If this stack is ever rebuilt from scratch, re-run the seeding doc first
  (signup open → seed → this checklist) — the migration file
  `db/migrations/001_admins_allowlist.sql` recreates the table, RLS, and
  `public.is_admin()` on a fresh database.
