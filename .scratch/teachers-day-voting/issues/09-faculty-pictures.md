# Faculty profile pictures and voting ballot display

Type: task
Status: resolved
Blocked by: 08

## What to deliver

Deliver faculty profile picture support as requested by the user:
- Schema migration `db/migrations/006_faculty_picture.sql`:
  - Add nullable `picture_url text NULL` column to `public.faculty`.
  - Create `faculty-photos` storage bucket in Supabase storage and define RLS policies for public read and admin upload/update/delete.
- API / Service layer:
  - Update faculty schemas (`lib/faculty/schemas.ts`) to include `picture_url`.
  - Update faculty mutations (`createFaculty`, `renameFaculty`, `updateFacultyPicture`) to support photo uploads and picture URLs.
  - Update faculty query helpers (`lib/faculty/queries.ts`) to return `picture_url`.
  - Update vote schemas and resolvers (`lib/vote/schemas.ts`, `lib/vote/actions.ts`) so both faculty and student ballots include `pictureUrl`.
- UI:
  - Update admin faculty management (`app/admin/faculty/forms.tsx`, `app/admin/faculty/page.tsx`) to allow uploading and previewing faculty pictures.
  - Update voting UI (`app/vote/forms.tsx`) to display faculty photos and initials fallback on candidate selection cards and on the vote confirmation step.
  - Update published results UI (`app/results/page.tsx`) and any other faculty listing where photos enrich the UI.
- Verify:
  - Typecheck, security tests, and e2e lifecycle tests pass.

## Acceptance criteria

- [x] Schema migration applied to local Supabase stack (`picture_url` on `faculty` and `faculty-photos` bucket).
- [x] Admin can upload or set faculty pictures from `/admin/faculty`.
- [x] Voting ballot on `/vote` renders candidate pictures (with clean fallback avatars) on ballot choice buttons and confirm step.
- [x] `npm run typecheck`, `npm run test:security`, and `npm run test:e2e` pass with 0 errors.

## Answer (resolved 2026-10-02)

Completed faculty profile picture upload and voting ballot display:
- **Migration `006_faculty_picture.sql`**: Added `picture_url text NULL` to `public.faculty`, provisioned the `faculty-photos` public storage bucket, and established RLS policies for public image reads and authenticated admin mutation.
- **Service & Schemas**:
  - `lib/faculty/schemas.ts`: Updated `facultyRowSchema`, `createFacultySchema`, and `renameFacultySchema` / `updateFacultySchema` to accept and validate picture URLs and uploads.
  - `lib/faculty/queries.ts`: Updated `listFacultyByDepartment` to query `picture_url`.
  - `lib/faculty/actions.ts`: Added `processPictureUpload` with file size (≤ 5MB) and mime-type verification (JPEG, PNG, WebP, GIF), uploading to the `faculty-photos` bucket via Supabase Storage and generating public URLs; preserved `picture_url` across faculty department moves.
  - `lib/vote/schemas.ts` & `lib/vote/actions.ts`: Added `pictureUrl` to `ballotCandidateSchema`, `resolveFacultyBallot`, and `resolveStudentBallot`.
  - `lib/stage2/schemas.ts` & `lib/stage2/queries.ts`: Added `pictureUrl` to `stage2FacultyRowSchema` and `getPublishedResults`.
- **UI Components**:
  - `components/faculty-avatar.tsx`: Created reusable avatar with image error fallback to school maroon initials.
  - `app/vote/forms.tsx`: Updated ballot candidate list to show faculty photo avatars and confirmation screen to prominently present the chosen candidate's picture and name.
  - `app/admin/faculty/forms.tsx`: Added photo upload input with file picker, photo preview, and photo removal checkbox to create and edit forms.
  - `app/results/page.tsx`: Updated official department winners and finalists cards to render faculty photos.
- **Verification**: Verified zero TypeScript errors (`tsc --noEmit`), passed 48/48 security tests and 35/35 end-to-end election lifecycle tests.
