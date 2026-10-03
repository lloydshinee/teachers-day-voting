# Architecture Exploration: Deepening Candidate 2 — Collapse Stage Lifecycles into the Election Module

## 1. Executive Summary & Problem Space

The Teachers' Day Voting system conducts a department-isolated, two-stage election that selects one honored faculty member per department: faculty peer voting advances a Top-3 per department, then student voting picks the honoree. The lifecycle of an **Election** follows an explicit, forward-only six-stage progression:

$$\text{DRAFT} \longrightarrow \text{FACULTY\_VOTING} \longrightarrow \text{FACULTY\_RESULTS} \longrightarrow \text{STUDENT\_VOTING} \longrightarrow \text{FINAL\_RESULTS} \longrightarrow \text{CLOSED}$$

Alongside this global sequence, each department advances through milestone markers:
- Stage-1 Top-3 advancement: locking the frozen **Finalist** snapshot (`finalists_locked_at`) or holding on a cutoff **Tie** (`tie_pending`).
- Stage-2 Winner selection: publishing the **Winner** honoree (`winner_published_at`) or holding on a Winner **Tie** (`tie_pending`).

### Current Architectural Fragmentation

Although an **Election** is a single conceptual entity, its lifecycle is fragmented across eight separate files in three distinct folders:

```
lib/
├── election/
│   ├── lifecycle-actions.ts   ← Shallow coordinator for stage advancement & election creation
│   ├── actions.ts             ← Pure state-machine transition functions (applyGlobalAction, etc.)
│   ├── stages.ts              ← Global stage definitions & transition mapping
│   ├── department.ts          ← Department advancement markers schema & predicates
│   └── queries.ts             ← Election listing for admin pickers
├── stage1/
│   ├── counting.ts            ← Pure Top-3 cutoff & Tie detection mathematics
│   ├── queries.ts             ← Database aggregation of faculty votes & marker status
│   └── actions.ts             ← Close, freeze snapshot, resolve Tie, and reopen mutations
├── stage2/
│   ├── counting.ts            ← Pure single-Winner & Winner-Tie detection mathematics
│   ├── queries.ts             ← Database aggregation of student votes & published results
│   └── actions.ts             ← Close, flag Tie, resolve Tie, and publish Winner mutations
└── dashboard/
    └── queries.ts             ← Call site stitching together stage1 and stage2 queries
```

### Analysis of the Deficiencies

1. **Shallow Modules and Circular Seams**:
   `lib/election/lifecycle-actions.ts` is an exceptionally shallow **module**. When asked to advance an **Election**, it inspects the requested action: if the action is `CLOSE_FACULTY_VOTING`, it delegates across a seam to `lib/stage1/actions.ts:closeFacultyVoting`; if `CLOSE_STUDENT_VOTING`, it delegates to `lib/stage2/actions.ts:closeStudentVoting`. In turn, those stage actions cross back over the seam into `lib/election/actions.ts` to call pure transition checkers (`applyGlobalAction`, `applyFlagTie`, `applyLockFinalists`, `applyPublishWinner`). Control bounces back and forth across artificial seams.

2. **Leaky Seams and Fragmented Orchestration**:
   Advancing from `FACULTY_VOTING` to locked **Finalist** snapshots currently requires an orchestrating caller to perform four distinct steps:
   - Call `closeFacultyVoting` to move the global stage to `FACULTY_RESULTS`.
   - Call `getStage1Results` to read in-memory aggregated vote counts.
   - Detect whether a cutoff **Tie** exists.
   - For clean departments, call `freezeStage1Finalists` to write the snapshot to the database; for tied departments, call `applyFlagTie` to mark `tie_pending`.
   Because this behavior is not enclosed within the **Election** **module**, callers must understand every intermediate ordering constraint.

3. **Loss of Locality**:
   The lifecycle rules governing how an **Election** advances, how **Tie** states hold departmental progression, and how snapshots freeze are scattered across eight files. Any alteration to stage transition rules or snapshot semantics requires modifying `lib/election/`, `lib/stage1/`, and `lib/stage2/`. Locality is completely lost.

4. **Zero Caller Leverage**:
   Call sites pay the price of this shallow decomposition. In `lib/dashboard/queries.ts`, the dashboard read model cannot ask a single **module** for the state of an **Election**. Instead, it must make separate queries to `getStage1Results` and `getStage2Results`, manually loop through departments, correlate two sets of marker rows, reconcile two distinct tally structures, and re-compute aggregate totals.

### Dependency Classification

