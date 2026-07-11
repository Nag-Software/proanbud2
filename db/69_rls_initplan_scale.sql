-- 69: RLS-skalering — pakk auth.uid()/auth.role() og null-args hjelpefunksjoner
-- (get_current_company_id, is_company_admin, is_company_manager_or_admin) i
-- (select ...) slik at Postgres evaluerer dem ÉN gang per spørring (InitPlan)
-- i stedet for én gang PER RAD. Identisk tilgangslogikk, samme policynavn.
-- Generert mekanisk fra pg_policies i prod; radhentende funksjoner som
-- has_project_access(project_id) er bevisst IKKE endret (radavhengige).

DROP POLICY IF EXISTS "billing_overage_snapshots_select" ON public."billing_overage_snapshots";
CREATE POLICY "billing_overage_snapshots_select" ON public."billing_overage_snapshots"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "owner_manage_calendar_event_links" ON public."calendar_event_links";
CREATE POLICY "owner_manage_calendar_event_links" ON public."calendar_event_links"
  FOR ALL
  TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

DROP POLICY IF EXISTS "company_members_delete_calendar_events" ON public."calendar_events";
CREATE POLICY "company_members_delete_calendar_events" ON public."calendar_events"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_calendar_events" ON public."calendar_events";
CREATE POLICY "company_members_insert_calendar_events" ON public."calendar_events"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_calendar_events" ON public."calendar_events";
CREATE POLICY "company_members_select_calendar_events" ON public."calendar_events"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_calendar_events" ON public."calendar_events";
CREATE POLICY "company_members_update_calendar_events" ON public."calendar_events"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "owner_manage_integrations" ON public."calendar_integrations";
CREATE POLICY "owner_manage_integrations" ON public."calendar_integrations"
  FOR ALL
  TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

DROP POLICY IF EXISTS "company_members_delete_change_order_photos" ON public."change_order_photos";
CREATE POLICY "company_members_delete_change_order_photos" ON public."change_order_photos"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_change_order_photos" ON public."change_order_photos";
CREATE POLICY "company_members_insert_change_order_photos" ON public."change_order_photos"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_change_order_photos" ON public."change_order_photos";
CREATE POLICY "company_members_select_change_order_photos" ON public."change_order_photos"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_delete_change_orders" ON public."change_orders";
CREATE POLICY "company_members_delete_change_orders" ON public."change_orders"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_change_orders" ON public."change_orders";
CREATE POLICY "company_members_insert_change_orders" ON public."change_orders"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_change_orders" ON public."change_orders";
CREATE POLICY "company_members_select_change_orders" ON public."change_orders"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_change_orders" ON public."change_orders";
CREATE POLICY "company_members_update_change_orders" ON public."change_orders"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "checklist_item_attachments_delete" ON public."checklist_item_attachments";
CREATE POLICY "checklist_item_attachments_delete" ON public."checklist_item_attachments"
  FOR DELETE
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND (uploaded_by = (select auth.uid()))));

DROP POLICY IF EXISTS "checklist_item_attachments_insert" ON public."checklist_item_attachments";
CREATE POLICY "checklist_item_attachments_insert" ON public."checklist_item_attachments"
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = (select get_current_company_id())) AND (uploaded_by = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM (project_checklist_items pci
     JOIN project_checklists pc ON ((pc.id = pci.checklist_id)))
  WHERE ((pci.id = checklist_item_attachments.item_id) AND has_project_access(pc.project_id))))));

DROP POLICY IF EXISTS "checklist_item_attachments_select" ON public."checklist_item_attachments";
CREATE POLICY "checklist_item_attachments_select" ON public."checklist_item_attachments"
  FOR SELECT
  TO authenticated
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "checklist_template_items_delete" ON public."checklist_template_items";
CREATE POLICY "checklist_template_items_delete" ON public."checklist_template_items"
  FOR DELETE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM checklist_templates t
  WHERE ((t.id = checklist_template_items.template_id) AND (t.company_id = (select get_current_company_id())) AND (t.is_system = false) AND (select is_company_manager_or_admin())))));

