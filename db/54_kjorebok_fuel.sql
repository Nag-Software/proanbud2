-- ============================================================================
-- 54_kjorebok_fuel.sql
-- ----------------------------------------------------------------------------
-- Drivstoffutgifter (fuel cost) for the kjørebok module.
--
--   kjorebok_vehicles.fuel_consumption_l_per_mil
--       Vehicle fuel consumption in LITER PER MIL (1 mil = 10 km) — the unit
--       Norwegian drivers think in ("0,8 på mila"). Combined with the fuel type
--       it lets the trip form estimate fuel cost.
--
--   kjorebok_trips.fuel_*  — a SNAPSHOT taken at save time, mirroring how
--       rate_nok_per_km/amount_nok snapshot the statens-sats. Historical trips
--       must not shift when a vehicle's consumption or the fuel price later
--       changes, so we persist the inputs (consumption, price/liter) alongside
--       the computed cost rather than re-deriving on read.
--
--   Fuel price is a simplified flat 18 kr/liter for combustion fuels
--       (bensin/diesel/hybrid); electric/hydrogen/other are not priced per
--       liter and get fuel_cost_nok = 0. See lib/kjorebok/fuel.ts.
--
-- Idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE public.kjorebok_vehicles
  ADD COLUMN IF NOT EXISTS fuel_consumption_l_per_mil NUMERIC(5,2)
    CHECK (fuel_consumption_l_per_mil IS NULL OR fuel_consumption_l_per_mil >= 0);

ALTER TABLE public.kjorebok_trips
  ADD COLUMN IF NOT EXISTS fuel_consumption_l_per_mil NUMERIC(5,2)
    CHECK (fuel_consumption_l_per_mil IS NULL OR fuel_consumption_l_per_mil >= 0),
  ADD COLUMN IF NOT EXISTS fuel_price_nok_per_liter NUMERIC(8,2)
    CHECK (fuel_price_nok_per_liter IS NULL OR fuel_price_nok_per_liter >= 0),
  ADD COLUMN IF NOT EXISTS fuel_cost_nok NUMERIC(10,2) NOT NULL DEFAULT 0
    CHECK (fuel_cost_nok >= 0);
