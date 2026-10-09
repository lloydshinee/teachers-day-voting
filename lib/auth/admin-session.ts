import type { SupabaseClient } from "@supabase/supabase-js";

export type AdminAuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN";

export interface AdminAuthError {
  readonly ok: false;
  readonly code: AdminAuthErrorCode;
  readonly message: string;
}

export interface AdminSession {
  readonly adminId: string;
  readonly supabase: SupabaseClient;
}

export type AdminSessionResult =
  | { readonly ok: true; readonly session: AdminSession }
  | AdminAuthError;

export interface AdminSessionAdapter {
  resolve(): Promise<AdminSessionResult>;
}

export const DEFAULT_UNAUTHENTICATED_MESSAGE =
  "Sign in as an admin to perform this action.";
export const DEFAULT_FORBIDDEN_MESSAGE =
  "Admin access required. Sign in with an admin account.";

/**
 * Production adapter: authenticates via Supabase Auth cookies and
 * verifies the admin allowlist via the `public.is_admin()` RPC.
 */
export class ProductionAdminSessionAdapter implements AdminSessionAdapter {
  private customUnauthenticatedMessage?: string;
  private customForbiddenMessage?: string;

  constructor(customMessages?: {
    unauthenticatedMessage?: string;
    forbiddenMessage?: string;
  }) {
    this.customUnauthenticatedMessage = customMessages?.unauthenticatedMessage;
    this.customForbiddenMessage = customMessages?.forbiddenMessage;
  }

  async resolve(): Promise<AdminSessionResult> {
    const { createClient } = await import("../supabase/server");
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        ok: false,
        code: "UNAUTHENTICATED",
        message:
          this.customUnauthenticatedMessage ?? DEFAULT_UNAUTHENTICATED_MESSAGE,
      };
    }

    const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
    if (adminError ?? isAdmin !== true) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: this.customForbiddenMessage ?? DEFAULT_FORBIDDEN_MESSAGE,
      };
    }

    return {
      ok: true,
      session: {
        adminId: user.id,
        supabase,
      },
    };
  }
}

export interface RequireAdminSessionOptions {
  unauthenticatedMessage?: string;
  forbiddenMessage?: string;
  adapter?: AdminSessionAdapter;
}

/**
 * Encapsulated Admin Session and Authorization Seam.
 *
 * Verifies that the caller holds an authenticated session with an account
 * present in the admin allowlist. Fails closed with typed error states.
 * Reuses the authenticated SupabaseClient for subsequent operations.
 */
export async function requireAdminSession(
  options?: RequireAdminSessionOptions,
): Promise<AdminSessionResult> {
  const adapter =
    options?.adapter ??
    new ProductionAdminSessionAdapter({
      unauthenticatedMessage: options?.unauthenticatedMessage,
      forbiddenMessage: options?.forbiddenMessage,
    });

  return adapter.resolve();
}

export interface AdminContext {
  adminId: string;
}

export type AdminGateResult<TState> =
  | { ok: true; context: AdminContext }
  | { ok: false; state: TState };

/**
 * Standard gate for Server Actions requiring admin authentication and allowlist membership.
 * Automatically maps failure into the action error state shape.
 */
export async function requireAdminGate<TState = AdminAuthError>(
  options?: RequireAdminSessionOptions,
): Promise<AdminGateResult<TState>> {
  const result = await requireAdminSession(options);
  if (!result.ok) {
    return { ok: false, state: result as unknown as TState };
  }
  return { ok: true, context: { adminId: result.session.adminId } };
}