All database persistence dependencies in this cluster (`elections`, `election_departments`, `votes`, `finalists`, `election_results`, `audit_logs`) interact via the Supabase PostgreSQL client. Under the codebase-design taxonomy, this dependency is **local-substitutable**:
- In production, it executes against PostgreSQL.
- In test environments, it runs against the local Supabase test instance (or an in-memory/PGLite container).
- Pure mathematical calculations (sorting, cutoff counts, **Tie** detection) are **in-process**.

Therefore, the entire cluster can be deepened into a single deep **module** with an internal persistence seam and zero external ports exposed to callers.

---

## 2. Design It Twice: Exploration of Alternative Interfaces

We explore two radically different interface designs to deepen the **module** and collapse stage lifecycles into `lib/election`:

- **Design A: State-Machine Driven Module** — A single **module** driven by transition actions where entering a results stage automatically triggers vote tabulation, cutoff calculation, **Finalist** snapshot freezing, and **Tie** flagging behind the seam.
- **Design B: Command & Query Facade Module** — Explicit, intention-revealing lifecycle commands for each stage milestone paired with a single consolidated read model.

---

## 3. Design A (State-Machine Driven)

### Conceptual Model

Design A centers on a state-machine engine. The external **interface** presents a minimal set of entry points:
1. `transitionElection(electionId, action)`: Moves the **Election** forward through its six stages. When transitioning into a results stage (`FACULTY_RESULTS` or `FINAL_RESULTS`), the **module** automatically tallies votes from the database, evaluates advancement cutoffs, writes frozen snapshots for clean departments, flags departments straddling cutoffs as `tie_pending`, and writes audit log entries—all in a single call.
2. `resolveDepartmentTie(electionId, departmentId, pickedIds)`: Resolves an active cutoff or Winner **Tie** using the administrator's manual pick, freezes the snapshot or stages the **Winner**, clears `tie_pending`, and writes audit logs.
3. `reopenDepartmentStage(electionId, departmentId)`: Evaluates the dependent-vote guardrail and safely reopens a department's stage if allowed.
4. `getElectionState(electionId)`: Returns a unified read model covering global stage, departmental advancement markers, counts, **Finalist** snapshots, and **Tie** verdicts.

This design achieves maximum **depth**: a caller provides a simple transition instruction, and an enormous amount of validation, database aggregation, cutoff calculation, snapshot generation, and audit logging runs entirely behind the seam.

### Interface TypeScript Definitions

