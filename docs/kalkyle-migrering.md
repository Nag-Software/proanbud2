# Kalkylemodulen: skisse til databasemigrering

**Status: skisse. Ikke kjørt, og skal ikke kjøres uten gjennomgang.** Kalkylemodulen
(branch `kalkyle`) er i dag bare UI med mock-data i minnet (`KalkyleProvider`).
Dette er forslaget til tabellene som erstatter mocken. Neste ledige nummer er
**db/118** (siste er `117_project_models_100mb.sql`). Sjekk igjen før det skrives, fordi
andre brancher kan ha tatt nummeret.

## Modellen

```
prosjekt (projects)
 └─ kalkyler                 «Bad 6 m²», «Kjøkken» … (flere per prosjekt = delprosjekter)
     ├─ kalkyle_poster       «Riving og rigg», «Membran og fliser» …
     │   └─ kalkyle_linjer   timer · materiell · underentreprenør · fast jobb
     └─ kalkyle_tilbud       v1, v2, «Alternativ B» … (frosne kopier, ett kan signeres)
           └─ offers         dagens tilbud (utsending, åpnet, aksept) peker hit

kalkyle_maler                «Bad komplett», «Terrasse» … (Mine priser → Kalkylemaler)
 └─ kalkyle_mal_poster → kalkyle_mal_linjer   mengde = fast + per_enhet × parameter

time_entries.kalkyle_post_id            ┐ etterkalkyle per post
project_material_costs.kalkyle_post_id  ┘
```

Typene ligger i `lib/kalkyle/types.ts`, og tabellene følger dem felt for felt.

## Prinsipper (fra tidligere migreringer)

- `company_id NOT NULL` på alle tabeller. Kobling til forelder med **sammensatt FK**
  `(forelder_id, company_id)`, som i db/115, så en rad aldri kan peke på en annen
  bedrifts data, heller ikke ved skriving med service role.
- **Aldri sammensatt primærnøkkel av FK-er** (PGRST201, db/106). Bruk `id UUID PRIMARY KEY`
  og en egen `UNIQUE (id, company_id)`.
- RLS på alt, alltid med `(SELECT public.get_current_company_id())` og
  `(SELECT public.is_company_manager_or_admin())` (initplan, db/69). Restriktiv
  `active_authenticated_user` som på de andre tabellene.
- **Kalkyler, priser og påslag er tall håndverkeren ikke skal se** (samme grense som
  Lønnsomhet). Lesing og skriving bare for leder og admin.
- Beløp `NUMERIC(14, 2)`, mengder og timer `NUMERIC(12, 3)`. Ingen avrunding i
  databasen, bare i visningen (`lib/kalkyle/format.ts`).
- Idempotent: `IF NOT EXISTS`, `DROP POLICY IF EXISTS`. Trygg å kjøre flere ganger.

## db/118_kalkyler.sql (utkast)

