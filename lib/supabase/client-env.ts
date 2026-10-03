import { z } from "zod";

// Public Supabase connection values. Safe to bundle for the browser.
// Prefers the modern publishable key, falls back to the legacy anon key.
const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

export interface ResolvedClientEnv {
  url: string;
  key: string;
}

export function getClientEnv(): ResolvedClientEnv {
  let parsed: ClientEnv;
  try {
    parsed = clientEnvSchema.parse(process.env);
  } catch {
    // Generic message on purpose: never echo env values into logs.
    throw new Error(
      "Missing or invalid Supabase client env vars. Check .env.local wiring.",
    );
  }
  const key =
    parsed.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    parsed.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (key === undefined) {
    throw new Error(
      "Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.local.",
    );
  }
  return { url: parsed.NEXT_PUBLIC_SUPABASE_URL, key };
}
