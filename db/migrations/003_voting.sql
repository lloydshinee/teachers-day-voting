-- Migration: 003_voting
-- Spec task 4 — Migration 2 (.scratch/teachers-day-voting/spec.md §14 task 4,
-- DDL direction §3): voting_tokens, votes, finalists, election_results,
-- audit_logs.
--
-- What this does:
--   1. Creates the five voting tables exactly per spec §3 (column direction):
--        voting_tokens(id, election_id, department_id, token_hash unique,
--                  token_type CHECK (FACULTY|STUDENT), faculty_id null → faculty
--                  (1:1 link for FACULTY; NULL for STUDENT, LOCKED),
--                  used bool default false, used_at null, invalidated_at null,
--                  plus the faculty-link CHECK:
--                  FACULTY ⇒ faculty_id NOT NULL, STUDENT ⇒ faculty_id IS NULL)
--        votes(id, election_id, department_id, candidate_faculty_id → faculty,
--                  stage CHECK (FACULTY|STUDENT), created_at)
--                  — NO token/voter reference, ever (privacy, LOCKED).
--                  Duplicate-vote prevention rests on the token row + used flag,
--                  so there is deliberately NO vote-side unique constraint
--                  (which would require a voter reference).
--        finalists(id, election_id, department_id, faculty_id → faculty,
--                  stage1_votes int, rank int) — frozen Stage-1 snapshot (LOCKED).
--        election_results(election_id, department_id, pk both,
--                  winner_faculty_id → faculty, published bool default false,
--                  policy_version timestamptz) — publishable record (LOCKED).
--        audit_logs(id, election_id, actor_admin_id uuid, action, details jsonb,
--                  created_at) — token-use WITHOUT choice, never choice↔identity.
--   2. Enables RLS deny-by-default on all five tables: no grants to anon,
--      no permissive policies. The /vote path never touches these tables
--      through the Data API; it uses the server-side service-role client,
--      which bypasses RLS entirely.
--   3. Adds admin-only policies reusing public.is_admin() (created in
--      001_admins_allowlist.sql): authenticated users with an admins row get
--      full access; everyone else gets nothing. No anon policies at all.
--   4. Runs no-join-key assertions (DO blocks): the migration FAILS if any
--      column or foreign key anywhere joins a vote to a Token or voter.
--
-- Nullability calls where spec §3 is silent (disclosed, not hidden):
--   audit_logs.election_id is NULL-able so operator-level actions outside one
--   election (e.g. purge, signup closure) can still be logged;
--   audit_logs.actor_admin_id is NULL-able for system/service-role writes and
--   is SET NULL (not cascaded) if the admin row is removed, so log history
--   survives allowlist churn.
--
-- Deny-by-default shape (per research-token-security.md §3, same as 001/002):
--   grants are revoked first, then least-privilege policies are added.
--   There are intentionally no policies for anon or for non-admin
--   authenticated users, so all such API access is denied.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- --------------------------------------------------------------- voting_tokens

