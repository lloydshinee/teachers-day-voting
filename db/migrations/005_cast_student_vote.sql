-- Migration: 005_cast_student_vote
-- Spec task 12 — student vote transaction (.scratch/teachers-day-voting/spec.md
-- §14 task 12, security model §8, student UX §11): atomic `cast_student_vote`
-- as a SECURITY DEFINER database function, callable only through the
-- server-side service-role client. This file is the source of truth for the
-- student transaction (Stage-1 `cast_vote` in 004 is untouched).
--
-- What this does:
--   1. Creates `public.cast_student_vote(p_token_hash text, p_candidate_id uuid)`:
--        SELECT the token row FOR UPDATE → validate everything below →
--        INSERT the vote → mark the token used → return the server-derived
--        (election_id, department_id). Any failure raises and rolls back the
--        whole statement (all-or-nothing).
--      Server-derived, never trusted from the browser: election (from the
--      token row), department (from the token row), stage ('STUDENT' literal),
--      token type (checked STUDENT inside the function). The only
--      browser-influenced inputs are the token hash (recomputed server-side
--      from the presented Code with the pepper) and the candidate id — and
--      the candidate is re-validated here: it must be a frozen Finalist row
--      for exactly this (election, department). A forged department from the
--      browser never reaches this check, and a cross-department candidate
--      (e.g. a CCS Code voting for a COED faculty id) fails here because no
--      such finalist row exists for the token's department.
--   2. Student scope for task 12: the election must be in STUDENT_VOTING, the
--      token must be STUDENT / unused / not invalidated / faculty_id IS NULL,
--      the vote stage is written as 'STUDENT'. FACULTY tokens are rejected
--      (faculty token on the student path fails), and STUDENT tokens remain
--      rejected on the faculty path by 004's FACULTY type check.
--   3. Locks per research-token-security.md §2 (same as 004): the FOR UPDATE
--      row lock makes a second concurrent submit block; under READ COMMITTED
--      it then re-reads the updated (used) row and fails. The `token_hash`
--      unique constraint from 003 remains the independent backstop. The
--      function holds no lock across user input — it runs as one short
--      statement.
--   4. Uniform non-oracling errors: EVERY validation failure raises the same
--      `vote rejected` message (SQLSTATE P0001), so even a caller with direct
--      database access learns nothing about which check failed (unknown vs
--      used vs wrong stage vs wrong token type vs non-finalist candidate).
--      The server vote path maps all such failures to the single public
--      string "Invalid or unusable voting code".
--   5. Callable only through the service-role path: REVOKE ALL from PUBLIC,
--      anon, and authenticated; GRANT EXECUTE to service_role only. RLS
--      policies never run for service_role (bypass), and the Data-API roles
--      have no execute grant, so browsers cannot call this function
--      directly — only the server-side service-role client can.
--
-- Privacy (LOCKED, spec §§3, 4, 7): the vote row carries candidate +
-- department + stage only — no token/voter reference is written here or
-- anywhere else. The token→department link is resolved transiently inside the
-- transaction (required for department derivation) and discarded. Audit of
-- token-use (without choice) is written by the server audit hook after a
-- successful call, never inside the vote row.

CREATE OR REPLACE FUNCTION public.cast_student_vote(
  p_token_hash text,
  p_candidate_id uuid
)
RETURNS TABLE (election_id uuid, department_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_token_id uuid;
  v_election_id uuid;
  v_department_id uuid;
  v_token_type text;
  v_faculty_id uuid;
  v_used boolean;
  v_invalidated_at timestamptz;
  v_stage text;
  v_finalist_id uuid;
BEGIN
  -- Input shape checks. Same generic failure as every check below.
  IF p_token_hash IS NULL OR p_token_hash = '' THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;
  IF p_candidate_id IS NULL THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;

  -- Lock the token row. A concurrent second submit blocks here, then
  -- re-reads the committed (used) row under READ COMMITTED and fails below.
  SELECT t.id, t.election_id, t.department_id, t.token_type,
         t.faculty_id, t.used, t.invalidated_at
    INTO v_token_id, v_election_id, v_department_id, v_token_type,
         v_faculty_id, v_used, v_invalidated_at
    FROM public.voting_tokens AS t
   WHERE t.token_hash = p_token_hash
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;
  -- Token type (task 12: student flow only), unused state, live state.
  -- STUDENT rows carry no faculty link (LOCKED, spec §3).
  IF v_token_type IS DISTINCT FROM 'STUDENT' THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;
  IF v_used THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;
  IF v_invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;
  IF v_faculty_id IS NOT NULL THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;

  -- Election stage: Stage 2 only.
  SELECT e.stage INTO v_stage
    FROM public.elections AS e
   WHERE e.id = v_election_id;
  IF NOT FOUND OR v_stage IS DISTINCT FROM 'STUDENT_VOTING' THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;

  -- Candidate: must be a frozen Finalist for exactly the token's
  -- (election, department). Department is derived from the token row — a
  -- forged department or candidate from the browser never reaches this
  -- check as anything but an id, and a cross-department id fails here
  -- because no such finalist row exists for the token's department.
  -- Same-department non-finalist ids fail identically (uniform error).
  SELECT f.id INTO v_finalist_id
    FROM public.finalists AS f
   WHERE f.election_id = v_election_id
     AND f.department_id = v_department_id
     AND f.faculty_id = p_candidate_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;

  -- Secret-ballot insert: candidate + department + stage only. No token or
  -- voter reference exists on this row (see 003 privacy assertions).
  INSERT INTO public.votes (election_id, department_id, candidate_faculty_id, stage)
  VALUES (v_election_id, v_department_id, p_candidate_id, 'STUDENT');

  -- Burn the token while still holding the row lock: this UPDATE is what
  -- makes the FOR UPDATE lock protective (per the Postgres docs caveat).
  UPDATE public.voting_tokens AS t
     SET used = true,
         used_at = now()
   WHERE t.id = v_token_id;

  election_id := v_election_id;
  department_id := v_department_id;
  RETURN NEXT;
END;
$$;

-- Callable only through the server-side service-role client: no grants to
-- the Data-API roles, so browsers cannot execute this function directly.
REVOKE ALL ON FUNCTION public.cast_student_vote(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cast_student_vote(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cast_student_vote(text, uuid) TO service_role;

COMMENT ON FUNCTION public.cast_student_vote(text, uuid) IS
  'Atomic student vote (spec §8, task 12): locks the token row, validates election stage + STUDENT token type + unused state, derives the department from the token, validates a frozen Finalist candidate for exactly that (election, department), inserts the secret-ballot vote, burns the token. All-or-nothing; uniform vote-rejected error; service_role only.';
