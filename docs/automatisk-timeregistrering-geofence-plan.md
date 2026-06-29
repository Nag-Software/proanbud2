# Automatisk timeregistrering med geofence (GPS-tilstedeværelse) — plan & research

> **Status:** PLAN / RESEARCH (ingen kode skrevet). Utarbeidet 2026-06-29.
> **Mål:** At bedrifter slutter å tape penger på ufakturerte timer, ved at håndverkere
> automatisk registreres når de er på et prosjekt — svært nøyaktig, svært enkelt, og
> med automatikk som bærebjelke. **Lovlig i Norge** er en hard forutsetning, ikke en detalj.

---

## 0. TL;DR — de tre beslutningene som styrer alt

1. **Innramming (juridisk + markedsføring):** Bygg dette som **«elektronisk mannskapsliste +
   HMS-stempling via geofence»**, *ikke* som «GPS-sporing av ansatte». Tilstedeværelse på en
   *definert byggeplass* står juridisk langt sterkere enn å spore en persons bevegelser, og
   knytter seg til en plikt bedriften allerede har (byggherreforskriften §15). Samme
   forretningsresultat (korrekte fakturerbare timer), dramatisk lavere juridisk risiko.

2. **Teknologi:** Geofencing **må** ligge i det native laget i mobilappen
   (`react-native-background-geolocation`, transistorsoft, ~$399 engangslisens). WebView-en
   sover i bakgrunnen og kan ikke gjøre dette. Native SDK oppdager inn/ut → POST-er hendelsen
   til Supabase → web-appen er en tynn klient som bare *viser* status.

3. **Automatikkmodell (✅ VALGT 2026-06-30):** **«Auto-detektering, bekreftet timeliste».**
   Systemet oppdager inn/ut automatisk og fyller ut timelisten selv (håndverkeren rører
   ingenting — ingen stoppeklokke). Ett raskt bekreftelsestrykk fra håndverker + godkjenning fra
   leder før timene blir fakturerbare. Dette forener «automatikk er nøkkel» med «svært nøyaktig»
   og er det juridisk holdbare valget. (Vurderte alternativer: full automatikk uten bekreftelse,
   og «påminnelse → trykk for å stemple» — begge forkastet, se §11.)

---

## 1. Hvorfor dette er verdt å bygge

- Timeføring finnes allerede i ProAnbud (`time_entries`, start/stopp-timer, oversikter per
  prosjekt/ansatt, koblet til `hourly_rates` og job costing). Problemet er at den er **manuell**:
  håndverkere glemmer å stemple inn/ut, runder av, eller fører timer på feil prosjekt → bedriften
  taper fakturerbare timer.
- Markedet beviser etterspørselen: Hubstaff, Connecteam, QuickBooks Time (TSheets) og den
  bygg-spesifikke Workyard selger nettopp geofencet stempling som «slutt å tape timer +
  anti-buddy-punching».
- ProAnbud har allerede 80 % av fundamentet (se §3), så dette er en naturlig utvidelse av en
  **eksisterende betalt modul** (`timeforing`) — ikke et nytt produkt.

---

## 2. Den juridiske virkeligheten (styrer hele designet)

> Full kildebelagt gjennomgang er gjort; her er det operative. **Dette er ikke juridisk
> rådgivning** — før lansering må en norsk arbeidsretts-/personvernadvokat signere av
> interesseavveining + DPIA på det konkrete designet.

To regelverk gjelder **samtidig og kumulativt** — funksjonen må bestå **begge**:

- **(A) Arbeidsmiljøloven kap. 9 (kontrolltiltak):** *Har arbeidsgiver lov til å innføre tiltaket?*
  Krever **saklig grunn** (§9-1), **forholdsmessighet** (minst inngripende metode), og **§9-2**:
  **drøftingsplikt** med tillitsvalgte *før* innføring, **informasjonsplikt** (formål, praktiske
  konsekvenser, antatt varighet), og **jevnlig evaluering**.
- **(B) GDPR / personopplysningsloven:** *Har arbeidsgiver lov til å behandle dataene?*

### Hard-kravene som MÅ bygges inn i produktet

| # | Krav | Konsekvens for designet |
|---|------|--------------------------|
| 1 | **Ikke samtykke** som behandlingsgrunnlag — ugyldig i arbeidsforhold (maktubalanse). | Bygg på **berettiget interesse** + dokumentert **interesseavveining** (mal i produktet). Samtykke kan ikke trekkes tilbake og «velte» grunnlaget. |
| 2 | **Dataminimering** — kontinuerlig «brødsmule»-spor er *ikke* forsvarlig som standard. | Lagre **kun geofence inn/ut-hendelser** (+ aggregerte timer). Ingen løpende posisjonslogg. |
| 3 | **Forholdsmessighet / «privatsporing forbudt».** | **Kun i arbeidstid**, ansatt-styrt **AV-knapp** («privat-knapp»), **auto-av utenfor skift**. Ingen innsamling når man er av. |
| 4 | **Formålslås.** Data samlet for stempling kan *ikke* gjenbrukes til prestasjons-/disiplinkontroll. | Teknisk sperre mot gjenbruk. Dette er nøyaktig feilen Høyesterett felte arbeidsgiver for i **HR-2013-234-A (Avfallsservice/GPS-dommen)**. |
| 5 | **§9-2 drøfting + informasjon FØR aktivering.** | Innebygd «oppsett-veiviser» som *gater* aktivering bak logget drøfting + utsendt informasjonsskriv. (En bedrift fikk 100 000 kr i gebyr for å hoppe over dette.) |
| 6 | **DPIA obligatorisk** («systematisk monitorering av ansatte» står som eget punkt på Datatilsynets liste). | Lever en **DPIA-pakke/mal** kunden fyller ut. Salgsfordel *og* lovkrav. |
| 7 | **Kort lagringstid** på rådata + **innsyn/sletting** for den ansatte. | Auto-sletting av rå-hendelser (konfigurerbart, kort default). Aggregerte/godkjente timer beholdes lenger (bokføring). Innsyn er håndhevet — Timegrip fikk 250 000 kr for å nekte ansatte innsyn. |

### Det smarte grepet: byggherreforskriften §15

Byggherren er **allerede pålagt** å føre elektronisk **oversiktsliste** over alle på byggeplassen
(navn, fødselsdato, arbeidsgiver, HMS-kortnummer), oppdatert daglig, oppbevart 6 mnd. Dette er en
**rettslig forpliktelse** (GDPR art. 6(1)(c)). Viktig nyanse: oversiktslisten krever *ikke* at man
registrerer klokkeslett for når en person kommer/går. Men ved å posisjonere funksjonen som
**digital mannskapsliste/HMS-stempling**, står tilstedeværelses-loggingen på et mye tryggere
grunnlag, og *timene* blir et deklarert sekundærformål under berettiget interesse. Vi får begge
deler: lovlig tilstedeværelse + fakturerbare timer.

---

## 3. Hva finnes allerede i ProAnbud (gjenbruk)

| Byggekloss | Hvor | Hva vi gjenbruker |
|------------|------|-------------------|
| **Timeføring** | `db/17_*`, `db/18_*`, `app/timeforing/actions.ts`, `app/prosjekter/[id]/timeforing-tab.tsx`, `app/min-bedrift/timeforing/` | `time_entries` (project_id, user_id, company_id, started_at, ended_at, hours), start/stopp-økt, «én aktiv økt per bruker»-indeks, oversikter per prosjekt/ansatt. **Auto-stempling mater denne modellen.** |
| **Timepriser / job costing** | `db/30_hourly_rates.sql`, `db/33_job_costing.sql`, `app/prosjekter/[id]/job-costing-actions.ts` | Faktura- og kostsats → margin. Timene fra geofence flyter rett inn. |
| **GPS + kart** | `components/kjorebok/live-tracker.tsx`, `trip-map.tsx`, `lib/kjorebok/haversine.ts` | MapLibre + MapTiler-kartkomponent, Haversine-avstand. Brukes til admin-kart og avstandssjekk. |
| **Geokoding (gratis, norsk)** | `app/api/kjorebok/geocode/route.ts` (Kartverket + MapTiler-fallback) | Adresse → koordinater for å sette byggeplassens geofence. **Må generaliseres** (i dag gated bak `kjorebok`-modulen). |
| **Mobil-bro** | `proanbud-app/App.tsx`, `lib/native-bridge.ts`, `components/native-auth-bridge.tsx` | `postMessage`/`injectJavaScript`/`window.__nativeAuth`-mønsteret (utprøvd på OAuth) + `isNativeApp()`. |
| **Tenant/RBAC** | `db/00_*` | `get_current_company_id()`, `is_company_admin()`, `has_project_access()`, `project_members`, roller admin/manager/worker. |
| **Tilstedeværelse/kart-ops** | `db/32_user_presence.sql`, `/sjefen/analyse` | `last_seen_at`-mønster + Norge-kart kan gjenbrukes til admin «hvem er på plass nå». |
| **Modul-gating + Stripe** | `companyHasModule(...)`, plan-gating | Henges på som utvidelse av `timeforing` eller som eget tillegg. |

