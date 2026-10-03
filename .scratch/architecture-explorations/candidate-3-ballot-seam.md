# Architecture Exploration: Deepen the Ballot Resolution and Casting Seam (Candidate 3)

## 1. Executive Summary & Problem Framing

This report explores **Candidate 3: Deepen the Ballot Resolution and Casting Seam** for the Teachers' Day Voting codebase. 

The goal of this architectural exploration is to transform the shallow, fragmented entry points currently exposed in [`lib/vote/actions.ts`](file:///home/user/Documents/teacher/lib/vote/actions.ts) into a **deep module**. A deep module places significant implementation complexity behind a compact, intuitive **interface** at a clean **seam**, maximizing **leverage** for callers and **locality** for maintainers.

### Core Architectural Vocabulary
This exploration adheres strictly to the definitions established in `codebase-design`:
- **Module**: A discrete unit composed of an **interface** and an **implementation** (scale-agnostic; avoids the ambiguous labels *component* or *service*).
- **Interface**: Everything a caller must know to use the module correctly (type definitions, invariants, ordering constraints, error modes, configuration, and security guarantees).
- **Implementation**: The internal code body hidden behind the interface.
- **Depth**: The leverage at the interface—the amount of behavior, security validation, and database orchestration exercised per unit of interface learned.
- **Seam**: The exact location where the module's interface lives, allowing behavior to be altered or substituted without modifying callers (replaces the overloaded term *boundary*).
- **Adapter**: A concrete thing satisfying an interface at a seam (e.g., in-memory rate limiter, database client).
- **Leverage**: The caller benefit of depth—substantial capability invoked through minimal interface surface area.
- **Locality**: The maintainer benefit of depth—logic, verification, and bug fixes concentrate in one place rather than dispersing across callers.

### Domain Vocabulary
All domain concepts conform strictly to [`GLOSSARY.md`](file:///home/user/Documents/teacher/GLOSSARY.md):
- **Tie**: Two or more candidates in one department with equal vote counts straddling an advancement cutoff.
- **Token**: The single-use voting credential issued to one voter for one election stage.
- **Code**: The human-readable form of a Token (typed, printed, or QR-encoded).
- **Candidate**: A faculty member eligible to receive votes in faculty peer voting.
- **Finalist**: A Candidate advanced to student voting as one of a department's Top-3.
- **Winner**: A Finalist selected by student voting as a department's honoree.
- **Election**: One running of the Teachers' Day vote.

---

## 2. Current State Analysis: Shallow Seam & Accidental Complexity

### 2.1 Five Public Entry Points Across 920+ Lines
Currently, [`lib/vote/actions.ts`](file:///home/user/Documents/teacher/lib/vote/actions.ts) spans 921 lines and exports five distinct asynchronous server functions:
1. [`resolveFacultyBallot(code, clientIp?)`](file:///home/user/Documents/teacher/lib/vote/actions.ts#L248)
2. [`castFacultyVote(code, candidateId, clientIp?)`](file:///home/user/Documents/teacher/lib/vote/actions.ts#L389)
3. [`resolveStudentBallot(code, clientIp?)`](file:///home/user/Documents/teacher/lib/vote/actions.ts#L469)
4. [`castStudentVote(code, candidateId, clientIp?)`](file:///home/user/Documents/teacher/lib/vote/actions.ts#L652)
5. [`resolveVoteBallot(code, clientIp?)`](file:///home/user/Documents/teacher/lib/vote/actions.ts#L731)

This proliferation of entry points arose through chronological accretion across project phases:
- Phase 1 (Spec §14, Task 9) implemented faculty voting (`resolveFacultyBallot` + `castFacultyVote`).
- Phase 2 (Spec §14, Task 12) added student voting (`resolveStudentBallot` + `castStudentVote`), replicating the same structure.
- Phase 3 introduced a unified entry resolver (`resolveVoteBallot`) so that the front-end voting booth could accept either a faculty or student Code into a single input field. However, casting was never unified; `castFacultyVote` and `castStudentVote` remained separate.

### 2.2 Rampant Duplication Across Entry Points
Because each of the five entry points acts as an independent Server Action, the same infrastructural concerns are duplicated repeatedly across all 920+ lines:

1. **IP Resolution & Rate-Limit Gating**:
   Each entry point independently resolves the client IP via HTTP headers (`x-forwarded-for`, `x-real-ip`) or defaults to `"unknown"`, hashes the Code using the secret pepper, and queries `checkVoteGate`. The gating boilerplate is repeated five times.
2. **Error Handling & Failure Accounting**:
   Each entry point defines identical local helper closures (`fail()`, `rateLimited*()`, `unavailable*()`) that record failures against `recordVoteFailure(tokenHash)` and return `VOTE_UNIFORM_ERROR` (`"Invalid or unusable voting code."`) or `VOTE_RATE_LIMITED_ERROR`.
3. **Database Validation Boilerplate**:
   `resolveFacultyBallot`, `resolveStudentBallot`, and `resolveVoteBallot` all execute near-identical Supabase queries to fetch the Token row from `voting_tokens`, validate it against `tokenRowSchema`, fetch the Election stage from `elections`, and fetch department details from `departments`.
4. **Internal Branching Duplication**:
   `resolveVoteBallot` duplicates the candidate query logic of `resolveFacultyBallot` inside an `if (token.data.token_type === "FACULTY")` block, and duplicates the finalist query logic of `resolveStudentBallot` inside an `if (token.data.token_type === "STUDENT")` block.

```
CURRENT SHALLOW SEAM:
┌─────────────────────────────────────────────────────────────────────────────┐
│ Caller (app/vote/forms.tsx)                                                 │
│   - Tracks voterType ("FACULTY" | "STUDENT")                                │
│   - Branches to call castFacultyVote() OR castStudentVote()                 │
└──────────────┬───────────────────┬───────────────────┬──────────────────────┘
               │                   │                   │
   resolveVoteBallot()    castFacultyVote()   castStudentVote()
               │                   │                   │
┌──────────────▼───────────────────▼───────────────────▼──────────────────────┐
│ lib/vote/actions.ts (920+ lines)                                            │
│   [IP Extr]  [Rate Gate]  [Hash Code]  [Query DB]  [Branch]  [Audit]        │
│   Duplicated across 5 distinct exported actions                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 Seam Leakage into Callers
The shallow nature of the current module directly damages caller simplicity in [`app/vote/forms.tsx`](file:///home/user/Documents/teacher/app/vote/forms.tsx#L155-L177). 

Even though the user only sees a single 3-step voting booth, the UI caller must track `voterType: VoterType | null` across UI states and manually branch during casting:
```typescript
// app/vote/forms.tsx lines 161-164
const result =
  voterType === "FACULTY"
    ? await castFacultyVote(code, selectedId)
    : await castStudentVote(code, selectedId);
```
The caller is burdened with knowledge of Token types, separate casting actions, and separate database stored procedures (`cast_vote` vs `cast_student_vote`). This is an inversion of depth: the caller is forced to coordinate domain dispatch that belongs inside the module implementation.

### 2.4 Test-Past-The-Interface Smell in `security.self-test.ts`
Because the module's interface was fragmented, [`lib/vote/security.self-test.ts`](file:///home/user/Documents/teacher/lib/vote/security.self-test.ts#L583-L660) and [`lib/vote/rate-limit.self-test.ts`](file:///home/user/Documents/teacher/lib/vote/rate-limit.self-test.ts#L230-L260) resorted to reading the source code as text (`fs.readFileSync("lib/vote/actions.ts")`) and asserting regex matches on function bodies (`functionBody(actions, "castFacultyVote").includes('rpc("cast_vote"')`).

This violates the fundamental principle from `codebase-design`:
> *"The interface is the test surface. Callers and tests cross the same seam. If you want to test past the interface, the module is probably the wrong shape."*

The tests had to verify security invariants by inspecting file text because the public interface did not offer a clean, unified surface through which security behaviors could be verified directly.

---

## 3. Design It Twice

To deepen the module, we explore two contrasting designs for the ballot resolution and casting seam.

---

### Design A: Unified 2-Method Seam

#### Architectural Concept
Design A consolidates the entire voting capability into exactly two stateless functions: `resolveBallot` and `castBallot`. The caller provides only human input (the Code, and upon confirmation, the chosen candidate ID). The module hides all Token type classification, Election stage verification, database RPC routing, rate-limiting budgets, and audit logging.

```
DESIGN A (UNIFIED 2-METHOD SEAM):
┌─────────────────────────────────────────────────────────┐
│ Caller (app/vote/forms.tsx)                             │
│   - Holds Code and selected candidate ID                │
│   - Zero knowledge of Token types or RPC procedures    │
└────────────────────────────┬────────────────────────────┘
                             │
            resolveBallot()  │  castBallot()
                             │
┌────────────────────────────▼────────────────────────────┐
│ Deep Module Seam (lib/vote/actions.ts)                  │
├─────────────────────────────────────────────────────────┤
│ Implementation:                                         │
│   1. IP Extraction & Rate-Limit Window Gate             │
│   2. Peppered SHA-256 Hashing                           │
│   3. Token Hash Lookup & Lockout Budget Check           │
│   4. Election Stage & Department Verification           │
│   5. Candidate Roster Assembly (Faculty vs Finalist)   │
│   6. Atomic DB RPC Transaction (cast_vote / student)    │
│   7. Non-identifying Audit Log Generation               │
│   8. Uniform Non-Oracling Error Normalization           │
└─────────────────────────────────────────────────────────┘
```

#### Interface TypeScript Definitions
```typescript
/**
 * Deep ballot resolution and casting interface.
 * Implemented in lib/vote/actions.ts; imported by UI callers and test suites.
 */

export interface BallotCandidate {
  readonly id: string;
  readonly fullName: string;
  readonly pictureUrl?: string | null;
}

export interface BallotDepartment {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly pictureUrl?: string | null;
}

export interface ResolvedBallot {
  readonly electionId: string;
  readonly department: BallotDepartment;
  readonly candidates: readonly BallotCandidate[];
  readonly ballotType: "FACULTY_PEER" | "STUDENT_FINALIST";
  readonly heading: string;
  readonly subheading: string;
}

export type BallotError =
  | { readonly ok: false; readonly code: "INVALID"; readonly message: string }
  | { readonly ok: false; readonly code: "UNAVAILABLE"; readonly message: string }
  | { readonly ok: false; readonly code: "RATE_LIMITED"; readonly message: string; readonly retryAfterSeconds: number };

export type ResolveBallotResult =
  | { readonly ok: true; readonly ballot: ResolvedBallot }
  | BallotError;

export type CastBallotResult =
  | { readonly ok: true }
  | BallotError;

/**
 * Resolves any valid Code (faculty or student) to its active departmental ballot.
 * 
 * Invariants:
 * - Requires only human-readable Code (and optional clientIp for test harness).
 * - Rate gate executes before database lookup; exhausted budget rejects immediately.
 * - Resolves Token type internally:
 *     - FACULTY Token: requires FACULTY_VOTING stage; lists active department faculty excluding voter.
 *     - STUDENT Token: requires STUDENT_VOTING stage; lists department Finalists ordered by rank.
 * - Non-oracling: all token/stage/department errors return uniform VOTE_UNIFORM_ERROR.
 */
export function resolveBallot(
  code: string,
  clientIp?: string,
): Promise<ResolveBallotResult>;

/**
 * Casts a secret vote for a Candidate or Finalist using the presented Code.
 * 
 * Invariants:
 * - Accepts only Code and candidateId (no department, stage, or token type allowed).
 * - Rate gate executes before database transaction.
 * - Re-derives Token type and atomically delegates to:
 *     - `cast_vote` for FACULTY Token (verifies departmental eligibility, burns token).
 *     - `cast_student_vote` for STUDENT Token (verifies Top-3 Finalist snapshot, burns token).
 * - Records non-identifying audit log (action, electionId, departmentId only; choice is omitted).
 * - Commits all-or-nothing; failures return uniform VOTE_UNIFORM_ERROR.
 */
export function castBallot(
  code: string,
  candidateId: string,
  clientIp?: string,
): Promise<CastBallotResult>;
```

#### Call Site Usage Example (`app/vote/forms.tsx`)
Notice how the call site simplifies dramatically. All branching disappears; `voterType` state is eliminated:

```tsx
"use client";

import { useState } from "react";
import { resolveBallot, castBallot } from "@/lib/vote/actions";
import type { ResolvedBallot } from "@/lib/vote/schemas";

export function VoteFlow({ initialCode }: { initialCode: string }) {
  const [step, setStep] = useState<"code" | "ballot" | "confirm" | "success">("code");
  const [code, setCode] = useState(initialCode);
  const [ballot, setBallot] = useState<ResolvedBallot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await resolveBallot(code);
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setBallot(result.ballot);
    setSelectedId(null);
    setStep("ballot");
  }

  async function handleCast() {
    if (pending || !selectedId) return;
    setPending(true);
    setError(null);

    const result = await castBallot(code, selectedId);
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      setBallot(null);
      setSelectedId(null);
      setStep("code"); // Return to entry if token burned or invalid
      return;
    }

    setStep("success");
  }

  return (
    <section>
      {/* UI rendering uses ballot.heading, ballot.subheading, and ballot.candidates directly */}
    </section>
  );
}
```

#### What Sits Behind the Seam
The implementation inside `lib/vote/actions.ts` orchestrates the entire security pipeline through private helper functions:
1. **Unified IP Resolution**: Extracts IP from Next.js `headers()` (`x-forwarded-for`, `x-real-ip`) or accepts the test injection parameter.
2. **Deterministic Pepper Hashing**: Normalizes Code format and generates the SHA-256 digest (`hashFacultyCode`).
3. **Pre-DB Rate Limiting**: Executes `consumeVoteAttempt(ip, tokenHash)` before contacting Supabase.
4. **Token Resolution & Verification**: Reads `voting_tokens` and validates that the Token is unused and un-invalidated.
5. **Stage & Candidate Branching**:
   - If `FACULTY`: Validates `election.stage === "FACULTY_VOTING"`, pulls unarchived departmental faculty, filters out `token.faculty_id`.
   - If `STUDENT`: Validates `election.stage === "STUDENT_VOTING"`, pulls `finalists` for `(election_id, department_id)` ordered by rank, and joins faculty display profiles.
6. **Atomic Transaction Dispatch in `castBallot`**:
   - Queries `voting_tokens` inside the action to inspect `token_type`.
   - Dispatches to Postgres `cast_vote` RPC or `cast_student_vote` RPC using the service-role client.
   - Dispatches audit logging: `logFacultyVoteCast` or `logStudentVoteCast` (recording zero voter identity and zero vote choice).
7. **Failure/Success Accounting**: Invokes `recordVoteFailure(tokenHash)` on any error, or `recordVoteSuccess(tokenHash)` upon completion.

#### Dependency Category
**Local-substitutable**. The module depends on:
- PostgreSQL database (Supabase schema with migrations `004` and `005`).
- In-memory rate-limiter maps.
- Node.js crypto primitives.
Because local test stand-ins (local PostgreSQL instance / test database) exist, the dependency is local-substitutable. No remote mock ports or network adapters are needed at the module interface.

#### Test Impact: Running `security.self-test.ts` Across Design A
Design A replaces brittle source-text string matching with actual functional verification through the interface:
- **Interface as Test Surface**: Instead of using `actions.includes("export async function resolveFacultyBallot...")`, the 48 security tests call `resolveBallot(code)` and `castBallot(code, candidateId)` directly.
- **Attack Verification**:
  - Malformed Codes, expired tokens, cross-stage tokens, and cross-department candidate IDs are fed to `castBallot(code, candidateId)`. The test asserts that the result is strictly `{ ok: false, code: "INVALID", message: VOTE_UNIFORM_ERROR }`.
  - Rate limiting is verified by firing repeated attempts to `resolveBallot(code)` and asserting that `{ code: "RATE_LIMITED" }` is returned with positive `retryAfterSeconds`.
- **Database Transaction Verification**:
  Direct RPC security assertions (ensuring anon and authenticated roles have zero `GRANT EXECUTE` permissions on `cast_vote` and `cast_student_vote`) remain in the database layer check, preserving the full depth of the security suite while cleaning up the application layer test surface.

---

### Design B: Session-Based Handle

#### Architectural Concept
Design B models ballot voting as an ephemeral state machine using an active session handle. The caller passes the Code to `openBallot(code)`, which resolves and validates the Token and returns an active `BallotSession` handle. The ability to cast a vote is encapsulated within the session handle's `submit(candidateId)` method.

```
DESIGN B (SESSION-BASED HANDLE):
┌─────────────────────────────────────────────────────────┐
│ Caller (app/vote/forms.tsx)                             │
│   1. Calls openBallot(code)                             │
│   2. Receives session handle                           │
│   3. Calls session.submit(candidateId)                 │
└────────────────────────────┬────────────────────────────┘
                             │
              openBallot()   │  session.submit()
                             │
┌────────────────────────────▼────────────────────────────┐
│ Deep Module Seam (lib/vote/actions.ts)                  │
├─────────────────────────────────────────────────────────┤
│ Implementation:                                         │
│   1. Token Verification & Stage Check                   │
│   2. Issues Ephemeral Sealed Session Token / Closure    │
│   3. Method `submit` captures Token Hash & Context      │
│   4. Caller never handles Code during submission        │
└─────────────────────────────────────────────────────────┘
```

#### Interface TypeScript Definitions
Because Next.js Server Actions execute across client-server boundaries, an object method must either be a bound server action closure or use an encrypted, tamper-proof session ticket:

```typescript
/**
 * Session-based ballot interface.
 * Implemented in lib/vote/actions.ts; imported by UI callers.
 */

export interface BallotCandidate {
  readonly id: string;
  readonly fullName: string;
  readonly pictureUrl?: string | null;
}

export interface BallotDepartment {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly pictureUrl?: string | null;
}

export interface ResolvedBallot {
  readonly electionId: string;
  readonly department: BallotDepartment;
  readonly candidates: readonly BallotCandidate[];
  readonly ballotType: "FACULTY_PEER" | "STUDENT_FINALIST";
  readonly heading: string;
  readonly subheading: string;
}

export interface BallotSession {
  readonly ballot: ResolvedBallot;
  /**
   * Submits the chosen candidate. Single-use capability; invalidates the session.
   */
  readonly submit: (candidateId: string) => Promise<CastBallotResult>;
}

export type OpenBallotResult =
  | { readonly ok: true; readonly session: BallotSession }
  | BallotError;

/**
 * Validates a Code and opens an authenticated voting session.
 * 
 * Invariants:
 * - Rate gate checked prior to DB lookup.
 * - Generates an ephemeral bound action or signed session ticket.
 * - Submit capability is tied to the validated token hash.
 */
export function openBallot(
  code: string,
  clientIp?: string,
): Promise<OpenBallotResult>;
```

#### Call Site Usage Example (`app/vote/forms.tsx`)
```tsx
"use client";

import { useState } from "react";
import { openBallot } from "@/lib/vote/actions";
import type { BallotSession } from "@/lib/vote/schemas";

export function VoteFlow({ initialCode }: { initialCode: string }) {
  const [step, setStep] = useState<"code" | "ballot" | "confirm" | "success">("code");
  const [code, setCode] = useState(initialCode);
  const [session, setSession] = useState<BallotSession | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleCodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const result = await openBallot(code);
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      return;
    }

    setSession(result.session);
    setCode(""); // The raw Code can be discarded immediately from client state!
    setSelectedId(null);
    setStep("ballot");
  }

  async function handleCast() {
    if (pending || !selectedId || !session) return;
    setPending(true);
    setError(null);

    const result = await session.submit(selectedId);
    setPending(false);

    if (!result.ok) {
      setError(result.message);
      setSession(null);
      setSelectedId(null);
      setStep("code");
      return;
    }

    setStep("success");
  }

  return (
    <section>
      {/* UI renders session.ballot */}
    </section>
  );
}
```

#### What Sits Behind the Seam
Behind `openBallot`, the module performs the same token validation, stage checking, and candidate loading as Design A. In addition, it binds a server closure or signs an ephemeral cryptographic ticket (`sessionToken`) containing `{ tokenHash, tokenType, electionId, departmentId, expiresAt }`.

When `session.submit(candidateId)` is called:
1. The server unpacks the bound closure or verifies the sealed session ticket.
2. Checks that `Date.now() < expiresAt` (e.g., 5-minute voting window).
3. Executes the rate-limit gate.
4. Executes the corresponding database transaction (`cast_vote` or `cast_student_vote`) using the pre-verified Token hash.
5. Records the non-identifying audit log.
6. Returns uniform error or success.

#### Dependency Category
**Local-substitutable with Session Adapter**.
In addition to PostgreSQL and in-memory rate limits, Design B requires a mechanism for state persistence or cryptographic session sealing (such as an HMAC signing secret for session tickets or React Server Action closure binding).

#### Test Impact: Running `security.self-test.ts` Across Design B
- The test harness calls `openBallot(code)` to acquire the session handle, then calls `session.submit(candidateId)`.
- Tests for session tampering, expired tickets, and replay attacks on the session ticket must be added.
- The 48 security tests exercise the two-step lifecycle (`openBallot` followed by `session.submit`).

---

## 4. Detailed Comparison: Depth, Locality, and Seam Placement

| Dimension | Current Implementation (`actions.ts`) | Design A: Unified 2-Method Seam | Design B: Session-Based Handle |
| :--- | :--- | :--- | :--- |
| **Interface Surface** | **5 public actions**: `resolveFacultyBallot`, `castFacultyVote`, `resolveStudentBallot`, `castStudentVote`, `resolveVoteBallot`. | **2 public actions**: `resolveBallot(code)`, `castBallot(code, candidateId)`. | **1 entry point + 1 handle method**: `openBallot(code)` returning `session.submit(candidateId)`. |
| **Depth** | **Shallow**. Interface exposes domain type branching (`VoterType`) and separate casting functions. Implementation duplicates pipeline 5 times. | **Deep**. Immense leverage. Callers pass only human input. All Token type resolution, stage gates, and RPC routing are hidden. | **Deep**. High encapsulation. Capability to vote is chained to successful resolution. Code discarded early from caller memory. |
| **Locality** | **Poor**. Logic scattered across 920 lines. Rate-limit checks, error handlers, and queries repeated across functions. | **Exceptional**. All token validation, rate-limiting, stage checking, and RPC dispatch collapse into a single cohesive pipeline. | **Moderate-High**. Voting logic is centralized, but introduces session token lifecycle management and ticket encryption. |
| **Seam Placement** | **Porous Seam**. Placed at individual action level; caller in `forms.tsx` must decide which cast action to call based on token type. | **Clean Seam**. Placed strictly between the UI presentation layer and the voting core. Zero domain leakage across the seam. | **Complex Seam**. Placed at the session boundary. Requires transferring stateful handles across the React Server/Client boundary. |
| **Next.js & Server Action Alignment** | Works, but awkward client-side ternary dispatch. | **Natural & Idiomatic**. Both functions are pure, stateless Next.js Server Actions with primitive, serializable arguments. | **Frictional**. Server Action closures returning methods can complicate serialization across Client Components or page reloads. |
| **Testing Surface** | Brittle regex checks on source code (`actions.includes(...)`). Tests past the interface. | **Clean & Direct**. Tests invoke `resolveBallot` and `castBallot` directly as the test surface. | Requires testing ticket expiry, session lifecycle, and signature validation in addition to core voting rules. |

---

## 5. Architectural Recommendation

### Decisive Recommendation: Design A (Unified 2-Method Seam)

**Design A is the decidedly superior architecture.**

### Rationale:
1. **Maximum Leverage with Minimal Surface Area**:
   Design A reduces five sprawling entry points down to just two:
   - `resolveBallot(code)`
   - `castBallot(code, candidateId)`
   This is the epitome of a deep module: the caller needs to learn almost nothing to operate the system securely.
2. **Elimination of Caller Leakage**:
   The voting page ([`app/vote/forms.tsx`](file:///home/user/Documents/teacher/app/vote/forms.tsx)) is completely freed from tracking `voterType` or deciding which database transaction to call. The UI simply displays what `resolveBallot` provides and submits what the user selects via `castBallot`.
3. **Flawless Fit for Stateless Web Architecture**:
   Design B introduces session state or cryptographic ticket serialization across the network boundary between React Server Actions and Client Components. If a voter refreshes their browser on Step 3 (Confirmation), a session handle in React state is lost, forcing them back to Step 1. In contrast, Design A is completely stateless: the Code remains the sole credential, perfectly aligning with HTTP and Next.js Server Actions.
4. **Restores the True Seam for Verification**:
   Adopting Design A allows [`lib/vote/security.self-test.ts`](file:///home/user/Documents/teacher/lib/vote/security.self-test.ts) to delete all brittle text-scraping regex checks. The 48 security attacks run against `resolveBallot` and `castBallot` directly, ensuring the interface is the genuine test surface.

---

## 6. Migration and Implementation Plan

### Step 1: Schemas Refactoring ([`lib/vote/schemas.ts`](file:///home/user/Documents/teacher/lib/vote/schemas.ts))
- Introduce `ResolvedBallot`, `ResolveBallotResult`, and `CastBallotResult`.
- Deprecate individual `FacultyBallot` and `StudentBallot` result types in favor of the unified `ResolvedBallot` type.
- Keep `VOTE_UNIFORM_ERROR`, `VOTE_UNAVAILABLE_ERROR`, and `VOTE_RATE_LIMITED_ERROR` intact.

### Step 2: Implementation Consolidation ([`lib/vote/actions.ts`](file:///home/user/Documents/teacher/lib/vote/actions.ts))
- Extract shared internal helpers:
  - `resolveCallerIp(clientIp?: string): Promise<string>`
  - `gateAndHash(code: string, clientIp?: string): Promise<{ tokenHash: string } | BallotError>`
  - `fetchVerifiedToken(tokenHash: string): Promise<VerifiedToken | null>`
- Implement `resolveBallot(code, clientIp?)`:
  - Gates rate limit.
  - Queries `voting_tokens`.
  - Dispatches to faculty roster query (if `FACULTY` and `FACULTY_VOTING`) or finalist snapshot query (if `STUDENT` and `STUDENT_VOTING`).
  - Returns unified `ResolvedBallot`.
- Implement `castBallot(code, candidateId, clientIp?)`:
  - Gates rate limit.
  - Inspects Token type server-side.
  - Invokes `cast_vote` RPC or `cast_student_vote` RPC accordingly.
  - Writes non-identifying audit log.
- Deprecate or re-export old actions as thin 1-line shims delegating to `resolveBallot` and `castBallot` during transition.

### Step 3: Call Site Update ([`app/vote/forms.tsx`](file:///home/user/Documents/teacher/app/vote/forms.tsx))
- Replace imports of `castFacultyVote`, `castStudentVote`, and `resolveVoteBallot` with `resolveBallot` and `castBallot`.
- Remove `voterType` state.
- Simplify `handleCast` to a single invocation of `castBallot(code, selectedId)`.

### Step 4: Test Suite Deepening ([`lib/vote/security.self-test.ts`](file:///home/user/Documents/teacher/lib/vote/security.self-test.ts))
- Replace source-code string matching (`functionBody(actions, ...)`) with direct programmatic calls to `resolveBallot` and `castBallot`.
- Validate that all 48 security invariants pass cleanly through the deepened seam.
- Run `npm run test:security` and `npm run test:ratelimit` to ensure complete green verification.