CREATE TABLE IF NOT EXISTS public.voting_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES public.elections (id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments (id) ON DELETE RESTRICT,
  token_hash text NOT NULL UNIQUE CHECK (token_hash <> ''),
  token_type text NOT NULL CHECK (token_type IN ('FACULTY', 'STUDENT')),
  -- 1:1 link for FACULTY Tokens; NULL for STUDENT Tokens (LOCKED).
  -- Transient at vote time, never joined to votes (see assertions below).
  faculty_id uuid NULL REFERENCES public.faculty (id) ON DELETE RESTRICT,
  used boolean NOT NULL DEFAULT false,
  used_at timestamptz NULL,
  invalidated_at timestamptz NULL,
  CONSTRAINT voting_tokens_faculty_link_check CHECK (
    (token_type = 'FACULTY' AND faculty_id IS NOT NULL)
    OR (token_type = 'STUDENT' AND faculty_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS voting_tokens_election_department_idx
  ON public.voting_tokens (election_id, department_id);

-- ----------------------------------------------------------------------- votes

-- Secret ballot shape (LOCKED): candidate + department + stage only.
-- There is deliberately no token_id / token_hash / voter column of any kind.
CREATE TABLE IF NOT EXISTS public.votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES public.elections (id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments (id) ON DELETE RESTRICT,
  candidate_faculty_id uuid NOT NULL REFERENCES public.faculty (id) ON DELETE RESTRICT,
  stage text NOT NULL CHECK (stage IN ('FACULTY', 'STUDENT')),
  -- Kept for stage-close verification; documented residual timing-correlation
  -- vector (spec §3 — privacy wording covers this honestly).
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Counting queries aggregate over (election, department, stage) per spec §12.
CREATE INDEX IF NOT EXISTS votes_election_department_stage_idx
  ON public.votes (election_id, department_id, stage);
CREATE INDEX IF NOT EXISTS votes_candidate_faculty_id_idx
  ON public.votes (candidate_faculty_id);

-- ------------------------------------------------------------------- finalists

CREATE TABLE IF NOT EXISTS public.finalists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NOT NULL REFERENCES public.elections (id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments (id) ON DELETE RESTRICT,
  faculty_id uuid NOT NULL REFERENCES public.faculty (id) ON DELETE RESTRICT,
  stage1_votes integer NOT NULL CHECK (stage1_votes >= 0),
  rank integer NOT NULL CHECK (rank >= 1),
  -- Snapshot integrity: each faculty appears once per department snapshot,
  -- each rank is taken once per department snapshot (frozen Top-3).
  UNIQUE (election_id, department_id, faculty_id),
  UNIQUE (election_id, department_id, rank)
);

CREATE INDEX IF NOT EXISTS finalists_election_department_idx
  ON public.finalists (election_id, department_id);

-- -------------------------------------------------------------- election_results

CREATE TABLE IF NOT EXISTS public.election_results (
  election_id uuid NOT NULL REFERENCES public.elections (id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES public.departments (id) ON DELETE RESTRICT,
  winner_faculty_id uuid NOT NULL REFERENCES public.faculty (id) ON DELETE RESTRICT,
  published boolean NOT NULL DEFAULT false,
  policy_version timestamptz NULL,
  PRIMARY KEY (election_id, department_id)
);

-- ------------------------------------------------------------------- audit_logs

-- Never-log rule (LOCKED): token-use WITHOUT choice, tie picks WITH policy
-- version, never choice↔identity in one payload. Enforced by the audit helper
-- (later task); the schema's part is carrying no join key (see assertions).
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  election_id uuid NULL REFERENCES public.elections (id) ON DELETE CASCADE,
  actor_admin_id uuid NULL REFERENCES public.admins (auth_user_id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action <> ''),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_election_id_idx
  ON public.audit_logs (election_id);

-- ------------------------------------------------------------------ RLS setup

ALTER TABLE public.voting_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.finalists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.election_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Grants first: anon gets nothing on all five tables; authenticated gets the
-- API privileges only (a policy is still required before any row is visible).
REVOKE ALL ON TABLE public.voting_tokens FROM anon, authenticated;
REVOKE ALL ON TABLE public.votes FROM anon, authenticated;
REVOKE ALL ON TABLE public.finalists FROM anon, authenticated;
REVOKE ALL ON TABLE public.election_results FROM anon, authenticated;
REVOKE ALL ON TABLE public.audit_logs FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.voting_tokens TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.votes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.finalists TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.election_results TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.audit_logs TO authenticated;

-- The only API path to these rows: an admin (row in public.admins).
-- FOR ALL covers SELECT/INSERT/UPDATE/DELETE; USING gates reads, WITH CHECK
-- gates writes. service_role bypasses RLS and needs no policy.
DROP POLICY IF EXISTS voting_tokens_admin_all ON public.voting_tokens;
CREATE POLICY voting_tokens_admin_all
  ON public.voting_tokens
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS votes_admin_all ON public.votes;
CREATE POLICY votes_admin_all
  ON public.votes
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS finalists_admin_all ON public.finalists;
CREATE POLICY finalists_admin_all
  ON public.finalists
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS election_results_admin_all ON public.election_results;
CREATE POLICY election_results_admin_all
  ON public.election_results
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS audit_logs_admin_all ON public.audit_logs;
CREATE POLICY audit_logs_admin_all
  ON public.audit_logs
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ------------------------------------------- no-join-key privacy assertions
-- Secret ballot (LOCKED, spec §3/§4/§7): no column or foreign key anywhere
-- joins a vote to a Token or voter. These blocks FAIL the migration if the
-- forbidden shape ever appears — including via a future migration that adds
-- a token/voter column or FK to votes.

-- 1. votes has exactly the spec §3 columns — nothing to hang a join on.
DO $$
DECLARE
  extra text;
BEGIN
  SELECT string_agg(column_name, ', ' ORDER BY column_name) INTO extra
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'votes'
    AND column_name NOT IN
      ('id', 'election_id', 'department_id', 'candidate_faculty_id',
       'stage', 'created_at');
  IF extra IS NOT NULL THEN
    RAISE EXCEPTION 'privacy guard: votes carries non-spec column(s) (%); votes must hold candidate + department + stage only', extra;
  END IF;
END $$;

-- 2. Every FK out of votes targets only elections / departments / faculty-as-
-- candidate. In particular, none targets voting_tokens (or anything else).
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(src.attname || ' -> ' || dst.relname, ', ' ORDER BY src.attname) INTO bad
  FROM pg_constraint c
  JOIN pg_class tbl ON tbl.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = tbl.relnamespace
  JOIN pg_class dst ON dst.oid = c.confrelid
  JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS src_att(num, ord) ON true
  JOIN pg_attribute src ON src.attrelid = tbl.oid AND src.attnum = src_att.num
  WHERE c.contype = 'f'
    AND n.nspname = 'public'
    AND tbl.relname = 'votes'
    AND dst.relname NOT IN ('elections', 'departments', 'faculty');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'privacy guard: votes has forbidden foreign key(s) (%) — no join key from a vote to a Token or voter may exist', bad;
  END IF;
END $$;

-- 3. No FK in either direction between votes and voting_tokens (belt and
-- suspenders alongside assertion 2, robust to constraint renames).
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_constraint c
  JOIN pg_class a ON a.oid = c.conrelid
  JOIN pg_namespace na ON na.oid = a.relnamespace
  JOIN pg_class b ON b.oid = c.confrelid
  JOIN pg_namespace nb ON nb.oid = b.relnamespace
  WHERE c.contype = 'f'
    AND na.nspname = 'public' AND nb.nspname = 'public'
    AND ((a.relname = 'votes' AND b.relname = 'voting_tokens')
      OR (a.relname = 'voting_tokens' AND b.relname = 'votes'));
  IF n <> 0 THEN
    RAISE EXCEPTION 'privacy guard: found % foreign key(s) between votes and voting_tokens; the vote↔Token path must not exist', n;
  END IF;
END $$;

-- 4. The faculty-link CHECK on voting_tokens is present (transient identity
-- resolution needs the 1:1 FACULTY link, and STUDENT rows must carry none).
DO $$
DECLARE
  n int;
BEGIN
  SELECT count(*) INTO n
  FROM pg_constraint
  WHERE conrelid = 'public.voting_tokens'::regclass
    AND contype = 'c'
    AND conname = 'voting_tokens_faculty_link_check';
  IF n <> 1 THEN
    RAISE EXCEPTION 'privacy guard: voting_tokens_faculty_link_check is missing';
  END IF;
END $$;

COMMENT ON TABLE public.voting_tokens IS
  'Per-election single-use voting Tokens (LOCKED): token_hash unique backstop; faculty_id 1:1 for FACULTY, NULL for STUDENT. Carries used/invalidated flags, never the choice. Spec §3/§6.';
COMMENT ON TABLE public.votes IS
  'Secret-ballot vote rows (LOCKED): candidate + department + stage only. No token/voter column or FK exists anywhere — see migration assertions. Spec §3/§7.';
COMMENT ON TABLE public.finalists IS
  'Frozen Stage-1 Top-3 snapshot per department, written on Stage-1 close (LOCKED). Spec §3/§12.';
COMMENT ON TABLE public.election_results IS
  'Per-department published-Winner record; published pages read this + finalists, never live vote rows. Spec §3/§12.';
COMMENT ON TABLE public.audit_logs IS
  'Admin audit trail: token-use WITHOUT choice, tie picks WITH policy version, never choice↔identity. Spec §3/§7.';
