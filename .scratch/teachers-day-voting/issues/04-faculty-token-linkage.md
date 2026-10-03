# Decide faculty token linkage and auto-generation rule

Type: grilling
Status: resolved
Blocked by: 01

## Question

Loose idea §7 says faculty code count derives from eligible faculty rows (24 faculty → 24 codes, +1 faculty → generate only 1 missing, never duplicates), and §5/§6 require hiding self from the ballot and enforcing own-department-only voting on the backend.

Decide, via grilling + domain-modeling:

- Are faculty tokens 1:1 assigned to a specific faculty row (via `faculty_id`) or an unassigned per-department pool handed out loosely?
- What does "missing token" mean precisely (eligible − existing valid tokens) and when does generation run?
- What terms go in the glossary: Token vs Code, Candidate vs Finalist vs Winner?

The hashing, transaction, and brute-force mechanics belong to the token-security research ticket — only the linkage + counting rule is decided here.

## Answer (resolved 2026-10-01, all recommendations accepted)

**Linkage:** faculty Tokens are **1:1 assigned** to a specific faculty row (the token points at the faculty; the vote never points back). This delivers the privacy ticket's transient identity resolution: self-exclusion from the ballot, server-side department derivation, and exactly-one-vote-per-person.

**Missing-token rule:** missing = eligible faculty (non-archived, in the election) minus faculty already holding any live token record. **Used ≠ missing** — a colleague who already voted keeps their (used) record and gets no second code. Generation is an explicit admin "Generate missing codes" action creating exactly the shortfall; the add-faculty flow offers one-click generation for the newcomer but never silently bulk-creates.

**Roster churn:** archiving invalidates the *unused* token immediately; an already-cast vote **stands** (election integrity beats roster churn). A department move = archive + re-add: old token invalidated, fresh token in the new department, prior vote in the old department stands.

**Glossary (locked):** Token / Code / Candidate / Finalist / Winner defined in `GLOSSARY.md` ("voting code" stays the colloquial alias for Code).

**Effect on neighbors:** per-election scoping of the 1:1 link (global faculty row vs per-election membership) still waits on the election-reuse ticket — this decision constrains it but doesn't resolve it. No fog graduated; no new tickets; nothing out of scope. No ADR — recorded here until the spec carries it.
