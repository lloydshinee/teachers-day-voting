-- Migration: 007_department_picture
-- Department profile picture / emblem support:
--   1. Adds nullable `picture_url text NULL` to `public.departments`.
--   2. Provisions the `department-photos` public storage bucket in `storage.buckets`.
--   3. Configures Row-Level Security policies on storage for public reads and
--      authenticated admin-only upload/update/delete.

-- -------------------------------------------------------------------- department column

ALTER TABLE public.departments
  ADD COLUMN IF NOT EXISTS picture_url text NULL;

COMMENT ON COLUMN public.departments.picture_url IS
  'Public URL of department logo, photo, or emblem. Displayed across admin and voting portals.';

-- ------------------------------------------------------------------- storage bucket

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'department-photos',
  'department-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

-- ------------------------------------------------------------------ storage policies

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'buckets'
      AND policyname = 'Public read department buckets'
  ) THEN
    CREATE POLICY "Public read department buckets"
      ON storage.buckets FOR SELECT
      USING (public = true);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read department photos'
  ) THEN
    CREATE POLICY "Public read department photos"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'department-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admin insert department photos'
  ) THEN
    CREATE POLICY "Admin insert department photos"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'department-photos' AND public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admin update department photos'
  ) THEN
    CREATE POLICY "Admin update department photos"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'department-photos' AND public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admin delete department photos'
  ) THEN
    CREATE POLICY "Admin delete department photos"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (bucket_id = 'department-photos' AND public.is_admin());
  END IF;
END $$;