```sql
-- 118_kalkyler.sql
-- Kalkylemodulen: kalkyler per prosjekt med poster og linjer, tilbud som frosne
-- kopier, maler, og post på timer/innkjøp for etterkalkyle per post.
-- Safe to run repeatedly.

CREATE UNIQUE INDEX IF NOT EXISTS projects_id_company_uidx ON public.projects (id, company_id);

-- ── Kalkyler ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kalkyler (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  project_id            UUID NOT NULL,
  navn                  TEXT NOT NULL DEFAULT 'Kalkyle' CHECK (length(navn) BETWEEN 1 AND 120),
  rekkefolge            INT NOT NULL DEFAULT 0,
  -- Prising (kalkylens standard; linjer kan overstyre påslag og timepris)
  timesats              NUMERIC(14, 2) NOT NULL CHECK (timesats >= 0),
  intern_kost_per_time  NUMERIC(14, 2) NOT NULL CHECK (intern_kost_per_time >= 0),
  paslag_materiell      NUMERIC(6, 2) NOT NULL DEFAULT 15,
  paslag_ue             NUMERIC(6, 2) NOT NULL DEFAULT 10,
  -- Malen den ble laget fra (for «Oppdater malen» i etterkalkylen)
  mal_id                UUID REFERENCES public.kalkyle_maler(id) ON DELETE SET NULL,  -- se rekkefølge under
  mal_parameter         NUMERIC(12, 3),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by            UUID REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT kalkyler_project_company_fkey
    FOREIGN KEY (project_id, company_id) REFERENCES public.projects (id, company_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS kalkyler_id_company_uidx ON public.kalkyler (id, company_id);
CREATE INDEX IF NOT EXISTS kalkyler_project_idx ON public.kalkyler (company_id, project_id, rekkefolge);

-- ── Poster ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kalkyle_poster (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  kalkyle_id  UUID NOT NULL,
  navn        TEXT NOT NULL DEFAULT 'Ny post',
  rekkefolge  INT NOT NULL DEFAULT 0,
  CONSTRAINT kalkyle_poster_kalkyle_fkey
    FOREIGN KEY (kalkyle_id, company_id) REFERENCES public.kalkyler (id, company_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS kalkyle_poster_id_company_uidx ON public.kalkyle_poster (id, company_id);
CREATE INDEX IF NOT EXISTS kalkyle_poster_kalkyle_idx ON public.kalkyle_poster (kalkyle_id, rekkefolge);

-- ── Linjer ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kalkyle_linjer (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL,
  post_id          UUID NOT NULL,
  rekkefolge       INT NOT NULL DEFAULT 0,       -- dra-og-slipp
  beskrivelse      TEXT NOT NULL DEFAULT '',
  type             TEXT NOT NULL CHECK (type IN ('arbeid', 'materiell', 'ue', 'jobb')),
  antall           NUMERIC(12, 3) NOT NULL DEFAULT 1 CHECK (antall >= 0),
  enhet            TEXT NOT NULL CHECK (enhet IN ('t', 'stk', 'm²', 'lm', 'sett', 'rull', 'pall', 'rs')),
  innpris          NUMERIC(14, 2) CHECK (innpris >= 0),          -- materiell/UE; null for arbeid og jobb
  paslag           NUMERIC(6, 2),                                -- null = kalkylens påslag
  -- Timepris: kopi (snapshot) som på tilbudslinjer, så kalkylen står fast om
  -- timeprisen i Mine priser endres eller slettes. hourly_rate_id er bare sporing.
  hourly_rate_id   UUID REFERENCES public.hourly_rates(id) ON DELETE SET NULL,
  timepris_navn    TEXT,
  timepris_sats    NUMERIC(14, 2),
  timepris_kost    NUMERIC(14, 2),
  -- Fast jobb (Lagrede jobber): kunden betaler fastpris, kost = timer × intern kost
  saved_job_id     UUID REFERENCES public.saved_jobs(id) ON DELETE SET NULL,
  fastpris         NUMERIC(14, 2) CHECK (fastpris >= 0),
  timer_per_enhet  NUMERIC(12, 3),
  -- SmartKI: prisen er et anslag, ikke fra prisfil. Aldri synlig for kunden.
  anslag           BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT kalkyle_linjer_post_fkey
    FOREIGN KEY (post_id, company_id) REFERENCES public.kalkyle_poster (id, company_id) ON DELETE CASCADE,
  CONSTRAINT kalkyle_linjer_pris_check CHECK (
    (type IN ('materiell', 'ue') AND innpris IS NOT NULL)
    OR (type = 'jobb' AND fastpris IS NOT NULL)
    OR type = 'arbeid'
  )
);
CREATE INDEX IF NOT EXISTS kalkyle_linjer_post_idx ON public.kalkyle_linjer (post_id, rekkefolge);

-- ── Tilbud fra kalkylen (frosne kopier) ──────────────────────────────────
-- Hele kalkylen lagres som jsonb (`Kalkyle` i TilbudSnapshot, lib/kalkyle/types.ts), ikke
-- som rader: et sendt tilbud skal aldri endre seg når kalkylen endres etterpå,
-- og etterkalkylen måler mot nettopp denne kopien.
CREATE TABLE IF NOT EXISTS public.kalkyle_tilbud (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    UUID NOT NULL,
  kalkyle_id    UUID NOT NULL,
  versjon       INT NOT NULL CHECK (versjon > 0),
  navn          TEXT NOT NULL,                  -- «v1», «Alternativ B»
  status        TEXT NOT NULL DEFAULT 'utkast' CHECK (status IN ('utkast', 'sendt', 'signert', 'avvist')),
  kalkyle       JSONB NOT NULL,
  detaljniva    TEXT NOT NULL CHECK (detaljniva IN ('total', 'post', 'linje')),
  vis_timer     BOOLEAN NOT NULL DEFAULT true,
  offer_id      UUID REFERENCES public.offers(id) ON DELETE SET NULL,   -- utsending, åpnet, aksept
  sendt_at      TIMESTAMPTZ,
  signert_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by    UUID REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT kalkyle_tilbud_kalkyle_fkey
    FOREIGN KEY (kalkyle_id, company_id) REFERENCES public.kalkyler (id, company_id) ON DELETE CASCADE,
  CONSTRAINT kalkyle_tilbud_versjon_uniq UNIQUE (kalkyle_id, versjon)
);
-- Bare ett signert tilbud per kalkyle.
CREATE UNIQUE INDEX IF NOT EXISTS kalkyle_tilbud_ett_signert_uidx
  ON public.kalkyle_tilbud (kalkyle_id) WHERE status = 'signert';

-- Et signert tilbud er låst: kopien, valgene og statusen kan ikke endres.
CREATE OR REPLACE FUNCTION public.kalkyle_tilbud_las() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.status = 'signert' AND (
    NEW.kalkyle IS DISTINCT FROM OLD.kalkyle
    OR NEW.detaljniva IS DISTINCT FROM OLD.detaljniva
    OR NEW.vis_timer IS DISTINCT FROM OLD.vis_timer
    OR NEW.status IS DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'Et signert tilbud kan ikke endres';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS kalkyle_tilbud_las_trg ON public.kalkyle_tilbud;
CREATE TRIGGER kalkyle_tilbud_las_trg BEFORE UPDATE ON public.kalkyle_tilbud
  FOR EACH ROW EXECUTE FUNCTION public.kalkyle_tilbud_las();

-- ── Maler (Mine priser → Kalkylemaler) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.kalkyle_maler (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  navn              TEXT NOT NULL,
  parameter_navn    TEXT NOT NULL CHECK (parameter_navn IN ('Areal', 'Antall', 'Løpemeter')),
  parameter_enhet   TEXT NOT NULL,
  parameter_standard NUMERIC(12, 3) NOT NULL,
  parameter_min     NUMERIC(12, 3) NOT NULL,
  parameter_max     NUMERIC(12, 3) NOT NULL,
  parameter_steg    NUMERIC(12, 3) NOT NULL DEFAULT 1,
  brukt_antall      INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS kalkyle_maler_id_company_uidx ON public.kalkyle_maler (id, company_id);

CREATE TABLE IF NOT EXISTS public.kalkyle_mal_poster (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  UUID NOT NULL,
  mal_id      UUID NOT NULL,
  navn        TEXT NOT NULL,
  rekkefolge  INT NOT NULL DEFAULT 0,
  CONSTRAINT kalkyle_mal_poster_mal_fkey
    FOREIGN KEY (mal_id, company_id) REFERENCES public.kalkyle_maler (id, company_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS kalkyle_mal_poster_id_company_uidx ON public.kalkyle_mal_poster (id, company_id);

CREATE TABLE IF NOT EXISTS public.kalkyle_mal_linjer (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id       UUID NOT NULL,
  mal_post_id      UUID NOT NULL,
  rekkefolge       INT NOT NULL DEFAULT 0,
  beskrivelse      TEXT NOT NULL,
  type             TEXT NOT NULL CHECK (type IN ('arbeid', 'materiell', 'ue', 'jobb')),
  enhet            TEXT NOT NULL,
  mengde_fast      NUMERIC(12, 3) NOT NULL DEFAULT 0,   -- mengde = fast + per_enhet × parameter
  mengde_per_enhet NUMERIC(12, 3) NOT NULL DEFAULT 0,
  innpris          NUMERIC(14, 2),
  fastpris         NUMERIC(14, 2),
  timer_per_enhet  NUMERIC(12, 3),
  CONSTRAINT kalkyle_mal_linjer_post_fkey
    FOREIGN KEY (mal_post_id, company_id) REFERENCES public.kalkyle_mal_poster (id, company_id) ON DELETE CASCADE
);

-- ── Etterkalkyle per post ────────────────────────────────────────────────
-- Valgfri post på timer og innkjøp. Null = «ikke fordelt» (vises som egen rad).
ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS kalkyle_post_id UUID REFERENCES public.kalkyle_poster(id) ON DELETE SET NULL;
ALTER TABLE public.project_material_costs
  ADD COLUMN IF NOT EXISTS kalkyle_post_id UUID REFERENCES public.kalkyle_poster(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS time_entries_kalkyle_post_idx
  ON public.time_entries (kalkyle_post_id) WHERE kalkyle_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS project_material_costs_kalkyle_post_idx
  ON public.project_material_costs (kalkyle_post_id) WHERE kalkyle_post_id IS NOT NULL;

-- ── RLS (samme mønster på alle de sju tabellene) ─────────────────────────
ALTER TABLE public.kalkyler ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS managers_all_kalkyler ON public.kalkyler;
CREATE POLICY managers_all_kalkyler ON public.kalkyler
  FOR ALL TO authenticated
  USING (
    company_id = (SELECT public.get_current_company_id())
    AND (SELECT public.is_company_manager_or_admin())
  )
  WITH CHECK (
    company_id = (SELECT public.get_current_company_id())
    AND (SELECT public.is_company_manager_or_admin())
  );
DROP POLICY IF EXISTS active_authenticated_user ON public.kalkyler;
CREATE POLICY active_authenticated_user ON public.kalkyler
  AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT public.is_active_user()))
  WITH CHECK ((SELECT public.is_active_user()));
-- … gjentas for kalkyle_poster, kalkyle_linjer, kalkyle_tilbud, kalkyle_maler,
--   kalkyle_mal_poster og kalkyle_mal_linjer.
```

