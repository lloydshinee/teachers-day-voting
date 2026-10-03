# Teachers' Day Voting System — Architecture & Implementation Plan

**Status: APPROVED 2026-10-01 by the human.** Locked items were decided on the map; proposed items (§13) are decided by this approval. Build may begin at task 0.

- Map: `.scratch/teachers-day-voting/map.md`
- Decision tickets: `.scratch/teachers-day-voting/issues/`
- Security facts: `.scratch/teachers-day-voting/research-token-security.md`
- Vocabulary: `GLOSSARY.md` (Election, Department is loose-idea language; Tie, Token, Code, Candidate, Finalist, Winner are locked glossary terms — use them exactly)

---

## 1. Requirements summary

**[LOCKED]** Two-stage, department-isolated vote selecting one honored faculty member per department:

- **Stage 1 — faculty peer voting:** every eligible faculty member votes for exactly one fellow faculty member in their own department. Self-votes forbidden.
- **Gate:** Top-3 per department become Finalists (frozen snapshot). Ties at the cutoff never auto-resolve.
- **Stage 2 — student voting:** department-bound student Codes elect the Winner among that department's Finalists only.
- **Publish:** per-department Winners, published per department.

Constraints that the backend (never the browser) enforces: department isolation, one-time Tokens, atomic vote submission, explicit election stage, secret ballot in all interfaces. Faculty and students hold no accounts and no passwords; only admins authenticate (Supabase Auth). Mobile-first `/vote`, QR with manual-entry fallback.

Out of scope (locked): school-wide cross-department winner, any voter accounts/passwords, and — for this spec — implementation code itself.

---

## 2. User flows

### 2a. Admin (authenticated)

Create election → set tie-policy text → add departments → add faculty → open faculty voting → monitor participation per department → close faculty voting → resolve any ties (manual pick, audit-logged) → finalists freeze → generate department student Codes in chosen quantities → open student voting → monitor → close → resolve winner ties if any → publish per department → close election. Every step in this chain writes an audit entry.

### 2b. Faculty voter (anonymous, one Code)

`/vote` → enter Code → server resolves Token → department ballot listing fellow faculty (self excluded) → select one → confirm screen → submit → "Vote recorded" → Token permanently used. Wrong stage, used/invalid Code, or ineligible candidate each yield a uniform, non-oracling error (§32 wording).

### 2c. Student voter (anonymous, department-bound Code)

Identical shape, but the server derives the department **from the Token** and shows only that department's frozen Top-3. A CCS Code can never reach a COED ballot however the request is forged.

### 2d. Tie resolution (admin)

Tie banner (`Tie detected for 3rd place` / `Tie detected for winner`) on the department → admin picks among exactly the tied Candidates → system writes Finalists (or Winner record) + audit entry referencing the frozen policy version → department advances.

---

## 3. Database schema **[PROPOSED DDL direction — locked verdicts, proposed columns]**

Table verdicts are **[LOCKED]** (§reuse ticket): `departments`, `faculty`, `elections`, `election_departments` (participation), `voting_tokens`, `votes`, `audit_logs` all survive; `election_candidates` is repurposed as the finalist snapshot (`finalists`); `election_results` is kept as the per-department published-winner record. Column lists below are proposed.