```typescript
// lib/election/types.ts

import type { DepartmentMarkers } from "./department";
import type { ElectionStage, GlobalAdminAction } from "./stages";

/** Domain error codes returned as values across the seam. */
export type ElectionErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "ILLEGAL_GLOBAL_TRANSITION"
  | "ELECTION_CLOSED"
  | "STAGE_MISMATCH"
  | "TIE_PENDING"
  | "TIE_NOT_PENDING"
  | "TIE_ALREADY_PENDING"
  | "NOT_TIED_CANDIDATE"
  | "NOT_TIED_FINALIST"
  | "WRONG_PICK_COUNT"
  | "POLICY_NOT_FROZEN"
  | "FINALISTS_ALREADY_LOCKED"
  | "FINALISTS_NOT_LOCKED"
  | "WINNER_ALREADY_PUBLISHED"
  | "REOPEN_BLOCKED_BY_DEPENDENT_VOTES"
  | "REOPEN_BLOCKED_BY_PUBLISHED_WINNER"
  | "REOPEN_NOTHING_TO_REOPEN"
  | "DB_ERROR";

export interface ElectionError {
  readonly code: ElectionErrorCode;
  readonly message: string;
}

export type ElectionResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ElectionError };

/** Input to advance an Election globally. */
export interface TransitionElectionInput {
  readonly electionId: string;
  readonly action: GlobalAdminAction;
}

/** Per-department summary produced automatically during a transition. */
export interface DepartmentTransitionVerdict {
  readonly departmentId: string;
  readonly departmentCode: string;
  readonly status: "CLEAN_FROZEN" | "TIE_DETECTED" | "HELD" | "ADVANCED";
  readonly tiePending: boolean;
  readonly finalistsCount: number;
  readonly winnerCandidateId: string | null;
}

/** Output of a successful global transition. */
export interface TransitionElectionSuccess {
  readonly electionId: string;
  readonly fromStage: ElectionStage;
  readonly toStage: ElectionStage;
  readonly verdicts: readonly DepartmentTransitionVerdict[];
  readonly message: string;
}

/** Input to resolve a manual Tie pick in a department. */
export interface ResolveTieInput {
  readonly electionId: string;
  readonly departmentId: string;
  /**
   * Stage 1: Candidate IDs filling remaining Top-3 seats.
   * Stage 2: Exactly one Finalist ID chosen as Winner.
   */
  readonly pickedIds: readonly string[];
}

export interface ResolveTieSuccess {
  readonly electionId: string;
  readonly departmentId: string;
  readonly resolvedStage: "FACULTY_RESULTS" | "FINAL_RESULTS";
  readonly finalistsLocked: boolean;
  readonly winnerPublished: boolean;
  readonly message: string;
}

/** Input to safely reopen a department's Stage 1. */
export interface ReopenStageInput {
  readonly electionId: string;
  readonly departmentId: string;
}

export interface ReopenStageSuccess {
  readonly electionId: string;
  readonly departmentId: string;
  readonly supersededSnapshotAt: string;
  readonly message: string;
}

/** Complete consolidated read model for an Election. */
export interface DepartmentElectionView {
  readonly department: {
    readonly id: string;
    readonly code: string;
    readonly name: string;
    readonly pictureUrl: string | null;
  };
  readonly participating: boolean;
  readonly tiePending: boolean;
  readonly stage1Tie: boolean;
  readonly stage2Tie: boolean;
  readonly finalistsLockedAt: string | null;
  readonly winnerPublishedAt: string | null;
  readonly facultyVotes: number;
  readonly studentVotes: number;
  readonly finalists: ReadonlyArray<{
    readonly candidateId: string;
    readonly fullName: string;
    readonly stage1Votes: number;
    readonly rank: number;
  }>;
  readonly winner: {
    readonly candidateId: string;
    readonly fullName: string;
    readonly published: boolean;
  } | null;
}

export interface ElectionStateView {
  readonly election: {
    readonly id: string;
    readonly name: string;
    readonly academicYear: string;
    readonly stage: ElectionStage;
    readonly tiePolicyText: string;
    readonly tiePolicyLockedAt: string | null;
  };
  readonly departments: readonly DepartmentElectionView[];
  readonly totals: {
    readonly participatingDepartments: number;
    readonly facultyVotesCast: number;
    readonly studentVotesCast: number;
    readonly departmentsWithTie: number;
    readonly departmentsFinalistsLocked: number;
    readonly departmentsWinnerPublished: number;
  };
}
```

### What Sits Behind the Seam

All complex lifecycle logic is hidden inside the **implementation**:
1. **Automated Cutoff & Tabulation Engine**:
   When `transitionElection` receives `action: "CLOSE_FACULTY_VOTING"`, the **implementation**:
   - Updates `elections.stage` to `FACULTY_RESULTS`.
   - Queries `votes` for all `FACULTY` votes across participating departments in aggregate.
   - Executes `computeStage1Cutoff` for every department.
   - For clean departments: writes `finalists` rows (ranks 1, 2, 3) and sets `finalists_locked_at = now()`.
   - For departments with a cutoff **Tie**: sets `tie_pending = true` and records the tied set.
   - Writes structured audit rows for the global step and for each department action.
2. **Automated Winner Tabulation Engine**:
   When `transitionElection` receives `action: "CLOSE_STUDENT_VOTING"`, the **implementation**:
   - Updates `elections.stage` to `FINAL_RESULTS`.
   - Reads `votes` for `STUDENT` votes validated against the frozen `finalists` snapshot.
   - Executes `computeStage2Winner` for every department.
   - If clean: stages the **Winner** in `election_results`.
   - If a **Winner** **Tie** occurs: flags `tie_pending = true`.
3. **Audit Log Hook**:
   All audit entries (`CLOSE_FACULTY_VOTING`, `FREEZE_STAGE1_FINALISTS`, `FLAG_STAGE1_TIE`, `RESOLVE_STAGE1_TIE`, etc.) are generated internally using the administrator's authenticated identity.
4. **Invariant Enforcement**:
   The caller cannot forget to freeze snapshots or forget to flag a **Tie**; the state machine guarantees consistency.

### Call Site Usage Examples

#### Call Site 1: Admin Advancing Faculty Voting to Results

```typescript
// app/admin/actions.ts (Next.js Server Action)
"use server";

import { transitionElection } from "@/lib/election";
import { revalidatePath } from "next/cache";

export async function handleCloseFacultyVoting(electionId: string) {
  const result = await transitionElection({
    electionId,
    action: "CLOSE_FACULTY_VOTING",
  });

  if (!result.ok) {
    return { success: false, error: result.error.message };
  }

  // The caller gets rich feedback without having orchestrated anything
  const tiedCount = result.value.verdicts.filter(v => v.tiePending).length;
  revalidatePath("/admin");

  return {
    success: true,
    message: `Faculty voting closed. ${tiedCount} department(s) require tie resolution.`,
  };
}
```

