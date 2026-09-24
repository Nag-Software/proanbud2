-- Ledere kan slette andres filer i prosjektmappen.
--
-- db/101 delte prosjektfilene for lesing, men sletting var fortsatt bare for den
-- som lastet opp. Nå kan også admin/leder i firmaet og prosjektleder på
-- prosjektet slette filer i prosjektets mappe – f.eks. rydde bort feil bilder.
-- Å gi nytt navn eller flytte er fortsatt bare for eieren.

CREATE OR REPLACE FUNCTION public.can_manage_project_documents(p_project_id UUID)
RETURNS BOOLEAN AS $$
  SELECT
    p_project_id IS NOT NULL
    AND (
      (
        public.is_company_manager_or_admin()
        AND EXISTS (
          SELECT 1 FROM public.projects p
          WHERE p.id = p_project_id
            AND p.company_id = public.get_current_company_id()
        )
      )
      OR public.is_project_manager(p_project_id)
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.can_manage_project_documents(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_project_documents(UUID) TO authenticated;

DROP POLICY IF EXISTS "project_managers_delete_project_documents" ON public.document_items;
CREATE POLICY "project_managers_delete_project_documents" ON public.document_items
  FOR DELETE
  TO authenticated
  USING (
    project_id IS NOT NULL
    AND item_type = 'file'
    AND public.can_manage_project_documents(project_id)
  );

-- Selve filen i lagringen. API-et sletter filen før raden, så raden finnes ennå.
DROP POLICY IF EXISTS "documents_bucket_project_manager_delete" ON storage.objects;
CREATE POLICY "documents_bucket_project_manager_delete" ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'documents'
    AND EXISTS (
      SELECT 1
      FROM public.document_items d
      WHERE d.storage_bucket = 'documents'
        AND d.storage_path = storage.objects.name
        AND d.project_id IS NOT NULL
        AND public.can_manage_project_documents(d.project_id)
    )
  );
