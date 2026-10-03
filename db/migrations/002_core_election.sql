-- Migration: 002_core_election
-- Spec task 3 — Migration 1 (.scratch/teachers-day-voting/spec.md §14 task 3,
-- DDL direction §3): departments, faculty, elections, election_departments.
--
-- What this does:
--   1. Creates the four core tables exactly per spec §3 (column direction):
--        departments(id, code unique, name)
--        faculty(id, department_id → departments, full_name, archived_at null)
--        elections(id, name, academic_year, stage, tie_policy_text not null,
--                  tie_policy_locked_at null)
--        election_departments(election_id, department_id, pk both,
--                  finalists_locked_at null, winner_published_at null,
--                  tie_pending bool default false)
--      Faculty's department is GLOBAL (one department per faculty, LOCKED);
--      election_departments is the per-election participation + per-department
--      gate record (LOCKED). Election stage is the global state machine
--      DRAFT → FACULTY_VOTING → FACULTY_RESULTS → STUDENT_VOTING →
--      FINAL_RESULTS → CLOSED (spec §5, LOCKED); transitions are enforced by
--      the server state-machine library (later task), the CHECK here only
--      rejects unknown stage values.
--   2. Enables RLS deny-by-default on all four tables: no grants to anon,
--      no permissive policies. The /vote path never touches these tables
--      through the Data API; it uses the server-side service-role client,
--      which bypasses RLS entirely.
--   3. Adds admin-only policies reusing public.is_admin() (created in
--      001_admins_allowlist.sql): authenticated users with an admins row get
--      full access; everyone else gets nothing. No anon policies at all.
--
-- Deny-by-default shape (per research-token-security.md §3, same as 001):
--   grants are revoked first, then least-privilege policies are added.
--   There are intentionally no policies for anon or for non-admin
--   authenticated users, so all such API access is denied.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------- departments

CREATE TABLE IF NOT EXISTS public.departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code <> ''),
  name text NOT NULL CHECK (name <> '')
);

-- -------------------------------------------------------------------- faculty

CREATE TABLE IF NOT EXISTS public.faculty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES public.departments (id) ON DELETE RESTRICT,
  full_name text NOT NULL CHECK (full_name <> ''),
  archived_at timestamptz NULL
);

CREATE INDEX IF NOT EXISTS faculty_department_id_idx
  ON public.faculty (department_id);

-- ------------------------------------------------------------------- elections

CREATE TABLE IF NOT EXISTS public.elections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (name <> ''),
  academic_year text NOT NULL CHECK (academic_year <> ''),
  stage text NOT NULL DEFAULT 'DRAFT'
    CHECK (stage IN ('DRAFT', 'FACULTY_VOTING', 'FACULTY_RESULTS',
                     'STUDENT_VOTING', 'FINAL_RESULTS', 'CLOSED')),
  tie_policy_text text NOT NULL CHECK (tie_policy_text <> ''),
  tie_policy_locked_at timestamptz NULL
);

-- -------------------------------------------------------- election_departments

CREATE TABLE IF NOT EXISTS public.election_departments (
  election_id uuid NOT NULL REFERENCES public.elections (id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments (id) ON DELETE RESTRICT,
  finalists_locked_at timestamptz NULL,
  winner_published_at timestamptz NULL,
  tie_pending boolean NOT NULL DEFAULT false,
  PRIMARY KEY (election_id, department_id)
);

-- ------------------------------------------------------------------ RLS setup

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.faculty ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.elections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_departments ENABLE ROW LEVEL SECURITY;

-- Grants first: anon gets nothing on all four tables; authenticated gets the
-- API privileges only (a policy is still required before any row is visible).
REVOKE ALL ON TABLE public.departments FROM anon, authenticated;
REVOKE ALL ON TABLE public.faculty FROM anon, authenticated;
REVOKE ALL ON TABLE public.elections FROM anon, authenticated;
REVOKE ALL ON TABLE public.election_departments FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.departments TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.faculty TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.elections TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.election_departments TO authenticated;

-- The only API path to these rows: an admin (row in public.admins).
-- FOR ALL covers SELECT/INSERT/UPDATE/DELETE; USING gates reads, WITH CHECK
-- gates writes. service_role bypasses RLS and needs no policy.
DROP POLICY IF EXISTS departments_admin_all ON public.departments;
CREATE POLICY departments_admin_all
  ON public.departments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS faculty_admin_all ON public.faculty;
CREATE POLICY faculty_admin_all
  ON public.faculty
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS elections_admin_all ON public.elections;
CREATE POLICY elections_admin_all
  ON public.elections
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS election_departments_admin_all ON public.election_departments;
CREATE POLICY election_departments_admin_all
  ON public.election_departments
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON TABLE public.departments IS
  'Departments (e.g. CCS / College of Computing Studies); code is the short unique key. Spec §3.';
COMMENT ON TABLE public.faculty IS
  'Faculty with GLOBAL department belonging (one department per faculty). archived_at NULL = eligible. Spec §3.';
COMMENT ON TABLE public.elections IS
  'Reusable election container, one row per year; stage is the global state machine (DRAFT → … → CLOSED). Spec §3/§5.';
COMMENT ON TABLE public.election_departments IS
  'Per-election department participation + per-department gates (finalists_locked_at, winner_published_at, tie_pending). Spec §3/§5.';
