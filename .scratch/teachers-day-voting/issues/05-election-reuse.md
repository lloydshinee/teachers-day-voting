# Decide election reuse and per-election membership shape

Type: grilling
Status: resolved
Blocked by: 01

## Question

Loose idea §§25-26 sketches `departments, faculty, elections, election_departments, election_candidates, voting_tokens, votes, election_results, audit_logs` and asks whether each table is necessary — reusable across years or one-off Teachers' Day 2026?

Decide, via grilling + domain-modeling:

- Reusable `elections` container with per-election department participation + finalist snapshot, or single-election tables?
- Does a faculty member belong to exactly one department globally or per-election, and where do Top-3 finalists get snapshotted for Stage 2 isolation?
- Which sketched tables survive, merge, or drop — and why?

Do not write the final DDL here — only the reuse + membership decisions the schema plan must follow.

## Answer (resolved 2026-10-01, all recommendations accepted)

**Reuse:** `elections` is a reusable container — each year gets a new election row owning its departments-participating, tokens, votes, finalists, and results.

**Belonging:** department lives globally on the faculty row (one department per faculty); an election names its participating departments; eligibility is a live rule (non-archived faculty of participating departments). Tokens are per-election (one election + one faculty per token), so last year's codes can never vote this year.

**Finalist snapshot:** explicit frozen finalist records on the election, written by the close-faculty-voting transition after tie resolution; student voting reads the snapshot (and validates candidates against it) rather than re-deriving Top-3 live.

**Table verdicts:** `departments` ✓, `faculty` ✓, `elections` ✓, `election_departments` ✓ (participation), `voting_tokens` ✓ (per-election), `votes` ✓ (per-election, no voter ref), `audit_logs` ✓; `election_candidates` repurposed as the finalist snapshot; `election_results` kept as the per-department published-winner record (winner ref + published flag + policy version). Global stage on the election + per-department advancement markers (finalists locked, winner published, tie pending).

**Domain note:** crystallised `Election` in `GLOSSARY.md`. No ADR — recorded here until the spec carries it. Partially graduates the finalist-snapshot fog (mechanism decided; exact shape + re-open/close semantics stay open). No new tickets; nothing out of scope.
