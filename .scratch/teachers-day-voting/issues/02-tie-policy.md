# Choose the tie-breaking policy

Type: grilling
Status: resolved
Blocked by: 01

## Question

Loose idea §11 forbids silently resolving ties (e.g. 10-vs-10 for 3rd place) and requires an explicit, pre-election tie-breaking policy with an admin-visible `Tie detected for 3rd place` state.

Decide, via grilling + domain-modeling:

- Manual admin pick (audit-logged) vs deterministic automatic rule (seniority / hire-date / random selection) vs runoff vote?
- Where does the tie surface (faculty results → finalist generation gate) and what audit entry does resolution write?
- What does the spec promise before the election begins?

Do not design the results counting query itself here — only the policy the later plan must implement.

## Answer (resolved 2026-10-01, all recommendations accepted)

**Policy:** tied cutoffs are resolved by **manual admin pick, audit-logged** — a named human decides which tied candidate advances; the system never auto-advances and never triggers a runoff.

**Scope:** the same policy guards **both gates** — the faculty Top-3 cutoff (gates finalist generation) and a tied student vote for department winner (gates result publishing).

**Gating:** a tie blocks **only its own department's advancement**; other departments flow on. The global state machine still moves, but per-department advancement is tracked separately.

**Pre-election promise:** the policy text is stored on the election record, shown beside tie status on the dashboard, and becomes **read-only once `FACULTY_VOTING` opens**; each resolution audit entry references the policy version applied.

**Domain note:** crystallised `Tie` in `GLOSSARY.md` (equal counts straddling an advancement cutoff, one department). No ADR — the decision is recorded here and belongs in the final spec; revisit at build time if implementation needs it. No fog graduated (finalist-snapshot shape still waits on election reuse); no new tickets; nothing ruled out of scope.
