import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getClientEnv } from "./client-env";

// Session refresh for proxy.ts. Reads the session from request cookies and
// writes refreshed tokens back to the response so Server Components stay
// authenticated. Must never return a response stripped of these cookies.
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  let supabaseResponse = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  const { url, key } = getClientEnv();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({
          request: {
            headers: requestHeaders,
          },
        });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  // Triggers a refresh when the access token is expired; result intentionally
  // unused — proxy only maintains the session, it never gates on it here.
  await supabase.auth.getUser();

  return supabaseResponse;
}