**Det som mangler (må bygges):**
1. Prosjekter har **ingen koordinater/geofence** i dag (adressefeltet i veiviseren lagres ikke).
2. **Ingen native bakgrunns-GPS / geofencing** i mobilappen (ren WebView, ingen posisjonstillatelser).
3. **Ingen godkjenningsflyt** på timer (de blir «ferdige» med en gang).
4. Ingen compliance-verktøy (drøfting-gate, DPIA-mal, AV-knapp, innsyn/sletting, lagringspolicy).

---

## 4. Teknisk arkitektur (gitt WebView-begrensningen)

**Kjernefakta:** Når appen er i bakgrunnen, fryser iOS/Android WebView-ens JavaScript. All
geofencing **må** derfor ligge i det native laget, som leverer hendelser til backend uavhengig av
web-appen.

```
┌─ NATIVE LAG (mobilapp): react-native-background-geolocation ────────────┐
│  • Overvåker byggeplass-geofencer (dynamisk: de 20/100 nærmeste)        │
│  • OS vekker native kode ved INN/UT — også når appen er terminert*      │
│  • Hendelse → SQLite-kø → autoSync HTTP POST                            │
│        headers: { Authorization: <Supabase JWT> }                       │
└───────────────────────────────┬─────────────────────────────────────────┘
                                 ▼
┌─ BACKEND: Next.js API route / Supabase Edge Function ───────────────────┐
│  • Validerer bruker, prosjekt, arbeidstid, dwell, nøyaktighet           │
│  • Skriver presence-hendelse + utkast-timepost (RLS-beskyttet)          │
└───────────────────────────────┬─────────────────────────────────────────┘
                                 ▼
┌─ Supabase Postgres ─┐  ◀── leser ──  ┌─ WebView / Next.js web-app ──────┐
│  presence_events    │                │  Tynn klient: viser stemplingsstatus│
│  time_entries       │                │  + manuell overstyring + bekreft   │
└─────────────────────┘                └────────────────────────────────────┘
```

- **Hvorfor transistorsoft, ikke `expo-location`:** `expo-location` + `expo-task-manager`
  støtter geofencing, men har to diskvalifiserende svakheter for auto-stempling: (a) på Android
  **dør geofencing når appen drepes** (Expos egne docs + uløst bug), og (b) bakgrunns-`fetch`
  fungerer ikke pålitelig i headless-kontekst. transistorsoft er bygd for nettopp dette:
  `stopOnTerminate:false`, `startOnBoot:true`, native HTTP + SQLite-kø (sletter kun ved 2xx),
  bevegelses-deteksjon for batteri, og dynamisk «nærmeste N»-registrering som omgår iOS sin
  20-grense. Lisensen (~$399 engang) er triviell mot ingeniørtiden det koster å slåss mot
  `expo-location`.
- **Geofence-only-modus** (`startGeofences`) + bevegelses-stillstandsmaskin = lavest batteri,
  og slipper Android foreground-service. Dette er den anbefalte driftsmodusen.
- **Web-appen forblir tynn:** leser stemplingsstatus fra Supabase (helst realtime-subscription),
  tilbyr manuell inn/ut. Broen `postMessage`/`injectJavaScript` brukes **kun i forgrunnen** for
  live UI — aldri til bakgrunns-levering av hendelser.
- **\*Force-quit-gapet:** iOS relanserer appen for region-hendelser selv etter swipe-bort (men
  rapportert ustabilt); Android relanserer *ikke* en bruker-drept app (transistorsoft demper med
  `startOnBoot`, men OEM-batteridrepere kan forstyrre). **Tiltak:** kjør en
  **avstemming/reconciliation når appen åpnes** — sammenlign faktisk posisjon mot DB-status og
  rett opp glipp.

---

## 5. Datamodell (forslag — nye tabeller + endringer)

> Følger ProAnbuds konvensjon: manuelle migrasjoner `db/NN_*.sql`, `company_id` på alt, RLS via
> `get_current_company_id()` / `has_project_access()`.

### 5.1 Prosjektets geofence
```sql
-- Enten kolonner på projects, eller egen tabell for fleksibilitet (flere soner/polygon senere).
-- Anbefalt: egen tabell.
CREATE TABLE project_geofences (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label         TEXT,                          -- f.eks. "Byggeplass", "Brakkerigg"
  center_lat    DOUBLE PRECISION NOT NULL,
  center_lng    DOUBLE PRECISION NOT NULL,
  radius_m      INTEGER NOT NULL DEFAULT 150,  -- min 100–150 m (se §6)
  polygon       JSONB,                         -- valgfri presis avgrensning (fase 2)
  address       TEXT,                          -- menneskelesbar (fra geokoding)
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
```
Settes ved prosjektopprettelse/redigering: geokod adressen (Kartverket) → forhåndsutfyll
sentrum + radius, vis på kart, la leder dra/justere. (Adressefeltet som i dag samles men ikke
lagres i veiviseren, kobles hit.)

### 5.2 Rå tilstedeværelses-hendelser (kort levetid)
```sql
CREATE TABLE presence_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id    UUID NOT NULL REFERENCES companies(id),
  project_id    UUID NOT NULL REFERENCES projects(id),
  geofence_id   UUID REFERENCES project_geofences(id),
  user_id       UUID NOT NULL REFERENCES users(id),
  event_type    TEXT NOT NULL CHECK (event_type IN ('enter','exit','dwell')),
  occurred_at   TIMESTAMPTZ NOT NULL,
  lat           DOUBLE PRECISION,
  lng           DOUBLE PRECISION,
  accuracy_m    NUMERIC(7,2),                  -- ignorer hendelser med >300 m (se §6)
  source        TEXT NOT NULL DEFAULT 'geofence'
                  CHECK (source IN ('geofence','high_accuracy_fix','manual','reconcile')),
  processed     BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);
-- Auto-sletting via cron etter N dager (default kort, f.eks. 7–30 dager). Aggregerte timer
-- beholdes i time_entries (egen, lengre policy).
```

### 5.3 Utvid `time_entries` (ikke ny tabell — gjenbruk)
```sql
ALTER TABLE time_entries
  ADD COLUMN source            TEXT NOT NULL DEFAULT 'manual'
                                 CHECK (source IN ('manual','timer','auto_geofence')),
  ADD COLUMN status            TEXT NOT NULL DEFAULT 'confirmed'
                                 CHECK (status IN ('draft','confirmed','approved','invoiced','rejected')),
  ADD COLUMN check_in_event_id  UUID REFERENCES presence_events(id),
  ADD COLUMN check_out_event_id UUID REFERENCES presence_events(id),
  ADD COLUMN auto_generated     BOOLEAN NOT NULL DEFAULT false;
```
Geofence-par (enter→exit) lager en **draft** timepost automatisk. Bekreftet av håndverker →
`confirmed`. Godkjent av leder → `approved` → fakturerbar/Tripletex. (Eksisterende
«én aktiv økt per bruker»-indeks passer perfekt: inn = aktiv økt, ut = lukk og beregn timer.)