**Rekkefølge i fila:** `kalkyle_maler` må opprettes før `kalkyler`, fordi `kalkyler.mal_id` peker på den. Utkastet over er sortert for lesbarhet, så flytt malblokken først når fila skrives.

## Åpne spørsmål før migreringen skrives

1. **Kobling til dagens tilbud.** Forslaget er at `kalkyle_tilbud.offer_id` peker på en
   rad i `offers`, som lages når tilbudet sendes. Da gjenbrukes utsending, «åpnet»,
   digital aksept og bevispakke uendret. Alternativet er en egen utsending, men det
   anbefales ikke.
2. **Aksept → signert.** Når kunden godtar `offers`-raden, må `kalkyle_tilbud.status`
   bli `signert` (i aksept-actionen eller med en trigger). Tilbud som var sendt på samme
   kalkyle bør bli `avvist`.
3. **Omsetning i lønnsomheten.** `getProjectProfitability` regner omsetning fra aksepterte
   `offers`. Det fortsetter å virke hvis aksepten går via `offers`. Etterkalkyle per post
   leser i tillegg `kalkyle_tilbud.kalkyle` for den signerte kopien.
4. **Post på timer.** Håndverkeren velger post i timeføringen (valgfritt, med «Ikke
   fordelt» som standard), eller lederen fordeler etterpå. Det skal avklares i UI før
   kolonnen tas i bruk.
5. **Prosjekter uten kalkyle** (alle eksisterende og timeprisjobber) får ingen rader.
   Etterkalkyle viser da bare «Kostnader og innkjøp», som i dag.
6. **Maler fra eksempeldata.** De fem eksempelmalene (`MOCK_MALER`) bør ikke seedes
   inn hos alle bedrifter. Tilby «Start fra eksempel» i stedet.

## Utrulling

1. Skriv `db/118_kalkyler.sql` fra utkastet, og kjør den i en Supabase-branch først
   (`get_advisors` for RLS og ytelse).
2. Koble `KalkyleProvider` til server actions (les og skriv per kalkyle), med
   `KalkyleOmrade` som laster prosjektets kalkyler i stedet for mocken.
3. Slå på `NEXT_PUBLIC_KALKYLE=on` for én testbedrift og sjekk Økonomi-aliasene.
4. Når flagget er på for alle: fjern `okonomi-tab.tsx` og den gamle tilbudstabellen
   (`NewOfferItemsTable`). Alias-oppføringene i `project-tab-aliases.ts` må **aldri**
   fjernes.
