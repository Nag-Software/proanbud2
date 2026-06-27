# Fiken-integrasjon — komplett plan

> Status: **IMPLEMENTERT** 2026-06-22 (alle faser). Live OAuth/personlig-token-test gjenstår (krever Fiken-konto).
>
> **Feltsemantikk verifisert mot LIVE spec** (`api.fiken.no/api/v2/docs/swagger.yaml`, v2.0.0):
> - `vatType` er UPPERCASE (`NONE/HIGH/MEDIUM/LOW/...`) ✅
> - `invoiceishDraftLine.unitPrice` = **NET (eks MVA) i øre** — Fiken regner ut MVA fra `vatType`. (Mapperen ble rettet fra feilaktig brutto-oppgrossing.)
> - `invoiceishDraftRequest` krever `type` (`offer`/`invoice`), `customerId`, `daysUntilDueDate` ✅
> - `discount` = prosent, gis før rabatt trekkes (ingen dobbel rabatt) ✅
> - Betaling pollet via `GET /invoices?settled=true` (ikke `/sales`) — `invoiceResult.invoiceId` er nøkkelen vi lagrer; embedded `sale` har settled/settledDate ✅
> - `sendInvoiceRequest` krever `method[]` + `includeDocumentAttachments` ✅
> - `contact` krever kun `name`; `address` krever kun `country` ✅; `projectRequest` krever `startDate/number/name` ✅
>
> ---
>
> Opprinnelig plan/research (skrevet 2026-06-22):
> Mål: full Fiken-integrasjon med samme funksjonalitet som Tripletex (kunde-/prosjekt-/tilbud-/faktura-synk + betalingsstatus), gjenbruk av eksisterende leverandøruavhengig infrastruktur.

Alle API-fakta under er verifisert mot Fikens offisielle OpenAPI-spec (`https://api.fiken.no/api/v2/docs/swagger.yaml`, info.version 2.0.0) der ikke annet er nevnt. Punkter merket ⚠️ må bekreftes mot **live** spec/API før koding (research hentet noen detaljer fra community-mirror `bjerkio/fiken-js` fordi live-spec krevde auth).

---

## 1. TL;DR

- **Plumbingen er allerede leverandøruavhengig.** Tabellene `integration_jobs`, `external_entity_links`, `integration_webhook_events` har en `provider`-kolonne (verifisert: **ingen** CHECK-constraint på `provider` — kun på status-feltene). RPC-ene `integration_claim_jobs(p_worker, p_provider, p_limit)` og `integration_mark_job_*` tar allerede `p_provider`. Fiken bruker bare `provider='fiken'`. **Ingen migrasjon trengs på køtabellene.**
- **Tre fundamentale forskjeller fra Tripletex driver hele designet:**
  1. **Auth = OAuth2 authorization_code** (Bearer access+refresh, app-nivå `client_id`/`client_secret`) — *ikke* lim-inn-API-nøkkel. Personlige API-nøkler er **ToS-brudd** for tredjeparts-/multitenant-bruk; kun lov for eget firma (intern smoketest).
  2. **Fiken har INGEN webhooks.** Betalt-faktura-deteksjon må **pollet** via `GET /sales?settled=true`. Betalingsdata ligger på **salget** (`sale`), ikke fakturaen.
  3. **Fiken har ingen muterbar ordre og intet eksternreferanse-felt.** Tofase-flyten tilbud→ordre→faktura kollapser til tilbud→faktura, og `external_entity_links` blir den autoritative dedupe-kilden (sjekk-før-opprett på hver POST, siden Fiken mangler idempotency-key).
- **Strategi:** speil Tripletex fil-for-fil i `lib/integrations/fiken/*` + `app/api/integrations/fiken/*` + en innstillings-UI `app/min-bedrift/fiken/*`, pluss én ny tabell `fiken_connections`. Provider-abstraksjon (`AccountingProvider`-interface) anbefales som **oppfølging**, ikke for v1.
- **Estimat:** ~16 arbeidsdager fordelt på 6 faser (se §8).

---

## 2. Slik får du Fiken API-tilgang RASKT

Det finnes **ingen egen sandbox-host** — alt (prod + test) kjører på `https://api.fiken.no/api/v2`. Du tester ved å opprette et eget **testfirma** på prod.

### A) Rask intern smoketest (eget firma, minutter, ingen godkjenning)
1. Logg inn på Fiken → **Rediger konto → API → Personlige API-nøkler** → opprett nøkkel (utløper aldri, kan trekkes tilbake samme sted). ⚠️ Bekreft eksakt menynavn i live-UI; Fiken endrer av og til.
2. Test: `curl -H "Authorization: Bearer <token>" https://api.fiken.no/api/v2/companies` → får du company-`slug`.
3. Bruk **kun** dette til å validere connector/mappers lokalt. **Ikke** for kundebruk (ToS).

