import "server-only";

import { z } from "zod";

// Privileged keys. Server runtime only — never import this module (or its
// importers) from Client Components.
const serviceRoleEnvSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type ServiceRoleEnv = z.infer<typeof serviceRoleEnvSchema>;

export function getServiceRoleKey(): string {
  let parsed: ServiceRoleEnv;
  try {
    parsed = serviceRoleEnvSchema.parse(process.env);
  } catch {
    // Generic message on purpose: never echo env values into logs.
    throw new Error("Missing Supabase service-role env vars. Check .env.local wiring.");
  }
  const key = parsed.SUPABASE_SECRET_KEY ?? parsed.SUPABASE_SERVICE_ROLE_KEY;
  if (key === undefined) {
    throw new Error(
      "Set SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) in .env.local.",
    );
  }
  return key;
}

// Server-side pepper for voting-Code hashes (spec §6, task 8).
// Concatenated BEFORE SHA-256: stored value is SHA-256(pepper + Code) hex,
// so a database dump alone is insufficient to test Code guesses. The pepper
// lives only in the server environment (or Vault in production — full setup
// docs land with spec task 20) and is never written to the database, never
// logged, and never sent to the browser.
const tokenPepperEnvSchema = z.object({
  VOTING_TOKEN_PEPPER: z.string().min(16),
});

export function getTokenPepper(): string {
  let parsed: { VOTING_TOKEN_PEPPER: string };
  try {
    parsed = tokenPepperEnvSchema.parse(process.env);
  } catch {
    // Generic message on purpose: never echo the secret into logs.
    throw new Error("Missing voting-Code pepper env var. Check .env.local wiring.");
  }
  return parsed.VOTING_TOKEN_PEPPER;
}
