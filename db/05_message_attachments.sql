ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_url TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_type TEXT;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;

-- We need to ensure the bucket 'message_attachments' exists.
-- You can run this block, or just create it via Supabase Dashboard.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public) 
  VALUES ('message_attachments', 'message_attachments', true)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Skipping bucket creation, please create message_attachments bucket manually in Supabase Dashboard if it fails here.';
END $$;

DROP POLICY IF EXISTS "Users can upload message attachments" ON storage.objects;
CREATE POLICY "Users can upload message attachments" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'message_attachments');

DROP POLICY IF EXISTS "Users can view message attachments" ON storage.objects;
CREATE POLICY "Users can view message attachments" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'message_attachments');
