# Election Creation & Stage Lifecycle Controls

Type: task
Status: resolved
Blocked by: 12

## What to deliver

Enable administrators to create elections and guide each election through its lifecycle:
- **Server Actions** (`lib/election/lifecycle-actions.ts`):
  - `createElection`: Validates election name, academic year, tie policy, and participating departments. Creates row in `public.elections` with initial stage `DRAFT` and links departments in `public.election_departments`.
  - `advanceElectionStage`: Governs transitions across the 6-stage lifecycle (`DRAFT` → `FACULTY_VOTING` → `FACULTY_RESULTS` → `STUDENT_VOTING` → `FINAL_RESULTS` → `CLOSED`), setting `tie_policy_locked_at` when faculty voting opens.
- **Client Components & Dashboard** (`app/admin/election-forms.tsx`, `app/admin/page.tsx`):
  - `CreateElectionModal`: Modal dialog to create an election with name, academic year, tie-breaking policy, and department selection.
  - `CreateElectionButton`: Accessible trigger rendered in both empty state ("+ Create First Election") and dashboard header ("+ New Election").
  - `ElectionStageControls`: Visual 6-step pipeline banner indicating current status, instructions, confirmation guards, and action buttons to advance stage.
- **Verification**:
  - `npm run typecheck`, `npm run test:security`, `npm run test:e2e`, and `npm run build` pass with 0 errors.

## Acceptance criteria

- [x] Admin can create an election with name, academic year, and participating departments.
- [x] Initial stage defaults to `DRAFT`.
- [x] Visual pipeline controls guide admin from Draft through Closed.
- [x] All test suites pass.

## Answer (resolved 2026-10-02)

Implemented election creation and stage pipeline:
- Created `lib/election/lifecycle-actions.ts` with `createElection` and `advanceElectionStage`.
- Built `app/admin/election-forms.tsx` with `CreateElectionModal`, `CreateElectionButton`, and `ElectionStageControls`.
- Updated `app/admin/page.tsx` with empty state guidance and live stage progression controls.
- Seeded default "Teachers' Day 2026" election (Academic Year 2026-2027) with all 4 active departments in `DRAFT` stage.
- Validated with security and e2e suites.
