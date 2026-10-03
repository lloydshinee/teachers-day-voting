import "client-only";

import { createBrowserClient } from "@supabase/ssr";

import { getClientEnv } from "./client-env";

// Browser client for Client Components ONLY. The "client-only" import above
// makes server-side imports a build error.
export function createClient() {
  const { url, key } = getClientEnv();
  return createBrowserClient(url, key);
}
