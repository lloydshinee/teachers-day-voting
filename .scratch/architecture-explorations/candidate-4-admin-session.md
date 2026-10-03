# Architecture Exploration: Candidate 4 — Encapsulate the Admin Session and Authorization Seam

## Executive Summary

In the Teachers' Day Voting codebase, the Election lifecycle advances through two department-isolated stages: faculty peer voting to advance a Top-3 of Candidates to Finalists, followed by student voting to select the department Winner. Throughout this lifecycle, voters interact exclusively through single-use Tokens rendered as human-readable Codes. Voters have no accounts and require no authentication credentials.

In contrast, administrators manage the entire Election lifecycle: configuring departments, registering Candidates, generating and revoking faculty and student Codes, breaking cutoff and Winner Ties, freezing Finalist snapshots, and publishing Winners. Administrative operations must be strictly authenticated and verified against an administrative allowlist.

Currently, this administrative authorization logic is implemented as a shallow, copy-pasted guard duplicated across **7 mutation files** and **5+ query files**:

- **7 Mutation Files**: `lib/faculty/code-actions.ts`, `lib/faculty/actions.ts`, `lib/student/code-actions.ts`, `lib/stage1/actions.ts`, `lib/stage2/actions.ts`, `lib/election/lifecycle-actions.ts`, `lib/departments/actions.ts`.
- **Query Files**: `lib/dashboard/queries.ts`, `lib/stage1/queries.ts`, `lib/stage2/queries.ts`, `lib/departments/queries.ts`, `lib/election/queries.ts` (as well as `lib/faculty/queries.ts`, `lib/faculty/code-queries.ts`, and `lib/student/code-queries.ts`).

This exploration evaluates **Candidate 4: Encapsulate the Admin Session and Authorization Seam** using the principles of deep module design. We apply the **Design It Twice** methodology to contrast two alternative interfaces:
1. **Design A (Context Provider / Guard)**: An explicit `requireAdminSession()` function returning `{ adminId, supabase }` with fail-closed errors.
2. **Design B (Higher-Order Action / Session Wrapper)**: A wrapping function `withAdminSession(actionHandler)` that intercepts execution and injects an authenticated session into protected mutations.

---

## 1. Problem Space: The Current Shallow Auth Duplication

### 1.1 Anatomy of the Duplication

Across all 7 mutation files, each file contains a private, duplicated implementation of `requireAdmin()`:

```typescript
interface AdminContext {
  adminId: string;
}

async function requireAdmin(): Promise<
  | { ok: true; context: AdminContext }
  | { ok: false; state: ActionState }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      state: {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Sign in as an admin to ...",
      },
    };
  }
  const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
  if (adminError ?? isAdmin !== true) {
    return {
      ok: false,
      state: {
        ok: false,
        code: "FORBIDDEN",
        message: "Admin access required. Sign in with an admin account.",
      },
    };
  }
  return { ok: true, context: { adminId: user.id } };
}
```

Simultaneously, in query files such as `lib/dashboard/queries.ts`, `lib/stage1/queries.ts`, and `lib/stage2/queries.ts`, the exact same checks are repeated inline:

```typescript
const supabase = await createClient();

const {
  data: { user },
} = await supabase.auth.getUser();
if (!user) {
  return {
    ok: false,
    code: "UNAUTHENTICATED",
    message: "Sign in as an admin to view ...",
  };
}

const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
if (adminError ?? isAdmin !== true) {
  return {
    ok: false,
    code: "FORBIDDEN",
    message: "Admin access required. Sign in with an admin account.",
  };
}
```

### 1.2 Pathologies of the Current Codebase

This structure exhibits four critical architectural deficiencies:

1. **Deficient Locality**:
   Authorization knowledge is smeared across 12+ separate files. If the mechanism for verifying administrator status changes (for example, introducing role scopes, checking session expiration policies, or enriching audit payloads), maintainers must edit 12+ locations in unison.
2. **Redundant Client Instantiation & Resource Churn**:
   The current `requireAdmin()` function instantiates a Supabase client (`await createClient()`), uses it to authenticate the user and run `is_admin`, and then immediately discards the client instance, returning only `{ adminId: user.id }`.
   Consequently, the calling mutation function must call `await createClient()` a second time to execute database operations (seen in `lib/faculty/actions.ts:203`, `lib/faculty/code-actions.ts:141`, `lib/student/code-actions.ts:138`, etc.).
   Even worse, compound operations such as `closeStage1` (`lib/stage1/actions.ts`) invoke `requireAdmin()`, then call `getStage1Results()` (which creates a client and performs the session check a second time), and then create a third client to update the Election stage and record the audit log.
