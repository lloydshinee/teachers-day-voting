-- Migration: 006_faculty_picture
-- Faculty profile picture support:
--   1. Adds nullable `picture_url text NULL` to `public.faculty`.
--   2. Provisions the `faculty-photos` public storage bucket in `storage.buckets`.
--   3. Configures Row-Level Security policies on storage for public reads and
--      authenticated admin-only upload/update/delete.

-- -------------------------------------------------------------------- faculty column

ALTER TABLE public.faculty
  ADD COLUMN IF NOT EXISTS picture_url text NULL;

COMMENT ON COLUMN public.faculty.picture_url IS
  'Public URL of faculty member photo or avatar. Displayed on voting ballots and admin directory.';

-- ------------------------------------------------------------------- storage bucket

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'faculty-photos',
  'faculty-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

-- ------------------------------------------------------------------ storage policies

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'buckets'
      AND policyname = 'Public read faculty buckets'
  ) THEN
    CREATE POLICY "Public read faculty buckets"
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
      AND policyname = 'Public read faculty photos'
  ) THEN
    CREATE POLICY "Public read faculty photos"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'faculty-photos');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admin insert faculty photos'
  ) THEN
    CREATE POLICY "Admin insert faculty photos"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = 'faculty-photos' AND public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admin update faculty photos'
  ) THEN
    CREATE POLICY "Admin update faculty photos"
      ON storage.objects FOR UPDATE
      TO authenticated
      USING (bucket_id = 'faculty-photos' AND public.is_admin());
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Admin delete faculty photos'
  ) THEN
    CREATE POLICY "Admin delete faculty photos"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (bucket_id = 'faculty-photos' AND public.is_admin());
  END IF;
END $$;