### B) Riktig oppsett for produktet (OAuth2 — påkrevd for multitenant)
1. Opprett et dedikert **testfirma** i Fiken, navngi tydelig f.eks. `ProAnbud Test`. Hvert firma får 30 dagers gratis prøve; firmaet eksponerer `testCompany=true` via `GET /companies`.
2. Aktiver **API-modulen** (betalt: **99 kr/mnd** per firma) under **Innstillinger → Modultilgang**. Innenfor prøveperioden kan du starte umiddelbart; e-post `api@fiken.no` for lengre gratis dev-tilgang.
3. Skru på **utvikler/OAuth-modus**: **Rediger konto → Profil → Andre innstillinger** → huk av utvikler-checkbox. Det låser opp en **API**-fane under **Brukerinnstillinger** der du oppretter en **App** og får **Client ID + Client Secret**. Sett redirect-URI til callback-en din. (Ingen e-post nødvendig for å *starte* utvikling.)
4. Sett env-variabler (§7) og kjør OAuth-flyten ende-til-ende mot testfirmaet.
5. **Produksjon / >5 kundefirma:** dev-tilgang er **begrenset til 5 brukere**. E-post `api@fiken.no` for produksjonsstatus — svartid er ikke publisert, så **be tidlig**.

### Verktøy under utvikling
- Interaktiv Swagger-UI: `https://api.fiken.no/api/v2/docs/` (autoriser med client-creds eller personlig token, sett `companySlug`, Execute).
- **Hent og pin live spec:** `https://api.fiken.no/api/v2/docs/swagger.yaml` for å låse eksakte feltnavn/enums (se §3 ⚠️-punkter) før du skriver mappers.

### Grenser (gjelder fra dag 1)
- **Maks 1 samtidig request per credential.** Brudd → HTTP 429, gjentatte brudd → **BANNET** (manuell oppheving via `api@fiken.no`).
- Throttling over **~4 req/s**. Kjør **alt serielt** med backoff.

---

## 3. Fiken API-referanse (verifisert)

| Tema | Fakta |
|---|---|
| **Base URL** | `https://api.fiken.no/api/v2` (kun TLS). Alle ressurser under `/companies/{companySlug}/...` |
| **company slug** | Streng-nøkkel i path (ikke numerisk id). Hent via `GET /companies` → `company.slug`, `organizationNumber`, `hasApiAccess`, `testCompany`. |
| **Auth** | `Authorization: Bearer <token>`. OAuth2 authorization_code: authorize `https://fiken.no/oauth/authorize`, token `POST https://fiken.no/oauth/token` (HTTP Basic med `client_id:client_secret`). Scopes: `read`, `write`. |
| **Token-respons** | `access_token`, `refresh_token`, expiry, scope. ⚠️ Eksakt `expires_in`-TTL og om refresh-token roterer må leses fra live-respons. ⚠️ PKCE-støtte ubekreftet (spec antyder confidential client + secret). |
| **Pagination** | Query `page` (0-indeksert, default 0) + `pageSize` (default 25, **maks 100**) — begge må settes. Responsheadere: `Fiken-Api-Page`, `Fiken-Api-Page-Size`, `Fiken-Api-Page-Count`, `Fiken-Api-Result-Count`. Loop til `Page == Page-Count - 1`. |
| **Opprett-mønster** | POST → **201 + `Location`-header** = full URL til ny ressurs (slutter på numerisk id). **Respons-body er tom** — les id-en fra `Location`, ikke body. PUT → 200 + Location. |
| **Idempotency** | **Ingen** Idempotency-Key. Kun rådgivende `X-Request-ID` (UUID) for sporing. Dedupe må gjøres klient-side. |
| **Feil** | Ressurs-API dokumenterer kun HTTP-status (400/401/403/404/405/415). Strukturert JSON-feilbody kun på OAuth-endepunkt (`{error, error_description}`). Aksepterer kun `application/json`. |
| **Beløp** | Heltall i **øre** (3000,00 NOK = `300000`). Mapper må gange med 100 og runde. |
| **MVA** | `vatType` string-enum: `HIGH` (25%), `MEDIUM` (15%), `LOW` (12%), `EXEMPT`, `EXEMPT_IMPORT_EXPORT`, `EXEMPT_REVERSE`, `OUTSIDE`, `NONE`. ⚠️ Casing: spec-eksempel viser `high`, beskrivelse `HIGH` — bekreft mot live. |

### Ressurser

**Contacts** (kunder OG leverandører — samme ressurs)
- `GET/POST /companies/{slug}/contacts`, `GET/PUT /contacts/{contactId}` (ingen DELETE — bruk `inactive:true`).
- Felter: `name` (eneste påkrevde), `email`, `organizationNumber`, `phoneNumber`, `customer`/`supplier` (bool, kan begge være true), `address{streetAddress, city, postCode, country}` (alle 4 påkrevd hvis adresse sendes), `language` (`NORWEGIAN`/`ENGLISH`), `inactive`.
- `customerNumber`/`supplierNumber` er **readOnly** (auto-tildeles). **Ingen eksternreferanse-felt.**
- **Dedupe:** filter `GET /contacts?organizationNumber=NNN` (eksakt match). Fallback e-post/navn for privatpersoner.