3. **Inconsistent Error Interface**:
   Each file invents its own error message string ("Sign in as an admin to manage faculty.", "Sign in as an admin to manage elections.", "Sign in as an admin to view final results."). While the discriminant codes (`UNAUTHENTICATED`, `FORBIDDEN`) align, the textual interface diverges arbitrarily.
4. **Lack of a Testable Seam (Testing Barrier)**:
   All call sites couple directly to `@/lib/supabase/server`, which imports `cookies()` from `next/headers`. Because the authentication check is hardwired to Next.js cookie headers and network calls to Supabase Auth, admin mutations cannot be executed in automated unit or integration tests without spinning up a full Next.js runtime environment.
   As explicitly acknowledged in `lib/e2e/election-lifecycle.e2e.ts`, the end-to-end test suite cannot call the actual server mutation functions directly; instead, it is forced to bypass the server action layer entirely and invoke database transactions and pure counting algorithms through an ad-hoc test harness.

---

## 2. Design It Twice

To deepen the admin session module, we place a new, explicit seam between calling operations (mutations and queries) and the underlying identity infrastructure.

```
┌─────────────────────────────────────────────────────────────┐
│                 Call Sites (Actions & Queries)               │
│   e.g. createFaculty, closeStage1, getStage1Results         │
└──────────────────────────────┬──────────────────────────────┘
                               │
                      [ADMIN SESSION SEAM]
                               │
┌──────────────────────────────▼──────────────────────────────┐
│                    Admin Session Module                     │
│  - Cookie extraction & Supabase client scoping              │
│  - User identity resolution (getUser)                       │
│  - Administrator allowlist verification (is_admin RPC)      │
│  - Fail-closed error standardization                        │
└──────────────────────────────┬──────────────────────────────┘
                               │
            ┌──────────────────┴──────────────────┐
            ▼                                     ▼
   [Production Adapter]                    [Test Adapter]
   @supabase/ssr + cookies()               In-memory admin stub
```

---

### Design A: Context Provider / Guard (`requireAdminSession`)

#### Interface Definition

Design A introduces a deep functional guard module. The interface is a single asynchronous function returning a strongly-typed discriminated union:

```typescript
// lib/auth/admin-session.ts

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Standard administrative authentication error codes.
 */
export type AdminAuthErrorCode = "UNAUTHENTICATED" | "FORBIDDEN";

export interface AdminAuthError {
  readonly ok: false;
  readonly code: AdminAuthErrorCode;
  readonly message: string;
}

export interface AdminSession {
  /** The verified unique identifier of the authenticated administrator. */
  readonly adminId: string;
  /**
   * Scoped, authenticated Supabase client associated with this admin session.
   * Callers MUST use this client and NEVER instantiate a secondary client.
   */
  readonly supabase: SupabaseClient;
}

export type AdminSessionResult =
  | { readonly ok: true; readonly session: AdminSession }
  | AdminAuthError;

export interface AdminSessionOptions {
  /**
   * Optional custom resource description used in error reporting.
   * Defaults to "manage election data".
   */
  readonly actionDescription?: string;
  /**
   * Optional adapter override, allowing test environments to inject
   * a pre-authenticated test adapter across the seam.
   */
  readonly adapter?: AdminSessionAdapter;
}

/**
 * Resolves and verifies an active administrator session.
 *
 * Invariants:
 * 1. Fail-closed: Returns an AdminAuthError if the user is unauthenticated,
 *    if session cookies are absent/corrupt, or if the user is not in the admin allowlist.
 * 2. Guaranteed authorization: If `ok: true`, `session.supabase` is pre-scoped
 *    and verified against public.is_admin(); no further role checks are necessary.
 * 3. Client reuse: The returned Supabase client instance shares the verified request context,
 *    eliminating secondary cookie reads or client allocations.
 *
 * @param options Configuration options and optional test adapter.
 * @returns An AdminSession on success, or an AdminAuthError on failure.
 */
export async function requireAdminSession(
  options?: AdminSessionOptions,
): Promise<AdminSessionResult>;
```

#### Call Site Usage Examples

##### 1. Admin Server Mutation (e.g. `lib/faculty/actions.ts`)

