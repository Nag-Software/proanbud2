-- Kart: geographic coordinates for projects + customers so they can be pinned on
-- the new /kart map page. Projects gain an explicit SITE address (the create
-- wizard collects a location today but never persists it); customers already
-- have an address but no coordinates. Coordinates are WGS84 (EPSG:4326), stored
-- as double precision lon/lat, filled by geocoding via Kartverket
-- (see lib/geo/geocode.ts). RLS is inherited from the existing tables.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS site_address TEXT,
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS lng DOUBLE PRECISION;

-- Partial indexes so "which rows are already geocoded" scans stay cheap.
CREATE INDEX IF NOT EXISTS idx_projects_company_coords
  ON public.projects (company_id)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_company_coords
  ON public.customers (company_id)
  WHERE lat IS NOT NULL AND lng IS NOT NULL;