```text
departments(id uuid pk, code text unique, name text)                      -- e.g. CCS / College of Computing Studies
faculty(id uuid pk, department_id → departments, full_name text,          -- department is GLOBAL, one per faculty [LOCKED]
          archived_at timestamptz null)
elections(id uuid pk, name text, academic_year text, stage text,          -- reusable container, one row per year [LOCKED]
          tie_policy_text text not null, tie_policy_locked_at timestamptz null)
election_departments(election_id, department_id, pk both,                 -- participation + per-department gates [LOCKED]
          finalists_locked_at null, winner_published_at null, tie_pending bool default false)
voting_tokens(id uuid pk, election_id, department_id,                     -- per-election Tokens [LOCKED]
          token_hash text unique, token_type text CHECK (FACULTY|STUDENT),
          faculty_id null → faculty,                                      -- 1:1 link for FACULTY; NULL for STUDENT [LOCKED]
          used bool default false, used_at null, invalidated_at null,
          CHECK (token_type='FACULTY' AND faculty_id NOT NULL OR token_type='STUDENT' AND faculty_id IS NULL))
votes(id uuid pk, election_id, department_id, candidate_faculty_id → faculty,  -- NO token/voter reference, ever [LOCKED]
          stage text CHECK (FACULTY|STUDENT), created_at)
finalists(id uuid pk, election_id, department_id, faculty_id → faculty,   -- frozen snapshot written on Stage-1 close [LOCKED]
          stage1_votes int, rank int)
election_results(election_id, department_id, pk both, winner_faculty_id → faculty,  -- publishable record [LOCKED]
          published bool default false, policy_version timestamptz)
audit_logs(id uuid pk, election_id, actor_admin_id uuid, action text, details jsonb, created_at)
admins(auth_user_id uuid pk)                                               -- allowlist driving RLS [PROPOSED]
```

Key constraints: `token_hash` unique (replay/backstop); **no foreign key or column anywhere joins a vote to a Token or voter** (privacy, locked); duplicate-vote prevention rests on the locked token row + `used` flag, *not* a vote-side unique constraint (which would require a voter reference). `votes.created_at` is kept for stage-close verification — it is the documented residual timing-correlation vector (privacy wording covers this honestly).

---

## 4. Entity relationships

```text
departments ─┬─ faculty (global belonging: one department per faculty)
             └─ election_departments ─ election (participation + per-dept gates)

election ─┬─ voting_tokens ── faculty (FACULTY Tokens only, 1:1; transient at vote time, never joined to votes)
          ├─ votes ── faculty AS candidate (choice only, no voter side)
          ├─ finalists ── faculty (frozen Top-3 snapshot)
          ├─ election_results ── faculty AS winner (published record)
          └─ audit_logs (token-use WITHOUT choice; tie picks WITH policy version; never choice↔identity)
```

The relationship that must **not** exist is as important as those that do: there is no path from `votes` to `voting_tokens`.

---

## 5. Election state machine

**[LOCKED]** Global stage on the election: `DRAFT → FACULTY_VOTING → FACULTY_RESULTS → STUDENT_VOTING → FINAL_RESULTS → CLOSED`, transitions only forward via explicit admin actions (each audit-logged). **[LOCKED]** Per-department advancement markers ride alongside: `finalists_locked_at`, `winner_published_at`, `tie_pending` — a tied department holds while others advance.

**[PROPOSED]** Re-open rule: a stage may re-open only if no dependent-stage votes exist in that department (e.g. Stage 1 re-opens only when that department has zero student votes); re-opening unfreezes that department's snapshot (prior snapshot marked superseded in audit) and requires a fresh close. Re-opening never un-casts votes.

**[PROPOSED]** Optional advisory voting windows (open/close timestamps) may display countdowns, but explicit admin actions are authoritative — a window expiring never moves the stage by itself.

---

## 6. Token architecture

- **Form [PROPOSED]:** 12-character Codes in 3 groups of 4 (unambiguous alphabet, ~60 bits), e.g. `7K9P-X2MA-Q4LT`. The loose idea shows 8-char examples (~40 bits); 12 chars cost 4 extra typed characters and buy meaningful offline-guessing resistance on top of pepper + rate limits. Confirm on approval.
- **Faculty Codes [LOCKED]:** count derived from eligible faculty — missing = eligible (non-archived, in participating departments) minus holders of any live token record; **used ≠ missing**. Explicit admin "Generate missing codes" creates exactly the shortfall; add-faculty offers one-click generation, never silent bulk creation. 1:1 faculty↔Token.
- **Student Codes [LOCKED]:** admin-specified quantity per department (e.g. CCS 300, COED 450); "Generate more" tops up without ever duplicating.
- **Storage [LOCKED per research]:** random Token from `gen_random_bytes`, stored as deterministic `SHA-256(pepper ‖ Code)` hex via pgcrypto for indexed lookup; pepper server-side (env/Vault), never in DB. Raw Codes visible only in the controlled generation/export moment.
- **Lifecycle [LOCKED]:** unused → used (on vote) or invalidated (archive, rotation, admin action). Invalidated/unused Codes cannot vote; used Codes can never vote again. Archive invalidates unused Tokens; cast votes stand; department move = archive + re-issue.
- **QR [PROPOSED]:** payload is `/vote?token=<CODE>` and nothing else — no PII, no department. Server re-validates everything; manual entry always available.