```typescript
"use server";

import { requireAdminSession } from "@/lib/auth/admin-session";
import { logFacultyAudit } from "@/lib/audit/hook";
import { createFacultySchema, type FacultyActionState } from "./schemas";

export async function createFaculty(
  _prevState: FacultyActionState,
  formData: FormData,
): Promise<FacultyActionState> {
  // 1. Authenticate and authorize at the module interface
  const auth = await requireAdminSession({ actionDescription: "manage faculty" });
  if (!auth.ok) {
    return auth; // Exact structural match for failure states
  }
  const { adminId, supabase } = auth.session;

  // 2. Input validation
  const parsed = createFacultySchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0].message };
  }

  // 3. Database operation using the scoped client (no secondary createClient call)
  const { data, error } = await supabase
    .from("faculty")
    .insert({
      election_id: parsed.data.electionId,
      department_id: parsed.data.departmentId,
      name: parsed.data.name,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, code: "DB_ERROR", message: "Database rejected faculty creation." };
  }

  // 4. Audit logging with verified adminId
  await logFacultyAudit({
    action: "CREATE_FACULTY",
    facultyId: data.id,
    actorAdminId: adminId,
  });

  return { ok: true, message: "Faculty member added successfully." };
}
```

##### 2. Admin Query (e.g. `lib/stage1/queries.ts`)

```typescript
import { requireAdminSession } from "@/lib/auth/admin-session";
import type { Stage1ResultsResult } from "./schemas";

export async function getStage1Results(
  electionId: string,
): Promise<Stage1ResultsResult> {
  const auth = await requireAdminSession({ actionDescription: "view faculty results" });
  if (!auth.ok) {
    return auth;
  }
  const { supabase } = auth.session;

  const { data: electionData, error: electionError } = await supabase
    .from("elections")
    .select("id, stage, tie_policy_locked_at")
    .eq("id", electionId)
    .maybeSingle();

  if (electionError || !electionData) {
    return { ok: false, code: "DB_ERROR", message: "Could not load the Election." };
  }

  // Proceed with Candidate count computation and cutoff calculations...
  return { ok: true, results: /* ... */ };
}
```

#### What Sits Behind the Seam

The implementation of `requireAdminSession` completely hides:
1. **Cookie Jar Retrieval**: Asynchronous resolution of Next.js `cookies()` headers.
2. **Client Scoping**: Creation of the `@supabase/ssr` server client configured with request-scoped cookie getters and setters.
3. **Session Validation**: Execution of `supabase.auth.getUser()`, verifying cryptographic signature, expiration timestamps, and revocation state.
4. **Allowlist Verification**: Execution of `supabase.rpc("is_admin")`, validating that the authenticated user's ID exists in the database `admins` allowlist table.
5. **Fail-Closed Mapping**: Catching network, schema, and authorization faults and normalizing them into standard `UNAUTHENTICATED` and `FORBIDDEN` error structures.

#### Dependency Category

- **Local-substitutable / Remote-but-owned**:
  In production, the module interacts with the local or remote Supabase instance (Auth server and Postgres database).
  Because the interface requires only `{ adminId, supabase }`, the entire session resolution can be satisfied in test suites by a local-substitutable test adapter that provides a mock or in-memory Supabase client and a fixed admin ID, requiring zero network calls and no Next.js cookie infrastructure.

#### Test Impact: Substituting a Test Admin Adapter

A test suite can invoke mutations directly across the seam without any Next.js runtime mocks:

```typescript
// In test runner or integration suite
const fakeSupabase = createMockSupabaseClient();
const testAdapter: AdminSessionAdapter = {
  resolveSession: async () => ({
    ok: true,
    session: { adminId: "test-admin-uuid", supabase: fakeSupabase },
  }),
};

// Exercise the real server mutation through its public interface
const result = await createFaculty(initialState, validFormData, { adapter: testAdapter });
assert.equal(result.ok, true);
```

---

### Design B: Higher-Order Action / Session Wrapper (`withAdminSession`)

#### Interface Definition

Design B adopts a higher-order wrapper pattern. The module wraps the mutation handler, managing authentication, error interception, and dependency injection before the underlying handler executes:

