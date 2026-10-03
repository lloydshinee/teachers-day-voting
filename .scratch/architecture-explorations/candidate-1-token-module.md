# Architecture Exploration — Deepening Candidate 1: Consolidate the Token & Code Module

## 1. Problem Space & Architectural Flaws in Current Codebase

The Teachers' Day Voting codebase handles a department-isolated, two-stage Election (faculty peer voting advancing Candidates to Top-3 Finalists, followed by student voting determining each department's Winner). Security and anonymity depend entirely on single-use credentials:

- **Token**: A single-use voting credential issued to one voter for one Election stage.
- **Code**: The human-readable form of a Token: what is typed, printed, or QR-encoded.

Despite being universal across both Election stages and all voter types, the mechanisms governing Tokens and Codes are currently fragmented, mislocated, and leaking across unrelated directory trees.

```
CURRENT FRAGMENTED & LEAKY SEAMS:

lib/faculty/
├── code-format.ts   <-- Universal alphabet, 60-bit entropy, formatting, normalization.
│                        Misnamed with "Faculty" prefixes (e.g. generateFacultyCode).
├── codes.ts         <-- Universal SHA-256(pepper + Code) hashing at rest.
│                        Misnamed hashFacultyCode, resides in faculty directory.
├── tokens.ts        <-- Token invalidation logic for archived faculty.
├── code-actions.ts  <-- Duplicated minting loop, retries on SQL 23505 conflict.
└── code-queries.ts  <-- Ad-hoc parsing of voting_tokens rows.
         │
         │ Cross-directory leak (generation)
         ▼
lib/student/
├── code-actions.ts  <-- Imports generateFacultyCode & hashNormalizedCodeLetters.
│                        Duplicates the retry loop & batch deduplication.
├── vote-link.ts     <-- Universal QR payload (/vote?token=<CODE>) sequestered in student/.
└── code-queries.ts  <-- Ad-hoc parsing of voting_tokens rows.
         ▲
         │ Backwards leak (QR generation for faculty print sheets)
         │
app/admin/faculty/codes/forms.tsx

lib/vote/
└── actions.ts       <-- Call site: imports hashFacultyCode for BOTH faculty
                         and student ballot resolution and vote casting!
```

### 1.1 Anatomy of Mislocation and Cross-Directory Leakage

A detailed review of the involved files reveals extensive structural leaks and shallow interfaces:

1. **`lib/faculty/code-format.ts`**:
   - Contains pure in-process computation: the 32-symbol unambiguous alphabet (`CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"`), the 60-bit entropy specification (12 characters in 3 groups of 4), presentation formatting (`formatFacultyCode`), normalization (`normalizeFacultyCode`), Zod validation (`facultyCodeSchema`), and cryptographic generation (`generateFacultyCode`).
   - The file's own documentation (lines 6–19) states: *"Faculty/student Code format (spec §6, task 8)... Glossary: Code is the human-readable form of a Token — what is typed, printed, or QR-encoded."*
   - Despite being completely stage-agnostic and voter-agnostic, every function and type is prefixed with `faculty` and sequestered under `lib/faculty/`.

2. **`lib/faculty/codes.ts`**:
   - Contains server-only cryptographic hashing: retrieving the server pepper (`VOTING_TOKEN_PEPPER`) and producing `SHA-256(pepper + Code)` hex digests.
   - Every Token in the system—whether issued to a faculty voter or a student voter—is stored exclusively in `voting_tokens.token_hash` using this exact hash.
   - However, the functions are named `hashFacultyCode` and `hashNormalizedCodeLetters` and placed inside `lib/faculty/`.

3. **`lib/student/vote-link.ts`**:
   - Contains the pure in-process URL constructor: `buildVoteCodeLink(code: string): string => /vote?token=${code}`.
   - Comment at lines 2–4 states: *"Student/faculty QR payload (spec §6, task 11). The QR encodes ONLY `/vote?token=<CODE>` and nothing else"*.
   - Because this module was placed under `lib/student/`, admin faculty print sheets must import backwards across feature directories:
     ```typescript
     // app/admin/faculty/codes/forms.tsx:19
     import { buildVoteCodeLink } from "@/lib/student/vote-link";
     ```
     Faculty admin features directly depend on student internals for universal QR link construction.