DROP POLICY IF EXISTS "checklist_template_items_insert" ON public."checklist_template_items";
CREATE POLICY "checklist_template_items_insert" ON public."checklist_template_items"
  FOR INSERT
  TO authenticated
  WITH CHECK ((EXISTS ( SELECT 1
   FROM checklist_templates t
  WHERE ((t.id = checklist_template_items.template_id) AND (t.company_id = (select get_current_company_id())) AND (t.is_system = false) AND (select is_company_manager_or_admin())))));

DROP POLICY IF EXISTS "checklist_template_items_select" ON public."checklist_template_items";
CREATE POLICY "checklist_template_items_select" ON public."checklist_template_items"
  FOR SELECT
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM checklist_templates t
  WHERE ((t.id = checklist_template_items.template_id) AND ((t.is_system = true) OR (t.company_id = (select get_current_company_id())))))));

DROP POLICY IF EXISTS "checklist_template_items_update" ON public."checklist_template_items";
CREATE POLICY "checklist_template_items_update" ON public."checklist_template_items"
  FOR UPDATE
  TO authenticated
  USING ((EXISTS ( SELECT 1
   FROM checklist_templates t
  WHERE ((t.id = checklist_template_items.template_id) AND (t.company_id = (select get_current_company_id())) AND (t.is_system = false) AND (select is_company_manager_or_admin())))));

DROP POLICY IF EXISTS "checklist_templates_delete" ON public."checklist_templates";
CREATE POLICY "checklist_templates_delete" ON public."checklist_templates"
  FOR DELETE
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND (is_system = false) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "checklist_templates_insert" ON public."checklist_templates";
CREATE POLICY "checklist_templates_insert" ON public."checklist_templates"
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = (select get_current_company_id())) AND (is_system = false) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "checklist_templates_select" ON public."checklist_templates";
CREATE POLICY "checklist_templates_select" ON public."checklist_templates"
  FOR SELECT
  TO authenticated
  USING (((is_system = true) OR (company_id = (select get_current_company_id()))));

DROP POLICY IF EXISTS "checklist_templates_update" ON public."checklist_templates";
CREATE POLICY "checklist_templates_update" ON public."checklist_templates"
  FOR UPDATE
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND (is_system = false) AND (select is_company_manager_or_admin())))
  WITH CHECK (((company_id = (select get_current_company_id())) AND (is_system = false)));

DROP POLICY IF EXISTS "admin_update_own_company" ON public."companies";
CREATE POLICY "admin_update_own_company" ON public."companies"
  FOR UPDATE
  TO public
  USING (((id = (select get_current_company_id())) AND (select is_company_admin())));

DROP POLICY IF EXISTS "view_own_company" ON public."companies";
CREATE POLICY "view_own_company" ON public."companies"
  FOR SELECT
  TO public
  USING ((id = (select get_current_company_id())));

DROP POLICY IF EXISTS "company_billing_select" ON public."company_billing";
CREATE POLICY "company_billing_select" ON public."company_billing"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "company_hms_admin" ON public."company_hms";
CREATE POLICY "company_hms_admin" ON public."company_hms"
  FOR ALL
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND (select is_company_admin())))
  WITH CHECK (((company_id = (select get_current_company_id())) AND (select is_company_admin())));

DROP POLICY IF EXISTS "company_hms_select" ON public."company_hms";
CREATE POLICY "company_hms_select" ON public."company_hms"
  FOR SELECT
  TO authenticated
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "company_modules_select" ON public."company_modules";
CREATE POLICY "company_modules_select" ON public."company_modules"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "company_tracking_settings_select" ON public."company_tracking_settings";
CREATE POLICY "company_tracking_settings_select" ON public."company_tracking_settings"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "company_tracking_settings_write" ON public."company_tracking_settings";
CREATE POLICY "company_tracking_settings_write" ON public."company_tracking_settings"
  FOR ALL
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())))
  WITH CHECK (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "company_usage_events_select" ON public."company_usage_events";
CREATE POLICY "company_usage_events_select" ON public."company_usage_events"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "manage_contracts" ON public."contracts";
CREATE POLICY "manage_contracts" ON public."contracts"
  FOR ALL
  TO public
  USING ((company_id = (select get_current_company_id())))
  WITH CHECK ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "view_contracts" ON public."contracts";
CREATE POLICY "view_contracts" ON public."contracts"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND ((project_id IS NULL) OR has_project_access(project_id))));