### 5.4 Compliance- og innstillings-tabeller
```sql
-- Per bedrift: aktivering gated bak compliance-stegene
CREATE TABLE company_tracking_settings (
  company_id          UUID PRIMARY KEY REFERENCES companies(id),
  gps_enabled         BOOLEAN NOT NULL DEFAULT false,
  drofting_logged_at  TIMESTAMPTZ,        -- §9-2 drøfting med tillitsvalgte
  drofting_note       TEXT,
  dpia_completed_at   TIMESTAMPTZ,
  info_sent_at        TIMESTAMPTZ,        -- informasjonsskriv til ansatte
  raw_retention_days  INTEGER NOT NULL DEFAULT 14,
  default_radius_m    INTEGER NOT NULL DEFAULT 150,
  require_worker_confirm BOOLEAN NOT NULL DEFAULT true,
  require_manager_approve BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- Per ansatt: AV-knappen + skift/arbeidstid + informasjons-kvittering
CREATE TABLE worker_tracking_state (
  user_id        UUID PRIMARY KEY REFERENCES users(id),
  company_id     UUID NOT NULL REFERENCES companies(id),
  tracking_on    BOOLEAN NOT NULL DEFAULT true,   -- ansatt-styrt «privat-knapp»
  info_ack_at    TIMESTAMPTZ,                      -- bekreftet mottatt informasjon
  shift_start    TIME,                             -- arbeidstid-gate
  shift_end      TIME,
  updated_at     TIMESTAMPTZ DEFAULT now()
);
```

---

## 5B. Eiendomsgrense som geofence (matrikkel/teig) — med 100 m fallback

I stedet for kun en sirkel rundt adressepunktet henter vi den faktiske **eiendomsgrensen (teig)** for prosjektets adresse og bruker den som geofence. Finnes ingen teig, faller vi tilbake til en **100 m sirkel**. Hele oppslaget skjer **én gang ved prosjektopprettelse** (eller når adressen endres) og caches på `project_geofences` — aldri på hot-path.

> **Verifisert mot live-tjenestene 2026-06-30** (Storgata 1, Oslo → gnr 208/bnr 619; fleranleggseiendom 4601-32/1 → 6 teiger). Alle bærende påstander (adressefelt, teig-endepunkt, EPSG/akse, åpen CC BY 4.0-lisens) er bekreftet mot ekte API-respons.

### Pipeline (steg-for-steg)

1. **Prosjektadresse → matrikkel-id + punkt.** Gjenbruk geokoderen mot Geonorge adresse-API: `GET ws.geonorge.no/adresser/v1/sok?sok=<adresse>&treffPerSide=1&utkoordsys=4326`. Ta `adresser[0]` og hent ut `kommunenummer` (behold som streng, f.eks. `"0301"`), `gardsnummer`, `bruksnummer`, `festenummer` (0 = ingen) og `representasjonspunkt` (lat/lon). Sjekk `metadata.totaltAntallTreff`: `0` = ingen match, `>1` = disambiguer (helst med strukturerte parametre `adressenavn`/`nummer`/`kommunenummer`).
2. **Matrikkel-id → teig-polygon (anbefalt: Eiendom-API, GeoJSON i 4326).** Bruk Kartverkets **frie, åpne** Eiendom-API på samme host som geokoderen — det returnerer teig som **GeoJSON allerede reprojisert til WGS84**, så ingen reprojeksjon trengs i koden:
   `GET ws.geonorge.no/eiendom/v1/punkt/omrader?nord=<N>&ost=<E>&koordsys=25833&utkoordsys=4326&radius=10`
   (eller via `/geokoding?matrikkelnummer=<knr>-<gnr>/<bnr>&omrade=true&utkoordsys=4326` for å treffe eksakt matrikkelenhet fremfor «teigen punktet lander i»). Svaret er en `FeatureCollection` med `geometry.type="Polygon"` og rike `properties` (`matrikkelnummertekst`, `nøyaktighetsklasseteig`, `teigmedflerematrikkelenheter`, `hovedområde`, `oppdateringsdato`).
3. **Samle alle teiger.** Én matrikkelenhet har ofte **flere teiger** (verifiserte eksempler: gnr/bnr med 3, 5 og 6 separate teiger). Samle **alle** polygonene — ikke bare det første. Teiger kan være fysisk adskilt, så bygg en **`MultiPolygon`** (ikke tving til ett ring).
4. **Reprojiser til WGS84.** På happy-path er dette gratis: Eiendom-API leverer `[lon, lat]` WGS84 som MapLibre/turf konsumerer direkte. (API-ets default-CRS er faktisk EPSG:4258/ETRS89, ikke 4326 — derfor settes `utkoordsys=4326` eksplisitt; differansen i Norge er <1 m.) (Defensiv reserve: bruker vi en rå EPSG:25833-kilde, reprojiserer vi med `proj4`/`reproject`. Merk axis: 25833 er easting/northing → 4326 `[lon, lat]`.)
5. **Lagre som GeoJSON.** Skriv `Polygon`/`MultiPolygon`-geometrien til `project_geofences.polygon`, sett `geofence_kind='polygon'`, og lagre dessuten en beregnet **bounding-circle** (`center_lat`/`center_lng` + `radius_m`) slik at native geofence kan registreres uten ny utregning.
6. **Fallback ved ingen teig.** Hvis adresse-oppslaget mangler gnr/bnr, Eiendom-API returnerer 0 features, eller kallet feiler → sett `geofence_kind='circle'`, bruk `representasjonspunkt` som `center_lat`/`center_lng` og `radius_m=100`. Geofence rendres da via `turf.circle` som planlagt.

### API-oversikt

| API | Gir | Endepunkt | Auth | Lisens | EPSG |
|-----|-----|-----------|------|--------|------|
| Geonorge adresse-API (`/sok`, `/punktsok`) | matrikkel-id (knr/gnr/bnr/fnr) + representasjonspunkt | `ws.geonorge.no/adresser/v1/sok` | Ingen | NLOD/CC | Default 4258 — sett `utkoordsys=4326` |
| **Eiendom-API (`/punkt/omrader`, `/geokoding`)** ← anbefalt | teig-polygon som **GeoJSON**, reprojisert | `api.kartverket.no/eiendom/v1` (speilet på `ws.geonorge.no/eiendom/v1`) | Ingen | Åpne data (CC BY 4.0) | Default **4258** — sett `utkoordsys=4326` |
| WFS Matrikkelen-Eiendomskart Teig (reserve) | teig som GML | `wfs.geonorge.no/skwms1/wfs.matrikkelen-eiendomskart-teig` | Ingen | CC BY 4.0 | Native 25833; reprojiserer til 4326, men gir GML + akse `lat lon` |
| Matrikkel-API (SOAP) — **unngå** | full matrikkel/seksjon | `matrikkel.no` | Krever avtale | Begrenset | 32632 |

> Velg **Eiendom-API** på happy-path: åpent, GeoJSON, ferdig reprojisert. WFS-en er en god reserve (også åpen, CC BY), men leverer **kun GML 3.2.1** (`outputFormat=application/json` gir feil), bruker akserekkefølge `lat lon` i 4326 (må byttes til `lon lat`), og rapporterer `numberReturned="0"` selv når body har features — **tell faktiske `app:Teig`-medlemmer**, ikke attributtene. SOAP-API-et trengs ikke (gnr/bnr kommer gratis fra adresse-API-et; `seksjonsnummer` er irrelevant for teig).

### Geofence-mekanikk

