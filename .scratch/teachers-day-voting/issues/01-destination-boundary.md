# Lock the destination and planning boundary

Type: grilling
Status: resolved

## Question

Confirm the destination for this Teachers' Day effort before any other decision is taken:

- Is the destination an approved, implementation-ready architecture + task plan (user flows, DB schema, state machine, token + privacy + security models, dashboard structure, UX, results architecture) ready to hand off to build — with no implementation code written inside this map?
- Is this map planning-only (decisions, not deliverables), with the pull to "just build it" treated as the signal to hand off?

Resolve by live grilling + domain-modeling (call both skills). Record the locked destination wording and any scope redraw. This unblocks the tie, privacy, token-linkage, and reuse decisions.

## Answer (resolved 2026-10-01)

**Locked:** the destination is an **approved, implementation-ready architecture + task plan** for the department-isolated 2-stage Teachers' Day vote (faculty peer → Top-3 per department → student winner), ready to hand off to build. This map is **planning-only**: it produces decisions, not code or migrations; the pull to "just build it" is the signal to hand off.

**Basis (human's own words, not assumed):** the loose idea's §35 "Only begin implementation after I approve the architecture and plan" + §36 "Before writing code, return the complete architecture and implementation plan. Do not start implementation until I explicitly approve the plan," confirmed by the human's "go" on the map as charted. Grilling + domain-modeling consulted; no glossary conflicts (no `GLOSSARY.md` exists yet, nothing crystallised needing lazy creation), no ADR (process boundary, not a technical trade-off).

**Scope effect:** no redraw — Destination, Notes, Fog, and Out-of-scope sections stand as charted. No fog graduated, no new tickets surfaced, no tickets invalidated. Unblocks the four grilling tickets gated on this decision.
