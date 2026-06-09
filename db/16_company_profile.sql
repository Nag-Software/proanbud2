-- Company profile fields used in offers, contracts, and customer communication.

ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS postal_code TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS website TEXT;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS quote_validity_days INTEGER NOT NULL DEFAULT 30;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS price_level TEXT NOT NULL DEFAULT 'normal'
  CHECK (price_level IN ('low', 'normal', 'high'));
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS industry TEXT;

DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('company-logos', 'company-logos', true)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping company-logos bucket creation; create manually in Supabase Dashboard if needed.';
END $$;

DROP POLICY IF EXISTS "Users can upload company logos" ON storage.objects;
CREATE POLICY "Users can upload company logos" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "Users can update company logos" ON storage.objects;
CREATE POLICY "Users can update company logos" ON storage.objects
FOR UPDATE TO authenticated
USING (bucket_id = 'company-logos');

DROP POLICY IF EXISTS "Anyone can view company logos" ON storage.objects;
CREATE POLICY "Anyone can view company logos" ON storage.objects
FOR SELECT TO public
USING (bucket_id = 'company-logos');