- **Native trigger (gratis, sirkel):** `react-native-background-geolocation` har sirkulære geofences som standard (`{ identifier, latitude, longitude, radius }`). Registrer en **bounding-circle** rundt teigen (senter + maks vertex-avstand) som billig, grov trigger. **iOS er treig under ~200 m** — registrer derfor native trigger på **≥200 m** selv om fallback-sirkelen er 100 m.
- **Server-side bekreftelse (presis):** Ved ENTER-event sender appen presis posisjon til server, som kjører `turf.booleanPointInPolygon([lng, lat], polygon)` mot lagret teig før tidssporing starter. `booleanPointInPolygon` håndterer `Polygon`, `MultiPolygon` og hull nativt.
- **MultiPolygon ved flere teiger:** «enhver teig inneholder punktet» = «på stedet». Lagres og testes som MultiPolygon.
- **Buffer mot GPS-drift:** Bart matrikkel-omriss gir falske «utenfor»-treff i kant av små tomter (urban GPS-feil ~5–20 m). Buffer med `turf.buffer(polygon, N, { units: "meters" })`, N ≈ 10–25 skalert etter `nøyaktighetsklasseteig`. `{ units: "meters" }` er obligatorisk (turf default er km). Test mot den **bufrede** polygonen.
- **iOS 20-geofence-grense:** Apple tillater kun 20 monitorerte geofences. Bruk transistorsofts «infinite geofencing» (aktiverer kun nærmeste) fremfor å registrere alle prosjekter samtidig.
- **Betalt alternativ:** transistorsofts **Polygon Geofencing add-on** (`vertices`-API, `[[lat,lng],…]`) gir on-device polygon-presisjon (auto-beregnet minimum enclosing circle + C++ point-in-polygon). Kjøp kun hvis on-device offline polygon-presisjon kreves; den frie hybriden (native sirkel + server-turf) dekker ellers behovet.

### Datamodell-justering (`project_geofences`)

| Felt | Endring | Merknad |
|------|---------|---------|
| `polygon` JSONB | Bekreftes brukt | GeoJSON `Polygon`/`MultiPolygon` (WGS84) — ikke lenger kun «reservert» |
| `radius_m` | Default **100** | Fallback-sirkel (server-bekreftelse); native iOS-trigger registreres ≥200 |
| `center_lat`/`center_lng` | Beholdes | Fra representasjonspunkt (fallback) eller beregnet bounding-circle-senter (polygon) |
| `geofence_kind` | **Nytt** | `'polygon' | 'circle'` — diskriminator for runtime |
| `matrikkel_kommunenr` / `gnr` / `bnr` / `festenr` | **Nytt** | Cache av matrikkel-id; `kommunenummer` som **streng** (ledende null) |
| `polygon_source` | **Nytt** | F.eks. `'eiendom-api'` / `'wfs'` / `'manuell'` for sporbarhet |
| `noyaktighetsklasse` | **Nytt** | `nøyaktighetsklasseteig` — styrer buffer-bredde |
| `srid` | **Nytt** | Alltid `4326` på lagret geometri (eksplisitt) |
| `polygon_oppdatert` | **Nytt (valgfritt)** | `oppdateringsdato` for staleness/re-fetch |

### Edge-cases

- **Adresse uten registrert eiendom:** Adresse-API gir 0 treff eller mangler gnr/bnr → direkte til 100 m fallback-sirkel på beste tilgjengelige punkt.
- **Seksjonert eiendom / sameie:** `seksjonsnummer` er irrelevant for teig — teig er nøklet på matrikkelenhet (gnr/bnr/fnr), så hele eiendommens teig brukes som geofence (riktig for stedssporing). (Feltet mangler i adresse-API-et, men finnes nullbart i Eiendom-API-ets teig-properties.)
- **Store/uregelmessige teiger:** Flere/disjunkte teiger → MultiPolygon (any-teig-contains-point). Svært store teiger gir stor bounding-circle som native trigger; server-side point-in-polygon holder presisjonen.
- **Manuell justering på kart (siste utvei):** Lar bruker tegne/flytte geofence i MapLibre (`polygon_source='manuell'`) når automatikken bommer — overstyrer både teig og fallback.

### Lisens og attribusjon

Eiendomsdataene (Matrikkelen – Eiendomskart Teig) er **åpne data under Creative Commons BY 4.0** → krever **kildeangivelse til Kartverket** der grensene vises/brukes. Merk også `matrikkelloven §30` + utleveringsforskriften som regulerer viderebruk av matrikkelopplysninger — verdt en kort compliance-sjekk siden ProAnbud er et kommersielt produkt.

### Gjenbruk

- **Utvid eksisterende geocode-API** fremfor å lage nytt: legg `property-boundary`-logikken i samme Kartverket-baserte rute (`ws.geonorge.no`-host gjenbrukes for både adresse og eiendom). Geokoding → `eiendom/v1/punkt/omrader?...&utkoordsys=4326` → samle features til Polygon/MultiPolygon → fallback til sirkel ved tomt resultat.
- **Generaliser bort kjørebok-modulgaten:** Flytt logikken ut av `app/api/kjorebok/geocode/route.ts` til en delt, modul-uavhengig geokoder/eiendoms-tjeneste, slik at geofence-modulen (og andre) kan bruke den uten kjørebok-spesifikk tilgangssjekk.
- **`proj4js` holdes utenfor kritisk sti** (server returnerer 4326); beholdes kun som beskyttet reserve hvis vi noen gang konsumerer rå 25833-kilde.

---

## 6. Nøyaktighet — slik unngår vi feilstempling («svært nøyaktig»-kravet)

Geofencing er av natur omtrentlig (~100–200 m presisjon, forsinkelse fra titalls sekunder til
~6 min, verst på *exit* og når enheten har stått stille). Derfor lag-på-lag-tiltak:

1. **Radius ≥ 100–150 m** (begge OS-leverandørers anbefaling). Polygon for store/uregelmessige
   tomter (fase 2). For tett by/høye bygg: aldri trang radius.
2. **Dwell/oppholdstid før innstempling** — Androids `DWELL` + server-regel «må være innenfor
   ≥ N min» dreper drive-by-treff.
3. **Nøyaktighets-gating + hysterese (Connecteam-mønster):** dynamisk buffer etter GPS-nøyaktighet
   (≤10 m → 50 m buffer; 10–300 m → 100 m; **>300 m → ignorer**). Auto-utstempling kun når *hele*
   nøyaktighetssirkelen er utenfor bufferen.
4. **Bekreft med et høy-nøyaktig punkt** når en geofence trigger, før timeposten committes — ikke
   stol på trigger-koordinaten alene.
5. **Arbeidstids-gate:** reager kun på hendelser i konfigurert skift (også et lovkrav, §2).
6. **Bevegelses-/aktivitetsgjenkjenning** (transistorsofts maskin): GPS av når stillestående →
   sparer batteri *og* fjerner drift-«exits» mens en arbeider står stille på plassen.
7. **Bekreftelses-/godkjenningslaget** (§7) er det siste sikkerhetsnettet mot feil: mennesket
   fanger det GPS-en bommer på. Dette er grunnen til at full-auto-uten-bekreftelse er risikabelt.

**Forventning som må kommuniseres i UI:** «auto-utstempling kan ta noen minutter». Aldri
presenter geofence-tidsstempel som eksakt stempleklokke; rund/avstem server-side.

---

## 7. Brukeropplevelse (enkel å bruke + administrere)

### Håndverkeren (mobil) — «gjør ingenting»-opplevelsen
1. Engangs-oppsett: appen ber om posisjonstillatelse (Når-i-bruk → eskaler til **Alltid** med
   tydelig begrunnelse), viser informasjonsskrivet, ansatt kvitterer (informasjon, *ikke*
   samtykke som grunnlag).
2. Kjører til jobb → **automatisk varsel: «Du er nå på [Prosjekt X] — stempling startet.»**
   Ingen handling nødvendig.
3. Drar hjem → **«Stemplet ut. 7t 15m registrert på [Prosjekt X]. Bekreft ✓ / Rediger.»**
   Ett trykk. (Konfigurerbart: auto-bekreft etter X timer hvis ikke bestridt.)
4. Alltid synlig: **stor AV-knapp** («privat-knapp») + status «sporing på/av», og full innsyn i
   egne registreringer (lovkrav).

### Lederen (web) — administrerer i eksisterende timeføring
1. Setter geofence ved prosjektopprettelse: skriv adresse → kart forhåndsutfylt → juster radius.
2. **Oppsett-veiviser (compliance-gate):** før GPS kan slås på må leder (a) logge drøfting med
   tillitsvalgte, (b) sende informasjonsskriv (auto-generert), (c) bekrefte DPIA. Knappen
   «aktiver» er låst til disse er gjort.
