-- ============================================================================
-- Operator script: Purge expired audit logs
-- Spec: .scratch/teachers-day-voting/spec.md §13 item 7, §3, §7
-- Retention policy:
--   Keep audit logs for election lifetime + 1 academic year, then operator purge.
--   The never-log rule is permanent.
--
-- Usage:
--   psql "$DATABASE_URL" -f supabase/purge-audit-logs.sql
--   or run directly in the Supabase SQL Editor.
-- ============================================================================

BEGIN;

-- 1. Identify closed elections whose latest audit entry is older than 1 year
--    (1 academic year retention past the election's lifetime).
CREATE TEMP TABLE expired_closed_elections ON COMMIT DROP AS
SELECT
  e.id AS election_id,
  e.name,
  e.academic_year,
  MAX(a.created_at) AS closed_at
FROM public.elections e
JOIN public.audit_logs a ON a.election_id = e.id
WHERE e.stage = 'CLOSED'
GROUP BY e.id, e.name, e.academic_year
HAVING MAX(a.created_at) < (NOW() - INTERVAL '1 year');

-- 2. Count records to be purged for reporting
DO $$
DECLARE
  v_election_count integer;
  v_log_count integer;
BEGIN
  SELECT count(*) INTO v_election_count FROM expired_closed_elections;
  SELECT count(*) INTO v_log_count
    FROM public.audit_logs
   WHERE election_id IN (SELECT election_id FROM expired_closed_elections);

  RAISE NOTICE 'Found % expired closed election(s) with % audit log entries to purge.',
    v_election_count, v_log_count;
END $$;

-- 3. Delete audit logs belonging to expired closed elections
WITH deleted AS (
  DELETE FROM public.audit_logs
  WHERE election_id IN (SELECT election_id FROM expired_closed_elections)
  RETURNING id
)
-- 4. Record an operator-level audit entry (election_id IS NULL) documenting the purge
INSERT INTO public.audit_logs (
  election_id,
  actor_admin_id,
  action,
  details,
  created_at
)
SELECT
  NULL,
  NULL,
  'PURGE_AUDIT_LOGS',
  jsonb_build_object(
    'retentionPolicy', 'election lifetime + 1 academic year',
    'cutoff', (NOW() - INTERVAL '1 year')::text,
    'purgedElectionsCount', (SELECT count(*) FROM expired_closed_elections),
    'purgedRowsCount', (SELECT count(*) FROM deleted),
    'purgedAt', NOW()::text
  ),
  NOW();

COMMIT;