**Products**
- `GET/POST/PUT/DELETE /companies/{slug}/products[/{productId}]`.
- Felter: `name` (påkrevd), `unitPrice` (heltall øre, netto), `incomeAccount` (f.eks. `'3000'`), `vatType` (påkrevd), `active` (påkrevd), `productNumber`.

**Projects** (prosjekt — finnes!)
- `GET/POST /companies/{slug}/projects`, `GET/PATCH/DELETE /projects/{projectId}`.
- Create krever `startDate`, `number`, `name`; valgfritt `contactId`, `description`, `endDate`, `completed` (bool).
- Prosjekt → kunde via `contactId`. **Ingen prosjektleder/ansatt-modell.** Faktura → prosjekt via `invoiceRequest.projectId` (kun ved opprettelse).

**Sales: tilbud / ordrebekreftelse / faktura / kreditnota**
- **Tilbud:** `POST /offers/drafts` (body `invoiceishDraftRequest`) → `POST /offers/drafts/{draftId}/createOffer`. `GET /offers[/{id}]`.
- **Ordrebekreftelse:** `POST /orderConfirmations/drafts` → `.../createOrderConfirmation`. **Statisk dokument — ikke en muterbar/fakturerbar ordre.**
- **Faktura-utkast:** `POST /invoices/drafts` → `POST /invoices/drafts/{draftId}/createInvoice` (201 + Location). ELLER direkte `POST /invoices` (`invoiceRequest`).
- **invoiceRequest:** `customerId` (= Fiken `contactId`), `issueDate`, `dueDate`, `lines[]`, `bankAccountCode`, `cash`, `projectId`, `ourReference`/`yourReference`/`orderReference`. ⚠️ Eksakt required-array må bekreftes.
- **Linje:** `productId` ELLER `description`, `quantity`, `unitPrice`/`unitAmount` (heltall øre), `vatType`, `discount`, `incomeAccount`. ⚠️ `unitPrice` vs `unitAmount` (netto/brutto, hvilken som sendes) må bekreftes.
- **Send:** `POST /invoices/send` (`sendInvoiceRequest`), `method`: `email`, `ehf`, `sms`, `vipps`, `letter`, `auto`. EHF krever kundens org.nr + ELMA/PEPPOL-registrering. ⚠️ Om `method` er skalar/array bekreftes.
- **Kreditnota:** `POST /creditNotes/full`, `/creditNotes/partial`, draft-flyt, `/creditNotes/send`.
- **Linjer overføres IKKE automatisk** mellom tilbud og faktura — integrasjonen må kopiere linjesettet selv. Ingen convert-API.

**Vedlegg & dokumenter** (tilsvarer Tripletex documentArchive)
- Vedlegg (multipart): `POST /invoices/{id}/attachments`, `/contacts/{id}/attachments`, `.../drafts/{draftId}/attachments`. Filnavn må ende `.pdf/.png/.jpg/.jpeg/.gif`. ⚠️ Maks filstørrelse ikke dokumentert.
- Dokument-innboks: `GET/POST /companies/{slug}/inbox`.

**Betalingsdeteksjon (ingen webhooks → polling)**
- `GET /companies/{slug}/sales?settled=true&lastModifiedGe=<dato>`. `saleResult` har `settled`, `settledDate`, `totalPaid`, `outstandingBalance`, `paymentDate`, `salePayments[]`. `invoiceResult` har **ingen** betalt-bool — reconcile via embedded `sale`.
- ⚠️ **`lastModified` er DATO-granularitet** (`YYYY-MM-DD`, ikke timestamp). Kan ikke pollet "siden 14:32". Re-poll fra cursor-dato hver kjøring og **upsert-by-id** for å dedupe samme-dag-overlapp.

---

## 4. Tripletex → Fiken: kapabilitetskart

