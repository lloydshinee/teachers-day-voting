## Destination

An approved, implementation-ready architecture + task plan for the department-isolated 2-stage Teachers' Day vote (faculty peer → Top-3 → student winner) — ready to hand off to build, with no code written in this map.

## Notes

- Domain: Teachers' Day voting — Election, Department, Faculty, Candidate / Finalist / Winner, Voting Token/Code (FACULTY|STUDENT), Stage, Tie, Audit Log. Faculty + students use one-time tokens only; only admins use Supabase Auth.
- Planning-only effort: each ticket resolves a decision, not a deliverable. Produce decisions, not code, unless Notes are overridden on redrawing.
- Skills every session should consult: `grilling` + `domain-modeling` for HITL decisions; `research` for AFK fact-finding; `prototype` for UX fidelity. Check `docs/agents/domain.md` + `docs/agents/issue-tracker.md` Wayfinding operations before claiming.
- Stack reality (verified 2026-10-01 via Supabase MCP + workspace read): bare Next.js 16.3.8 App Router scaffold, no supabase-js / shadcn / zod yet; local Supabase compose stack (`supabase-teacher`) healthy on `http://localhost:8000` with **empty `public` schema** (greenfield), Auth healthy with 0 users but public signup currently open (spec must close it); MCP `list_tables`/`list_extensions` fail permanently for now (`supabase_read_only_user` has NULL password — see baseline ticket) — **canonical path is `supabase_execute_sql` (role `postgres`)**; keys live in the compose `.env`, never in the repo; no `supabase/` dir or CLI in repo.
- Standing constraints from loose idea: backend-enforced department isolation (never trust browser `department_id`/`candidate_id`/`stage`/`token_type`); random token format (e.g. `7K9P-X2MA`), hash at rest, one-time use, atomic vote transaction; explicit state machine DRAFT → FACULTY_VOTING → FACULTY_RESULTS → STUDENT_VOTING → FINAL_RESULTS → CLOSED; mobile-first `/vote` + QR with manual fallback.
- Refer by name in human narration (never bare `01, 02`); ids/paths ride inside the name link.

## Decisions so far

<!-- one line per closed ticket: gist + link; detail lives in the ticket -->

- [Lock the destination and planning boundary](issues/01-destination-boundary.md): destination is the approved architecture + task plan, planning-only with no code in this map — unblocks the four gated grilling tickets.
- [Research token hashing, atomic vote, RLS and rate-limit options](issues/06-token-security-research.md): facts in `research-token-security.md` (pgcrypto SHA-256+pepper, FOR UPDATE vote txn, deny-by-default RLS, rate-limit envelope) — no policy decided.
- [Choose the tie-breaking policy](issues/02-tie-policy.md): manual audit-logged admin pick at both gates (Top-3 cutoff + winner), per-department gating, policy frozen on the election record once faculty voting opens.
- [Settle the privacy and anonymity guarantee](issues/03-privacy-guarantee.md): secret ballot in interfaces (aggregates only), schema carries no voter→choice join key, transient identity at vote time is enforced-then-discarded, no claim of mathematical unlinkability.
- [Decide faculty token linkage and auto-generation rule](issues/04-faculty-token-linkage.md): 1:1 faculty↔token assignment, missing = eligible minus token-holders (used ≠ missing) via explicit admin action, archive-invalidates-unused with cast votes standing, Token/Code/Candidate/Finalist/Winner in glossary.
- [Decide election reuse and per-election membership shape](issues/05-election-reuse.md): reusable elections container, global department on faculty with live eligibility, per-election tokens, frozen finalist snapshot on Stage-1 close, table verdicts + global stage with per-department advancement markers.
- [Repair the local Supabase read path and establish admin-auth baseline](issues/07-supabase-baseline.md): read_only_user has NULL password (not repaired — proxy credential unknown), canonical MCP path is `supabase_execute_sql` as `postgres`, greenfield confirmed (0 tables, 0 auth users), public signup still open (spec must close it).
- [Setup/run docs and pre-launch checklist](issues/08-setup-and-run-docs.md): authored `docs/setup-and-run.md` and `docs/pre-launch-checklist.md` satisfying spec §14 task 20; validated Supabase MCP integration.
- [Faculty profile pictures and voting ballot display](issues/09-faculty-pictures.md): added `picture_url` to `faculty`, created `faculty-photos` storage bucket with RLS, added photo upload/management in admin, and integrated faculty pictures on `/vote` ballots and `/results`.
- [Dedicated admin login and modern sidebar dashboard layout](issues/10-admin-login-and-sidebar.md): added `/admin/login` page with Supabase Auth + allowlist check, enforced auth redirect on all `/admin/*` routes, built responsive `AdminSidebar` with active states and sign-out, isolated public header/footer from admin workspace.
- [Department emblems and photos](issues/11-department-pictures.md): fixed `_missingSchemas` runtime ReferenceError in audit hook, added `picture_url` to `departments`, provisioned `department-photos` storage bucket, added upload/removal in admin departments, and integrated department emblems across admin, voting ballot, and results.
- [Faculty & Department admin UX overhaul](issues/12-admin-crud-modals-and-filters.md): live search, department filter tabs, persistent college selection when adding faculty, and clean modal dialogs for all CRUD actions.
- [Election creation and stage lifecycle controls](issues/13-election-creation-and-lifecycle.md): added `+ New Election` modal dialog, automatic department linking, and 6-stage visual pipeline controls on admin dashboard.

## Not yet specified

- Finalist snapshot exact shape + what re-opening/closing a stage does to already-recorded votes and tokens (snapshot mechanism decided: frozen records written on Stage-1 close — see reuse ticket).
- Student code print/export layout + QR payload (`/vote?token=`) and whether QR carries anything beyond the token.
- Admin dashboard information architecture across 8 departments / ~124 faculty scale (department drill-down vs global views).
- Audit-log retention periods (what is never logged is decided: no vote-choice ↔ identity join — see privacy ticket).
- Rate-limit / brute-force envelope for `/vote` token guessing (Supabase + Next.js layering).
- Whether results need per-department publish flags or single global publish.

## Out of scope

- Combining departments into a school-wide winner (explicitly future work in loose idea §19).
- Faculty/student accounts or passwords (ruled out: tokens only, admins only on Auth).
- Implementation code itself (destination is the approved plan; build is the handoff after the map closes).