DROP POLICY IF EXISTS "manage_company_customers" ON public."customers";
CREATE POLICY "manage_company_customers" ON public."customers"
  FOR ALL
  TO public
  USING (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR (( SELECT users.role
   FROM users
  WHERE (users.id = (select auth.uid()))) = 'manager'::text))));

DROP POLICY IF EXISTS "view_company_customers" ON public."customers";
CREATE POLICY "view_company_customers" ON public."customers"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "deviation_attachments_insert" ON public."deviation_attachments";
CREATE POLICY "deviation_attachments_insert" ON public."deviation_attachments"
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = (select get_current_company_id())) AND (uploaded_by = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM deviations d
  WHERE ((d.id = deviation_attachments.deviation_id) AND (d.company_id = (select get_current_company_id())) AND has_project_access(d.project_id))))));

DROP POLICY IF EXISTS "deviation_attachments_select" ON public."deviation_attachments";
CREATE POLICY "deviation_attachments_select" ON public."deviation_attachments"
  FOR SELECT
  TO authenticated
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "deviations_insert" ON public."deviations";
CREATE POLICY "deviations_insert" ON public."deviations"
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = (select get_current_company_id())) AND has_project_access(project_id) AND (reported_by = (select auth.uid()))));

DROP POLICY IF EXISTS "deviations_select" ON public."deviations";
CREATE POLICY "deviations_select" ON public."deviations"
  FOR SELECT
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND ((select is_company_manager_or_admin()) OR has_project_access(project_id))));

DROP POLICY IF EXISTS "deviations_update" ON public."deviations";
CREATE POLICY "deviations_update" ON public."deviations"
  FOR UPDATE
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND can_manage_deviations(project_id)))
  WITH CHECK ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "owner_manage_document_integrations" ON public."document_integrations";
CREATE POLICY "owner_manage_document_integrations" ON public."document_integrations"
  FOR ALL
  TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

DROP POLICY IF EXISTS "owner_manage_document_items" ON public."document_items";
CREATE POLICY "owner_manage_document_items" ON public."document_items"
  FOR ALL
  TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

DROP POLICY IF EXISTS "docusign_connections_manage" ON public."docusign_connections";
CREATE POLICY "docusign_connections_manage" ON public."docusign_connections"
  FOR ALL
  TO public
  USING ((company_id IN ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "docusign_connections_select" ON public."docusign_connections";
CREATE POLICY "docusign_connections_select" ON public."docusign_connections"
  FOR SELECT
  TO public
  USING ((company_id IN ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "external_links_select" ON public."external_entity_links";
CREATE POLICY "external_links_select" ON public."external_entity_links"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "external_links_service_write" ON public."external_entity_links";
CREATE POLICY "external_links_service_write" ON public."external_entity_links"
  FOR ALL
  TO public
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

DROP POLICY IF EXISTS "fiken_connections_manage" ON public."fiken_connections";
CREATE POLICY "fiken_connections_manage" ON public."fiken_connections"
  FOR ALL
  TO public
  USING (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR (( SELECT users.role
   FROM users
  WHERE (users.id = (select auth.uid()))) = 'manager'::text))))
  WITH CHECK (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR (( SELECT users.role
   FROM users
  WHERE (users.id = (select auth.uid()))) = 'manager'::text))));

DROP POLICY IF EXISTS "fiken_connections_select" ON public."fiken_connections";
CREATE POLICY "fiken_connections_select" ON public."fiken_connections"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "fiken_oauth_state_service" ON public."fiken_oauth_state";
CREATE POLICY "fiken_oauth_state_service" ON public."fiken_oauth_state"
  FOR ALL
  TO public
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