3. Daglig drift: **utkast-timer** dukker opp i dagens timeførings-oversikt
   (`/min-bedrift/timeforing`) → godkjenn (én eller bulk) → fakturerbar/Tripletex.
4. Valgfritt **«hvem er på plass nå»-kart** (gjenbruk MapLibre + presence-status). NB:
   personvern — vis *status* (på plass/borte) heller enn live-prikk, og kun i arbeidstid.

---

## 8. Integrasjoner

- **Timeføring:** auto-timer er `time_entries` med `source='auto_geofence'`, `status='draft'`.
  Gjenbruker hele eksisterende oversikt/rapportering.
- **Tripletex:** når `status='approved'` → følg samme synk-mønster som kjørebok bruker i dag
  (per-rad status/feil-kolonner). Mulighet for å sende godkjente timer som timelinjer.
- **Geokoding:** generaliser `/api/kjorebok/geocode` (eller ny `/api/geocode`) så den ikke er
  gated bak kjørebok-modulen.
- **Kart:** gjenbruk `components/kjorebok/trip-map.tsx` (MapLibre) for geofence-redigering og
  admin-kart.
- **Modul/billing:** utvid `timeforing`-modulen, eller eget tillegg «GPS-stempling». Følg
  data-drevet billing + Stripe seed-konvensjonen.

---

## 9. App Store / Play Store (godkjenningsløpet — en reell milepæl)

- **iOS:** `NSLocationWhenInUseUsageDescription` + `NSLocationAlwaysAndWhenInUseUsageDescription`,
  `UIBackgroundModes: ['location']`, `allowsBackgroundLocationUpdates=true`. Be om Når-i-bruk
  først, eskaler til Alltid. Ærlige formålstekster. Aksepter den blå statuslinjen ved
  bakgrunnssporing. Guideline 5.1.5 / 2.5.4 — arbeidstid-stempling kvalifiserer.
- **Android:** `ACCESS_FINE_LOCATION` + `ACCESS_BACKGROUND_LOCATION` (på 11+ må bruker sendes til
  Innstillinger; be om forgrunn først, så bakgrunn separat). **Play Store krever
  Permissions-Declaration-skjema + ≤30 s demovideo + «prominent disclosure»-dialog** før OS-promten.
  Geofence-only (uten foreground-service) forenkler review.
- **OEM-batteridrepere** (Samsung/Xiaomi/Huawei m.fl.) er den #1 reelle Android-risikoen → bygg
  en in-app «skru av batterioptimalisering»-guide (ref. dontkillmyapp.com).
- **Bygg:** appen bruker EAS; transistorsoft har Expo config-plugin (krever dev/EAS-build, ikke
  Expo Go).

---

## 10. Leveranseplan (faser)

| Fase | Innhold | Resultat |
|------|---------|----------|
| **0. Juridisk fundament** | Interesseavveining-mal, DPIA-mal, informasjonsskriv-generator, drøfting-gate, lagringspolicy, AV-knapp, innsyn/sletting. Advokat-gjennomgang. | Lovlig å slå på. |
| **1. Geofence-data + manuell stempling++** | `project_geofences` + geokoding + kartredigering. Manuell «jeg er på plass»-knapp i web/app som logger presence + lager timepost. Ingen bakgrunns-GPS ennå. | Verdi uten native-risiko; tester datamodell + UX. |
| **2. Native bakgrunns-geofence (MVP auto)** | transistorsoft i appen, tillatelser, POST-endepunkt, draft-timer, bekreftelse/godkjenning. Nøyaktighetstiltak (§6). Reconciliation-on-open. | Ekte automatikk for pilotkunder. |
| **3. Polish + skala** | Polygon-geofencer, admin «på plass nå»-kart, bulk-godkjenning, Tripletex-timelinjer, OEM-guide, store-godkjenning iOS+Android. | Full lansering. |

---

## 11. Åpne beslutninger (dine å ta)

1. **Automatikkmodell** — ✅ **AVGJORT 2026-06-30: «auto-detektering + bekreftet timeliste»**
   (automatikk gjør alt, menneske bekrefter, leder godkjenner før fakturering). Forkastet:
   *full automatikk* (høyere feil-/tvisterisiko, svakere juridisk transparens) og *påminnelse →
   trykk for å stemple* (minst automatisk).
2. **Pakketering:** del av `timeforing`-modulen, eller eget betalt tillegg «GPS-stempling»?
3. **Lagringstid** på rå-hendelser (default 14 dager foreslått) og på godkjente timer.
4. **«På plass nå»-kart for ledere:** ja/nei, og i så fall status-visning vs. live-prikk
   (personvern-avveining).
5. **Pilot:** hvilke 1–3 kunder/bedrifter kjører vi fase 2-pilot med (krever drøfting +
   informasjon på plass)?

---

## 12. Risikoer → tiltak (oppsummert)

| Risiko | Tiltak |
|--------|--------|
| **Juridisk: bygges feil → ulovlig/usalgbart** | Innramming som mannskapsliste/HMS, berettiget interesse, geofence-only data, AV-knapp, formålslås, §9-2-gate, DPIA, kort lagring. Advokat-signoff. |
| **iOS force-quit / Android user-kill + OEM-drepere bommer på hendelser** | `stopOnTerminate:false`, `startOnBoot:true`, in-app batteri-guide, **reconciliation når appen åpnes**, alltid manuell overstyring. |
| **Play/App Store-avvisning** | Declaration-skjema + demovideo + disclosure (Android); ærlige purpose strings + blå linje (iOS). Geofence-only forenkler. |
| **Feilstempling pga. GPS-drift** | Radius + dwell + nøyaktighets-gating + hysterese + høy-nøyaktig bekreftelsespunkt + bekreftelseslag. |
| **Forsinkelse overrasker bruker** | Kommuniser i UI; avstem tidsstempel server-side. |
| **Pålitelighetstak på full-auto** | Tilby «påminnelse → bekreft»-fallback per arbeider/plass der full-auto er ustabilt. |

---

## 13. Kilder (utvalg)

- **Juss:** Datatilsynet (samtykke, interesseavveiing, yrkesbiler/GPS, DPIA-liste, lagringstid,
  «Sjefen ser deg?»), Lovdata aml. §§9-1/9-2, byggherreforskriften §15 + Arbeidstilsynet
  (elektroniske oversiktslister), HMS-kort-forskriften, **HR-2013-234-A (Avfallsservice)**,
  gebyrsaker (renovasjon 100k, Timegrip 250k).
- **Teknikk:** Expo Location/TaskManager-docs, Apple Region Monitoring + Authorization +
  App Store Review Guidelines, Android Geofencing/Background-location/Permissions, Google Play
  background-location-policy, transistorsoft docs/pricing/Philosophy-of-Operation,
  react-native-webview (bakgrunnssuspensjon), Radar (geofence-nøyaktighet), dontkillmyapp.com,
  produkt-docs: Hubstaff, QuickBooks Time, Connecteam, Workyard.

(Fullstendige URL-er finnes i research-loggen for denne planen.)


---

## Tillegg: «Kart»-side — levende drifts­kart

> **Status:** PLAN / RESEARCH (ingen kode skrevet). Utarbeidet 2026-06-30.
> **Avhengighet:** Bygges **etter** at geofence-timeregistreringen over er på plass — den
> leverer både prosjekt-geofencene og tilstedeværelses­hendelsene som kartet visualiserer.
> **Juridisk grunnregel:** Et live posisjonskart for ansatte gjeninnfører nøyaktig den
> løpende overvåkingen geofence-designet bevisst unngikk. Derfor er hele dette designet bygget
> rundt **status, ikke posisjon** — og strengere enn det: **bemanning per plass, ikke per person.**
> Kartet er et **oppslagsverktøy**, ikke en overvåkingsskjerm: en navngitt mannskapsliste er et
> separat, logget, pull-basert per-prosjekt-oppslag — aldri en live strøm til en alltid-åpen skjerm.

---

## K0. TL;DR — de tre beslutningene for kartet

