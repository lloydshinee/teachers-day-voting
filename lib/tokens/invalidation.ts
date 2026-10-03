import { z } from "zod";

import { logFacultyAudit } from "@/lib/audit/hook";
import { createClient } from "@/lib/supabase/server";

/**
 * Token invalidation for faculty archive / move churn (spec §14 task 7).
 *
 * Churn rule: archiving a faculty member invalidates only the UNUSED voting
 * Tokens for that faculty — cast votes stand.
 */

const facultyContextSchema = z.object({
  id: z.string().uuid(),
  department_id: z.string().uuid(),
  full_name: z.string(),
});

type FacultyContext = z.infer<typeof facultyContextSchema>;

export interface InvalidateFacultyTokensOptions {
  /** Auth user id of the acting admin; null only for system writes. */
  actorAdminId?: string | null;
}

export interface InvalidateFacultyTokensResult {
  /** Number of UNUSED Token rows stamped invalidated. */
  invalidated: number;
}

/**
 * Invalidates the unused voting Token(s) for one archived faculty row and
 * writes one `INVALIDATE_FACULTY_TOKENS` audit entry when any row lapsed.
 */
export async function invalidateUnusedFacultyTokens(
  facultyId: string,
  options?: InvalidateFacultyTokensOptions,
): Promise<InvalidateFacultyTokensResult> {
  const supabase = await createClient();

  const { data: faculty } = await supabase
    .from("faculty")
    .select("id, department_id, full_name")
    .eq("id", facultyId)
    .maybeSingle();

  const { data, error } = await supabase
    .from("voting_tokens")
    .update({ invalidated_at: new Date().toISOString() })
    .eq("faculty_id", facultyId)
    .eq("token_type", "FACULTY")
    .eq("used", false)
    .is("invalidated_at", null)
    .select("id");

  if (error) {
    throw new Error(
      `Faculty Token invalidation failed (code ${error.code}).`,
    );
  }

  const invalidated = data === null ? 0 : data.length;
  if (invalidated > 0) {
    const parsedContext = facultyContextSchema.safeParse(faculty);
    if (parsedContext.success) {
      const context: FacultyContext = parsedContext.data;
      await logFacultyAudit({
        action: "INVALIDATE_FACULTY_TOKENS",
        facultyId,
        archivedFacultyId: null,
        departmentId: context.department_id,
        fullName: context.full_name,
        actorAdminId: options?.actorAdminId ?? null,
      });
    }
  }
  return { invalidated };
}
