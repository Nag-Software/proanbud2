-- ============================================================================
-- 53_kjorebok_same_company.sql
-- ----------------------------------------------------------------------------
-- Defense-in-depth multi-tenant guard for kjorebok_trips.
--
-- kjorebok_trips.driver_user_id / project_id / vehicle_id are plain FKs. FK
-- validation runs as table owner and does NOT respect RLS, and the RLS WITH CHECK
-- only constrains company_id (the caller's own company). So a manager could craft
-- a trip whose driver/project/vehicle id points at ANOTHER tenant's row: the FK
-- exists and company_id is their own, so the insert/update would succeed and
-- persist a cross-tenant reference (corrupting relational integrity and
-- mis-attributing mileage). RLS is the company boundary but it does not constrain
-- these FK targets — this trigger does.
--
-- Idempotent: safe to re-run.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.kjorebok_trips_same_company()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.driver_user_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = NEW.driver_user_id AND u.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'driver_user_id % does not belong to company %', NEW.driver_user_id, NEW.company_id;
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'project_id % does not belong to company %', NEW.project_id, NEW.company_id;
  END IF;

  IF NEW.vehicle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.kjorebok_vehicles v
    WHERE v.id = NEW.vehicle_id AND v.company_id = NEW.company_id
  ) THEN
    RAISE EXCEPTION 'vehicle_id % does not belong to company %', NEW.vehicle_id, NEW.company_id;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_kjorebok_trips_same_company ON public.kjorebok_trips;
CREATE TRIGGER trg_kjorebok_trips_same_company
  BEFORE INSERT OR UPDATE ON public.kjorebok_trips
  FOR EACH ROW EXECUTE FUNCTION public.kjorebok_trips_same_company();
