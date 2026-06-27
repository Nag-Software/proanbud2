-- ============================================================================
-- 51_kjorebok.sql
-- ----------------------------------------------------------------------------
-- Kjørebok (mileage/driving log). Paid à-la-carte module "kjorebok".
--
-- Two tables:
--   kjorebok_vehicles — company car register (Skatteetaten: which car drove the
--                       trip; gives rate/fuel context).
--   kjorebok_trips    — the core kjørebok entry (date, from/to, distance,
--                       purpose, business/private classification, statens-sats
--                       amount, simplified route polyline, Tripletex sync status).
--
-- Route geometry is stored as a JSONB array of [lng,lat] pairs on the trip row
-- (feeds straight into a MapLibre GeoJSON LineString — no PostGIS needed).
--
-- Phase 2 (Expo background auto-tracking) can later add a `kjorebok_waypoints`
-- table for the raw high-frequency trace WITHOUT changing this schema: `source`
-- already reserves room for 'auto', and times/odometer are nullable.
--
-- Tenant model mirrors timeføring: RLS is the company boundary; the worker-vs-
-- manager "see only my own trips" narrowing is enforced in the server actions
-- (canManageProjects + driver_user_id filter), not in RLS.
--
-- The canonical Tripletex id mapping lives in external_entity_links
-- (entity_type='kjorebok_trip'); the tripletex_* columns below are a denormalized
-- mirror so a trip row renders its status + deep link without a join.
--
-- Idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- kjorebok_vehicles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kjorebok_vehicles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,                       -- "Hvit VW Crafter"
  registration    TEXT,                                -- plate, e.g. "EL12345"
  fuel_type       TEXT CHECK (fuel_type IS NULL OR fuel_type IN
                    ('electric','diesel','petrol','hybrid','hydrogen','other')),
  default_driver  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  notes           TEXT,
  created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kjorebok_vehicles_company ON public.kjorebok_vehicles(company_id);

ALTER TABLE public.kjorebok_vehicles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_kjorebok_vehicles ON public.kjorebok_vehicles;
CREATE POLICY company_members_select_kjorebok_vehicles
  ON public.kjorebok_vehicles FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_insert_kjorebok_vehicles ON public.kjorebok_vehicles;
CREATE POLICY company_members_insert_kjorebok_vehicles
  ON public.kjorebok_vehicles FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_update_kjorebok_vehicles ON public.kjorebok_vehicles;
CREATE POLICY company_members_update_kjorebok_vehicles
  ON public.kjorebok_vehicles FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_delete_kjorebok_vehicles ON public.kjorebok_vehicles;
CREATE POLICY company_members_delete_kjorebok_vehicles
  ON public.kjorebok_vehicles FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

-- ---------------------------------------------------------------------------
-- kjorebok_trips
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.kjorebok_trips (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id       UUID REFERENCES public.projects(id) ON DELETE SET NULL,        -- nullable: a trip may have no project
  driver_user_id   UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,  -- whose allowance this is → Tripletex employee
  vehicle_id       UUID REFERENCES public.kjorebok_vehicles(id) ON DELETE SET NULL,

  trip_date        DATE NOT NULL,
  start_time       TIMESTAMPTZ,
  end_time         TIMESTAMPTZ,

  from_address     TEXT,
  from_lat         DOUBLE PRECISION,
  from_lng         DOUBLE PRECISION,
  to_address       TEXT,
  to_lat           DOUBLE PRECISION,
  to_lng           DOUBLE PRECISION,

  distance_km      NUMERIC(8,2) NOT NULL DEFAULT 0 CHECK (distance_km >= 0),

  purpose          TEXT,                                -- "Befaring Storgata 4"
  classification   TEXT NOT NULL DEFAULT 'business'
                     CHECK (classification IN ('business','private')),
  passengers       INTEGER NOT NULL DEFAULT 0 CHECK (passengers >= 0),
  anleggsvei       BOOLEAN NOT NULL DEFAULT false,      -- forest/construction road (+1 NOK/km)

  -- Rate snapshot at save time so historical trips don't change when the yearly
  -- statens-sats is updated. amount = distance_km * (base + passengers + anleggsvei).
  rate_nok_per_km  NUMERIC(6,2) NOT NULL DEFAULT 0,
  amount_nok       NUMERIC(10,2) NOT NULL DEFAULT 0,

  odometer_start   INTEGER CHECK (odometer_start IS NULL OR odometer_start >= 0),
  odometer_end     INTEGER CHECK (odometer_end   IS NULL OR odometer_end   >= 0),

  -- Simplified polyline: JSONB array of [lng,lat] pairs (GeoJSON order).
  route_geometry   JSONB,

  notes            TEXT,
  source           TEXT NOT NULL DEFAULT 'manual'
                     CHECK (source IN ('manual','gps')),   -- 'auto' reserved for phase 2

  -- Tripletex reiseregning sync mirror. Canonical id mapping lives in
  -- external_entity_links (entity_type='kjorebok_trip').
  tripletex_status     TEXT NOT NULL DEFAULT 'not_synced'
                         CHECK (tripletex_status IN ('not_synced','pending','synced','failed','blocked')),
  tripletex_external_id  BIGINT,
  tripletex_external_url TEXT,
  tripletex_synced_at    TIMESTAMPTZ,
  tripletex_last_error   TEXT,

  created_by       UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kjorebok_trips_company       ON public.kjorebok_trips(company_id);
CREATE INDEX IF NOT EXISTS idx_kjorebok_trips_project       ON public.kjorebok_trips(project_id);
CREATE INDEX IF NOT EXISTS idx_kjorebok_trips_driver        ON public.kjorebok_trips(driver_user_id);
CREATE INDEX IF NOT EXISTS idx_kjorebok_trips_date          ON public.kjorebok_trips(trip_date DESC);
CREATE INDEX IF NOT EXISTS idx_kjorebok_trips_company_date  ON public.kjorebok_trips(company_id, trip_date DESC);
-- Partial index for the sync worker scanning rows that still need pushing.
CREATE INDEX IF NOT EXISTS idx_kjorebok_trips_tripletex_pending
  ON public.kjorebok_trips(company_id) WHERE tripletex_status IN ('pending','failed');

ALTER TABLE public.kjorebok_trips ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_members_select_kjorebok_trips ON public.kjorebok_trips;
CREATE POLICY company_members_select_kjorebok_trips
  ON public.kjorebok_trips FOR SELECT
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_insert_kjorebok_trips ON public.kjorebok_trips;
CREATE POLICY company_members_insert_kjorebok_trips
  ON public.kjorebok_trips FOR INSERT
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_update_kjorebok_trips ON public.kjorebok_trips;
CREATE POLICY company_members_update_kjorebok_trips
  ON public.kjorebok_trips FOR UPDATE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()))
  WITH CHECK (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS company_members_delete_kjorebok_trips ON public.kjorebok_trips;
CREATE POLICY company_members_delete_kjorebok_trips
  ON public.kjorebok_trips FOR DELETE
  USING (company_id = (SELECT company_id FROM public.users WHERE id = auth.uid()));
