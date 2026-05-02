-- ==========================================
-- DEDUPE USER NAME SOURCE OF TRUTH
-- Keep full_name ONLY in public.users.
-- public.user_profiles should only contain profile metadata (avatar_url, bio, ...).
-- ==========================================

BEGIN;

-- 0) Remove legacy trigger/function dependencies on user_profiles.full_name
--    (common in earlier schemas where profile name synced into users).
DROP TRIGGER IF EXISTS on_profile_name_update ON public.user_profiles;
DROP FUNCTION IF EXISTS public.on_profile_name_update();

-- 1) Best-effort backfill users.full_name from user_profiles.full_name
--    only when users.full_name is empty.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_profiles'
      AND column_name = 'full_name'
  ) THEN
    UPDATE public.users u
    SET full_name = up.full_name,
        updated_at = now()
    FROM public.user_profiles up
    WHERE up.user_id = u.id
      AND up.full_name IS NOT NULL
      AND btrim(up.full_name) <> ''
      AND (u.full_name IS NULL OR btrim(u.full_name) = '');
  END IF;
END $$;

-- 2) Drop duplicate column from user_profiles.
ALTER TABLE IF EXISTS public.user_profiles
  DROP COLUMN IF EXISTS full_name;

COMMIT;