DROP POLICY IF EXISTS "company_members_delete_hourly_rates" ON public."hourly_rates";
CREATE POLICY "company_members_delete_hourly_rates" ON public."hourly_rates"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_hourly_rates" ON public."hourly_rates";
CREATE POLICY "company_members_insert_hourly_rates" ON public."hourly_rates"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_hourly_rates" ON public."hourly_rates";
CREATE POLICY "company_members_select_hourly_rates" ON public."hourly_rates"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_hourly_rates" ON public."hourly_rates";
CREATE POLICY "company_members_update_hourly_rates" ON public."hourly_rates"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "integration_jobs_insert" ON public."integration_jobs";
CREATE POLICY "integration_jobs_insert" ON public."integration_jobs"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "integration_jobs_select" ON public."integration_jobs";
CREATE POLICY "integration_jobs_select" ON public."integration_jobs"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "integration_jobs_service_write" ON public."integration_jobs";
CREATE POLICY "integration_jobs_service_write" ON public."integration_jobs"
  FOR UPDATE
  TO public
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

DROP POLICY IF EXISTS "integration_webhook_events_select" ON public."integration_webhook_events";
CREATE POLICY "integration_webhook_events_select" ON public."integration_webhook_events"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "integration_webhook_events_service_write" ON public."integration_webhook_events";
CREATE POLICY "integration_webhook_events_service_write" ON public."integration_webhook_events"
  FOR ALL
  TO public
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

DROP POLICY IF EXISTS "integration_worker_locks_service" ON public."integration_worker_locks";
CREATE POLICY "integration_worker_locks_service" ON public."integration_worker_locks"
  FOR ALL
  TO public
  USING (((select auth.role()) = 'service_role'::text))
  WITH CHECK (((select auth.role()) = 'service_role'::text));

DROP POLICY IF EXISTS "admins_manage_invitation_roles" ON public."invitation_roles";
CREATE POLICY "admins_manage_invitation_roles" ON public."invitation_roles"
  FOR ALL
  TO public
  USING ((select is_company_admin()))
  WITH CHECK ((select is_company_admin()));

DROP POLICY IF EXISTS "view_company_invitation_roles" ON public."invitation_roles";
CREATE POLICY "view_company_invitation_roles" ON public."invitation_roles"
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM invitations i
  WHERE ((i.id = invitation_roles.invitation_id) AND (i.company_id = (select get_current_company_id()))))));

DROP POLICY IF EXISTS "admins_create_invitations" ON public."invitations";
CREATE POLICY "admins_create_invitations" ON public."invitations"
  FOR INSERT
  TO public
  WITH CHECK (((company_id = (select get_current_company_id())) AND (select is_company_admin()) AND (invited_by = (select auth.uid()))));

DROP POLICY IF EXISTS "admins_update_invitations" ON public."invitations";
CREATE POLICY "admins_update_invitations" ON public."invitations"
  FOR UPDATE
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_admin())))
  WITH CHECK (((company_id = (select get_current_company_id())) AND (select is_company_admin())));