4. **`lib/student/code-actions.ts`**:
   - Student Code issuance must cross-import from `lib/faculty/`:
     ```typescript
     // lib/student/code-actions.ts:6-7
     import { generateFacultyCode } from "@/lib/faculty/code-format";
     import { hashNormalizedCodeLetters } from "@/lib/faculty/codes";
     ```
   - When issuing student voting credentials, lines 221 and 228 execute:
     ```typescript
     const code = generateFacultyCode();
     ...
     const tokenHash = hashNormalizedCodeLetters(letters);
     ```
     Student workflows are forced to invoke "faculty" named functions to mint student Tokens.

5. **`lib/vote/actions.ts` (Call Site)**:
   - The primary voting resolution and ballot casting path imports from `lib/faculty/codes`:
     ```typescript
     // lib/vote/actions.ts:7
     import { hashFacultyCode } from "@/lib/faculty/codes";
     ```
   - Across all five voter entry points—`resolveFacultyBallot`, `castFacultyVote`, `resolveStudentBallot`, `castStudentVote`, and `resolveVoteBallot`—the call site invokes `hashFacultyCode(parsedCode.data)`.
   - When a student arrives at `/vote` to choose between departmental Finalists, line 478 runs:
     ```typescript
     // Same 12-character format and pepper as faculty Codes (spec §6).
     tokenHash = parsedCode.success ? hashFacultyCode(parsedCode.data) : null;
     ```
     The entire student voting path is architecturally coupled to a faculty-labeled module.

6. **`lib/faculty/tokens.ts`**:
   - Houses `invalidateUnusedFacultyTokens(facultyId: string)`. It directly queries and updates `voting_tokens`, setting `invalidated_at = new Date().toISOString()` where `token_type = 'FACULTY'` and `used = false`.
   - Token lifecycle invalidation is tied directly to faculty database updates rather than presenting a unified Token lifecycle interface.

7. **`lib/faculty/code-queries.ts` and `lib/student/code-queries.ts`**:
   - Both modules independently query the `voting_tokens` table and define ad-hoc Zod schemas (`facultyTokenRowSchema`, `studentTokenRowSchema`) to parse token status (live unused, used, invalidated).

### 1.2 Implementation Duplication & Lack of Depth

Beyond naming and path misplacement, the current modules are **shallow**. They do not hide enough implementation details from their callers. Consider the duplication between `lib/faculty/code-actions.ts` (lines 285–368) and `lib/student/code-actions.ts` (lines 214–291):

```typescript
// Duplicated across both faculty and student issuance callers:
for (let n = 0; n < count; n += 1) {
  let inserted = false;
  for (let attempt = 0; attempt < MAX_HASH_RETRIES && !inserted; attempt += 1) {
    const code = generateFacultyCode();
    const letters = code.replace(/-/g, "");
    if (batchLetters.has(letters)) {
      continue;
    }
    const tokenHash = hashNormalizedCodeLetters(letters);
    const { error: insertError } = await supabase
      .from("voting_tokens")
      .insert({
        election_id: electionId,
        department_id: departmentId,
        token_hash: tokenHash,
        token_type: type,
        faculty_id: facultyId ?? null,
      });
    if (insertError) {
      if (insertError.code === "23505") { // Unique-violation backstop
        continue;
      }
      // handle database errors...
    }
    inserted = true;
    batchLetters.add(letters);
    issued.push({ ... });
  }
}
```

Both callers must manage:
- Checking server environment pepper availability.
- Stripping dashes from display format.
- In-memory duplicate collision tracking across the batch (`batchLetters`).
- The 5-attempt retry loop on Postgres unique constraint violations (SQL code `23505`).
- Directly composing SQL insert payloads targeting `voting_tokens`.

Callers have very little **leverage**: they must know database constraints, retry parameters, and hash mechanics. **Locality** is fractured: an update to how Tokens are generated, hashed, retried, or stored requires coordinated edits across multiple callers in disparate directories.

---

## 2. Deep Module Architecture & Seam Placement

To achieve high **depth**, maximum **leverage**, and strict **locality**, all Token and Code mechanics are consolidated into a single deep module: `lib/tokens/`.