| Tripletex-kapabilitet | Fiken-ekvivalent | Vurdering |
|---|---|---|
| Auth: consumer+employee → 30-dagers session, Basic `0:token` | OAuth2 authorization_code, Bearer access+refresh | **tilpasses** (helt ny modell + OAuth-callback) |
| Session-refresh m/buffer (`session.ts`) | OAuth refresh_token-exchange; dynamisk TTL | **tilpasses** (lagre `expires_in`, roter refresh-token) |
| AES-256-GCM token-kryptering (`crypto.ts`) | Identisk | **direkte** (løft til `shared/crypto.ts`) |
| Test/prod-miljødeteksjon (`test-`-prefiks, api-test-host) | Ingen — `company.testCompany`-bool på samme host | **utgår** |
| Rate-limit-header → `rate_limit_reset_at` | Ingen reset-header; 1 samtidig + ~4 req/s + ban-risiko | **omgås** (global serialisering + token-bucket) |
| Kunde-upsert `/customer` | `/contacts` (`customer:true`) | **tilpasses** (slug-path, Location-id, `inactive` ikke DELETE) |
| Dedupe via `externalAccountsNumber`-oppslag | Intet eksternref-felt; kun `organizationNumber` + lokal lenketabell | **omgås** ⚠️ største bruddet |
| Prosjekt-upsert `/project` | `/projects` (CRUD finnes) | **tilpasses** (`completed` vs `isClosed`, ingen prosjektleder) |
| Tilbud via `project.isOffer=true` + orderlines | Førsteklasses `/offers/drafts` + `createOffer` | **tilpasses** (immutabelt dokument — ingen replace-lines) |
| Ordre (muterbar, fakturerbar) | `orderConfirmation` (statisk) | **omgås** — kollaps til tilbud→faktura |
| Faktura fra ordre | `/invoices/drafts` + `createInvoice` (el. direkte `POST /invoices`) | **tilpasses** (kopier linjer selv, øre, `vatType`-enum) |
| `default_vat_type_id`/`default_account_id` (numerisk) | `vatType`-enum + `incomeAccount`-streng | **tilpasses** |
| Send-til-kunde-flagg | `POST /invoices/send` m/`method[]` | **direkte** (rikere) |
| Dokument til prosjekt (`uploadTripletexProjectDocument`) | Vedlegg på faktura/kontakt/innboks | **tilpasses** (ikke på prosjekt) |
| Kalender/prosjektaktivitet | Ingen relevant skrive-flate | **utgår** |
| Webhooks (HMAC → `webhook.invoice_paid`) | INGEN | **utgår** → poll `GET /sales?settled=true` |
| Reconcile / pull_all | Paginerte GET m/`lastModified`-cursor | **tilpasses** |
| Jobbkø + RPC-er + backoff + dead-letter | Identisk (`provider='fiken'`) | **direkte** |
| `external_entity_links` | Identisk, men **opphøyet** til primær dedupe | **direkte** |

### Største gap (akseptert / mitigert)
1. **Ingen webhooks** → polling, deteksjon i minutter ikke sanntid.
2. **Dato-cursor** → re-poll + upsert-by-id.
3. **Ingen muterbar ordre** → tilbud→faktura (ordrebekreftelse valgfritt papirspor).
4. **Ingen eksternref + ingen idempotency** → lenketabell-sjekk-før-opprett på hver POST.
5. **Hard 1-samtidig + ban-risiko** → global serialisering (se §5, kritisk).
6. **Øre-heltall** → `round(value*100)`, eksplisitte avrundingstester.
7. **ToS/kostnad** → OAuth påkrevd, dev-cap 5 firma, 99 kr/mnd-modul.

---

## 5. Arkitektur (med review-korrigeringer)

### Gjenbruk som-det-er (leverandøruavhengig kjerne)
- `integration_jobs` + `integration_claim_jobs`/`integration_mark_job_*` RPC-er (db/08) — **verifisert** at `provider`-kolonnen er ukonstrenet TEXT, så `provider='fiken'` virker uten migrasjon.
- `external_entity_links` (opphøyes til autoritativ dedupe-kilde).
- Connection-helsestatemaskin (`sync_state`/`last_success_at`/`last_error_*`).
- `retry-failed`- og `worker`-cron-mønstrene, samt UI-shell (status-badge, jobb-aktivitetslogg, scope-toggles, toasts).

### Fork/skriv om (leverandørspesifikt)
- HTTP+auth-laget (Bearer + OAuth-refresh vs Basic + session-exchange).
- Alle mappers (øre-heltall, `vatType`-enum, slug-scopede paths, Location-header-id-parsing).
- Tilbud/faktura-flyt (tilbud→faktura, ingen muterbar ordre).
- Dedupe-strategi (lenketabell-først).

### 🔴 Kritisk: cross-invocation-mutex (ban-beskyttelse)
Batch-størrelse 1 + modul-nivå token-bucket er **ikke nok** — to overlappende cron-kjøringer (eller worker + poller samtidig) kjører i **separate serverless-instanser** og kan fyre Fiken-kall parallelt mot samme credential → ban. **Krav (Fase 1, ikke "hardening"):**
- Skaff en **per-connection lås** øverst i BÅDE worker OG poller: `pg_advisory_xact_lock(hashtext('fiken:'||company_id))` eller `SELECT ... FOR UPDATE` på connection-raden. Kun én prosess rører en credential av gangen.
- **Alternativt:** slå sammen worker + betalings-poll til ÉN seriell cron-entrypoint så de aldri overlapper. (Anbefalt — enklere.)
- Token-bucket (<4 req/s) i connector-laget i tillegg.

### OAuth-flyt
- `GET /api/integrations/fiken/oauth/start` → opprett `fiken_oauth_state`-rad (random `state` → `company_id` [+ `code_verifier` hvis PKCE]) → redirect til authorize.
- `GET /api/integrations/fiken/oauth/callback` → valider `state` (CSRF, utløp), exchange `code` (Basic client-creds), krypter+lagre tokens, `GET /companies` → fang `slug` + `testCompany` (slug-velger hvis flere firma), upsert `fiken_connections`. **Utsett** reconcile/poll-enqueue til ETTER slug er valgt, og rut gjennom den serialiserte workeren (ikke inline i callback).