1. **Konsept:** Ett kart som binder sammen prosjekter, kunder og bemanning. Ikke en ny modul —
   en visualisering av data ProAnbud allerede har (prosjekter, kunder, geofencer, tilstedeværelse).
   Dette er moaten i praksis: «slutt å lappe sammen fem systemer» blir til *ett bilde* av driften.
2. **Personvern-default:** Kartet viser **bemanning per prosjekt** som hovedvisning — **binær
   «bemannet / ubemannet»** når antallet er under en k-anonymitets-terskel (f.eks. <3), og først
   **aggregert «N på plassen nå»** når N ≥ terskelen. **Ingen navn, ingen bruker-id, ingen
   per-ansatt-status og ingen «borte»-merking i standardkartet.** En **navngitt mannskapsliste** er
   et separat, **logget, pull-basert per-prosjekt-oppslag** bak `has_project_access` og bak fullført
   §9-2/DPIA-gate — ikke en del av standardvisningen. **Ingen levende prikk, ingen spor, ingen
   historikk.**
3. **Teknologi:** Gjenbruk av eksisterende MapLibre + MapTiler-stack. Statiske pins/geofencer +
   klynger på GeoJSON-lag; live bemanning via **Broadcast-from-Database** (Postgres-trigger →
   `realtime.broadcast_changes()` på firma-topic) som **kun bærer prosjekt-nivå antall/binær status
   — aldri bruker-id-er.** Navn hentes kun ved eksplisitt, logget RPC-oppslag.

---

## K1. Konsept og plass i visjonen

ProAnbud har i dag prosjekter, kunder og (etter geofence-funksjonen) tilstedeværelse — men de
lever i hver sin liste. Kartet er stedet der de tre møtes geografisk: en leder åpner `/kart` og
ser *med én gang* hvor prosjektene er, hvilke kunder de hører til, og hvor mange som faktisk er på
plass akkurat nå. Det er ren sammenheng-verdi: ingen konkurrent-funksjon i seg selv, men noe bare
en plattform med *ett datagrunnlag* kan gjøre godt.

Nordisk kontekst bekrefter posisjoneringen: SmartDok, Infobric, EasyHours og Capitech gjør alle
geofence-innsjekk og «hvem er sjekket inn på hvilken plass» — **ikke** bevegelige personprikker.
ProAnbud kan derfor lede på *polish* (Apple-Maps-følelse) uten å være mer inngripende enn
bransjen. Det er en trygg, differensierende vinkel.

---

## K2. Kartlag

Fire lag, hvert med en egen synlighets- og personvernprofil:

| Lag | Innhold | Default | Personvern |
|---|---|---|---|
| **Prosjekter** | Pin per prosjekt med adresse, status og bemannings-badge | PÅ | Bedriftsdata, ingen personopplysning |
| **Kunder** | Pin per kunde (dempet, distinkt stil) | AV (toggle) | Bedrifts-/CRM-data; samme formål som i dag |
| **Geofencer** | Myk sirkel/polygon rundt prosjektet | AV (toggle) | Bedriftsdata |
| **Bemanning/tilstedeværelse** | «Bemannet/ubemannet» eller (k≥3) «N på plassen nå»-badge på prosjekt-pin | PÅ | Terskel-supprimert aggregat → ikke personrettbart på kartet |

**Personvern-trygg default for ansatt-tilstedeværelse (følger den juridiske gjennomgangen):**

- **Default OG hovedvisning (alle ledere/admin med prosjekttilgang):** *bemanning per prosjekt* med
  **k-anonymitets-terskel**. Under terskelen (f.eks. <3 på plass) vises **kun binær «bemannet /
  ubemannet»** — *aldri* «1 på plassen», som i et lite lag (ProAnbuds målgruppe 5–20, ofte 1–3 på en
  plass) er trivielt re-identifiserbart fordi lederen vet hvem som er satt på prosjektet. Først ved
  **k ≥ 3** vises *aggregert antall* — «3 på plassen nå». **Ingen navn, ingen bruker-id på
  kartlaget.** Dette er hovedfunksjonen.
- **Bak tjenstlig-behov-gate + logget oppslag (kun prosjektansvarlig/admin med `has_project_access`
  for *det* prosjektet):** en **navngitt mannskapsliste** for **ETT** prosjekt, hentet som
  **snapshot** ved eksplisitt handling (pull-basert, hendelsesutløst) — ikke en live, push-oppdatert
  strøm. Tillatt per-person-tilstand er **maksimalt binær «på plass» / «ikke registrert»**, og selv
  dette er sekundært, ikke live. Dette flytter funksjonen fra *overvåking* til *oppslag*
  (byggherreforskriften §15-innramming: leder slår opp gjeldende mannskap ved tjenstlig behov).
- **Bygges IKKE:** «borte»/«away»-status (fjernet helt — se K7), kontinuerlig oppdatert presis prikk
  per ansatt, brødsmulespor, «sist sett her»-historikk, replay/scrubber, push-strøm av navngitte
  ansatte til en alltid-åpen skjerm, eller et firma-bredt «alle ansatte»-livekart. Dette er
  linjen Avfallsservice-dommen (HR-2013-234-A) og dataminimering trekker.

---

## K3. Interaksjonsmodell — «avansert men enkel»

Mønsteret som går igjen hos ServiceTitan, Skedulo og Connecteam: *side-liste synket med kart*.

- **Side-liste ↔ kart (toveis).** Venstre liste over prosjekter (valgfritt kunder) bundet til
  synlig kartutsnitt: panorer kartet → listen oppdateres; velg i listen → pin uthevet og motsatt
  (Airbnb-stil). Listen er kollapsbar for fullskjerm-kart.
- **Klikk-pin → detaljpanel.** Avrundet, flytende kort (ikke trang popup): prosjektnavn, adresse,
  statusfarge, bemannings-status («bemannet» eller «N på plassen nå» ved k≥3), lenke inn i
  prosjektet. **Navngitt mannskapsliste vises ikke i panelet automatisk** — den krever et eksplisitt,
  logget «Vis mannskap»-oppslag (se K7), tilgjengelig kun for prosjektansvarlig/admin. For kunde:
  adresse + tilknyttede prosjekter.
- **Søk.** Fritekst på prosjekt-/kundenavn og adresse; treff → `flyTo`.
- **Filtre gruppert etter type** (ikke 20 brytere): status (anbud/aktiv/ferdig), ansvarlig
  leder/team, «har bemanning på plass nå» (binær). Lag-toggles (prosjekter/kunder/geofencer) holdes
  adskilt fra attributt-filtre.
- **Klynger (clustering).** Énfarget, nummerert sirkel; diameter ∝ antall; klikk → zoom inn
  (`getClusterExpansionZoom` + `easeTo`); spiderfy kun ved maks zoom. Holder tette byområder lesbare.
- **Fly-to + status-badges.** `flyTo` (van Wijk-kurve, ~600–1200 ms) ved hopp, `easeTo` ved korte
  panoreringer. Bemannings-badge sitter på prosjekt-pin.
- **Tilstand huskes.** Siste zoom/utsnitt + siste filtervalg lagres, så kartet «blir der du forlot det».
- **Lys/mørk.** Basemap byttes med app-temaet (next-themes).

---

## K4. Apple-Maps-aktig visuell tilnærming i MapLibre

Mål: *rolig basemap, fokusert farge.* Kartet er lerretet, dataene er blekket.

- **Stilvalg:** MapTiler **`base-v4`** (lys) + **`base-v4-dark`** — den nye generasjonen (okt 2025),
  «minimal, clear, unobtrusive», nærmest Apple-følelsen. Erstatt dagens `streets-v2-dark`-default.
  Tilby `streets-v4` som valgfri toggle for ledere som vil ha veikontekst.
- **Temabytte uten å miste lag:** `map.setStyle(url, { transformStyle })` som re-injiserer egne
  sources/layers i den nye stilen; re-fest overlegg på `styledata` (ikke `style.load`). Kamera
  bevares automatisk.
- **Minimal chrome:** få faste kontroller (lag-toggle, søk, tema). Flytende avrundede kort med myk
  skygge og lett gjennomskinn (Liquid-Glass-ånd): ~16px radius, subtil backdrop-blur, 1px
  hårstrek-kant, lav-opasitet skygge — aldri kantete bokser sveiset til skjermkanten.