```
CONSOLIDATED DEEP MODULE ARCHITECTURE:

                 CALLERS
  ┌─────────────────────────────────────────────────────────┐
  │  Admin Faculty Action  │  Admin Student Action          │
  │  Voter Entry (/vote)   │  Faculty Archive/Move Hook     │
  └─────────────────────────────────────────────────────────┘
                              │
               ═══════════════╪═══════════════  EXTERNAL SEAM
                              │ (Small, High-Leverage Interface)
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │                   lib/tokens/ Module                    │
  │                                                         │
  │  HIDDEN BEHIND THE SEAM:                                │
  │  • 32-character unambiguous alphabet (60-bit entropy)   │
  │  • Uniform crypto.randomInt generation                  │
  │  • Format (XXXX-XXXX-XXXX) & normalization (case/dash)   │
  │  • Confusable rejection (0/O, 1/I)                      │
  │  • Server pepper management (VOTING_TOKEN_PEPPER)        │
  │  • SHA-256 cryptographic hashing at rest                │
  │  • Unique-violation retry loop (SQL 23505, max 5)       │
  │  • In-batch deduplication sets                          │
  │  • Direct voting_tokens table persistence               │
  │  • QR payload construction (/vote?token=<CODE>)         │
  └─────────────────────────────────────────────────────────┘
                              │
               ───────────────┼───────────────  INTERNAL SEAM
                              ▼
                 LOCAL-SUBSTITUTABLE DEPENDENCY
  ┌─────────────────────────────────────────────────────────┐
  │  Postgres Database (voting_tokens table) via Supabase    │
  │  Test Stand-in: Local Supabase / PGLite                 │
  └─────────────────────────────────────────────────────────┘
```

### 2.1 What Sits Behind the Seam

