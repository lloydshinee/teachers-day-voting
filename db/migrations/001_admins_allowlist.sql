-- Migration: 001_admins_allowlist
-- Spec task 2 — admin Auth foundation (.scratch/teachers-day-voting/spec.md §14 task 2).
--
-- What this does:
--   1. Creates public.admins, the allowlist keyed by Supabase Auth user id.
--      A row's presence is what makes an authenticated user an admin.
--   2. Enables RLS deny-by-default on public.admins (no anon access at all,
--      authenticated reads only through the admin policy below, no API writes).
--   3. Adds public.is_admin(), the helper every later table's RLS policies reuse:
--      e.g. CREATE POLICY ... USING (public.is_admin()).
--
-- Deny-by-default shape (per research-token-security.md §3):
--   grants are revoked first, then a single least-privilege policy is added.
--   The /vote path never touches this table; it uses the server-side
--   service-role client, which bypasses RLS entirely.
--
-- Seeding is a deliberate out-of-band SQL step by the operator
-- (see docs/admin-first-seeding.md), never an API write: there are
-- intentionally NO insert/update/delete policies on this table.

CREATE TABLE IF NOT EXISTS public.admins (
  auth_user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- Grants first: anon gets nothing, authenticated gets SELECT only
-- (a policy is still required before any row is visible).
REVOKE ALL ON TABLE public.admins FROM anon, authenticated;
GRANT SELECT ON TABLE public.admins TO authenticated;

-- Reusable admin check for all future RLS policies.
-- SECURITY DEFINER so the membership lookup itself is not subject to RLS
-- (avoids recursion); fixed search_path against hijack; (SELECT auth.uid())
-- wrapping lets the planner cache the value per statement.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admins
    WHERE auth_user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- The only API path to these rows: an admin may list the allowlist.
-- No insert/update/delete policies => all API writes are denied;
-- rows are managed with SQL / service-role (bypass RLS), see seeding doc.
DROP POLICY IF EXISTS admins_select_if_admin ON public.admins;
CREATE POLICY admins_select_if_admin
  ON public.admins
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

COMMENT ON TABLE public.admins IS
  'Admin allowlist keyed by auth.users id; presence of a row confers admin rights via public.is_admin(). Managed by operator SQL only — no API writes.';
COMMENT ON FUNCTION public.is_admin() IS
  'Returns true when the requesting auth user has a row in public.admins. Reuse in every admin-gated RLS policy as USING (public.is_admin()).';