---

## 7. Privacy architecture **[LOCKED — wording approved]**

> "Secret ballot in all admin interfaces — aggregates only, never voter→choice. A database operator with raw access could attempt timing correlation; the schema carries no join key to make that easy, but we do not claim mathematical unlinkability."

Mechanics: vote rows carry candidate + department + stage, never Token/voter; Token rows carry used/invalidated flags, never choice; audit logs record Token-use events without choices; admin/result UIs query aggregates only. The server resolves Token → identity transiently inside the vote transaction (required for self-exclusion and department derivation) and discards the link — the guarantee covers what is **stored and shown**, never what the transaction momentarily knows.

---

## 8. Security model

- **Never trust the browser [LOCKED]:** `department_id`, `candidate_id`, `stage`, `token_type` from the client are hints at most. Every vote re-derives department from the Token, checks election stage, checks Token type, and validates the candidate (own-department faculty in Stage 1; frozen Finalist in Stage 2) inside one atomic transaction.
- **Atomic submission [LOCKED per research]:** `SELECT … FOR UPDATE` on the Token row → validate all of the above → insert vote → mark used → commit; any failure rolls back. **[PROPOSED]** implementation: a single `cast_vote(election, token_hash, candidate)` `SECURITY DEFINER` function, executable by the service-role path only, plus the unique `token_hash` backstop.
- **RLS [LOCKED per research]:** deny-by-default — no grants to `anon`/`authenticated` on voting tables, no permissive policies; the `/vote` path uses a server-side service-role client exclusively. **[PROPOSED]** admin dashboard rows gated by `admins` allowlist (`auth.uid()`), with public signup closed as part of admin bootstrap (baseline: signup is currently open — must be shut).
- **Brute force [PROPOSED numbers]:** validate endpoint limited per IP (sliding window) plus stricter per-Token-hash failure budget with temporary lockout; uniform error strings ("Invalid or unusable voting code") so failures oracle nothing; `Retry-After` on 429. Exact budgets set at build from the research envelope and asserted by tests.
- **Stage/type/department manipulation:** covered by the transaction checks above; direct API/DB manipulation is in the security test suite, not just UI tests.

---

## 9. Admin dashboard structure **[PROPOSED layout, locked content]**

Election dashboard (§22 shape): status banner (stage + per-department tie flags), counts (departments, faculty, faculty votes x/y, student votes x/y), nav to Departments / Faculty / Faculty Codes / Faculty Results / Student Codes / Student Voting / Final Results / Settings / Audit Logs. Department drill-down (§23 shape): faculty count, faculty Codes, faculty votes, student Codes, student votes, Top-3/Finalists, tie banner with resolve action, publish control. Aggregates only, everywhere.

---

## 10. Faculty UX

`/vote` → Code entry → department ballot of fellow faculty (large touch targets, self absent) → confirm screen (`You selected: <name>`, Back/Submit) → success screen → Token burned. Under a minute, mobile-first, high contrast, no registration. Error strings per §8 (uniform, non-oracling).

## 11. Student UX

Same three-step shape showing only the voter's department Finalists; department label displayed for confidence ("College of Computing Studies") but **derived server-side, never submitted**. QR deep-link prefills the Code field (still one tap to continue — never auto-submit, so a stray scan can't burn a Code unseen **[PROPOSED]**). Post-submit, the Code is burned and the choice is final.

---

## 12. Results architecture

Counting queries are aggregates over `votes` grouped by candidate, scoped to `(election, department, stage)` — no voter-side join exists to write. **Stage-1 close:** compute counts → detect cutoff tie (more Candidates share the 3rd-place total than seats remain → `tie_pending`, banner) → on clean Top-3 or after manual tie pick, write frozen `finalists` (with `stage1_votes`, `rank`) + audit. **Stage-2 close:** same pattern over student votes against the snapshot → winner tie gates publishing → admin publishes per department (`election_results.published`, policy version stamped). Published results pages read `election_results` + `finalists` only — never live vote rows **[PROPOSED]**.

