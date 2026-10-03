# Settle the privacy and anonymity guarantee

Type: grilling
Status: resolved
Blocked by: 01

## Question

Loose idea §24 warns against claiming "anonymous voting" if voter→choice correlation is possible, while §6/§31 still need token-usage + fraud-prevention records.

Decide, via grilling + domain-modeling:

- What do we promise: (a) unlinkable in normal admin/result interfaces but correlatable by a DB operator, (b) fully unlinkable even in DB, or (c) pseudonymous with traceable audit?
- What is explicitly never logged or joined together (token identity ↔ vote choice), and what the admin UI shows instead (aggregates only)?
- What honest wording goes into the spec's privacy architecture?

Cross-check against the token-linkage and audit decisions; update them if this invalidates their shape.

## Answer (resolved 2026-10-01, all recommendations accepted)

**Promise (a):** secret ballot in all normal admin/result interfaces — aggregates only, never voter→choice. A database operator with raw access could attempt timing correlation; the schema carries no join key to make that easy, but mathematical unlinkability is explicitly **not** claimed.

**Separation rule:** a vote record carries candidate + department + stage, never a token/voter reference; a token record carries used/invalidated flags, never the choice; audit logs record token-use events without choices; no foreign key ever joins the two sides. Enforced by schema (no join key exists) plus convention (admin UI queries aggregates only).

**Transient-knowledge framing (accepted):** to enforce "can't vote for yourself," the server necessarily resolves token → identity *during* the vote transaction (to hide self from the ballot). The guarantee covers what is **stored and shown**, never what the server momentarily knows — the link is enforced-then-discarded, never persisted.

**Spec wording (locked):** "Secret ballot in all admin interfaces — aggregates only, never voter→choice. A database operator with raw access could attempt timing correlation; the schema carries no join key to make that easy, but we do not claim mathematical unlinkability."

**Cross-check:** constrains (does not resolve) the faculty-token-linkage ticket — tokens must resolve identity at vote time (points toward 1:1 assignment) while never persisting the voter→choice link. Partially sharpens the audit fog: *what is never logged* is now decided (no choice ↔ identity join); retention periods stay open. No ADR — decision lives here until the spec carries it.