### Provider-gating for triggere (review-korrigert)
- **IKKE** rør `companies.contract_provider` (verifisert `CHECK IN ('docusign','tripletex')` — det er **e-signering**, ikke regnskap).
- Den faktiske ERP-gaten er `contracts.erp_provider` (`CHECK IN ('tripletex','none')`) + `companies.tripletex_order_trigger`.
- **Anbefalt v1:** gate på hvilken connection-rad som finnes (`fiken_connections` vs `tripletex_connections`). Begge triggerne (`on-offer-accepted.ts`, `offers/[id]/send/route.ts`) leser i dag ingen provider-kolonne.
- Hvis eksplisitt valg ønskes: legg til **ny** kolonne `companies.accounting_provider` ELLER utvid `contracts.erp_provider` til `('tripletex','fiken','none')` — ikke overlast `contract_provider`. **Avklar først:** kan ett firma koble både Tripletex og Fiken samtidig? (Åpent spørsmål §9.)

---

## 6. Database-migrasjoner

Manuelle nummererte filer (neste ledige: **db/36+**).

### `db/36_fiken_connections.sql`
Ny tabell som speiler `tripletex_connections`. RLS (company-scoped select; admin/manager manage), `handle_updated_at`-trigger, unik på `company_id` — kopier DO-block-mønsteret fra `db/08_tripletex_integration.sql` verbatim, tabell-omdøpt.

```sql
CREATE TABLE IF NOT EXISTS public.fiken_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  -- OAuth2 (authorization_code), AES-256-GCM-kryptert
  access_token_enc TEXT,
  refresh_token_enc TEXT,
  token_expires_at TIMESTAMPTZ,
  -- valgfri personal-token-modus (kun eget firma)
  personal_token_enc TEXT,
  auth_mode TEXT NOT NULL DEFAULT 'oauth' CHECK (auth_mode IN ('oauth','personal')),
  -- Fiken firma-scoping
  fiken_company_slug TEXT,
  is_test_company BOOLEAN NOT NULL DEFAULT false,
  -- Fiken-defaults (ingen numeriske ider)
  default_vat_type TEXT,          -- f.eks. 'HIGH'
  default_income_account TEXT,    -- f.eks. '3000'
  default_bank_account_code TEXT, -- for POST /invoices
  -- helse/livssyklus (speiler tripletex_connections)
  sync_state TEXT NOT NULL DEFAULT 'connected'
    CHECK (sync_state IN ('connected','degraded','disconnected')),
  last_success_at TIMESTAMPTZ,
  last_error_at TIMESTAMPTZ,
  last_error_message TEXT,
  -- dato-cursor for betalings-polleren
  last_payment_poll_date DATE,
  scope_config JSONB NOT NULL DEFAULT
    '{"contacts":true,"projects":true,"offers":true,"invoices":true,"products":false,"inbox":false}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (company_id)
);
CREATE INDEX IF NOT EXISTS fiken_connections_company_idx ON public.fiken_connections (company_id);
ALTER TABLE public.fiken_connections ENABLE ROW LEVEL SECURITY;
-- + handle_updated_at-trigger og RLS-policies (kopier fra db/08, tabell-omdøpt)
```

### `db/37_fiken_oauth_state.sql`
Kortlevd CSRF/state-lager for OAuth-redirecten (mapper random `state` → `company_id`). Inkluder `code_verifier`-kolonne **i tilfelle PKCE kreves** (billig forsikring).

```sql
CREATE TABLE IF NOT EXISTS public.fiken_oauth_state (
  state TEXT PRIMARY KEY,
  company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.users(id),
  code_verifier TEXT,            -- PKCE (hvis påkrevd)
  redirect_to TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX IF NOT EXISTS fiken_oauth_state_expiry_idx ON public.fiken_oauth_state (expires_at);
ALTER TABLE public.fiken_oauth_state ENABLE ROW LEVEL SECURITY;
-- service_role-only (callback kjører server-side med admin-klient)
```

### `db/38_fiken_links_and_gating.sql`
**Korrigert fra første utkast** — ikke rør `contract_provider`.

```sql
-- Køtabellene trenger INGEN endring: provider-kolonnen er ukonstrenet TEXT (verifisert),
-- og RPC-ene tar allerede p_provider.

-- Raskere "flip-til-betalt"-skann i betalings-reconcile:
CREATE INDEX IF NOT EXISTS external_entity_links_fiken_invoice_idx
  ON public.external_entity_links (company_id, provider, entity_type, sync_status)
  WHERE provider = 'fiken';

-- Gating (VELG ÉN — avklar åpent spørsmål først):
-- ALT A (anbefalt v1): ingen kolonne — gate på connection-eksistens i koden.
-- ALT B: utvid ERP-provider (IKKE contract_provider):
--   ALTER TABLE public.contracts DROP CONSTRAINT IF EXISTS contracts_erp_provider_check;
--   ALTER TABLE public.contracts ADD CONSTRAINT contracts_erp_provider_check
--     CHECK (erp_provider IN ('tripletex','fiken','none'));
-- ALT C: ny kolonne companies.accounting_provider.
```

---

## 7. Fil-for-fil-plan