```typescript
// lib/auth/admin-wrapper.ts

import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminSession {
  readonly adminId: string;
  readonly supabase: SupabaseClient;
}

export type ActionFailureState = {
  readonly ok: false;
  readonly code: string;
  readonly message: string;
};

export type AdminActionHandler<TState, TPayload> = (
  session: AdminSession,
  prevState: TState,
  payload: TPayload,
) => Promise<TState>;

export interface WithAdminSessionOptions<TState> {
  readonly actionDescription?: string;
  /** Transforms an authorization failure into the caller's specific state type */
  readonly formatError?: (code: "UNAUTHENTICATED" | "FORBIDDEN", message: string) => TState;
  /** Test adapter hook for local test substitution */
  readonly adapter?: AdminSessionAdapter;
}

/**
 * Higher-order wrapper that protects a server mutation with administrative authorization.
 *
 * Invariants:
 * 1. Physical isolation: `handler` is never invoked if authentication or allowlist checks fail.
 * 2. Parameter injection: An authorized `AdminSession` containing the adminId and scoped client
 *    is injected as the first parameter.
 * 3. Fail-closed translation: Unauthenticated or non-admin invocations immediately return
 *    a standardized error state without touching handler logic.
 *
 * @param handler The mutation logic to execute once authorized.
 * @param options Configuration for error formatting and test substitution.
 * @returns A callable server mutation function.
 */
export function withAdminSession<TState extends ActionFailureState, TPayload>(
  handler: AdminActionHandler<TState, TPayload>,
  options?: WithAdminSessionOptions<TState>,
): (prevState: TState, payload: TPayload) => Promise<TState>;
```

#### Call Site Usage Examples

##### 1. Admin Server Mutation (e.g. `lib/faculty/actions.ts`)

```typescript
"use server";

import { withAdminSession } from "@/lib/auth/admin-wrapper";
import { logFacultyAudit } from "@/lib/audit/hook";
import { createFacultySchema, type FacultyActionState } from "./schemas";

export const createFaculty = withAdminSession<FacultyActionState, FormData>(
  async ({ adminId, supabase }, _prevState, formData) => {
    // Session is already verified and injected; execution is guaranteed authorized
    const parsed = createFacultySchema.safeParse(Object.fromEntries(formData.entries()));
    if (!parsed.success) {
      return { ok: false, code: "INVALID_INPUT", message: parsed.error.issues[0].message };
    }

    const { data, error } = await supabase
      .from("faculty")
      .insert({
        election_id: parsed.data.electionId,
        department_id: parsed.data.departmentId,
        name: parsed.data.name,
      })
      .select("id")
      .single();

    if (error) {
      return { ok: false, code: "DB_ERROR", message: "Database rejected faculty creation." };
    }

    await logFacultyAudit({
      action: "CREATE_FACULTY",
      facultyId: data.id,
      actorAdminId: adminId,
    });

    return { ok: true, message: "Faculty member added successfully." };
  },
  { actionDescription: "manage faculty" }
);
```

##### 2. Admin Query Adaptability (e.g. `lib/stage1/queries.ts`)

Higher-order wrappers do not naturally fit query functions because query signatures vary widely (e.g. `getStage1Results(electionId: string)` vs `listDepartmentsWithCounts()` vs `getDashboardOverview(electionId: string)`).
To wrap queries under Design B, a distinct query wrapper is required:

```typescript
export function withAdminQuery<TArgs extends unknown[], TResult extends ActionFailureState>(
  queryFn: (session: AdminSession, ...args: TArgs) => Promise<TResult>,
  options?: WithAdminSessionOptions<TResult>,
): (...args: TArgs) => Promise<TResult>;

// Call site:
export const getStage1Results = withAdminQuery(
  async ({ supabase }, electionId: string): Promise<Stage1ResultsResult> => {
    const { data: electionData, error: electionError } = await supabase
      .from("elections")
      .select("id, stage, tie_policy_locked_at")
      .eq("id", electionId)
      .maybeSingle();
    // ...
  },
  { actionDescription: "view faculty results" }
);
```

#### What Sits Behind the Seam

In Design B, the implementation hides:
1. The exact same infrastructure operations as Design A: Next.js cookie handling, Supabase client initialization, `getUser()` authentication, and `is_admin` RPC execution.
2. **Control Flow Interception**: The function wrapping machinery that intercepts invocation, halts the execution pipeline on failure, formats the error return, and curries the session into the inner callback.

#### Dependency Category

- **Local-substitutable / Remote-but-owned**:
  Identical to Design A. The underlying dependencies remain Supabase Auth and PostgreSQL.

#### Test Impact: Substituting a Test Admin Adapter

To test wrapped actions under Design B, the test suite can either supply a test adapter option or directly invoke the unwrapped inner handler:

