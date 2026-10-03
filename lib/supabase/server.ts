import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { getClientEnv } from "./client-env";

// Server client for Server Components, Server Actions, and Route Handlers.
// Always create a fresh client per request — never share across requests.
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = getClientEnv();
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // setAll was called from a Server Component, where cookie writes
          // are not allowed. Session refresh is handled by proxy.ts instead.
        }
      },
    },
  });
}