#### Call Site 2: Admin Resolving a Cutoff Tie

```typescript
// app/admin/faculty/results/actions.ts
"use server";

import { resolveDepartmentTie } from "@/lib/election";
import { revalidatePath } from "next/cache";

export async function handleResolveTie(
  electionId: string,
  departmentId: string,
  pickedCandidateIds: string[],
) {
  const result = await resolveDepartmentTie({
    electionId,
    departmentId,
    pickedIds: pickedCandidateIds,
  });

  if (!result.ok) {
    return { success: false, error: result.error.message };
  }

  revalidatePath("/admin/faculty/results");
  return { success: true, message: result.value.message };
}
```

#### Call Site 3: Admin Dashboard Consolidated Read

```typescript
// lib/dashboard/queries.ts
import "server-only";
import { getElectionState } from "@/lib/election";

export async function getElectionDashboard(electionId: string) {
  const stateResult = await getElectionState(electionId);
  if (!stateResult.ok) {
    return stateResult;
  }

  const { election, departments, totals } = stateResult.value;

  return {
    ok: true as const,
    dashboard: {
      election,
      departments,
      totals,
    },
  };
}
```

---

## 4. Design B (Command & Query Facade)

### Conceptual Model

Design B organizes the **interface** around explicit, task-oriented commands corresponding to each distinct administrative milestone. Instead of a single generalized transition function taking an action identifier, Design B exposes dedicated command functions with tailored parameter types and specific error modes, alongside a consolidated read model.

The external **interface** presents:
- Stage-1 Commands: `openFacultyVoting`, `closeFacultyVoting`, `freezeDepartmentFinalists`, `resolveFacultyCutoffTie`, `reopenFacultyVoting`.
- Stage-2 Commands: `openStudentVoting`, `closeStudentVoting`, `resolveStudentWinnerTie`, `publishDepartmentWinner`.
- Terminal Command: `closeElection`.
- Consolidated Query: `getElectionLifecycleSummary`.

This design optimizes for explicit administrative intent: each command is strongly typed, making it impossible to pass invalid parameter combinations at compile time.

### Interface TypeScript Definitions

```typescript
// lib/election/facade.ts

import type { ElectionStage } from "./stages";

export type FacadeErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "ILLEGAL_STAGE_PROGRESSION"
  | "TIE_PENDING"
  | "TIE_NOT_PENDING"
  | "NOT_TIED_SELECTION"
  | "INVALID_SEAT_COUNT"
  | "SNAPSHOT_LOCKED"
  | "SNAPSHOT_NOT_LOCKED"
  | "WINNER_PUBLISHED"
  | "DEPENDENT_VOTES_EXIST"
  | "DB_ERROR";

export interface FacadeError {
  readonly code: FacadeErrorCode;
  readonly message: string;
}

export type FacadeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FacadeError };

export interface StageCommandSuccess {
  readonly electionId: string;
  readonly stage: ElectionStage;
  readonly message: string;
}

export interface FreezeFinalistsSuccess {
  readonly electionId: string;
  readonly departmentId: string;
  readonly status: "FROZEN" | "TIE_HELD";
  readonly finalistsLockedAt: string | null;
  readonly tiePending: boolean;
  readonly message: string;
}

export interface PublishWinnerSuccess {
  readonly electionId: string;
  readonly departmentId: string;
  readonly winnerCandidateId: string;
  readonly publishedAt: string;
  readonly message: string;
}

/** Dedicated commands exposed at the module seam */
export interface ElectionLifecycleModule {
  // Global stage commands
  openFacultyVoting(electionId: string): Promise<FacadeResult<StageCommandSuccess>>;
  closeFacultyVoting(electionId: string): Promise<FacadeResult<StageCommandSuccess>>;
  openStudentVoting(electionId: string): Promise<FacadeResult<StageCommandSuccess>>;
  closeStudentVoting(electionId: string): Promise<FacadeResult<StageCommandSuccess>>;
  closeElection(electionId: string): Promise<FacadeResult<StageCommandSuccess>>;

  // Department Stage 1 commands
  freezeDepartmentFinalists(
    electionId: string,
    departmentId: string,
  ): Promise<FacadeResult<FreezeFinalistsSuccess>>;

  resolveFacultyCutoffTie(
    electionId: string,
    departmentId: string,
    pickedCandidateIds: readonly string[],
  ): Promise<FacadeResult<FreezeFinalistsSuccess>>;

  reopenFacultyVoting(
    electionId: string,
    departmentId: string,
  ): Promise<FacadeResult<{ supersededSnapshotAt: string; message: string }>>;

  // Department Stage 2 commands
  resolveStudentWinnerTie(
    electionId: string,
    departmentId: string,
    pickedFinalistId: string,
  ): Promise<FacadeResult<{ stagedWinnerId: string; message: string }>>;

  publishDepartmentWinner(
    electionId: string,
    departmentId: string,
  ): Promise<FacadeResult<PublishWinnerSuccess>>;

  // Consolidated Read Model
  getElectionLifecycleSummary(
    electionId: string,
  ): Promise<FacadeResult<ElectionSummaryView>>;
}

export interface ElectionSummaryView {
  readonly electionId: string;
  readonly stage: ElectionStage;
  readonly policyLockedAt: string | null;
  readonly departments: ReadonlyArray<{
    readonly departmentId: string;
    readonly departmentCode: string;
    readonly finalistsLockedAt: string | null;
    readonly winnerPublishedAt: string | null;
    readonly tiePending: boolean;
    readonly facultyVoteTotal: number;
    readonly studentVoteTotal: number;
    readonly hasStage1Tie: boolean;
    readonly hasStage2Tie: boolean;
    readonly finalists: ReadonlyArray<{
      readonly candidateId: string;
      readonly fullName: string;
      readonly stage1Votes: number;
      readonly rank: number;
    }>;
    readonly publishedWinner: {
      readonly candidateId: string;
      readonly fullName: string;
    } | null;
  }>;
}
```