### lib/integrations/
| Fil | Speiler | Innhold |
|---|---|---|
| `shared/crypto.ts` **(ny)** | `tripletex/crypto.ts` | Løft AES-256-GCM verbatim. Én kanonisk nøkkelresolusjon: `FIKEN_ENCRYPTION_KEY` → fallback `TRIPLETEX_ENCRYPTION_KEY`, **feil høylytt hvis ingen**. Importér direkte alle steder (dropp per-provider re-export-shims). |
| `fiken/config.ts` | `tripletex/config.ts` | `getFikenBaseUrl()` (default `https://api.fiken.no/api/v2`), `getFikenClientId/Secret()`, OAuth-endepunkt-konstanter, `getFikenRedirectUri()`. Ingen test/prod-token-inspeksjon. |
| `fiken/connector.ts` | `tripletex/connector.ts` | `fikenRequest(conn, {method, path, body})` → Bearer-header, prefiks `/companies/{slug}`, 25–30s timeout, parse `Location`-header til id, 429→backoff. OAuth-helpere: `exchangeFikenCode`, `refreshFikenAccessToken`. **Token-bucket-limiter (<4 req/s, 1 in-flight).** Ressurs-fns: `upsertFikenContact`, `getFikenContactByOrgNumber`, `upsertFikenProject`, `createFikenOfferDraft`+`createOffer`, `createFikenInvoiceDraft`+`createInvoice`, `sendFikenInvoice`, `uploadFikenAttachment`, `listFikenSalesSettled`, `getFikenCompanies`. |
| `fiken/session.ts` | `tripletex/session.ts` | `ensureFreshFikenConnection`/`getFreshFikenConnection`: sjekk `token_expires_at` minus buffer (~5 min), refresh, **persister rotert refresh_token + expires_in**. Personal-modus hopper over refresh. `disconnected` = terminal. |
| `fiken/scopes.ts` | `tripletex/scopes.ts` | `buildFikenScopeConfig()`: contacts, projects, offers, invoices, products, inbox (ingen calendar/documents). |
| `fiken/types.ts` | `tripletex/types.ts` | `FikenConnectionRow`, `FikenContactPayload`, `FikenProjectPayload`, `FikenInvoiceishDraftRequest`/`...LineRequest`, `FikenInvoiceRequest`. Flytt `IntegrationJobRow` til shared. |
| `fiken/vat.ts` **(ny)** | n/a | `mapVatPercentToFikenVatType(pct)`: 25→`HIGH`, 15→`MEDIUM`, 12→`LOW`, 0→`EXEMPT`/`NONE`. |
| `fiken/mappers.ts` | `tripletex/mappers.ts` | `mapCustomerToFiken`, `mapProjectToFiken`, `mapOfferDraftFromOffer`, `mapInvoiceDraftFromOffer`, `mapFikenLinesFromOffer` (NOK→øre `*100` round, `vatType`-enum, markup-før-rabatt bevart, rabatt separat). Dropp prosjektleder. |
| `fiken/jobs.ts` | `tripletex/jobs.ts` | `provider='fiken'`-wrappers. **Helst:** ekstraher provider-nøytrale fns fra `tripletex/jobs.ts` til shared (dagens `jobs.ts` hardkoder `'tripletex'`) heller enn å duplisere. |
| `fiken/worker.ts` | `tripletex/worker.ts` | `runFikenWorker()`: **per-connection-lås** + batch 1, dispatch på `job_type`: `contact.upsert`, `project.upsert`, `offer.create_from_offer`, `invoice.create_from_offer`, `invoice.send`, `document.upload`, `poll_payments`, `reconcile.full`. Hver create: lenketabell-først-dedupe, parse Location-id, **persister lenke før markComplete**. |
| `fiken/sync.ts` | `tripletex/sync.ts` | `enqueueOfferFikenSync` (kollapset DAG: `contact.upsert → [project.upsert?] → offer.create_from_offer` (send) / `invoice.create_from_offer` (accept)), `processFikenQueueInBackground`, `fetchOfferFikenSyncStatus`, `enqueueFikenPaymentPoll`. |
| `fiken/payments.ts` **(ny)** | erstatter `webhook.invoice_paid` | `pollFikenPayments(conn)`: paginér `GET /sales?settled=true&lastModifiedGe=<cursor>` seriellt, map settled-salg → faktura via lenketabell, **flip `sync_status` til 'paid' KUN ved overgang** (ikke hver poll), kall on-paid-hook én gang, avansér `last_payment_poll_date`. |
| `fiken/urls.ts` | `tripletex/urls.ts` | Deep-links til `fiken.no/foretak/{slug}/...`. |

> ⚠️ Note: `external_entity_links.sync_status` CHECK er i dag `('pending','synced','error','deleted')` (verifisert). `'paid'` er **ikke** tillatt — enten utvid den CHECK-en i db/38, eller bruk et separat felt/`'synced'`+metadata for betalt-status. **Avklar.**

