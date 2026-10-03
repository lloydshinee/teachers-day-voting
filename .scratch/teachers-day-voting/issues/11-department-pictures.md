# Department profile pictures / emblems

Type: task
Status: resolved
Blocked by: 10

## What to deliver

Enable administrators to upload or specify a photo/emblem for each department:
- **Database migration** (`db/migrations/007_department_picture.sql`):
  - Add nullable `picture_url text NULL` column to `public.departments`.
  - Provision `department-photos` bucket in Supabase storage (`storage.buckets`).
  - Configure RLS policies on `storage.objects` for public read and authenticated admin mutation.
- **Service layer** (`lib/departments/`):
  - Update `departmentRowSchema`, `createDepartmentSchema`, and `renameDepartmentSchema` to support `picture_url`.
  - Add `processDepartmentPictureUpload` to handle file uploads (JPEG, PNG, WebP, GIF, SVG; <= 5MB) and URL inputs, plus removal via `removePicture`.
  - Update `listDepartmentsWithCounts` to query `picture_url`.
- **UI Components & Pages**:
  - Author `components/department-avatar.tsx` with logo image and fallback department badge.
  - Update `app/admin/departments/forms.tsx` to include photo upload, preview, and removal controls.
  - Update `app/admin/departments/page.tsx`, `app/admin/departments/[departmentId]/page.tsx`, and `app/admin/page.tsx` to show department emblems.
  - Update `/vote` and `/results` where departments are displayed.
- **Verification**:
  - `npm run typecheck`, `npm run test:security`, and `npm run test:e2e` pass with 0 errors.

## Acceptance criteria

- [x] Schema migration applied (`picture_url` on `departments` and `department-photos` bucket in storage).
- [x] Admin can upload or set department emblems from `/admin/departments`.
- [x] Admin can update or remove department emblems.
- [x] Department emblems display on admin pages, department cards, and voting/results views.
- [x] All tests and build pass with 0 errors.

## Answer (resolved 2026-10-02)

Completed department emblem and photo management:
- Fixed runtime `ReferenceError: _missingSchemas is not defined` in `lib/audit/hook.ts` by using a pure type-level exhaustion check without ambient runtime variables.
- Applied migration `007_department_picture.sql` on `public.departments` with `picture_url text NULL` and created `department-photos` Supabase storage bucket with RLS policies.
- Added image upload processing (PNG, JPEG, WebP, GIF, SVG <= 5MB) to `createDepartment` and `renameDepartment`.
- Created reusable `DepartmentAvatar` component with emblem image and fallback badge.
- Integrated department emblems on `/admin/departments`, `/admin/departments/[departmentId]`, `/admin` dashboard, `/vote` ballot header, and `/results` published department cards.