### What Sits Behind the Seam

1. **Explicit Milestone Handlers**:
   Each method in the facade encapsulates the entire database read, validation, state checking, calculation, mutation, and audit logging for that action:
   - `closeFacultyVoting`: Validates that current stage is `FACULTY_VOTING`, transitions to `FACULTY_RESULTS`, and audits.
   - `freezeDepartmentFinalists`: Queries faculty votes for that department, executes `computeStage1Cutoff`, writes `finalists` snapshot if clean, flags `tie_pending` if tied, and audits.
   - `resolveFacultyCutoffTie`: Reads current counts, validates that all picked IDs are members of the tied set and match remaining seats, inserts snapshot rows, clears `tie_pending`, stamps `finalists_locked_at`, and audits.
   - `publishDepartmentWinner`: Validates stage is `FINAL_RESULTS`, checks that snapshot is locked and no **Tie** is pending, verifies clear top or staged pick, writes `election_results` with `published = true`, stamps `winner_published_at`, and audits.
2. **Consolidated Read Engine**:
   `getElectionLifecycleSummary` reads `elections`, `election_departments`, `finalists`, `votes`, and `election_results` in parallel queries, assembling the complete lifecycle state in memory.

### Call Site Usage Examples

#### Call Site 1: Admin Freezing Finalists

```typescript
// app/admin/faculty/results/actions.ts
"use server";

import { freezeDepartmentFinalists } from "@/lib/election";
import { revalidatePath } from "next/cache";

export async function handleFreezeDepartment(electionId: string, departmentId: string) {
  const result = await freezeDepartmentFinalists(electionId, departmentId);
  if (!result.ok) {
    return { success: false, error: result.error.message };
  }

  revalidatePath("/admin/faculty/results");
  return {
    success: true,
    message: result.value.status === "TIE_HELD"
      ? "Cutoff tie detected. Manual pick required."
      : "Top-3 Finalists successfully frozen.",
  };
}
```

#### Call Site 2: Admin Resolving Stage 2 Winner Tie

```typescript
// app/admin/final/results/actions.ts
"use server";

import { resolveStudentWinnerTie } from "@/lib/election";
import { revalidatePath } from "next/cache";

export async function handleResolveWinnerTie(
  electionId: string,
  departmentId: string,
  pickedFinalistId: string,
) {
  const result = await resolveStudentWinnerTie(electionId, departmentId, pickedFinalistId);
  if (!result.ok) {
    return { success: false, error: result.error.message };
  }

  revalidatePath("/admin/final/results");
  return { success: true, message: "Winner tie resolved. Ready to publish." };
}
```

#### Call Site 3: Dashboard Read Model

