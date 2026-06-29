-- Project geofences: one stored geofence per project, used by the map and (later)
-- by the native background-tracking layer. Preferably the real cadastral property
-- boundary (matrikkel/teig) from Kartverket's open Eiendom-API, stored as a GeoJSON
-- MultiPolygon in WGS84; falls back to a 100 m circle when no boundary is found.
-- See lib/geo/eiendom.ts + lib/geo/project-geofence.ts.

CREATE TABLE IF NOT EXISTS public.project_geofences (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id      UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  label           TEXT,
  geofence_kind   TEXT NOT NULL DEFAULT 'circle' CHECK (geofence_kind IN ('polygon', 'circle')),
  center_lat      DOUBLE PRECISION,
  center_lng      DOUBLE PRECISION,
  radius_m        INTEGER NOT NULL DEFAULT 100,
  polygon         JSONB,                     -- GeoJSON Polygon/MultiPolygon (WGS84) when geofence_kind='polygon'
  matrikkel_kommunenr TEXT,
  gnr             INTEGER,
  bnr             INTEGER,
  festenr         INTEGER,
  polygon_source  TEXT,                      -- 'eiendom-api' | 'manuell'
  srid            INTEGER NOT NULL DEFAULT 4326,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  -- One geofence per project for now (upsert on project_id).
  UNIQUE (project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_geofences_company ON public.project_geofences (company_id);

ALTER TABLE public.project_geofences ENABLE ROW LEVEL SECURITY;

-- Any company member may read (the map page is gated to admin/manager at the app
-- layer); only managers/admins may write. Writes from server actions use the
-- service-role client and bypass RLS, but the policy keeps direct access safe.
DROP POLICY IF EXISTS project_geofences_select ON public.project_geofences;
CREATE POLICY project_geofences_select ON public.project_geofences
  FOR SELECT
  USING (company_id = public.get_current_company_id());

DROP POLICY IF EXISTS project_geofences_write ON public.project_geofences;
CREATE POLICY project_geofences_write ON public.project_geofences
  FOR ALL
  USING (company_id = public.get_current_company_id() AND public.is_company_manager_or_admin())
  WITH CHECK (company_id = public.get_current_company_id() AND public.is_company_manager_or_admin());
