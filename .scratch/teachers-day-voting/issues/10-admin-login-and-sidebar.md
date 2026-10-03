# Dedicated Admin Login Page and Sidebar Dashboard Layout

Type: task
Status: resolved
Blocked by: 09

## What to deliver

Deliver a dedicated admin authentication flow and modern sidebar dashboard UI:
- **Admin Login Page** (`app/admin/login/page.tsx`, `app/admin/login/actions.ts`):
  - Dedicated login form with email & password inputs, password visibility toggle, error handling, and redirection.
  - Server actions `adminSignIn` (verifies credentials with Supabase Auth and validates `public.is_admin()`) and `adminSignOut`.
  - Automatic redirect to `/admin/login` for unauthenticated or non-admin visitors attempting to access `/admin/*`.
- **Admin Sidebar Dashboard Layout** (`app/admin/layout.tsx`, `components/admin-sidebar.tsx`):
  - Sidebar with school branding (maroon theme), navigation links with Lucide icons (Dashboard, Departments, Faculty, Faculty Codes, Faculty Results, Student Codes, Final Results).
  - Quick links to public ballot and results.
  - Active admin profile card showing email and an instant Sign Out button.
  - Responsive mobile drawer / sheet navigation.
- **Verification**:
  - `npm run typecheck`, `npm run test:security`, and `npm run test:e2e` pass with 0 errors.
  - Production build succeeds.

## Acceptance criteria

- [x] Dedicated `/admin/login` page allows logging in with `admin@school.edu`.
- [x] Non-admin / unauthenticated users accessing `/admin` routes are redirected to `/admin/login`.
- [x] Admin layout displays a responsive sidebar with navigation icons, admin user details, and Sign Out functionality.
- [x] All tests and production build pass.