### app/api/integrations/fiken/
| Rute | Speiler | Innhold |
|---|---|---|
| `route.ts` | `tripletex/route.ts` | GET status (sync_state, slug, testCompany, scope, jobb-stats — ingen webhook-events), PATCH `disconnect`/`update_scope`/`sync_now`, DELETE. RBAC: medlemskap + admin/manager. |
| `oauth/start/route.ts` **(ny)** | n/a | GET (admin/manager): opprett `fiken_oauth_state`, redirect til authorize. |
| `oauth/callback/route.ts` **(ny)** | n/a | GET: valider state, exchange code, lagre tokens, `GET /companies` → slug+testCompany, upsert connection, (utsatt) enqueue reconcile via serialisert worker. |
| `worker/route.ts` | `tripletex/worker/route.ts` | Cron-entrypoint. POST validerer `INTEGRATION_WORKER_SECRET`/`CRON_SECRET`, kjører `runFikenWorker` serialisert. |
| `reconcile/route.ts` | `tripletex/reconcile/route.ts` | POST (CRON_SECRET): enqueue contact-pull + `reconcile.full` + `poll_payments`. **Polling-entrypoint som erstatter webhook.** |
| `retry-failed/route.ts` | `tripletex/retry-failed/route.ts` | POST: reset failed/dead_letter → retry. Nær-verbatim m/`provider='fiken'`. |

### app/ (UI + triggere)
| Fil | Handling | Innhold |
|---|---|---|
| `app/min-bedrift/fiken/page.tsx` **(ny)** | speiler tripletex | Server-page: hent `fiken_connections` + nylige jobber. Gated admin/manager/prosjektleder. Ingen webhook-fetch. |
| `app/min-bedrift/fiken/fiken-client.tsx` **(ny)** | speiler tripletex | "Koble til Fiken"-OAuth-knapp, slug + testCompany-badge, scope-toggles, koble til/fra/synk-nå, status-dashboard, jobb-logg. Ingen webhook-panel/kalender. Hjelpe-lenke `hjelp.fiken.no/api`. |
| `app/innstillinger/integrasjoner/page.tsx` | **modify** | Wire eksisterende Fiken-placeholder-kort → `/min-bedrift/fiken`, vis tilkoblet-status, fjern "Kommer senere". |
| `lib/tilbud/on-offer-accepted.ts` | **modify** | Kall `enqueueOfferFikenSyncAndProcess` (fase accept → faktura) når Fiken er tilkoblet provider. Gate på connection-eksistens. |
| `app/api/offers/[id]/send/route.ts` | **modify** | Trigger `enqueueOfferFikenSyncAndProcess` (fase send → opprett tilbud) ved offer-send når Fiken tilkoblet. |
| `app/api/offers/[id]/fiken-sync/route.ts` **(ny)** | speiler `tripletex-sync` | GET status + POST manuell per-tilbud-synk. |
| `vercel.json` | **modify** | Legg til Fiken worker + reconcile/poll cron. ⚠️ **Bekreft cron-tier først** (se §9) — eksisterende crons er daglige; sub-daglig kan kreve Pro-plan. |
| `tests/integrations/fiken-mappers.test.ts` **(ny)** | speiler tripletex-test | Unit-tester: øre-konvertering+avrunding, markup-før-rabatt, vat-enum, Location-id-parsing. |

---

## 8. Env-variabler

| Variabel | Formål |
|---|---|
| `FIKEN_CLIENT_ID` | OAuth2 app client_id (app-nivå, delt på tvers av firma). |
| `FIKEN_CLIENT_SECRET` | OAuth2 client_secret (Basic ved token-exchange/refresh). Kun server. |
| `FIKEN_OAUTH_REDIRECT_URI` | Registrert callback, f.eks. `https://app.proanbud.no/api/integrations/fiken/oauth/callback`. Må matche Fiken-App nøyaktig. |
| `FIKEN_ENCRYPTION_KEY` | 32-byte base64 AES-256-GCM-nøkkel for token-kryptering. Fallback `TRIPLETEX_ENCRYPTION_KEY`. |
| `FIKEN_BASE_URL` | Override (default `https://api.fiken.no/api/v2`). |
| `INTEGRATION_WORKER_SECRET` | **Finnes** — gjenbrukes for Fiken worker/reconcile-cron. |
| `CRON_SECRET` | **Finnes** — gjenbrukes for scheduled Fiken-kjøringer. |

---

## 9. Faseplan (~16 dager)

> **Harde porter** (review-korrigert):
> - **Port A (før Fase 2):** hent+pin LIVE `swagger.yaml`, lås `unitPrice` vs `unitAmount`, `vatType`-casing, `method`-kardinalitet, required-arrays, evt. nye metadata-felt. Smoketest: POST én faktura-draft mot testfirma og verifiser aksepterte feltformer. **Blokkerer mapper-koding.**
> - **Port B (i Fase 1, ikke senere):** cross-invocation per-connection-lås på plass i både worker og poller.