```typescript
// lib/dashboard/queries.ts
import "server-only";
import { getElectionLifecycleSummary } from "@/lib/election";

export async function getElectionDashboard(electionId: string) {
  const summary = await getElectionLifecycleSummary(electionId);
  if (!summary.ok) {
    return summary;
  }

  return {
    ok: true as const,
    dashboard: summary.value,
  };
}
```

---

## 5. Dependency Strategy & Local-Substitutability

Under the `codebase-design` guidelines, dependency classification determines how the deepened **module** is structured and verified:

```
┌────────────────────────────────────────────────────────┐
│             Deepened Election Module                   │
│                                                        │
│  ┌──────────────────────────────────────────────────┐  │
│  │               External Seam                      │  │
│  │ (Design A: transitionElection / resolveTie / ...)│  │
│  │ (Design B: closeFacultyVoting / freeze / ...)    │  │
│  └─────────────────────────┬────────────────────────┘  │
│                            │                           │
│  ┌─────────────────────────▼────────────────────────┐  │
│  │            Implementation Logic                  │  │
│  │  - Stage sequencing rules                        │  │
│  │  - computeStage1Cutoff (in-process)              │  │
│  │  - computeStage2Winner (in-process)              │  │
│  │  - Audit log writer                              │  │
│  └─────────────────────────┬────────────────────────┘  │
│                            │                           │
│  ┌─────────────────────────▼────────────────────────┐  │
│  │              Internal Seam                       │  │
│  │             Database Adapter                     │  │
│  └─────────────────────────┬────────────────────────┘  │
└────────────────────────────┼───────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
   Production Adapter                  Test Stand-in
(PostgreSQL / Supabase)            (Local Supabase / PGLite)
```

1. **Category**: **Local-substitutable**. The database engine is PostgreSQL accessed via `@supabase/supabase-js`. The local Supabase Docker stack (`supabase-teacher`) and local test runners execute identical SQL schemas and transactions.
2. **Discipline**: The persistence seam is entirely **internal** to the **module**. Callers never provide database connections, transaction objects, or query builders through the public **interface**. No secondary adapter is needed at the external **seam**.
3. **In-Process Logic**: Counting routines (`computeStage1Cutoff` and `computeStage2Winner`) are pure computational functions with zero I/O. They reside directly inside the **module** **implementation**.

---

## 6. Test Impact: Replace, Don't Layer

Adhering to the principle of **replace, don't layer**:
> *"Old unit tests on shallow modules become waste once tests at the deepened module's interface exist; delete them. The interface is the test surface."*

### Current Test Suite Inventory
1. `lib/election/self-test.ts` (434 lines): Tests pure state machine transitions and marker schemas in isolation from actual database persistence.
2. `lib/stage1/self-test.ts` (197 lines): Tests pure cutoff mathematics (`computeStage1Cutoff`) against synthetic in-memory arrays.
3. `lib/stage2/self-test.ts` (162 lines): Tests pure Winner mathematics (`computeStage2Winner`) against synthetic in-memory arrays.
4. `lib/e2e/election-lifecycle.e2e.ts` (2,133 lines): Manually stitches together raw SQL inserts, low-level RPCs, `applyGlobalAction`, and manual updates across 4 fixtures to verify the end-to-end flow.

### Tests Deleted as Waste
- **Shallow Action Tests**: Any tests asserting intermediate steps between `lifecycle-actions.ts`, `stage1/actions.ts`, and `stage2/actions.ts` are deleted.
- **Marker Transformation Tests**: Tests in `election/self-test.ts` that verify isolated marker mutation functions (`applyLockFinalists`, `applyFlagTie`, `applyPublishWinner`) are deleted. These functions were artifacts of exposing internal state manipulation through shallow **module** seams.
- **Brittle Orchestration in E2E**: Approximately 600 lines of manual state-machine driving in `election-lifecycle.e2e.ts` that manually called `applyGlobalAction`, queried votes, evaluated cutoffs, and updated `election_departments` are replaced.

### Tests Retained and Migrated
- **Mathematical Invariants**: The pure algorithms in `lib/stage1/counting.ts` and `lib/stage2/counting.ts` remain pure internal helpers. Their comprehensive mathematical test suites (`stage1/self-test.ts` and `stage2/self-test.ts`) are retained either as internal self-tests or absorbed into the deepened **module**'s comprehensive test suite.
- **E2E Integration Suite**: `lib/e2e/election-lifecycle.e2e.ts` survives but becomes vastly cleaner. Instead of manually coordinating 15 low-level steps across three packages, it calls the deepened **module**'s **interface** directly.

