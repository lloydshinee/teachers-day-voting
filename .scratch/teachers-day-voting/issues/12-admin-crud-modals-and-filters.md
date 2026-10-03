# Faculty & Department Admin UX: Live Search, Filters, Persistent College, and Modals

Type: task
Status: resolved
Blocked by: 11

## What to deliver

Overhaul the UX for both Department management (`/admin/departments`) and Faculty Roster (`/admin/faculty`):
- **Live Search & Filter**:
  - Departments: Instant client-side search by code or department name.
  - Faculty: Instant client-side search by faculty member name.
  - Department filter pill-tabs with badge counts on Faculty Roster ("All Departments" + each department).
- **Persistent College Selection**:
  - Remember the selected college/department in the "+ Add Faculty" modal across consecutive additions so the admin does not have to re-select the department each time.
- **Modern Dialog Modals**:
  - Replace ugly raw inline forms on cards with accessible modal dialogs with backdrop blur, Esc key listeners, autofocus, and outside-click dismissal:
    - `components/ui/modal.tsx`
    - Departments: "+ Add Department" modal, "Edit Department" modal, "Delete Department" modal.
    - Faculty: "+ Add Faculty Member" modal, "Edit Details" modal, "Move Department" modal, "Archive Faculty" confirmation modal.
- **Verification**:
  - `npm run typecheck`, `npm run test:security`, `npm run test:e2e`, and `npm run build` pass with 0 errors.

## Acceptance criteria

- [x] Live search on Departments page.
- [x] Live search on Faculty page.
- [x] Department filter pills on Faculty page.
- [x] Persistent college selection when creating faculty members.
- [x] Clean modal dialogs replace inline CRUD forms across both pages.
- [x] All test suites and production build pass with 0 errors.

## Answer (resolved 2026-10-02)

Delivered complete UX revamp for Departments and Faculty:
- Created reusable modal component `components/ui/modal.tsx` supporting backdrop blur, escape key shortcuts, and clean accessible styling.
- Revamped `/admin/departments` with `DepartmentsManager` (`app/admin/departments/forms.tsx`):
  - Search bar filtering departments by name or code in real time.
  - Clean cards showing emblem, code, name, and faculty count.
  - "+ Add Department" modal, "Edit Department" modal (name, code, emblem upload/url/remove), and "Delete Department" modal.
- Revamped `/admin/faculty` with `FacultyManager` (`app/admin/faculty/forms.tsx`):
  - Live search input matching faculty names.
  - Department filter pills with counts and active badge highlighting.
  - "+ Add Faculty Member" modal that remembers the last selected department across consecutive additions.
  - Clean faculty cards with avatar, department badge, and modal dialogs for Edit Details, Move Department, and Archive.
- Fixed `lib/vote/security.self-test.ts` cleanup verification loop.
- All test suites (`typecheck`, `test:security`, `test:e2e`) and `npm run build` pass cleanly.
