-- 13_normal_prices.sql
-- Referansepriser per m² for ulike prosjekttyper (hurtigoversikt for kalkyle-KI).

CREATE TABLE IF NOT EXISTS public.normal_prices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_type TEXT NOT NULL,
  slug TEXT NOT NULL,
  price_low_nok NUMERIC(12, 2) NOT NULL,
  price_normal_nok NUMERIC(12, 2) NOT NULL,
  price_high_nok NUMERIC(12, 2) NOT NULL,
  typical_total_min_nok NUMERIC(14, 2),
  typical_total_max_nok NUMERIC(14, 2),
  unit TEXT NOT NULL DEFAULT 'm2',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_normal_prices_slug ON public.normal_prices(slug);
CREATE INDEX IF NOT EXISTS idx_normal_prices_project_type ON public.normal_prices(project_type);

ALTER TABLE public.normal_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS read_normal_prices ON public.normal_prices;
CREATE POLICY read_normal_prices
ON public.normal_prices
FOR SELECT
USING (true);

INSERT INTO public.normal_prices (
  project_type,
  slug,
  price_low_nok,
  price_normal_nok,
  price_high_nok,
  typical_total_min_nok,
  typical_total_max_nok,
  sort_order
)
VALUES
  ('Nybygg enebolig', 'nybygg-enebolig', 25000, 35000, 55000, 3600000, 11000000, 1),
  ('Tilbygg', 'tilbygg', 28000, 45000, 65000, 525000, 3250000, 2),
  ('Bad', 'bad', 35000, 55000, 80000, 160000, 960000, 3),
  ('Kjøkken', 'kjokken', 20000, 40000, 70000, 200000, 1400000, 4),
  ('Totalrenovering', 'totalrenovering', 12000, 25000, 40000, 1200000, 7200000, 5),
  ('Oppussing', 'oppussing', 6000, 15000, 25000, 400000, 3750000, 6),
  ('Garasje', 'garasje', 12000, 22000, 35000, 375000, 1750000, 7),
  ('Hytte', 'hytte', 20000, 35000, 50000, 1500000, 6000000, 8),
  ('Flipping', 'flipping', 5000, 12000, 20000, 300000, 2400000, 9)
ON CONFLICT (slug) DO UPDATE SET
  project_type = EXCLUDED.project_type,
  price_low_nok = EXCLUDED.price_low_nok,
  price_normal_nok = EXCLUDED.price_normal_nok,
  price_high_nok = EXCLUDED.price_high_nok,
  typical_total_min_nok = EXCLUDED.typical_total_min_nok,
  typical_total_max_nok = EXCLUDED.typical_total_max_nok,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
