-- Migration: 008_reopen_and_unified_cast_vote
-- Reopen gate fix and unified voting engine (spec §5, §8, §14).
--
-- What this does:
--   1. Updates `public.cast_vote(p_token_hash text, p_candidate_id uuid)`:
--        SECURITY DEFINER function with service_role execute grant.
--        Inspects the voting_tokens row FOR UPDATE under READ COMMITTED.
--        If token_type = 'FACULTY':
--          - Checks election stage is 'FACULTY_VOTING' OR (stage is 'FACULTY_RESULTS'
--            and election_departments.finalists_locked_at IS NULL). This fixes the
--            Stage-1 reopen bug where reopened departments could not accept votes.
--          - Validates candidate faculty is active (archived_at IS NULL),
--            same department, and non-self.
--          - Inserts into votes with stage 'FACULTY'.
--        If token_type = 'STUDENT':
--          - Checks election stage is 'STUDENT_VOTING'.
--          - Validates candidate faculty is a frozen finalist in public.finalists
--            for that (election, department).
--          - Inserts into votes with stage 'STUDENT'.
--        Marks voting_tokens.used = true.
--        Returns (election_id, department_id).
--   2. Recreates `public.cast_student_vote(p_token_hash text, p_candidate_id uuid)`:
--        A backward-compatible 2-line wrapper that simply calls public.cast_vote,
--        unifying the voting engine while maintaining 100% backward compatibility.

CREATE OR REPLACE FUNCTION public.cast_vote(
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
  v_finalists_locked_at timestamptz;
  v_candidate_department_id uuid;
  v_candidate_archived_at timestamptz;
  v_finalist_id uuid;
BEGIN
  -- Input shape checks. Uniform non-oracling rejection.
  IF p_token_hash IS NULL OR p_token_hash = '' THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;
  IF p_candidate_id IS NULL THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;

  -- 1. Inspects voting_tokens row.
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
  IF v_used THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;
  IF v_invalidated_at IS NOT NULL THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;

  -- Election stage lookup
  SELECT e.stage INTO v_stage
    FROM public.elections AS e
   WHERE e.id = v_election_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;

  -- 2. If token_type = 'FACULTY':
  IF v_token_type = 'FACULTY' THEN
    IF v_faculty_id IS NULL THEN
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;

    -- Checks election stage is 'FACULTY_VOTING' OR (stage is 'FACULTY_RESULTS' and election_departments.finalists_locked_at IS NULL).
    IF v_stage = 'FACULTY_VOTING' THEN
      NULL;
    ELSIF v_stage = 'FACULTY_RESULTS' THEN
      SELECT ed.finalists_locked_at
        INTO v_finalists_locked_at
        FROM public.election_departments AS ed
       WHERE ed.election_id = v_election_id
         AND ed.department_id = v_department_id;
      IF FOUND AND v_finalists_locked_at IS NOT NULL THEN
        RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
      END IF;
    ELSE
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;

    -- Validates candidate faculty is active, same department, non-self.
    SELECT f.department_id, f.archived_at
      INTO v_candidate_department_id, v_candidate_archived_at
      FROM public.faculty AS f
     WHERE f.id = p_candidate_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;
    IF v_candidate_archived_at IS NOT NULL THEN
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;
    IF v_candidate_department_id IS DISTINCT FROM v_department_id THEN
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;
    IF p_candidate_id = v_faculty_id THEN
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;

    -- Inserts into votes with stage 'FACULTY'.
    INSERT INTO public.votes (election_id, department_id, candidate_faculty_id, stage)
    VALUES (v_election_id, v_department_id, p_candidate_id, 'FACULTY');

  -- 3. If token_type = 'STUDENT':
  ELSIF v_token_type = 'STUDENT' THEN
    IF v_faculty_id IS NOT NULL THEN
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;

    -- Checks election stage is 'STUDENT_VOTING'.
    IF v_stage IS DISTINCT FROM 'STUDENT_VOTING' THEN
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;

    -- Validates candidate faculty is a frozen finalist in public.finalists for that (election, department).
    SELECT f.id INTO v_finalist_id
      FROM public.finalists AS f
     WHERE f.election_id = v_election_id
       AND f.department_id = v_department_id
       AND f.faculty_id = p_candidate_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
    END IF;

    -- Inserts into votes with stage 'STUDENT'.
    INSERT INTO public.votes (election_id, department_id, candidate_faculty_id, stage)
    VALUES (v_election_id, v_department_id, p_candidate_id, 'STUDENT');

  ELSE
    RAISE EXCEPTION 'vote rejected' USING ERRCODE = 'P0001';
  END IF;

  -- 4. Marks voting_tokens.used = true.
  UPDATE public.voting_tokens AS t
     SET used = true,
         used_at = now()
   WHERE t.id = v_token_id;

  -- 5. Returns (election_id, department_id).
  election_id := v_election_id;
  department_id := v_department_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.cast_vote(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cast_vote(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cast_vote(text, uuid) TO service_role;

COMMENT ON FUNCTION public.cast_vote(text, uuid) IS
  'Unified atomic vote (spec §8, migration 008): locks token row, validates stage (including Stage-1 reopen gate), checks candidate eligibility, inserts vote row, burns token. All-or-nothing; uniform rejection; service_role only.';

-- Recreates public.cast_student_vote as a 2-line wrapper calling public.cast_vote
CREATE OR REPLACE FUNCTION public.cast_student_vote(
  p_token_hash text,
  p_candidate_id uuid
)
RETURNS TABLE (election_id uuid, department_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT *
    FROM public.cast_vote(p_token_hash, p_candidate_id);
$$;

REVOKE ALL ON FUNCTION public.cast_student_vote(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cast_student_vote(text, uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cast_student_vote(text, uuid) TO service_role;

COMMENT ON FUNCTION public.cast_student_vote(text, uuid) IS
  'Backward-compatible wrapper delegating to public.cast_vote (migration 008).';