DROP POLICY IF EXISTS "view_company_invitations" ON public."invitations";
CREATE POLICY "view_company_invitations" ON public."invitations"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "company_members_delete_kjorebok_trips" ON public."kjorebok_trips";
CREATE POLICY "company_members_delete_kjorebok_trips" ON public."kjorebok_trips"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_kjorebok_trips" ON public."kjorebok_trips";
CREATE POLICY "company_members_insert_kjorebok_trips" ON public."kjorebok_trips"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_kjorebok_trips" ON public."kjorebok_trips";
CREATE POLICY "company_members_select_kjorebok_trips" ON public."kjorebok_trips"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_kjorebok_trips" ON public."kjorebok_trips";
CREATE POLICY "company_members_update_kjorebok_trips" ON public."kjorebok_trips"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_delete_kjorebok_vehicles" ON public."kjorebok_vehicles";
CREATE POLICY "company_members_delete_kjorebok_vehicles" ON public."kjorebok_vehicles"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_kjorebok_vehicles" ON public."kjorebok_vehicles";
CREATE POLICY "company_members_insert_kjorebok_vehicles" ON public."kjorebok_vehicles"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_kjorebok_vehicles" ON public."kjorebok_vehicles";
CREATE POLICY "company_members_select_kjorebok_vehicles" ON public."kjorebok_vehicles"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_kjorebok_vehicles" ON public."kjorebok_vehicles";
CREATE POLICY "company_members_update_kjorebok_vehicles" ON public."kjorebok_vehicles"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "Users can insert messages for their company" ON public."messages";
CREATE POLICY "Users can insert messages for their company" ON public."messages"
  FOR INSERT
  TO authenticated
  WITH CHECK ((company_id IN ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "Users can update messages for their company" ON public."messages";
CREATE POLICY "Users can update messages for their company" ON public."messages"
  FOR UPDATE
  TO authenticated
  USING ((company_id IN ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "Users can view messages for their company" ON public."messages";
CREATE POLICY "Users can view messages for their company" ON public."messages"
  FOR SELECT
  TO authenticated
  USING ((company_id IN ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "insert_offer_activity" ON public."offer_activity";
CREATE POLICY "insert_offer_activity" ON public."offer_activity"
  FOR INSERT
  TO public
  WITH CHECK (((company_id = (select get_current_company_id())) AND (EXISTS ( SELECT 1
   FROM offers o
  WHERE ((o.id = offer_activity.offer_id) AND (o.company_id = (select get_current_company_id())))))));

DROP POLICY IF EXISTS "view_offer_activity" ON public."offer_activity";
CREATE POLICY "view_offer_activity" ON public."offer_activity"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND (EXISTS ( SELECT 1
   FROM offers o
  WHERE ((o.id = offer_activity.offer_id) AND (o.company_id = (select get_current_company_id())) AND ((o.project_id IS NULL) OR has_project_access(o.project_id)))))));

DROP POLICY IF EXISTS "manage_offers" ON public."offers";
CREATE POLICY "manage_offers" ON public."offers"
  FOR ALL
  TO public
  USING (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR ((project_id IS NULL) AND (( SELECT users.role
   FROM users
  WHERE (users.id = (select auth.uid()))) = 'manager'::text)) OR (EXISTS ( SELECT 1
   FROM project_members pm
  WHERE ((pm.project_id = offers.project_id) AND (pm.user_id = (select auth.uid())) AND (pm.access_level = ANY (ARRAY['write'::text, 'manager'::text]))))))))
  WITH CHECK (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR ((project_id IS NULL) AND (( SELECT users.role
   FROM users
  WHERE (users.id = (select auth.uid()))) = 'manager'::text)) OR (EXISTS ( SELECT 1
   FROM project_members pm
  WHERE ((pm.project_id = offers.project_id) AND (pm.user_id = (select auth.uid())) AND (pm.access_level = ANY (ARRAY['write'::text, 'manager'::text]))))))));

DROP POLICY IF EXISTS "view_offers_for_accessible_projects" ON public."offers";
CREATE POLICY "view_offers_for_accessible_projects" ON public."offers"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND ((project_id IS NULL) OR has_project_access(project_id))));

DROP POLICY IF EXISTS "project_checklist_items_insert" ON public."project_checklist_items";
CREATE POLICY "project_checklist_items_insert" ON public."project_checklist_items"
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = (select get_current_company_id())) AND (EXISTS ( SELECT 1
   FROM project_checklists pc
  WHERE ((pc.id = project_checklist_items.checklist_id) AND has_project_access(pc.project_id))))));

DROP POLICY IF EXISTS "project_checklist_items_select" ON public."project_checklist_items";
CREATE POLICY "project_checklist_items_select" ON public."project_checklist_items"
  FOR SELECT
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND (EXISTS ( SELECT 1
   FROM project_checklists pc
  WHERE ((pc.id = project_checklist_items.checklist_id) AND ((select is_company_manager_or_admin()) OR has_project_access(pc.project_id)))))));

DROP POLICY IF EXISTS "project_checklist_items_update" ON public."project_checklist_items";
CREATE POLICY "project_checklist_items_update" ON public."project_checklist_items"
  FOR UPDATE
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND (EXISTS ( SELECT 1
   FROM project_checklists pc
  WHERE ((pc.id = project_checklist_items.checklist_id) AND has_project_access(pc.project_id))))))
  WITH CHECK ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "project_checklists_insert" ON public."project_checklists";
CREATE POLICY "project_checklists_insert" ON public."project_checklists"
  FOR INSERT
  TO authenticated
  WITH CHECK (((company_id = (select get_current_company_id())) AND has_project_access(project_id) AND (created_by = (select auth.uid()))));