### New Tests at the Deepened Interface
A new, comprehensive test suite (`lib/election/lifecycle.test.ts`) exercises the deepened **module** across its single external **seam**:
- Advancing `DRAFT` $\to$ `FACULTY_VOTING` freezes the tie policy timestamp.
- Advancing `FACULTY_VOTING` $\to$ `FACULTY_RESULTS`:
  - Automatically aggregates cast `FACULTY` votes.
  - Automatically writes frozen `finalists` rows for departments with clean Top-3 counts.
  - Automatically sets `tie_pending: true` for departments where Candidates straddle the 3rd-place cutoff.
  - Logs audit rows for all transitions and snapshot freezes.
- Resolving a cutoff **Tie**:
  - Rejects picks not belonging to the tied set.
  - Rejects picks that do not equal the remaining seat count.
  - On valid pick: writes frozen `finalists` rows, clears `tie_pending`, stamps `finalists_locked_at`, and logs the audit row with the frozen policy version.
- Reopening Stage 1:
  - Allowed when dependent `STUDENT` votes equal 0; deletes snapshot rows and marks previous snapshot superseded in audit.
  - Blocked with `REOPEN_BLOCKED_BY_DEPENDENT_VOTES` when student votes exist.
  - Blocked when a **Winner** is already published.
- Advancing `STUDENT_VOTING` $\to$ `FINAL_RESULTS`:
  - Automatically aggregates cast `STUDENT` votes against frozen **Finalists**.
  - Flags **Winner** **Tie** when multiple **Finalists** share the top vote total.
- Publishing a **Winner**:
  - Gated on stage `FINAL_RESULTS`, locked **Finalists**, and no pending **Tie**.
  - Stays published permanently; stamps `winner_published_at` and frozen policy version.

---

## 7. Comparative Evaluation: Design A vs Design B

| Architectural Dimension | Current Architecture | Design A (State-Machine Driven) | Design B (Command & Query Facade) |
| :--- | :--- | :--- | :--- |
| **Depth (Leverage at Interface)** | **Very Low**: 8 files, 20+ exported functions; callers must orchestrate queries, math, and mutations manually. | **Extremely High**: 4 primary entry points hide queries, math, snapshot freezing, marker stamping, and audit logging. | **High**: 10 explicit command functions; each command hides database I/O, math, and audit logging, but caller coordinates stage sequence. |
| **Locality** | **Poor**: Rules spread across `lib/election`, `lib/stage1`, `lib/stage2`, and `lib/dashboard`. | **Maximum**: All lifecycle rules, invariants, and snapshot mechanics concentrate in a single **module**. | **Very Good**: Concentrated in one **module**, but split across multiple discrete command handlers. |
| **Seam Placement** | **Porous & Leaky**: Multiple internal seams exposed; callers must know when to call queries vs actions. | **Clean External Seam**: Placed between application actions/queries and domain lifecycle execution. | **Clean External Seam**: Placed at administrative intent level; strongly typed per operation. |
| **Error Modes** | Fragmented across `ActionError`, `Stage1ActionState`, `Stage2ActionState`. | Unified discriminated union `ElectionResult<T>` with rich typed error codes. | Typed per command; prevents parameter mismatches at compile time. |
| **Caller Cognitive Load** | Severe: Callers must know multi-step sequencing rules. | Minimal: Callers instruct the engine to advance; engine handles all consequences. | Low: Callers pick the exact command matching their UI action. |
| **Flexibility** | High (accidental): Callers can do things out of order (causing bugs). | Constrained: Engine enforces all transitions; manual overrides impossible. | Moderate: Each command is explicit, though caller chooses which command to call. |

### In-Depth Criteria Analysis

#### 1. Depth
- **Design A** delivers remarkable **depth**. Consider what happens when an administrator clicks "Close Faculty Voting". In the current system, the caller must call `closeFacultyVoting`, query `getStage1Results`, loop through every department, run cutoff detection, call `freezeStage1Finalists` for clean departments, call `flagStage2Tie` for tied departments, and record multiple audit entries. Under Design A, the caller issues a single call: `transitionElection({ electionId, action: "CLOSE_FACULTY_VOTING" })`. Everything else happens behind the seam. This represents extraordinary **leverage**: a single method call exercises hundreds of lines of sophisticated implementation logic.
- **Design B** also deepens the current architecture substantially by bundling vote reads, math, and audit logging into each command. However, its **interface** is broader (10+ methods), and it still requires callers to trigger `freezeDepartmentFinalists` separately from `closeFacultyVoting`.