```typescript
// Option 1: Provide test adapter to the wrapper
const protectedAction = withAdminSession(myHandler, { adapter: testAdapter });
const result = await protectedAction(prevState, formData);

// Option 2: Export and test the inner handler directly (bypassing the wrapper seam)
export const createFacultyHandler: AdminActionHandler<...> = async ({ adminId, supabase }, ...) => { ... };
export const createFaculty = withAdminSession(createFacultyHandler);
```

Note that Option 2 creates an architectural tension: testing the inner handler directly bypasses the authorization seam entirely, meaning the wrapper's error-handling and fail-closed guarantees are omitted from the test surface.

---

## 3. Comparative Evaluation

| Axis | Design A (Context Provider / Guard) | Design B (Higher-Order Action Wrapper) |
| :--- | :--- | :--- |
| **Interface Simplicity** | **High**: Single async function `requireAdminSession(options?)`. Returns standard discriminated union. | **Medium**: Higher-order function with generic type parameters (`TState`, `TPayload`, `TArgs`). Requires secondary wrapper for queries. |
| **Implementation Depth** | **Deep**: Completely conceals cookie retrieval, auth checking, allowlist verification, and client caching behind a 1-line call. | **Deep**: Hides auth logic plus execution wrapping and parameter currying. |
| **Locality** | **High**: All session resolution, allowlist logic, and error defaults live in one file (`lib/auth/admin-session.ts`). Single update propagates to mutations and queries alike. | **Medium**: Concentrates mutation authorization well, but fractures when applied to queries due to differing parameter signatures. |
| **Seam Placement** | **Internal Statement Seam**: Sits cleanly at the entry of any async function. Preserves normal function declarations (`export async function ...`). | **Outer Wrapper Seam**: Sits around the function definition (`export const foo = withAdminSession(...)`). Wraps the entire invocation pipeline. |
| **Next.js & Framework Alignment** | **Flawless**: Fully compatible with Next.js `"use server"` export constraints and Server Action AST transforms. Clean stack traces and debugging. | **Problematic**: Next.js Server Action static analyzers inspect exported async functions; higher-order function exports often encounter compiler constraints or obfuscated stack traces. |
| **Cross-Cutting Coverage** | **Universal**: Identical seam applies seamlessly to all 7 mutation files and all 5+ query files. | **Fractured**: Mutations take `(prevState, formData)` while queries take arbitrary parameters (`electionId`, etc.), requiring distinct wrapper overloads or multiple wrappers. |
| **Test Surface Discipline** | **Rigorous**: Tests invoke the public function and supply a test adapter across the exact same seam used in production. | **Compromised**: Tendency to export inner handlers for testing, effectively bypassing the outer authorization seam. |

### 3.1 Depth and Leverage

Both designs achieve substantial **depth**: a caller learns a minimal interface (`requireAdminSession()` or `withAdminSession()`), while behind the seam sits cookie parsing, client scoping, cryptographic token verification, and PostgreSQL RPC execution.

However, Design A provides far superior **leverage** across the entire codebase. Because queries in this application (such as `getStage1Results` or `getDashboardOverview`) return structured `{ ok: true, ... } | { ok: false, ... }` result objects, Design A's return value fits both mutations and queries without impedance mismatch:

```typescript
const auth = await requireAdminSession();
if (!auth.ok) return auth;
const { supabase, adminId } = auth.session;
```

In 3 lines of code, any mutation or query obtains an authenticated identity and an authorized client. Design B provides high leverage for mutations, but awkward leverage for queries, requiring maintainers to maintain two separate wrapper modules (`withAdminSession` and `withAdminQuery`).

### 3.2 Seam Placement and Locality

The placement of the seam is the most consequential divergence between the two designs:

- **Design A** places the seam **inside the function body** as the initial statement. This retains standard TypeScript function declarations (`export async function closeStage1(...)`). It complies with Next.js Server Action constraints, preserves explicit argument passing, keeps stack traces pristine during exceptions, and makes control flow readable to any developer reading top-to-bottom.
- **Design B** places the seam **around the function definition**. This introduces function currying and higher-order typing. In Next.js App Router applications, top-level `"use server"` action files require exported functions to be serializable action entry points. Higher-order wrappers frequently interfere with Next.js build-time AST extraction and type generation. Furthermore, when exceptions occur within wrapped handlers, stack traces are obscured by wrapper dispatch frames.

---

## 4. Definitive Recommendation

### Recommendation: Adopt Design A (Context Provider / Guard)

**Design A (`requireAdminSession`) is the definitively stronger architecture.**

