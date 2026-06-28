-- ==========================================
-- PROANBUD 2.0 - DOCUMENT MANAGER PERFORMANCE INDEXES
-- ==========================================
-- The hot folder-load query filters on (user_id, provider, external_parent_id),
-- and folder rename/delete scan descendants with storage_path LIKE 'prefix%'.
-- db/03 only indexed (user_id, provider, updated_at) and (user_id, item_type),
-- so both of those degrade as document_items grows. These two B-tree indexes
-- cover them. Additive only — no data migration. Run before deploy.

-- Folder listing + create/rename duplicate-name checks.
CREATE INDEX IF NOT EXISTS idx_document_items_user_provider_parent
  ON public.document_items (user_id, provider, external_parent_id);

-- Subtree LIKE 'prefix%' scans (folder rename/delete cascade, recursive search).
-- text_pattern_ops lets prefix LIKE use the index regardless of collation.
CREATE INDEX IF NOT EXISTS idx_document_items_user_provider_storage_path
  ON public.document_items (user_id, provider, storage_path text_pattern_ops);

-- Recursive name search (ilike '%term%') and type-aware listing.
CREATE INDEX IF NOT EXISTS idx_document_items_user_provider_name
  ON public.document_items (user_id, provider, name text_pattern_ops);
