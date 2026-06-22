# ProAnbud — Feature-roadmap for bygg-SMB (1–20 ansatte)

Fem features (dine #1, #2, #3, #5, #7), sekvensert etter **verdi/avhengighet** — ikke nummerrekkefølge. Hver oppgave er forankret i eksisterende kode.

**Tverrgående regler (gjelder ALT under):**
- DB-migrasjoner kjøres **manuelt** i Supabase, nummereres fortløpende (`db/33`, `34`, …). Kjør `pnpm db:migrate:baseline` først (når `DATABASE_URL` er satt).
- **RLS company-scoped** på alle nye tabeller: sett `company_id` ved insert + policyer (kopier `contracts` db/23 for prosjekt-scopet, `offers` db/07 for company-scopet, db/30 for `users.company_id`-mønster).
- Alle **KI-/utsendings-/betalte** handlinger bak `requireActiveSubscription` + `assertCompanyHasModule` + `recordUsageEvent` (stabil `idempotencyKey`).
- **Tripletex-push:** gjenbruk idempotent jobbkø + `external_entity_links` + `buildOrderLine` (markup-FØR-rabatt — aldri unitpris-etter-rabatt + `discount` samtidig).

---

## Fase 0 — Delt fundament (bygg ÉN gang, før features)

Tre av fem features blokkeres på samme bilde-/storage-lag. Bygg det én gang.

- [ ] **Delt foto-/kamera-capture-komponent** `components/shared/photo-capture.tsx` — `<input accept="image/*" capture="environment" multiple>`, opplasting via `/api/tilbud/source-documents` (bucket `documents`). Lagre `storage_path`, **ikke** signed URL. [Tilleggsarbeid/Befaring/FDV]
- [ ] **Signed-URL re-sign-helper + admin-klient-tilgangslag** — re-sign paths ved hver visning (URLer utløper 60 min/24t); admin-klient for kryss-team-lesing.
- [ ] **Utvid `OFFER_ACTIVITY`-konstanter** `lib/tilbud/offer-activity.shared.ts` — `CHANGE_ORDER_*`, befaring/AI-konvertering, `FDV_*` (TEXT-kolonne, ingen migrasjon).
- [ ] **Standardiser mobil-UI-mønstre** — touch-mål `min h-14`, sticky bunn-CTA, tabell→kort (`hidden md:block` / `md:hidden`), `hidden: isWorker`-faner.

---

## Fase 1 — Etterkalkyle / jobblønnsomhet (#3) · raskest verdi, lavest risiko

Nesten ren aggregering av data som ALLEREDE finnes (offers.line_items, time_entries, hourly_rates). Eneste reelle datamangel: materialkost.

- [ ] `db/33_job_costing.sql`: `project_material_costs` (company_id, project_id, supplier_name, description, amount_nok NUMERIC(12,2), invoice_ref, cost_date) + RLS + indekser **[S]**
- [ ] `db/33`: `ALTER hourly_rates ADD cost_rate_nok NUMERIC(12,2) NULL` — skill **kostpris** fra salgspris **[S]**
- [ ] `lib/job-costing/calc.ts` — rene margin-funksjoner (`computeOfferCalculatedCost` via `calculateLineItemUnitPriceWithMarkupBeforeDiscount`, `computeLaborCost`, `computeMargin`), enhetstestbart **[S]**
- [ ] `getProjectJobCostingAction` — aggreger **accepted** offers + sum timer (completedEntriesQuery) + materialkost + kostpris **[M]**
- [ ] CRUD-actions for materialkost (add/update/delete + revalidatePath) **[M]**
- [ ] Etterkalkyle-fane (`hidden: isWorker`) + KPI-kort: omsetning / lønnskost / materialkost / dekningsbidrag **[M]**
- [ ] Materialkost-registrerings-UI (liste + dialog, mobil; valgfritt produktsøk mot supplier_price_rows) **[M]**
- [ ] (valgfri) margin-badge på `OfferCard` for aksepterte tilbud **[S]**

⚠ Kun `status='accepted'` som omsetning. `cost_rate_nok` ≠ `hourly_rate_nok` (salg). time_entries har ingen sats-kobling i dag → velg kostpris bevisst.

---

## Fase 2 — Tilleggsarbeid / endringsordre (#1) · direkte inntekt, mest gjenbruk

Fanger fakturerbare tillegg som glipper i felt. Gjenbruker offentlig aksept-flyt, aktivitetslogg, Tripletex-push og kontrakt-entitetsmønster.

- [ ] `db/34_change_orders.sql`: `change_orders` (offer_id, project_id, line_items JSONB, amount NUMERIC(14,2), public_slug, status `draft→varslet→sent→viewed→accepted/rejected→synced`, signing_*, erp_*) + `change_order_photos` + public_slug partial-unique-index + RLS (contracts-mønster db/23) **[M]**
- [ ] Utvid `OFFER_ACTIVITY` med `CHANGE_ORDER_*` (gjort i Fase 0) **[S]**
- [ ] `lib/tilleggsarbeid/change-order.ts` — CRUD, `normalizeChangeOrderLineItems` (gjenbruk OfferLineItem), `ensureChangeOrderPublicSlug` **[M]**
- [ ] API: opprett/liste (`/api/tilbud/[id]/tilleggsarbeid`) + bilde-opplasting (gjenbruk Fase 0) **[M]**
- [ ] API: send-til-kunde — status→`sent`, `notified_at` = **NS 8405/8407 skriftlig varsling** + e-post/SMS-lenke **[M]**
- [ ] Offentlig view + **race-sikret** respond (`.eq('status', …)` + kjør side-effekt KUN når rad faktisk oppdatert) **[M/L]**
- [ ] UI: 'Tillegg'-fane i `offer-detail-client` + mobil-skjema + offentlig kundevisning (kopi av tilbudsvisning) **[L]**
- [ ] Push godkjent tillegg til Tripletex — idempotent jobType, vent på offerens hovedordre (`not-yet-synced` retry-mønster) **[L]**
- [ ] (valgfri) signeringssteg via DocuSign når `signing_required` **[M]**

⚠ Ikke push til ERP/faktura før kunde-godkjent. Gjenbruk markup-før-rabatt-mapperen.

---

## Fase 3 — Befaring-app (#2) · spar kveldsadmin (mobil KI)

Mer ny mekanikk: lydopptak + Whisper + gjenbruk av KI-generatorkjernen.

- [ ] `db/35_befaringer.sql`: `site_visits` (offers-mønster: photos, measurements, notes, voice_transcript) + RLS (vurder worker-skrive) **[M]**
- [ ] Whisper-rute `/api/befaring/transcribe` — multipart til OpenAI `audio/transcriptions` (whisper-1, no). **`openaiFetch` er kun JSON i dag → utvid for FormData.** Gate + `recordUsageEvent('whisper_transcription')`, maxDuration=60 **[M]**
- [ ] `voice-recorder.tsx` (MediaRecorder/getUserMedia — ny i kodebasen) **[M]**
- [ ] `measurements-input.tsx` (mål-repeater, inputMode=decimal) + gjenbruk Fase 0 capture **[S]**
- [ ] `lib/befaring/build-offer-input.ts` (adapter site_visit → KI-input + SaveOfferInput) **[S]**
- [ ] `/api/befaring/generer` — bilder (`input_image`) + transkript inn i eksisterende **multimodal generator (Responses API, ikke chat/completions)** **[L]**
- [ ] `app/befaring` sider + befaring-client + 'Konverter til tilbud' via `saveOfferDraftAction` **[L]**

⚠ Re-sign bilde-URLer ved gjenåpning. RBAC: bestem worker vs admin/manager bevisst. KI-kall: `requireActiveSubscription` + `recordUsageEvent('ai_befaring')`.

---

## Fase 4 — Mobil timeføring (#5, utvidelse) · bygger på eksisterende

Timeføring finnes (db/18 time_entries + UI). Dette er **utvidelse**: enkel stempling + lønnsgrunnlag + Tripletex-timeliste.

- [ ] `db/36_timeforing_payroll.sql`: `ALTER time_entries` (hourly_rate_id, break_minutes, edited_by/at) + `ALTER users` (default_hourly_rate_id, employee_no) + ny RLS `managers_correct_company_time_entries` + `idx(company_id, entry_date)` **[S]**
- [ ] Mobil stemplingsskjerm + `getMyAssignedProjectsAction` (prosjektvelger uten å gå inn i hvert prosjekt) + snarvei i mobilnav **[M]**
- [ ] `lib/payroll/wage-basis.ts` — netto timer (hours − break) × sats per ansatt/periode **[M]**
- [ ] Lønnsgrunnlag-tab (leder/admin) + CSV-eksport-rute (kopi av `avvik/export`-mønster) **[M/S]**
- [ ] Leder-korreksjon av økter (krever ny RLS fra db/36) **[M]**
- [ ] Tripletex timeliste-synk — `timesheet.push` worker-case + `external_entity_links` (gjenbruk Fase 2 push-pipeline) **[L]**
- [ ] (fase 2) a-melding/lønnsfil-format **[L]**

⚠ Én aktiv økt per bruker på tvers av ALLE prosjekter (eksisterende unik-index) — håndtér «aktiv økt annet sted». `hourly_rates` er salgspris i dag → koble sats til ansatt. Modul-gate `timeforing`.

---

## Fase 5 — Sluttdokumentasjon / FDV-generator (#7) · sist

Avhenger av artefaktene de andre produserer. Tyngst nybygg (zip + kryss-team-innsamling).

- [ ] `db/37_fdv_packages.sql`: `fdv_packages` + `fdv_package_items` + privat `fdv`-bucket + RLS **[M]**
- [ ] `pnpm add archiver` (eller jszip) + `lib/fdv/build-zip.ts` **[S]**
- [ ] `lib/fdv/collect-artifacts.ts` — samle prosjektdok/bilder + lukkede avvik + KS + HMS-håndbok. **MÅ bruke admin-klient (per-bruker document_items-RLS)** + collect-rute **[L/S]**
- [ ] `lib/fdv/fdv-document.ts` (puppeteer-PDF, speil `offer-document.ts`) + generate-rute (nodejs, maxDuration 60) **[L/M]**
- [ ] FDV-fane (`hidden: isWorker` / ModuleGate) + nedlasting PDF+zip + (valgfri) Resend-utsending + overtakelses-flyt **[L]**

⚠ **KRITISK:** `document_items` + `documents`-bucket er per-bruker (`user_id=auth.uid()`) — kryss-team-innsamling MÅ gå via service-role/admin-klient, ellers ser generatoren bare egne filer. Kun absolutt logo-URL i PDF.

---

## Delt infrastruktur som flere features deler (bygg/avklar én gang)
- Foto-capture + storage-mønster (Fase 0) → Tilleggsarbeid, Befaring, FDV.
- Offentlig kundeflyt (slug→view→respond, race-sikret) → Tilbud (finnes) + Tilleggsarbeid.
- Tripletex idempotent push-pipeline → Tilleggsarbeid + Timeføring.
- `hourly_rates` kostpris vs salgspris (`cost_rate_nok` + `users.default_hourly_rate_id`) → Etterkalkyle + Timeføring.
- Billing/kvote-gate → Befaring (KI+Whisper), Tilleggsarbeid (utsending), Timeføring (modul), FDV (ModuleGate).