| Fase | Leveranser | Innsats |
|---|---|---|
| **0 — Fundament** | Løft `crypto.ts`→shared; ekstraher provider-nøytrale jobb-helpere; db/36+37+38 migrasjoner; pin live swagger.yaml. | ~1,5 d |
| **1 — Auth & livssyklus** | `config.ts`, `connector.ts` (Bearer, token-bucket, Location-parsing, **per-connection-lås**), `session.ts` (refresh); OAuth start+callback; `fiken_oauth_state` CSRF; `GET /companies` slug-fangst + multi-firma-velger; `route.ts` (status/disconnect/scope/sync_now/DELETE); retry-failed. Smoketest OAuth ende-til-ende. | ~3 d |
| **2 — Mappers & skrive-sti** | `types.ts`, `vat.ts`, `mappers.ts` (øre, vat-enum, adresse-subfelt); `jobs.ts`+`worker.ts` m/lenketabell-først-dedupe + create-handlere; `sync.ts` (kollapset DAG); `urls.ts`; mapper-tester grønne. | ~4 d |
| **3 — Polling-reconcile** | `payments.ts` `pollFikenPayments` (paginert settled-salg, dato-cursor, upsert-by-id, flip-til-paid **kun ved overgang**); worker `poll_payments`+`reconcile.full`; reconcile-rute + worker-rute; vercel.json-cron (serialisert). Verifiser deteksjonslatens + samme-dag-dedupe. | ~2,5 d |
| **4 — Triggere & UI** | Wire `on-offer-accepted.ts` + `offers/[id]/send/route.ts`; `min-bedrift/fiken/*`; wire integrasjoner-kort; `offers/[id]/fiken-sync`. Ende-til-ende: send→tilbud, accept→faktura+send, betaling→paid. | ~3 d |
| **5 — Herding & utrulling** | Ban-risiko-gjennomgang (global serialisering bekreftet); dedupe/retry-sikkerhet; dokumentér api@fiken.no-godkjenning + 99 kr/mnd i UI; be om produksjonsstatus tidlig; staged rollout bak feature-flag. | ~2 d |

---

## 10. Risikoer

1. **BAN fra samtidighet** — 1 samtidig + ~4 req/s; gjentatte brudd → bannet credential. Worker OG poller må globalt serialiseres (per-connection-lås + token-bucket). Største drift-risiko.
2. **Duplikat-ressurser fra ikke-idempotente POST-er** — ingen Idempotency-Key/eksternref. Hver handler MÅ sjekke `external_entity_links` først og persistere lenke før `markJobCompleted`. Største korrekthet-risiko.
3. **Betalt-deteksjon latens + dato-cursor** — poll-intervall (minutter), re-poll + upsert-by-id; flip-til-paid kun ved overgang ellers dobbel on-paid-hook.
4. **Modellgap — ingen muterbar ordre** — kollaps endrer forretningssemantikk; nedstrøms logikk som forventer Tripletex-ordre (delfakturering) har ingen Fiken-ekvivalent.
5. **Beløp-enhet-bugs** — øre-heltall; glemt `*100` gir feil totaler. Eksplisitte avrundingstester.
6. **Spec-drift** — ⚠️-feltene må pinnes mot live spec før koding (ellers 400-er).
7. **Onboarding/kostnad** — OAuth dev-cap 5 firma til prod-godkjenning; 99 kr/mnd-modul. UI må forklare så kunder ikke blokkeres stille.
8. **OAuth-callback-sikkerhet** — `state`→firma-mapping må være CSRF-trygg + utløpe.
9. **Refresh-token-rotasjon** — lagre alltid nyeste refresh_token, ellers brytes connection stille.

---

## 11. Åpne spørsmål (avklar før/under bygging)

1. **Kan ett firma koble både Tripletex og Fiken samtidig**, eller er regnskaps-provider gjensidig utelukkende? Driver gating-logikken i triggerne. *(Anbefaling: tillat én aktiv om gangen i v1.)*
2. **Gating-mekanisme:** connection-eksistens (anbefalt) vs ny `accounting_provider`-kolonne vs utvid `erp_provider`.
3. **OAuth access-token TTL + roterer refresh-token?** Les fra live token-respons.
4. **PKCE påkrevd?** Avgjør start/callback + om `code_verifier` trengs.
5. **`unitPrice` vs `unitAmount`, `vatType`-casing, required-felt for POST /invoices, `method`-kardinalitet** — pin mot live swagger.yaml (Port A).
6. **`external_entity_links.sync_status` mangler `'paid'`** i CHECK — utvid eller bruk separat betalt-markør.
7. **Vercel cron-tier** — støtter planen sub-daglige crons? Eksisterende er daglige. Hvis ikke: ekstern scheduler (QStash) / self-reschedule / aksepter daglig polling.
8. **Ordrebekreftelse:** opprett for papirspor ved accept, eller rett til faktura?
9. **EHF/PEPPOL-sending** ønsket (krever org.nr + ELMA + EHF aktivert i Fiken), eller e-post-only til start?
10. **Provider-abstraksjon** (`AccountingProvider`-interface) nå eller etter v1? *(Anbefaling: etter v1.)*
11. **Bekreft no-webhooks** mot Fiken developer-changelog / `api@fiken.no` før poll-only låses.
