-- 71: Indekser på alle fremmednøkler som manglet dekkende indeks
-- (Supabase-lint «unindexed_foreign_keys», 48 stk). Uindekserte FK-er gir
-- sekvensielle skann ved joins OG ved DELETE/UPDATE på foreldretabellen
-- (f.eks. sletting av bruker/prosjekt låser og skanner barnetabellene).
-- DDL generert fra pg_constraint i prod — kolonnenavn er verifisert.

CREATE INDEX IF NOT EXISTS idx_calendar_events_created_by ON public.calendar_events (created_by);
CREATE INDEX IF NOT EXISTS idx_change_order_photos_company_id ON public.change_order_photos (company_id);
CREATE INDEX IF NOT EXISTS idx_change_order_photos_created_by ON public.change_order_photos (created_by);
CREATE INDEX IF NOT EXISTS idx_change_orders_created_by ON public.change_orders (created_by);
CREATE INDEX IF NOT EXISTS idx_change_orders_customer_id ON public.change_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_change_orders_project_id ON public.change_orders (project_id);
CREATE INDEX IF NOT EXISTS idx_checklist_item_attachments_company_id ON public.checklist_item_attachments (company_id);
CREATE INDEX IF NOT EXISTS idx_checklist_item_attachments_uploaded_by ON public.checklist_item_attachments (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_checklist_template_items_template_id ON public.checklist_template_items (template_id);
CREATE INDEX IF NOT EXISTS idx_checklist_templates_created_by ON public.checklist_templates (created_by);
CREATE INDEX IF NOT EXISTS idx_company_hms_updated_by ON public.company_hms (updated_by);
CREATE INDEX IF NOT EXISTS idx_contracts_customer_id ON public.contracts (customer_id);
CREATE INDEX IF NOT EXISTS idx_deviation_attachments_company_id ON public.deviation_attachments (company_id);
CREATE INDEX IF NOT EXISTS idx_deviation_attachments_deviation_id ON public.deviation_attachments (deviation_id);
CREATE INDEX IF NOT EXISTS idx_deviation_attachments_uploaded_by ON public.deviation_attachments (uploaded_by);
CREATE INDEX IF NOT EXISTS idx_deviations_checklist_item_id ON public.deviations (checklist_item_id);
CREATE INDEX IF NOT EXISTS idx_deviations_closed_by ON public.deviations (closed_by);
CREATE INDEX IF NOT EXISTS idx_deviations_reported_by ON public.deviations (reported_by);
CREATE INDEX IF NOT EXISTS idx_document_items_integration_id ON public.document_items (integration_id);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved_by ON public.error_logs (resolved_by);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON public.error_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_fiken_oauth_state_company_id ON public.fiken_oauth_state (company_id);
CREATE INDEX IF NOT EXISTS idx_fiken_oauth_state_created_by ON public.fiken_oauth_state (created_by);
CREATE INDEX IF NOT EXISTS idx_hourly_rates_created_by ON public.hourly_rates (created_by);
CREATE INDEX IF NOT EXISTS idx_invitation_roles_role_id ON public.invitation_roles (role_id);
CREATE INDEX IF NOT EXISTS idx_invitations_invited_by ON public.invitations (invited_by);
CREATE INDEX IF NOT EXISTS idx_kjorebok_trips_created_by ON public.kjorebok_trips (created_by);
CREATE INDEX IF NOT EXISTS idx_kjorebok_trips_vehicle_id ON public.kjorebok_trips (vehicle_id);
CREATE INDEX IF NOT EXISTS idx_kjorebok_vehicles_created_by ON public.kjorebok_vehicles (created_by);
CREATE INDEX IF NOT EXISTS idx_kjorebok_vehicles_default_driver ON public.kjorebok_vehicles (default_driver);
CREATE INDEX IF NOT EXISTS idx_offer_activity_actor_user_id ON public.offer_activity (actor_user_id);
CREATE INDEX IF NOT EXISTS idx_offers_contract_id ON public.offers (contract_id);
CREATE INDEX IF NOT EXISTS idx_project_checklist_items_company_id ON public.project_checklist_items (company_id);
CREATE INDEX IF NOT EXISTS idx_project_checklist_items_deviation_id ON public.project_checklist_items (deviation_id);
CREATE INDEX IF NOT EXISTS idx_project_checklist_items_responded_by ON public.project_checklist_items (responded_by);
CREATE INDEX IF NOT EXISTS idx_project_checklists_created_by ON public.project_checklists (created_by);
CREATE INDEX IF NOT EXISTS idx_project_checklists_template_id ON public.project_checklists (template_id);
CREATE INDEX IF NOT EXISTS idx_project_material_costs_created_by ON public.project_material_costs (created_by);
CREATE INDEX IF NOT EXISTS idx_project_members_user_id ON public.project_members (user_id);
CREATE INDEX IF NOT EXISTS idx_prospect_tasks_assigned_to ON public.prospect_tasks (assigned_to);
CREATE INDEX IF NOT EXISTS idx_prospect_tasks_created_by ON public.prospect_tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_prospect_tasks_done_by ON public.prospect_tasks (done_by);
CREATE INDEX IF NOT EXISTS idx_prospects_assigned_to ON public.prospects (assigned_to);
CREATE INDEX IF NOT EXISTS idx_saved_jobs_created_by ON public.saved_jobs (created_by);
CREATE INDEX IF NOT EXISTS idx_seller_email_log_sent_by ON public.seller_email_log (sent_by);
CREATE INDEX IF NOT EXISTS idx_seller_leads_converted_company_id ON public.seller_leads (converted_company_id);
CREATE INDEX IF NOT EXISTS idx_supplier_price_files_created_by ON public.supplier_price_files (created_by);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON public.user_roles (role_id);