#### Rationale:
1. **Unifies Mutations and Queries**:
   The Teachers' Day Voting codebase has 7 mutation files and 5+ query files that duplicate the exact same authorization sequence. Design A provides a single, uniform interface that serves both server mutations and read queries identically. Design B forces an artificial split between mutation wrappers and query wrappers.
2. **Eliminates Redundant Client Creation**:
   By packaging `{ adminId, supabase }` into the verified session result, Design A guarantees that the authenticated Supabase client created during session verification is reused for all subsequent queries and mutations. This eliminates the duplicate `createClient()` calls currently present across all 7 mutation files.
3. **Preserves Next.js Server Action Ergonomics**:
   Standard async function exports are fully transparent to Next.js compilers, linter rules, and React 19 form actions (`useActionState`).
4. **Enables Clean Local Test Substitution**:
   By equipping `requireAdminSession` with an internal adapter seam, test suites can execute the real server actions and queries directly by injecting an in-memory test admin adapter, solving the testing limitation documented in `lib/e2e/election-lifecycle.e2e.ts`.

---

## 5. Implementation Specification & Target Adapter Architecture

### 5.1 The Admin Session Module (`lib/auth/admin-session.ts`)

```typescript
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

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

/**
 * Production adapter: extracts cookies via Next.js headers,
 * authenticates via Supabase Auth, and validates the admin allowlist.
 */
class ProductionAdminSessionAdapter implements AdminSessionAdapter {
  async resolve(): Promise<AdminSessionResult> {
    const supabase = await createClient();

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return {
        ok: false,
        code: "UNAUTHENTICATED",
        message: "Sign in as an admin to perform this action.",
      };
    }

    const { data: isAdmin, error: adminError } = await supabase.rpc("is_admin");
    if (adminError ?? isAdmin !== true) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "Admin access required. Sign in with an admin account.",
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

let activeAdapter: AdminSessionAdapter = new ProductionAdminSessionAdapter();

/**
 * Replaces the active session adapter. Used exclusively by test harnesses
 * to inject a mock or in-process admin session across the seam.
 */
export function setAdminSessionAdapterForTesting(adapter: AdminSessionAdapter | null): void {
  activeAdapter = adapter ?? new ProductionAdminSessionAdapter();
}

/**
 * Primary interface for administrative authorization.
 * Callers invoke this at the start of any admin mutation or query.
 */
export async function requireAdminSession(): Promise<AdminSessionResult> {
  return activeAdapter.resolve();
}
```

### 5.2 Migration Roadmap for Call Sites

With `requireAdminSession` established at the seam, migration across the codebase proceeds mechanically and safely:

1. **Phase 1: Replace Mutation Duplications (7 Files)**
   - Remove private `interface AdminContext` and `async function requireAdmin()` from:
     - `lib/faculty/code-actions.ts`
     - `lib/faculty/actions.ts`
     - `lib/student/code-actions.ts`
     - `lib/stage1/actions.ts`
     - `lib/stage2/actions.ts`
     - `lib/election/lifecycle-actions.ts`
     - `lib/departments/actions.ts`
   - In each action, replace:
     ```typescript
     const gate = await requireAdmin();
     if (!gate.ok) return gate.state;
     const supabase = await createClient();
     ```
     with:
     ```typescript
     const auth = await requireAdminSession();
     if (!auth.ok) return auth;
     const { adminId, supabase } = auth.session;
     ```

2. **Phase 2: Replace Query Duplications (5+ Files)**
   - Remove inline `getUser()` and `is_admin` RPC blocks from:
     - `lib/dashboard/queries.ts`
     - `lib/stage1/queries.ts`
     - `lib/stage2/queries.ts`
     - `lib/departments/queries.ts`
     - `lib/election/queries.ts`
     - `lib/faculty/queries.ts`
     - `lib/faculty/code-queries.ts`
     - `lib/student/code-queries.ts`
   - In each query, replace the 20-line manual guard block with the standard 3-line `requireAdminSession()` invocation.

3. **Phase 3: Deepen Test Automation**
   - In `lib/e2e/election-lifecycle.e2e.ts` and new integration test suites, configure `setAdminSessionAdapterForTesting()` with a local-substitutable adapter.
   - Test admin actions (`createElection`, `generateMissingFacultyCodes`, `closeStage1`, `freezeStage1Finalists`, `resolveStage1Tie`, `openStage2`, `publishWinner`) directly through their real public function interfaces, verifying end-to-end audit logging, state machine transitions, and database state.