The consolidated implementation hides all operational complexity behind its interface:
1. **Alphabet & Entropy**: The 32-symbol alphabet (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`) generating 60 bits of entropy per 12-letter Code.
2. **Formatting & Normalization**: Dashes as pure presentation (`XXXX-XXXX-XXXX`), whitespace trimming, uppercase conversion, and confusable character rejection.
3. **Secret Salt Pepper**: Retrieval and assertion of `VOTING_TOKEN_PEPPER` without exposing secrets to callers or log sinks.
4. **Hash at Rest**: Computation of `SHA-256(pepper + letters)` hex digests. Raw Codes never touch the database.
5. **Collision Retry on Conflict**: Automatic retries (up to 5 attempts) on Postgres unique constraint violations (code `23505`).
6. **QR Construction**: Building verified URLs (`/vote?token=<CODE>`).
7. **Table Operations**: Direct, encapsulated query and mutation of `voting_tokens`.

### 2.2 Dependency Category: Local-Substitutable

Under `DEEPENING.md`, dependencies are categorized to govern how seams and adapters are structured:
- The consolidated Token module relies on:
  1. Pure in-process crypto (`node:crypto`).
  2. The Postgres database (`voting_tokens` table) via the Supabase client.
  3. Server environment variable (`VOTING_TOKEN_PEPPER`).
- The database is a **local-substitutable** dependency. It has a local test stand-in (the local Supabase instance running in development and test environments).
- **Seam Discipline**: No ports or adapters are leaked at the module's external interface. The interface exposes direct, strongly typed async functions. Tests exercise the module through this external interface directly against the local-substitutable database stand-in. The seam between the module implementation and the database driver is internal.

---

## 3. Design It Twice

We explore two alternative designs for the deepened module:
- **Design A (Minimalist)**: 1–3 high-leverage entry points. Radical depth through polymorphism.
- **Design B (Caller-Optimized / Role-Specific)**: Tailored entry points reflecting distinct caller workflows while hiding shared mechanics behind the seam.

---

### 3.1 Design A (Minimalist: 1–3 High-Leverage Entry Points)

Design A pushes depth to the absolute limit. It presents exactly **three entry points** that handle the entire credential lifecycle across the system.

#### Interface TypeScript Definitions

```typescript
// lib/tokens/index.ts

export type TokenType = "FACULTY" | "STUDENT";

export interface TokenTarget {
  departmentId: string;
  /** Null for STUDENT Tokens; required for FACULTY Tokens */
  facultyId?: string | null;
  /** Display label for printable export sheets */
  recipientName?: string;
  departmentCode?: string;
}

export interface IssueTokensRequest {
  electionId: string;
  tokenType: TokenType;
  targets: TokenTarget[];
}

export interface IssuedCredential {
  code: string;
  qrPayload: string;
  departmentId: string;
  departmentCode: string;
  facultyId: string | null;
  recipientName: string | null;
}

export interface IssueTokensResult {
  ok: true;
  issued: IssuedCredential[];
}

export type TokenResolutionFailure =
  | "INVALID_CODE"
  | "NOT_FOUND"
  | "ALREADY_USED"
  | "INVALIDATED"
  | "WRONG_STAGE"
  | "CONFIG_ERROR"
  | "RATE_LIMITED";

export interface ResolvedBallotContext {
  electionId: string;
  departmentId: string;
  tokenType: TokenType;
  /** Populated for FACULTY Tokens to enforce self-exclusion */
  voterFacultyId: string | null;
}

export type ResolveTokenResult =
  | { ok: true; context: ResolvedBallotContext }
  | { ok: false; reason: TokenResolutionFailure; retryAfterSeconds?: number };

export interface InvalidateTokensRequest {
  /** Invalidate unused Tokens for a specific archived faculty member */
  facultyId?: string;
  /** Optional election scope */
  electionId?: string;
}

export interface InvalidateTokensResult {
  invalidatedCount: number;
}

/**
 * High-leverage minimalist interface for the Token module.
 */
export interface TokenModule {
  /**
   * Mints and persists new single-use voting Tokens.
   *
   * Invariants:
   * - Each generated Code has 60 bits of entropy and 12 unambiguous characters.
   * - Only SHA-256(pepper + Code) is stored in voting_tokens.token_hash.
   * - Guarantees uniqueness by retrying on Postgres unique constraint violations (code 23505).
   * - Returned raw Codes are ephemeral; they cannot be recovered from storage.
   *
   * Ordering:
   * - Must be invoked before election voting stages open or during missing-token top-ups.
   */
  issueTokens(request: IssueTokensRequest): Promise<IssueTokensResult>;

  /**
   * Resolves a voter-submitted Code string into its authorized ballot context.
   *
   * Invariants:
   * - Accepts loose user input (case-insensitive, dash-optional, whitespace-tolerant).
   * - Rejects confusable characters (0/O, 1/I) immediately.
   * - Verifies that the Token exists, is live (invalidated_at IS NULL), and is unused.
   * - Checks that the current Election stage matches the Token type:
   *   FACULTY -> FACULTY_VOTING; STUDENT -> STUDENT_VOTING.
   * - Does NOT burn the Token (burning happens atomically during vote casting).
   */
  resolveToken(rawCode: string, clientIp?: string): Promise<ResolveTokenResult>;

  /**
   * Invalidates live unused Tokens for a target entity (e.g. faculty member archive/move).
   *
   * Invariants:
   * - Touches ONLY unused Tokens (used = false, invalidated_at IS NULL).
   * - Cast votes stand untouched (votes table is never addressed).
   */
  invalidateTokens(request: InvalidateTokensRequest): Promise<InvalidateTokensResult>;
}
```

#### Call Site Usage Examples (Design A)

##### Admin Faculty Shortfall Issuance Call Site:
```typescript
// app/admin/faculty/codes/actions.ts (using Design A)
import { issueTokens } from "@/lib/tokens";

export async function generateMissingFacultyCodesAction(formData: FormData) {
  // 1. Resolve missing faculty roster (shortfall computation)
  const missingFaculty = await getMissingFacultyRoster(electionId, departmentId);

  // 2. High-leverage call into Token module
  const result = await issueTokens({
    electionId,
    tokenType: "FACULTY",
    targets: missingFaculty.map((f) => ({
      departmentId: f.departmentId,
      departmentCode: f.departmentCode,
      facultyId: f.id,
      recipientName: f.fullName,
    })),
  });

  return { ok: true, issued: result.issued };
}
```

##### Admin Student Bulk Issuance Call Site:
```typescript
// app/admin/student/codes/actions.ts (using Design A)
import { issueTokens } from "@/lib/tokens";

export async function generateStudentCodesAction(formData: FormData) {
  const quantity = Number(formData.get("quantity"));
  
  // Construct N anonymous student targets
  const targets = Array.from({ length: quantity }, () => ({
    departmentId,
    departmentCode,
  }));

  const result = await issueTokens({
    electionId,
    tokenType: "STUDENT",
    targets,
  });

  return { ok: true, issued: result.issued };
}
```

##### Voting Ballot Resolution Call Site:
```typescript
// lib/vote/actions.ts (using Design A)
import { resolveToken } from "@/lib/tokens";

export async function resolveVoteBallot(code: string, clientIp?: string) {
  const resolution = await resolveToken(code, clientIp);
  
  if (!resolution.ok) {
    if (resolution.reason === "RATE_LIMITED") {
      return { ok: false, code: "RATE_LIMITED", retryAfterSeconds: resolution.retryAfterSeconds };
    }
    // Uniform non-oracling failure
    return { ok: false, code: "INVALID", message: VOTE_UNIFORM_ERROR };
  }

  const { context } = resolution;
  // Load department and ballot options based on context.tokenType
  if (context.tokenType === "FACULTY") {
    const candidates = await loadEligibleFacultyCandidates(
      context.electionId,
      context.departmentId,
      context.voterFacultyId // Self-exclusion applied
    );
    return { ok: true, voterType: "FACULTY", ballot: { candidates } };
  } else {
    const finalists = await loadFrozenDepartmentFinalists(
      context.electionId,
      context.departmentId
    );
    return { ok: true, voterType: "STUDENT", ballot: { candidates: finalists } };
  }
}
```

#### What Sits Behind the Seam (Design A)
- A single private engine loop executes code minting, formatting (`XXXX-XXXX-XXXX`), QR construction (`/vote?token=${code}`), peppered hashing, batch deduplication, and database insertion with automatic retries on constraint `23505`.
- Rate limiting integration and uniform error mapping are encapsulated inside `resolveToken`.

#### Dependency Strategy (Design A)
- The module internally imports the Supabase admin client (`createServiceRoleClient`) and reads `process.env.VOTING_TOKEN_PEPPER`.
- Tested against a local-substitutable Postgres database. Tests supply realistic records and observe `voting_tokens` state through the three public functions.

#### Test Impact (Design A)
- **Deleted Tests**:
  - `lib/faculty/code-format.self-test.ts` (replaced by module integration tests).
  - All unit tests testing `hashFacultyCode`, `hashNormalizedCodeLetters`, and `canonicalCodeLetters` in isolation.
  - Call-site mock tests verifying retry loops on SQL error 23505 in student/faculty actions.
- **Surviving / New Tests**:
  - `lib/tokens/tokens.self-test.ts`: Tests `issueTokens` for both FACULTY (1:1 linkage) and STUDENT (batch quantity) modes, verifying uniqueness, database persistence of SHA-256 digests, and QR construction.
  - Tests `resolveToken` with mixed casing, missing dashes, invalid confusables, expired stages, and already-used records.
  - Tests `invalidateTokens` ensuring only unused records are timestamped.

---

### 3.2 Design B (Caller-Optimized / Role-Specific)

Design B acknowledges that the callers of this module operate in distinct roles:
1. **Admin Faculty Code Manager**: Issues shortfall credentials 1:1 linked to specific eligible faculty members.
2. **Admin Student Code Manager**: Issues anonymous bulk credentials for a department in specified quantities.
3. **Voter at `/vote`**: Resolves an opaque string into an active ballot.
4. **Faculty Roster Administrator**: Invalidates credentials during department moves or departures.

Rather than forcing callers to construct a generic `TokenTarget[]` payload, Design B tailors entry points to match each caller's intent while keeping all hashing, formatting, QR creation, and table persistence behind the seam.

#### Interface TypeScript Definitions

```typescript
// lib/tokens/index.ts

export interface IssuedFacultyCredential {
  facultyId: string;
  recipientName: string;
  departmentId: string;
  departmentCode: string;
  code: string;
  qrPayload: string;
}

export interface IssueFacultyShortfallParams {
  electionId: string;
  departmentId?: string;
  facultyId?: string;
  actorAdminId: string;
}

export interface IssueFacultyShortfallResult {
  ok: true;
  issued: IssuedFacultyCredential[];
  message: string;
}

export interface IssuedStudentCredential {
  departmentId: string;
  departmentCode: string;
  code: string;
  qrPayload: string;
}

export interface IssueStudentBatchParams {
  electionId: string;
  departmentId: string;
  quantity: number;
  actorAdminId: string;
}

export interface IssueStudentBatchResult {
  ok: true;
  issued: IssuedStudentCredential[];
  message: string;
}

export interface DepartmentSummary {
  id: string;
  code: string;
  name: string;
  pictureUrl: string | null;
}

export interface BallotCandidate {
  id: string;
  fullName: string;
  pictureUrl: string | null;
}

export type VoterBallotResult =
  | {
      ok: true;
      voterType: "FACULTY";
      electionId: string;
      department: DepartmentSummary;
      candidates: BallotCandidate[]; // Fellow Candidates (self excluded)
    }
  | {
      ok: true;
      voterType: "STUDENT";
      electionId: string;
      department: DepartmentSummary;
      candidates: BallotCandidate[]; // Frozen department Finalists
    }
  | {
      ok: false;
      code: "INVALID" | "RATE_LIMITED" | "UNAVAILABLE";
      message: string;
      retryAfterSeconds?: number;
    };

export interface InvalidateFacultyCredentialsResult {
  invalidatedCount: number;
}

/**
 * Caller-Optimized interface for Token and Code operations.
 */
export interface TokenModule {
  /**
   * Calculates the missing faculty shortfall and issues 1:1 linked Tokens.
   *
   * Invariants:
   * - Queries eligible faculty minus holders of live Tokens (used Tokens are NOT missing).
   * - Persists SHA-256(pepper + Code) to voting_tokens with token_type='FACULTY'.
   * - Retries automatically on unique hash collisions (Postgres 23505).
   * - Emits GENERATE_FACULTY_CODES audit entries without logging secret Codes.
   */
  issueFacultyShortfall(params: IssueFacultyShortfallParams): Promise<IssueFacultyShortfallResult>;

  /**
   * Issues an exact quantity of anonymous STUDENT Tokens for a department.
   *
   * Invariants:
   * - Department must be participating in the target Election.
   * - Persists SHA-256(pepper + Code) with token_type='STUDENT' and faculty_id=NULL.
   * - Emits GENERATE_STUDENT_CODES audit entry.
   * - Produces verified QR payloads (/vote?token=<CODE>) for code sheets.
   */
  issueStudentBatch(params: IssueStudentBatchParams): Promise<IssueStudentBatchResult>;

  /**
   * Resolves a presented Code into a fully populated voter ballot.
   *
   * Invariants:
   * - Normalizes raw input (case-insensitive, dash-tolerant, trims whitespace).
   * - Rejects invalid symbols and confusables (0/O, 1/I) with a uniform failure message.
   * - Evaluates sliding-window rate limit gate before querying storage.
   * - Enforces election stage alignment (FACULTY_VOTING vs STUDENT_VOTING).
   * - Applies self-exclusion rule for faculty peer voting.
   * - Loads frozen department Finalists for student voting.
   * - Guarantees non-oracling uniform errors on any rejection.
   */
  resolveVoterBallot(rawCode: string, clientIp?: string): Promise<VoterBallotResult>;

  /**
   * Invalidates unused Tokens for an archived faculty member.
   *
   * Invariants:
   * - Only live, unused Tokens (used=false, invalidated_at IS NULL) are lapsed.
   * - Cast votes stand untouched.
   */
  invalidateFacultyCredentials(
    facultyId: string,
    actorAdminId?: string | null
  ): Promise<InvalidateFacultyCredentialsResult>;
}
```

#### Call Site Usage Examples (Design B)

##### Admin Faculty Shortfall Issuance Call Site:
```typescript
// app/admin/faculty/codes/actions.ts (using Design B)
import { issueFacultyShortfall } from "@/lib/tokens";

export async function generateMissingFacultyCodesAction(formData: FormData) {
  const electionId = String(formData.get("electionId"));
  const departmentId = formData.get("departmentId") as string | undefined;

  // The caller needs zero knowledge of shortfalls, hashing, or retries.
  const result = await issueFacultyShortfall({
    electionId,
    departmentId,
    actorAdminId: session.user.id,
  });

  return result;
}
```

##### Admin Student Bulk Issuance Call Site:
```typescript
// app/admin/student/codes/actions.ts (using Design B)
import { issueStudentBatch } from "@/lib/tokens";

export async function generateStudentCodesAction(formData: FormData) {
  const electionId = String(formData.get("electionId"));
  const departmentId = String(formData.get("departmentId"));
  const quantity = Number(formData.get("quantity"));

  // Caller specifies intent directly:
  const result = await issueStudentBatch({
    electionId,
    departmentId,
    quantity,
    actorAdminId: session.user.id,
  });

  return result;
}
```

##### Voter Ballot Resolution Call Site:
```typescript
// app/vote/page.tsx or lib/vote/actions.ts (using Design B)
import { resolveVoterBallot } from "@/lib/tokens";

export async function handleCodeSubmit(code: string) {
  // Direct one-line resolution returning ready-to-render ballot:
  const ballotResult = await resolveVoterBallot(code);
  return ballotResult;
}
```

#### What Sits Behind the Seam (Design B)
- Shared internal helpers: `generateSecureCodeLetters()`, `formatCodeDisplay()`, `hashCodeWithPepper()`, `buildVoteLink()`.
- Shared internal database operations: retry loop on error `23505`, atomic status queries, and ballot data assembly (joining departments, candidates, and finalists).
- Audit log persistence hooks (`logFacultyAudit`, `logStudentAudit`) invoked internally after write confirmation.

#### Dependency Strategy (Design B)
- Categorized as **local-substitutable**. The module encapsulates queries to `voting_tokens`, `faculty`, `departments`, `finalists`, and `elections`.
- In test suites, the entire module runs against the local Supabase test instance. Callers across admin actions and vote views are tested with pure end-to-end assertions without mocking internal queries.

#### Test Impact (Design B)
- **Deleted Tests**:
  - `lib/faculty/code-format.self-test.ts` (subsumed).
  - Isolated helper unit tests in `lib/faculty/codes.ts` and `lib/student/vote-link.ts`.
  - Fragile ballot resolution unit tests in `lib/vote/` that mocked SQL queries to `voting_tokens`.
- **Surviving / New Tests**:
  - `lib/tokens/issuance.self-test.ts`: Verifies faculty shortfall issuance (shortfall calculation, self-healing missing checks, 1:1 faculty link) and student batch issuance (quantity exactness, NULL faculty link).
  - `lib/tokens/resolution.self-test.ts`: Validates end-to-end ballot construction, stage gating, self-exclusion, and uniform error delivery.
  - `lib/tokens/invalidation.self-test.ts`: Asserts that archiving faculty lapses only unused tokens while leaving historical used records untouched.

---

## 4. Architectural Comparison

| Dimension | Current Architecture | Design A (Minimalist) | Design B (Caller-Optimized) |
| :--- | :--- | :--- | :--- |
| **Depth** | **Very Shallow**.<br>Callers manage retries, pepper checks, SQL payloads, and formatting manually across 8+ files. | **Extremely Deep**.<br>3 entry points cover everything. Maximum leverage per entry point. Requires callers to map targets. | **Deep & Specialized**.<br>4 role-aligned entry points. Maximum caller leverage. Callers pass domain intent with zero boilerplate. |
| **Locality** | **Fractured**.<br>Code format in `lib/faculty/`, hashing in `lib/faculty/`, QR link in `lib/student/`, call sites scattered in `lib/vote/`. | **High Locality**.<br>All Token/Code mechanics reside in `lib/tokens/`. | **Maximum Locality**.<br>All Token/Code mechanics, shortfall logic, and ballot resolution reside in `lib/tokens/`. |
| **Seam Placement** | **Porous & Leaky**.<br>Faculty code functions leaked into student actions; student vote link imported into faculty forms. | **At the Credential Seam**.<br>Seam sits between token credential management and domain workflows. | **At the Caller Role Seam**.<br>Seam sits between UI server actions and core domain execution. |
| **Caller Complexity** | High: callers implement `Set`, loops, retries, and manual DB inserts. | Medium: callers map domain records into generic `TokenTarget[]` payloads. | Minimal: callers pass raw IDs and receive complete, typed responses. |
| **Error Modes** | Inconsistent: exposes database codes (`23505`, Supabase error objects) to callers. | Consistent: maps to `TokenResolutionFailure` and typed result envelopes. | Uniform: handles non-oracling voting errors and typed admin operation results. |
| **Test Surface** | Dispersed unit tests asserting internal functions (`hashNormalizedCodeLetters`). | Single focused interface test surface testing 3 methods. | Complete integration test surface verifying real workflows across 4 entry points. |

---

## 5. Architectural Evaluation & Recommendation

### 5.1 Analysis of Trade-offs

- **Design A (Minimalist)** achieves the textbook definition of depth: a tiny interface (3 functions) hiding substantial complexity. However, its generic `issueTokens(request: IssueTokensRequest)` entry point pushes domain orchestration onto the caller:
  - The admin faculty caller still has to calculate the shortfall (querying eligible faculty, querying live token holders, finding the difference) before constructing `TokenTarget[]`.
  - The voting caller still has to inspect `context.tokenType` and make secondary queries to assemble candidates or finalists.
  - This shifts domain coordination out of the module and back into callers.

- **Design B (Caller-Optimized / Role-Specific)** aligns the interface directly with domain roles defined in `GLOSSARY.md`.
  - The faculty shortfall calculation belongs inherently to the faculty Token lifecycle: a Token cannot be properly issued without enforcing the invariant that a faculty member holds at most one live Token per Election. By placing this behind `issueFacultyShortfall`, the module guarantees that invariant internally.
  - The ballot resolution path at `/vote` requires that voter identity and choice are strictly decoupled. When `resolveVoterBallot` returns a fully formed ballot, the presentation layer never handles intermediate credential tokens or database joins.

### 5.2 Decisive Recommendation: The Hybrid Deep Module

The strongest architectural choice is a **Hybrid Deep Module** centered on **Design B**, utilizing the internal engine mechanics of **Design A**.

```
PROPOSED MODULE LAYOUT: lib/tokens/

lib/tokens/
├── index.ts              <-- Clean, deep public interface (Design B entry points).
├── internal/
│   ├── alphabet.ts       <-- 32-character unambiguous alphabet, 60-bit entropy.
│   ├── format.ts         <-- XXXX-XXXX-XXXX display formatting & input normalization.
│   ├── hashing.ts        <-- SHA-256(pepper + Code) with VOTING_TOKEN_PEPPER.
│   ├── qr.ts             <-- /vote?token=<CODE> payload constructor.
│   └── persistence.ts    <-- Conflict retry engine (SQL 23505 loop) & voting_tokens queries.
└── tokens.self-test.ts   <-- Comprehensive integration tests across the external seam.
```

#### Why This Is Strongest:
1. **Eliminates All Cross-Directory Leaks**:
   - `lib/faculty/` no longer exports code formatters or token hashers.
   - `lib/student/` no longer imports from faculty folders.
   - `lib/student/vote-link.ts` is deleted; QR generation is an internal detail of `lib/tokens/`.
   - `lib/vote/actions.ts` never imports `hashFacultyCode`.
2. **Absolute Locality for Security Invariants**:
   - The server pepper (`VOTING_TOKEN_PEPPER`), the 60-bit entropy guarantee, confusable symbol rejection, hash-at-rest generation, and database unique collision retries exist in exactly one directory (`lib/tokens/`).
   - If the code format changes or security requirements evolve, maintainers edit `lib/tokens/` and nothing else.
3. **Massive Caller Leverage**:
   - Admin actions in `app/admin/faculty/codes/actions.ts` and `app/admin/student/codes/actions.ts` collapse from 80+ lines of nested loops, SQL error checks, and manual set management into concise, 5-line invocations of `issueFacultyShortfall` and `issueStudentBatch`.
   - The voting path in `lib/vote/actions.ts` delegates token validation and ballot construction directly to `resolveVoterBallot`.
4. **Clean Testing Strategy (Replace, Don't Layer)**:
   - All shallow unit tests that inspected private hashing details are deleted.
   - The test suite exercises the module across its public interface using the local-substitutable database stand-in, validating end-to-end correctness from raw Code strings to persisted token hashes and rendered ballots.