- **Markørspråk:** *ett* pin-format overalt; mening kommer fra farge + badge, ikke fra mange ikoner.
- **Farge-/statussystem:** stram 3–4-trinns rampe — grønn = normal/bemannet, gul = trenger
  oppmerksomhet, rød = varsel, nøytral grå = ubemannet. Geofence-fyll og bemannings-badge
  fargelegges av *samme* terskel-supprimerte bemannings-uttrykk (grå = ubemannet, grønn = bemannet)
  så «hvor er det folk nå» leses på et blikk — uten å avsløre *hvem* eller, under k-terskel, *hvor mange*.
- **Stripp basemap:** skru av irrelevante POI-er/etiketter; reserver mettet farge utelukkende for
  ProAnbud-data.

---

## K5. Teknisk arkitektur

**Gjenbruk:** Trekk kart-initialiseringen i `components/kjorebok/trip-map.tsx` ut til en delt hook
(`useMapLibre`) + en `BaseMap`-komponent; behold `TripMap` som spesialisert variant. Generaliser
geokoder-API-et `app/api/kjorebok/geocode/route.ts` (Kartverket → MapTiler) ved å flytte logikken til
`lib/geo/geocode.ts` og fjerne `companyHasModule("kjorebok")`-sjekken (gate kun på firmatilgang), så
prosjekter og kunder kan geokodes.

| Bekymring | Valg |
|---|---|
| **Basedata** | GeoJSON-source + circle/symbol-lag (ikke HTML-markører) med innebygd `cluster:true` (radius 50, maxZoom 14); `step`-uttrykk for klyngestørrelse/-farge |
| **Interaktive aksenter** | Få HTML-`Marker` kun for valgt prosjekt / puls |
| **Geofence-sirkel** | `turf.circle(center, radius_m, {units:'meters', steps:64})` → fill (~0.12 opasitet) + line; bruk lagret `polygon` når den finnes |
| **Bemannings-badge** | Datadrevet symbol-lag som leser **terskel-supprimert** bemannings-felt (binær under k, antall ved k≥3); oppdateres med `setData` |
| **Treff/popover** | `queryRenderedFeatures` + lag-nivå `mouseenter`/`click`, ikke per-markør-lyttere |

**Valgt live-pipeline — Broadcast-from-Database (server-autoritativ):**

Sannheten om «på plass» kommer fra det native laget i mobilappen som POST-er geofence inn/ut til
Postgres (`presence_events` / avledet on-site-rollup) — ikke fra en nettlesers socket. Derfor:

1. Postgres-trigger på on-site-tabellen kaller `realtime.broadcast_changes()` til en
   **per-firma-topic** (`company:{companyId}:onsite`). RLS evalueres **én gang** ved
   meldingsopprettelse (skalerer til titusenvis av tilkoblinger), ikke per abonnent.
2. Kart-klienten gjør `supabase.realtime.setAuth()` + abonnerer på den private topic-en, oppdaterer
   bemannings-status per prosjekt og kaller `setData` på GeoJSON-source.
3. **Cold-load + fallback:** hent gjeldende (terskel-supprimerte) on-site-rollup via REST/RPC ved
   sidelast, og poll hvert ~30–60 s hvis socket faller (gjenbruk `last_seen_at`-heartbeat-maskineriet
   fra db/32).

Bevisst valgt **fremfor** Realtime Presence-kanaler (måler tilkoblede nettlesere, ikke ansatte på
plass) og Postgres Changes-abonnement (RLS-sjekk per abonnent per endring — minst skalerbart).
Presence-kanaler kan brukes *kun* til polish: «hvilke ledere ser på kartet nå».

**Payload-disiplin (håndhevet skille, ikke intensjon):** Broadcast-meldingen bærer **kun
prosjekt-nivå bemannings-status** — binær «bemannet/ubemannet» under k-terskel, aggregert antall ved
k≥3. **Ingen bruker-id-er, ingen navn, ingen per-ansatt-status og aldri en posisjonsstrøm** forlater
serveren via broadcast. Terskel-suppresjonen skjer **server-side** (i trigger/RPC), ikke i klienten,
slik at klienten aldri mottar et tall den må skjule. Navn/identitet hentes **utelukkende** ved et
eksplisitt, logget per-prosjekt-oppslag via en RLS-beskyttet RPC (se K7) — **aldri streamet**.

---

## K6. Datakrav og endringer

| Tabell | Endring | Hvorfor |
|---|---|---|
| `customers` | `ALTER TABLE customers ADD COLUMN lat numeric, ADD COLUMN lng numeric;` | Har adresse/postnr/by, mangler koordinater |
| `projects` | `ALTER TABLE projects ADD COLUMN lat numeric, ADD COLUMN lng numeric, ADD COLUMN address text;` | Har ingen geografi i dag |
| `project_geofences` | (allerede foreslått: `center_lat/center_lng/radius_m/polygon`) | Kilde for geofence-laget |
| `presence_events` / `worker_tracking_state` | (allerede foreslått) | Kilde for terskel-supprimert bemanning + (logget) snapshot-oppslag |
| `presence_lookup_audit` | **NY:** `viewer_user_id`, `subject_user_id`, `project_id`, `looked_up_at`, evt. `reason` | Logg for per-ansatt-oppslag (hvem-så-hvem-når); eksponeres for den ansattes innsynsrett |

- **Geokoding ved lagring:** kunde lagres → geokod adresse → lagre lat/lng. Prosjekt lagres →
  geokod prosjektadresse (eller arve kundeadresse / sette punkt manuelt fra kartet senere).
- **Backfill:** engangs-geokoding av eksisterende kunder/prosjekter via det delte API-et.
  **Merk:** prosjekt-/kunde-koordinater er i seg selv lav-risiko bedrifts-/CRM-data, men
  *kombinasjonen* prosjekt-koordinat + on-site-rollup + bruker-id er det som gjør personrettet
  stedfesting mulig. Derfor holdes bruker-id strukturelt adskilt fra kart-/broadcast-laget og lever
  kun bak det loggede oppslaget.
- **Bemanningskilde:** terskel-supprimert bemannings-status per prosjekt avledes av on-site-rollup
  fra `presence_events` (inn uten matchende ut), filtrert på `worker_tracking_state.tracking_on` +
  på-skift. **Kilde-sperre:** når `tracking_on = false` samles **ingen hendelse i det hele tatt**
  (ikke bare skjult i visningen) — den ansatte teller ikke og genererer ingen rad.

---

## K7. RBAC og personvern innebygd

- **Tilgang til siden:** kun admin/manager (`is_company_manager_or_admin`); per prosjekt
  `has_project_access` / `project_members`. Aldri arbeidere, aldri firma-bredt for andres status.
- **Terskel-supprimert bemanning** (binær under k, antall ved k≥3) kan vises til ledere/admin med
  prosjekttilgang. **Navngitt mannskaps-oppslag** kun til **prosjektansvarlig/admin med
  `has_project_access` for DET prosjektet** (avgjør åpen beslutning K9.3 i strengeste retning).
  **Aldri** firma-bredt «alle ansatte».
- **Per-ansatt-visning er pull-basert, ikke push.** En leder med tjenstlig behov *slår opp*
  gjeldende mannskapsliste for ett prosjekt (snapshot via RLS-beskyttet RPC) — det finnes ingen
  kontinuerlig socket-strøm av navngitte ansatte til en alltid-åpen skjerm. Funksjonen er *oppslag*,
  ikke *overvåking*.
- **Logging + rate-begrensning av oppslag:** hvert per-ansatt-oppslag skrives til
  `presence_lookup_audit` (hvem-så-hvem-når) og rate-begrenses. **Den ansattes innsynsrett:** den
  ansatte kan se at/hvor ofte status om dem er slått opp (personvernlovens innsyn; jf. Timegrip-gebyret).
