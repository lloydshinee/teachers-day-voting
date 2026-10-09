# Architecture Explorations — Deep Module Candidates

## Overview

This specification tracks architectural explorations and deep module candidates across the Teachers' Day Voting codebase, applying the principles from `codebase-design`.

The primary goal is identifying shallow modules, leaky abstractions, and duplication across core boundaries, consolidating them behind deep interfaces at clean seams.

## Candidate Explorations

The four architectural deepening candidates are documented in detail:

1. [Candidate 1: Consolidate the Token & Code Module](./candidate-1-token-module.md)
   - Consolidates fragmented token hashing, normalization, validation, generation, and lifecycle checks into a single deep token module.
2. [Candidate 2: Collapse Stage Lifecycles into the Election Module](./candidate-2-election-lifecycle.md)
   - Collapses stage transition rules, per-department advancement gates, tie flags, and audit hooks into the Election lifecycle module.
3. [Candidate 3: Deepen the Ballot Resolution and Casting Seam](./candidate-3-ballot-seam.md)
   - Encapsulates transient voter verification, self-exclusion, candidate validation, and atomic casting transactions behind a unified ballot seam.
4. [Candidate 4: Encapsulate the Admin Session and Authorization Seam](./candidate-4-admin-session.md)
   - Encapsulates administrative authentication, cookie validation, and allowlist verification behind a clean, testable admin session adapter.

## Implementation Issues

Tickets tracking the implementation and evaluation of these architectural explorations live under [issues/](./issues/).