DROP POLICY IF EXISTS "project_checklists_select" ON public."project_checklists";
CREATE POLICY "project_checklists_select" ON public."project_checklists"
  FOR SELECT
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND ((select is_company_manager_or_admin()) OR has_project_access(project_id))));

DROP POLICY IF EXISTS "project_checklists_update" ON public."project_checklists";
CREATE POLICY "project_checklists_update" ON public."project_checklists"
  FOR UPDATE
  TO authenticated
  USING (((company_id = (select get_current_company_id())) AND has_project_access(project_id)))
  WITH CHECK ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "project_geofences_select" ON public."project_geofences";
CREATE POLICY "project_geofences_select" ON public."project_geofences"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "project_geofences_write" ON public."project_geofences";
CREATE POLICY "project_geofences_write" ON public."project_geofences"
  FOR ALL
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())))
  WITH CHECK (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "company_members_delete_project_material_costs" ON public."project_material_costs";
CREATE POLICY "company_members_delete_project_material_costs" ON public."project_material_costs"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_project_material_costs" ON public."project_material_costs";
CREATE POLICY "company_members_insert_project_material_costs" ON public."project_material_costs"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_project_material_costs" ON public."project_material_costs";
CREATE POLICY "company_members_select_project_material_costs" ON public."project_material_costs"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_project_material_costs" ON public."project_material_costs";
CREATE POLICY "company_members_update_project_material_costs" ON public."project_material_costs"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "admins_and_managers_create_projects" ON public."projects";
CREATE POLICY "admins_and_managers_create_projects" ON public."projects"
  FOR INSERT
  TO public
  WITH CHECK (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR (( SELECT users.role
   FROM users
  WHERE (users.id = (select auth.uid()))) = 'manager'::text))));

DROP POLICY IF EXISTS "admins_delete_projects" ON public."projects";
CREATE POLICY "admins_delete_projects" ON public."projects"
  FOR DELETE
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_admin())));

DROP POLICY IF EXISTS "manage_assigned_projects" ON public."projects";
CREATE POLICY "manage_assigned_projects" ON public."projects"
  FOR UPDATE
  TO public
  USING (((company_id = (select get_current_company_id())) AND can_manage_project(id)));

DROP POLICY IF EXISTS "view_assigned_projects" ON public."projects";
CREATE POLICY "view_assigned_projects" ON public."projects"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR (EXISTS ( SELECT 1
   FROM project_members pm
  WHERE ((pm.project_id = projects.id) AND (pm.user_id = (select auth.uid()))))))));

DROP POLICY IF EXISTS "view_company_roles" ON public."roles";
CREATE POLICY "view_company_roles" ON public."roles"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "company_members_delete_saved_jobs" ON public."saved_jobs";
CREATE POLICY "company_members_delete_saved_jobs" ON public."saved_jobs"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_saved_jobs" ON public."saved_jobs";
CREATE POLICY "company_members_insert_saved_jobs" ON public."saved_jobs"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_saved_jobs" ON public."saved_jobs";
CREATE POLICY "company_members_select_saved_jobs" ON public."saved_jobs"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_saved_jobs" ON public."saved_jobs";
CREATE POLICY "company_members_update_saved_jobs" ON public."saved_jobs"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_delete_price_files" ON public."supplier_price_files";
CREATE POLICY "company_members_delete_price_files" ON public."supplier_price_files"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_price_files" ON public."supplier_price_files";
CREATE POLICY "company_members_insert_price_files" ON public."supplier_price_files"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_price_files" ON public."supplier_price_files";
CREATE POLICY "company_members_select_price_files" ON public."supplier_price_files"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_price_files" ON public."supplier_price_files";
CREATE POLICY "company_members_update_price_files" ON public."supplier_price_files"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_delete_price_rows" ON public."supplier_price_rows";
CREATE POLICY "company_members_delete_price_rows" ON public."supplier_price_rows"
  FOR DELETE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_insert_price_rows" ON public."supplier_price_rows";
CREATE POLICY "company_members_insert_price_rows" ON public."supplier_price_rows"
  FOR INSERT
  TO public
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_select_price_rows" ON public."supplier_price_rows";
CREATE POLICY "company_members_select_price_rows" ON public."supplier_price_rows"
  FOR SELECT
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "company_members_update_price_rows" ON public."supplier_price_rows";
CREATE POLICY "company_members_update_price_rows" ON public."supplier_price_rows"
  FOR UPDATE
  TO public
  USING ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))))
  WITH CHECK ((company_id = ( SELECT users.company_id
   FROM users
  WHERE (users.id = (select auth.uid())))));

