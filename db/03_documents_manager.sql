-- ==========================================
-- PROANBUD 2.0 - DOCUMENT MANAGER SCHEMA
-- ==========================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Integrations for document providers (Google Drive / OneDrive)
CREATE TABLE IF NOT EXISTS public.document_integrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google_drive', 'onedrive')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  scope TEXT,
  token_type TEXT,
  expires_at TIMESTAMPTZ,
  account_email TEXT,
  account_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, provider)
);

-- Canonical metadata for all items shown in Dokumenter (Supabase + external providers)
CREATE TABLE IF NOT EXISTS public.document_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('supabase', 'google_drive', 'onedrive')),
  integration_id UUID REFERENCES public.document_integrations(id) ON DELETE SET NULL,

  name TEXT NOT NULL,
  item_type TEXT NOT NULL DEFAULT 'file' CHECK (item_type IN ('file', 'folder')),
  mime_type TEXT,
  extension TEXT,
  size_bytes BIGINT,

  -- Supabase storage location
  storage_bucket TEXT,
  storage_path TEXT,

  -- External provider IDs
  external_id TEXT,
  external_parent_id TEXT,

  -- User-facing URLs
  web_url TEXT,
  download_url TEXT,

  checksum TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_modified_at TIMESTAMPTZ,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE (user_id, provider, storage_bucket, storage_path),
  UNIQUE (user_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_document_items_user_provider
  ON public.document_items (user_id, provider, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_items_type
  ON public.document_items (user_id, item_type);

-- Shared trigger function already exists in base schema; create if missing for safety
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_document_integrations') THEN
    CREATE TRIGGER set_updated_at_document_integrations
      BEFORE UPDATE ON public.document_integrations
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_document_items') THEN
    CREATE TRIGGER set_updated_at_document_items
      BEFORE UPDATE ON public.document_items
      FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
  END IF;
END$$;

ALTER TABLE IF EXISTS public.document_integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.document_items ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'document_integrations' AND policyname = 'owner_manage_document_integrations'
  ) THEN
    CREATE POLICY owner_manage_document_integrations ON public.document_integrations FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'document_items' AND policyname = 'owner_manage_document_items'
  ) THEN
    CREATE POLICY owner_manage_document_items ON public.document_items FOR ALL
      USING (user_id = auth.uid())
      WITH CHECK (user_id = auth.uid());
  END IF;
END$$;

-- Private bucket for first-party Proanbud files.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents',
  'documents',
  false,
  52428800,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage object policies scoped by user folder prefix: documents/{auth.uid()}/...
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_bucket_owner_select'
  ) THEN
    CREATE POLICY documents_bucket_owner_select ON storage.objects FOR SELECT
      USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_bucket_owner_insert'
  ) THEN
    CREATE POLICY documents_bucket_owner_insert ON storage.objects FOR INSERT
      WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_bucket_owner_update'
  ) THEN
    CREATE POLICY documents_bucket_owner_update ON storage.objects FOR UPDATE
      USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      )
      WITH CHECK (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'documents_bucket_owner_delete'
  ) THEN
    CREATE POLICY documents_bucket_owner_delete ON storage.objects FOR DELETE
      USING (
        bucket_id = 'documents'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END$$;
