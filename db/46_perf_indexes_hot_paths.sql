-- Composite indexes for the hottest read paths (speed audit, June 2026).
--
-- These COMPLEMENT the single-column indexes already in db/00 + db/43 by matching
-- the exact (filter, filter, sort) shape of the dashboard aggregates and the
-- project-list default sort, so Postgres can satisfy them from the index alone
-- instead of filtering a single-column index result then sorting in memory.
--
-- Pure additions: no schema/behaviour change, each IF NOT EXISTS (idempotent).
-- NOTE: at current production volume (offers/projects/tasks in the low dozens)
-- the planner will still seq-scan and these indexes go unused — they are
-- forward-looking, not a fix for today's felt latency (that is dominated by
-- network round-trips, addressed in the app layer). Ship them so reads stay flat
-- as data grows.
--
-- The migration runner wraps each file in a transaction, so CREATE INDEX
-- CONCURRENTLY is not used here. If any of these tables is already large in
-- production, build the matching index manually with CONCURRENTLY (outside a
-- transaction) instead of relying on this file.

-- offers: dashboard revenue/sent aggregates filter (company_id, status, created_at range)
CREATE INDEX IF NOT EXISTS idx_offers_company_status_created
  ON public.offers (company_id, status, created_at DESC);

-- offers: "Siste tilbud" / "Aktive tilbud" feeds (company_id + order by created_at)
CREATE INDEX IF NOT EXISTS idx_offers_company_created
  ON public.offers (company_id, created_at DESC);

-- projects: list page default sort (company_id + order by updated_at)
CREATE INDEX IF NOT EXISTS idx_projects_company_updated
  ON public.projects (company_id, updated_at DESC);

-- projects: dashboard active-project count/list (company_id, status, created_at)
CREATE INDEX IF NOT EXISTS idx_projects_company_status_created
  ON public.projects (company_id, status, created_at DESC);

-- tasks: Oppgaver tab created_at sort (project_id equality + order by created_at)
CREATE INDEX IF NOT EXISTS idx_tasks_project_created
  ON public.tasks (project_id, created_at DESC);

-- deviations: Avvik tab project-scoped list (project_id equality + order by created_at)
CREATE INDEX IF NOT EXISTS idx_deviations_project_created
  ON public.deviations (project_id, created_at DESC);