DROP POLICY IF EXISTS "manage_tasks_for_accessible_projects" ON public."tasks";
CREATE POLICY "manage_tasks_for_accessible_projects" ON public."tasks"
  FOR ALL
  TO public
  USING ((has_project_access(project_id) AND ((select is_company_admin()) OR (EXISTS ( SELECT 1
   FROM project_members pm
  WHERE ((pm.project_id = tasks.project_id) AND (pm.user_id = (select auth.uid())) AND (pm.access_level = ANY (ARRAY['write'::text, 'manager'::text]))))))));

DROP POLICY IF EXISTS "managers_delete_company_time_entries" ON public."time_entries";
CREATE POLICY "managers_delete_company_time_entries" ON public."time_entries"
  FOR DELETE
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "managers_update_company_time_entries" ON public."time_entries";
CREATE POLICY "managers_update_company_time_entries" ON public."time_entries"
  FOR UPDATE
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())))
  WITH CHECK (((company_id = (select get_current_company_id())) AND (select is_company_manager_or_admin())));

DROP POLICY IF EXISTS "users_manage_own_time_entries" ON public."time_entries";
CREATE POLICY "users_manage_own_time_entries" ON public."time_entries"
  FOR ALL
  TO public
  USING (((company_id = (select get_current_company_id())) AND (user_id = (select auth.uid())) AND has_project_access(project_id)))
  WITH CHECK (((company_id = (select get_current_company_id())) AND (user_id = (select auth.uid())) AND has_project_access(project_id)));

DROP POLICY IF EXISTS "view_time_entries_for_accessible_projects" ON public."time_entries";
CREATE POLICY "view_time_entries_for_accessible_projects" ON public."time_entries"
  FOR SELECT
  TO public
  USING (((company_id = (select get_current_company_id())) AND has_project_access(project_id) AND ((user_id = (select auth.uid())) OR (select is_company_manager_or_admin()))));

DROP POLICY IF EXISTS "tripletex_connections_manage" ON public."tripletex_connections";
CREATE POLICY "tripletex_connections_manage" ON public."tripletex_connections"
  FOR ALL
  TO public
  USING (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR (( SELECT users.role
   FROM users
  WHERE (users.id = (select auth.uid()))) = 'manager'::text))))
  WITH CHECK (((company_id = (select get_current_company_id())) AND ((select is_company_admin()) OR (( SELECT users.role
   FROM users
  WHERE (users.id = (select auth.uid()))) = 'manager'::text))));

DROP POLICY IF EXISTS "tripletex_connections_select" ON public."tripletex_connections";
CREATE POLICY "tripletex_connections_select" ON public."tripletex_connections"
  FOR SELECT
  TO public
  USING ((company_id = (select get_current_company_id())));

DROP POLICY IF EXISTS "owner_manage_profile" ON public."user_profiles";
CREATE POLICY "owner_manage_profile" ON public."user_profiles"
  FOR ALL
  TO public
  USING ((user_id = (select auth.uid())))
  WITH CHECK ((user_id = (select auth.uid())));

DROP POLICY IF EXISTS "admins_manage_user_roles" ON public."user_roles";
CREATE POLICY "admins_manage_user_roles" ON public."user_roles"
  FOR ALL
  TO public
  USING ((select is_company_admin()))
  WITH CHECK ((select is_company_admin()));

DROP POLICY IF EXISTS "view_company_user_roles" ON public."user_roles";
CREATE POLICY "view_company_user_roles" ON public."user_roles"
  FOR SELECT
  TO public
  USING ((EXISTS ( SELECT 1
   FROM (users u
     JOIN roles r ON ((r.id = user_roles.role_id)))
  WHERE ((u.id = user_roles.user_id) AND (u.company_id = (select get_current_company_id())) AND (r.company_id = (select get_current_company_id()))))));