---

## 13. Open items — decided by approving this spec

| # | Was fog | Proposal in this spec |
|---|---------|----------------------|
| 1 | Code length/entropy | 12-char Codes (§6) |
| 2 | QR payload | Token-only deep link, prefill without auto-submit (§6, §11) |
| 3 | Publish flags | Per-department `published` on `election_results` (§12) |
| 4 | Re-open semantics | Allowed only with no dependent-stage votes; snapshots superseded via audit (§5) |
| 5 | Advisory windows | Display-only; actions authoritative (§5) |
| 6 | Rate-limit budgets | Envelope + uniform errors here, exact numbers at build with tests (§8) |
| 7 | Audit retention | Keep for election lifetime + 1 academic year, then operator purge; never-log rule permanent **[PROPOSED]** |
| 8 | Dashboard IA detail | §9 layout |
| 9 | `votes.created_at` | Kept; documented as residual correlation vector (§3) |
| 10 | First-admin bootstrap | Seeded allowlist entry by the operator via SQL, documented in setup; public signup closed in the same step **[PROPOSED]** |

---

## 14. Implementation plan (build order, each independently reviewable)

0. Verify current `@supabase/ssr`, `supabase-js`, shadcn/ui, Zod docs; pin versions.
1. Scaffold: Next.js App Router + strict TS (`no any`), Tailwind, shadcn/ui, Zod; three Supabase clients (browser / server / service-role, service-role server-only).
2. Admin Auth: close public signup, `admins` allowlist, first-admin seeding doc, RLS deny-by-default + admin policies.
3. Migration 1: `departments`, `faculty`, `elections`, `election_departments` + constraints + RLS (no anon grants).
4. Migration 2: `voting_tokens`, `votes`, `finalists`, `election_results`, `audit_logs` + no-join-key assertions.
5. Election state-machine library (transitions, per-department markers, Zod-validated actions).
6. Department CRUD (admin).
7. Faculty CRUD + archive with churn rules (invalidate-unused, votes stand, move = re-issue).
8. Faculty Code generation (missing-only), invalidation, export/print views.
9. Faculty `/vote` flow + `cast_vote()` transaction + uniform errors.
10. Stage-1 counting + Top-3 + tie detection banner + manual tie pick + finalist freeze.
11. Student Code generation (per-department quantities, top-up) + dashboard + export/print + QR.
12. Student `/vote` flow (Token-derived department, snapshot-validated candidates).
13. Stage-2 counting + winner tie gate + per-department publish + published-results pages.
14. Department drill-down + election dashboard (aggregates only).
15. Audit-log helper with never-log allowlist + tests asserting no choice↔identity key exists.
16. Rate limiting + lockout + 429 semantics on all Token endpoints.
17. Print CSS for Code sheets (faculty + student, QR + department labels).
18. Security test suite: forged department/candidate/stage/type, replay, double-submit, concurrent submits, cross-department Codes, closed-stage votes.
19. E2E suite: both voter flows, ties, zero-vote departments, multi-department, re-open guardrails.
20. Setup/run docs (compose stack, keys via env, first admin, signup closure) + pre-launch checklist (tie policy frozen, Codes exported, windows set).

Business logic stays in server modules behind Zod boundaries; UI stays thin; DB constraints + server validation are authoritative throughout.

---

## 15. Testing strategy (maps to §34 of the loose idea)

Faculty matrix (valid/invalid/used Token, self-vote, cross-department candidate, duplicate + concurrent submits, post-close vote) · student matrix (valid/invalid/used, CCS-Code→COED-candidate, pre/post-stage, duplicates, concurrency) · results matrix (counts, Top-3, ties at both gates, zero votes, multi-department, top-ups, re-open behavior) · security matrix against direct API/DB manipulation, never UI-only. Privacy suite asserts the absence of any vote↔Token join path and scans audit payloads for choice↔identity pairs.