#### 2. Locality
- In **Design A**, locality is absolute. If the rules for how an **Election** transitions change (for example, requiring an audit hash or altering when the tie policy locks), exactly one file changes. Split-brain states—such as an **Election** moving to `FACULTY_RESULTS` while a department is left un-tallied or un-flagged—become mathematically impossible because the transition and the tabulation are atomic.
- In **Design B**, locality is greatly improved over current code, but the multi-step lifecycle remains partially visible at the seam. An administrator could theoretically advance to `STUDENT_VOTING` while forgetting to freeze **Finalists** in a department, requiring additional guardrails behind the seam.

#### 3. Seam Placement
- **Design A** places the seam between administrative intent ("advance the election") and domain execution. This is the optimal seam placement for workflow engines: callers express intent, and the **module** takes full responsibility for maintaining all database invariants.
- **Design B** places the seam at each individual UI button action ("click freeze", "click resolve", "click publish"). This makes server action handlers trivial to map, but exposes the internal phases of stage progression across the seam.

---

## 8. Architectural Recommendation & Hybrid Synthesis

### The Verdict

**Design A (State-Machine Driven)** is significantly stronger in **depth**, **leverage**, and **locality**. It completely eliminates the category of bugs where an **Election** changes global stage while departmental snapshots or **Tie** flags fall out of sync.

However, Design B offers one major practical advantage: **explicit administrative intent for manual picks and publishing**. When an administrator resolves a **Tie** or publishes a **Winner**, they are not performing a generic transition; they are executing a deliberate, high-stakes decision that requires unambiguous parameters (e.g. `pickedCandidateIds`).

### The Recommended Hybrid Architecture

The optimal architecture merges the automated transition engine of Design A with the explicit command signatures of Design B:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Deepened Election Module                             │
├────────────────────────────────────────────────────────────────────────┤
│ Public Interface (External Seam):                                      │
│                                                                        │
│   1. transitionElectionStage(electionId, action)                       │
│      - Handles all 5 global stage transitions                          │
│      - Automatically tabulates votes & computes cutoffs                │
│      - Automatically freezes clean Finalists snapshots                 │
│      - Automatically flags cutoff Ties & Winner Ties                   │
│      - Automatically logs all audit entries                            │
│                                                                        │
│   2. resolveElectionTie(electionId, departmentId, pickedIds)           │
│      - Resolves Stage-1 cutoff Tie or Stage-2 Winner Tie               │
│      - Validates picks strictly against tied Candidates/Finalists      │
│      - Locks snapshot / stages Winner with frozen policy version       │
│                                                                        │
│   3. publishDepartmentWinner(electionId, departmentId)                 │
│      - Explicit publication action per department                      │
│      - Validates FINAL_RESULTS, locked Finalists, no pending Tie       │
│      - Stamps winner_published_at and writes audit log                 │
│                                                                        │
│   4. reopenDepartmentStage1(electionId, departmentId)                  │
│      - Enforces dependent student vote guardrail (= 0)                 │
│      - Deletes snapshot and marks superseded in audit                  │
│                                                                        │
│   5. getElectionLifecycleView(electionId)                              │
│      - Single consolidated read model for Dashboard & Admin UI         │
├────────────────────────────────────────────────────────────────────────┤
│ Hidden Implementation (Behind the Seam):                               │
│   - Pure Cutoff Mathematics (computeStage1Cutoff, STAGE1_TOP_N = 3)    │
│   - Pure Winner Mathematics (computeStage2Winner)                      │
│   - Deterministic Candidate / Finalist Sorting                         │
│   - Snapshot Persistence (finalists table)                             │
│   - Marker Enforcement (election_departments)                          │
│   - Audit Trail Generation (audit_logs table)                          │
│   - Local-Substitutable Database Adapter                               │
└────────────────────────────────────────────────────────────────────────┘
```

### Why This Synthesis Wins

1. **Massive Caller Leverage**: Closing faculty voting or student voting is a single function call. All tabulation, cutoff checks, snapshot creations, and **Tie** flags occur atomically behind the seam.
2. **Ironclad Invariants**: It is impossible for an **Election** to enter `FACULTY_RESULTS` without every participating department having its cutoff evaluated, its clean **Finalists** frozen, and its **Tie** states flagged.
3. **Pristine Call Sites**: `lib/dashboard/queries.ts` shrinks from an unwieldy 360-line coordinator stitching together multiple queries into a straightforward pass-through to `getElectionLifecycleView`.
4. **Clean Testing Surface**: Test suites no longer need to mock or manipulate intermediate markers. Tests exercise the exact entry points that administrators use, asserting directly on observable outcomes (stages, snapshots, and audit rows).
