import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { getClientEnv } from "./client-env";
import { getServiceRoleKey } from "./server-env";

// Service-role client for the future server-side vote path (cast_vote).
// Bypasses RLS and ignores sessions: persistSession/autoRefreshToken are off.
// Strictly server-only — never import from Client Components and never
// return this client (or its key) to the browser.
export function createServiceRoleClient() {
  const { url } = getClientEnv();
  return createSupabaseClient(url, getServiceRoleKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