DROP POLICY IF EXISTS "admins_manage_users" ON public."users";
CREATE POLICY "admins_manage_users" ON public."users"
  FOR ALL
  TO public
  USING (((company_id = (select get_current_company_id())) AND (select is_company_admin())));

DROP POLICY IF EXISTS "allow_user_insert" ON public."users";
CREATE POLICY "allow_user_insert" ON public."users"
  FOR INSERT
  TO authenticated
  WITH CHECK (((select auth.uid()) = id));

DROP POLICY IF EXISTS "users_update_themselves" ON public."users";
CREATE POLICY "users_update_themselves" ON public."users"
  FOR UPDATE
  TO public
  USING ((id = (select auth.uid())));

DROP POLICY IF EXISTS "view_users_in_same_company" ON public."users";
CREATE POLICY "view_users_in_same_company" ON public."users"
  FOR SELECT
  TO public
  USING (((id = (select auth.uid())) OR ((company_id IS NOT NULL) AND (company_id = (select get_current_company_id())))));

DROP POLICY IF EXISTS "Users can upload message attachments" ON storage."objects";
CREATE POLICY "Users can upload message attachments" ON storage."objects"
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'message_attachments'::text) AND ((storage.foldername(name))[1] = ((select get_current_company_id()))::text)));

DROP POLICY IF EXISTS "Users can view message attachments" ON storage."objects";
CREATE POLICY "Users can view message attachments" ON storage."objects"
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'message_attachments'::text) AND ((storage.foldername(name))[1] = ((select get_current_company_id()))::text)));

DROP POLICY IF EXISTS "documents_bucket_owner_delete" ON storage."objects";
CREATE POLICY "documents_bucket_owner_delete" ON storage."objects"
  FOR DELETE
  TO public
  USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

DROP POLICY IF EXISTS "documents_bucket_owner_insert" ON storage."objects";
CREATE POLICY "documents_bucket_owner_insert" ON storage."objects"
  FOR INSERT
  TO public
  WITH CHECK (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

DROP POLICY IF EXISTS "documents_bucket_owner_select" ON storage."objects";
CREATE POLICY "documents_bucket_owner_select" ON storage."objects"
  FOR SELECT
  TO public
  USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

DROP POLICY IF EXISTS "documents_bucket_owner_update" ON storage."objects";
CREATE POLICY "documents_bucket_owner_update" ON storage."objects"
  FOR UPDATE
  TO public
  USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)))
  WITH CHECK (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ((select auth.uid()))::text)));

DROP POLICY IF EXISTS "hms_avvik_delete" ON storage."objects";
CREATE POLICY "hms_avvik_delete" ON storage."objects"
  FOR DELETE
  TO authenticated
  USING (((bucket_id = 'hms_avvik'::text) AND (owner = (select auth.uid()))));

DROP POLICY IF EXISTS "hms_avvik_insert" ON storage."objects";
CREATE POLICY "hms_avvik_insert" ON storage."objects"
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'hms_avvik'::text) AND ((storage.foldername(name))[1] = ((select get_current_company_id()))::text)));

DROP POLICY IF EXISTS "hms_avvik_select" ON storage."objects";
CREATE POLICY "hms_avvik_select" ON storage."objects"
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'hms_avvik'::text) AND ((storage.foldername(name))[1] = ((select get_current_company_id()))::text)));

DROP POLICY IF EXISTS "ks_checklists_delete" ON storage."objects";
CREATE POLICY "ks_checklists_delete" ON storage."objects"
  FOR DELETE
  TO authenticated
  USING (((bucket_id = 'ks_checklists'::text) AND (owner = (select auth.uid()))));

DROP POLICY IF EXISTS "ks_checklists_insert" ON storage."objects";
CREATE POLICY "ks_checklists_insert" ON storage."objects"
  FOR INSERT
  TO authenticated
  WITH CHECK (((bucket_id = 'ks_checklists'::text) AND ((storage.foldername(name))[1] = ((select get_current_company_id()))::text)));

DROP POLICY IF EXISTS "ks_checklists_select" ON storage."objects";
CREATE POLICY "ks_checklists_select" ON storage."objects"
  FOR SELECT
  TO authenticated
  USING (((bucket_id = 'ks_checklists'::text) AND ((storage.foldername(name))[1] = ((select get_current_company_id()))::text)));