- **«Borte»-status er fjernet helt.** En på-skift ansatt skal **aldri** merkes «borte/away» på et
  lederkart — det er et ytelses-/disiplinsignal og bryter formålslåsen (Avfallsservice). Maksimal
  per-person-tilstand er binær «på plass» / «ikke registrert», og selv den er sekundær og ikke live.
- **OFF-bryter og utenfor-skift = «ikke registrert»/«utilgjengelig»** — **aldri** som tomrom som
  impliserer fravær, og **aldri tellende**. Når `tracking_on = false` samles ingen hendelse ved
  kilden (se K6).
- **Ingen spor/historikk:** status er *gjeldende tilstand*, avledet og overskrevet — kartet bygger
  eller eksponerer aldri en bevegelseslogg. (Timeføringen beholder sine inn/ut-hendelser under *sitt*
  formål/oppbevaring — men kartet kobler aldri tilstedeværelse mot timelister.)
- **Formålslås som teknisk håndhevet skille (ikke bare intensjon):** kartets/oppslagets
  tilstedeværelsesdata **kan ikke joines mot `time_entries`/lønn/ytelse i noen kontroll-rettet
  visning** — dette håndheves ved at presence-snapshot-RPC-en og kart-laget ikke har lese-tilgang
  til lønns-/timeførings-kolonner i samme query/visning, og at «fravær»/«borte» **ikke finnes som
  felt** og dermed verken kan eksporteres eller varsles. Bemanning/koordinering/sikkerhet er det
  eneste formålet; ytelse, lønn, oppfølging og oppsigelse er eksplisitt utelukket.
- **DPIA + §9-2 — kartet som eget kontrolltiltak:** DPIA-en og §9-2-/drøftingen **må eksplisitt
  dekke kartet som selvstendig kontrolltiltak** (sanntids tilstedeværelsesvisning for ledere) — det
  kan **ikke** piggyback på geofence-timeførings-DPIA-en. Aktivering av **enhver** per-ansatt-visning
  på kartet gates bak **samme** drøfting-/info-gate som geofence-funksjonen
  (`company_tracking_settings`: `drofting_logged_at`, `info_sent_at`, `dpia_completed_at`). **Hvis
  navn vises: §9-2 må være fullført FØR visning kan slås på — håndhevet i kode** (oppslags-RPC-en
  nekter å returnere navn med mindre `dpia_completed_at` og §9-2-drøfting er registrert).

---

## K8. Faseplan (etter geofence-timeregistreringen)

| Fase | Innhold | Must / nice |
|---|---|---|
| **Forutsetning** | Geofence-timeregistreringen lever (geofencer + presence_events finnes) | — |
| **Fase a — Statisk kart** | Prosjekt- + kunde-pins, geofence-lag, klynger, søk, filtre, side-liste, lys/mørk, RBAC. Krever koordinat-migrasjon + geokoder ungated. Ingen persondata. | **Must** |
| **Fase b — Bemanning** | Terskel-supprimert bemannings-badge (binær <k / aggregert ≥k, default). Logget, pull-basert per-prosjekt mannskaps-oppslag (snapshot, kun prosjektansvarlig/admin, bak §9-2/DPIA-gate). Live aggregat via Broadcast-from-Database (kun prosjekt-nivå antall, ingen bruker-id) + REST cold-load. | **Must** |
| **Fase c — Lone-worker live-sporing** | **Droppet fra dette produktet.** Anbefaling: ikke bygg den — det holder produktløftet «status, ikke overvåking» troverdig. *Hvis* den noen gang bygges, må den være et **fysisk separat, eksplisitt opt-in, ansatt-kvittert sikkerhetsprodukt** med **egen DPIA, egen retensjon og egen tilgangsmodell** — **aldri** tilgjengelig fra det vanlige `/kart` eller dets UI-rammeverk. | **Droppet (anbefalt)** |

**Nice-to-have (senere):** «sett prosjektpunkt fra kart»; rute/ETA + kjørebok-kobling (opt-in);
«ledig mannskap i nærheten» (kun aggregert/binær, samme k-terskel); kunde-/prosjekt-tetthet for
salg; eget leder-kart i mobilappen. *Ingen* historisk replay/scrubber av ansatt-tilstedeværelse —
den slettes som idé, ikke utsettes.

---

## K9. Åpne beslutninger

1. **Plassering i nav:** egen toppnivå-`/kart` (leder+), eller nestet under «Min bedrift»
   (`/min-bedrift/kart`, konsistent med Kjørebok)? Anbefaling: nestet.
2. **Vises navn i mannskaps-oppslaget** (ikke i standardpanelet), eller bare binær «på plass»/initialer?
   Navn krever at §9-2-drøftingen er **gjennomført før visning** og at oppslaget logges per ansatt.
3. **Hvem ser mannskaps-oppslaget — AVGJORT (strengeste retning):** kun prosjektansvarlig/admin med
   `has_project_access` for *det* prosjektet. Terskel-supprimert aggregat/binær bemanning kan vises
   til ledere med prosjekttilgang. Aldri firma-bredt.
4. **k-terskelens verdi:** k = 3 (foreslått) vs. høyere for ekstra margin i små lag.
5. **Default basemap:** `base-v4` (ren) vs `streets-v4` (veikontekst) som standard.
6. **Kunde-pins default av eller på** — kan klusse til kartet for bemannings-fokuserte brukere.
7. **Manuell justering av prosjektpunkt** (dra pin) i fase a, eller kun geokodet adresse?

---

### Visuell spec for mockup

**Layout:** Fullbredde kart (`100dvh`, respekter iOS safe-area). Flytende venstre side-liste
(kollapsbar) med søkefelt øverst + filter-chips. Øverst-høyre: lag-toggle + tema-bryter som ett lite
glass-kort. Klikk-pin → flytende detaljkort (nede til venstre på desktop, bunn-ark på mobil).

**Lys modus:** basemap nær-hvit/lysegrå (`base-v4` light); panel-bakgrunn `#FFFFFF` med 92% opasitet
+ backdrop-blur; tekst `#1A1A1A`; hårstrek-kant `rgba(0,0,0,0.08)`; skygge `0 8px 24px rgba(0,0,0,0.10)`.

**Mørk modus:** basemap mørk grafitt (`base-v4-dark`); panel `#1C1C1E` med 88% opasitet + blur; tekst
`#F2F2F7`; kant `rgba(255,255,255,0.10)`; skygge `0 8px 24px rgba(0,0,0,0.45)`.

**Statusfarger (begge tema):** grønn `#34C759` (bemannet), gul `#FFCC00` (oppmerksomhet),
rød `#FF3B30` (varsel), nøytral `#8E8E93` (ubemannet). Kunde-pin: dempet blå-grå `#5E5CE6` @ 70%.

**Pin/markør:** ett dråpe-/sirkelformat, hvit kjerne med fargering etter status, ~28px, myk skygge.
**Bemannings-badge:** liten pille øverst-høyre på pinnen — under k-terskel viser den **statusprikk
uten tall** («bemannet»); ved k≥3 viser den **sirkel + tall** (`3`), fylt med statusfarge, hvit
tekst. **Aldri «1».** **Klynge:** énfarget nøytral sirkel med tall i midten, diameter vokser med
antall. **Geofence:** myk fyllt sirkel (statusfarge @ 12% opasitet) + 1.5px heltrukken kantlinje.

**Detaljkort innhold:** prosjektnavn (fet), adresse (dempet), statusprikk + status-tekst,
bemannings-rad — **«Bemannet»** (under terskel) eller **«3 på plassen nå»** (k≥3) — og en «Åpne
prosjekt»-knapp. For prosjektansvarlig/admin: en sekundær **«Vis mannskap»**-knapp som utløser et
**logget snapshot-oppslag** (ingen navn vises før det trykkes, oppslaget registreres i
`presence_lookup_audit`). **Ingen «borte»-rad finnes.** For kunde: navn, adresse, liste over
tilknyttede prosjekt-lenker.

**Side-liste rad:** statusprikk + prosjektnavn + kunde (dempet) + bemannings-pille til høyre
(prikk/«bemannet» under terskel, tall ved k≥3); hover/valgt-tilstand uthever tilsvarende pin på kartet.
