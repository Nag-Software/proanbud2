# Selgermaskinen v2 — autonom KI-pipeline for /selger

## Status (oppdatert 2026-09-12)

Fase 0–4 er bygget og ligger på `preview`. Dette avsnittet er fasiten på hva
som faktisk finnes i koden; resten av dokumentet er planen den ble bygget etter,
og noen detaljer nedenfor ble justert underveis (se «Avvik fra planen»).

| Fase | Innhold | Status |
|---|---|---|
| 0 | Porter, ICP-import, faktaark (db/90) | Ferdig |
| 1 | Research, dossier, skrivemotor, godkjenning (db/91) | Ferdig |
| 2 | Sekvens, IMAP-svarløkke, tick, helse, beacon (db/92–93) | Ferdig |
| 3 | Cockpit, svarflate, traktstripe, segmenter, innstillinger | Ferdig |
| 4 | Læring, autonomi, partnersegment, gaven, sletting (db/94) | Ferdig |

**Før maskinen kan sende én eneste ekte e-post, må Casper:**

1. Kjøre migrasjonene: `pnpm db:migrate` (db/91 → db/94).
2. Legge `CRON_SECRET` inn i Supabase Vault, og så kjøre db/93:
   `select vault.create_secret('<hemmelighet>', 'cron_secret', 'Bearer-token for /api/cron/*');`
   Uten den opprettes ingen pg_cron-jobb, og ticken kjører bare på Vercels
   daglige reserve.
3. Sette `alter database postgres set app.settings.base_url = 'https://app.proanbud.no';`
4. Legge `SALG_IMAP_HOST`, `SALG_IMAP_USER` og `SALG_IMAP_PASSWORD` for
   post@proanbud.no inn i Vercel. Uten dem leses ingen svar, og resten av
   maskinen går videre som om ingenting har skjedd — som er nøyaktig den
   feilen v1 gjorde.
5. Gå gjennom faktaarket i `/selger/innstillinger` og bekrefte eller rette de
   uverifiserte påstandene.
6. Kjøre en testsending med `SALG_SEND_MODE=test` og `SALG_TEST_RECIPIENT` satt
   til egen adresse. Sjekk tråding, pluss-adressering, Authentication-Results
   (DKIM/DMARC) og mail-tester-poeng.
7. Først da: `SALG_SEND_MODE=live` og start maskinen i innstillingene. Den står
   i pause fra seed og starter aldri av seg selv.

Valgfritt: `SALG_PLACES=on` (krever at Places API er skrudd på for
`GOOGLE_MAPS_API_KEY`), og `SALG_VARSEL_EPOST` for hvor svarvarsler skal.

**Avvik fra planen, med begrunnelse:**

- **Ingen `selger_jobs`-tabell.** Domenetabellene er køene, som revisjonen sier.
  Claim-RPC-ene ligger i db/91.
- **Faktaarket ble værende i `lib/outreach/facts.ts`** i stedet for å flyttes til
  `write/facts.ts`. Flyttingen hadde bare vært omrokering av importer.
- **`?nettside=` i gaven krever en endring i proanbud-new** (`ExampleFlow`) for at
  forhåndsutfyllingen skal virke. Lenken er gyldig uten den — den lander bare på
  et tomt skjema. Dette er den ENESTE gjenstående kodeavhengigheten utenfor dette
  repoet.
- **Ukesrapporten kjører på forespørsel**, ikke på en cron: den koster et
  modellkall, og ingen blir varslet av at den finnes.
- **Autopilot på steg 1 er ikke implementert som en bryter.** `autonomy.ts` regner
  ut om den er fortjent og viser det i Analyse, men oppgradering krever at Casper
  trykker. Nedgradering skjer derimot automatisk. Dette følger revisjonens punkt 4.
- **Eksperimenter med vinkler** er ikke bygget som en egen A/B-motor. Svarrate per
  vinkel måles i Analyse, og det er grunnlaget en slik motor uansett måtte hvile
  på. Bygges når det finnes nok data til at forskjeller betyr noe.

---

## Kontekst

Casper driver Proanbud alene. Pipelinen skal gjøre 95 % av jobben selv. Den finner firmaer, researcher dem, kvalifiserer dem, skriver en personlig e-post til hvert enkelt firma, sender, følger opp og fanger opp svar. Casper bruker ~15 min/dag på å godkjenne førstekontakter. Resten av tiden går til menneskene som faktisk svarer.

**Hvorfor dagens oppsett ikke virker** (målt i prod og Brønnøysund 2026-09-11):

- **Kilden er feil.** 31 Brreg-leads er importert i dag. Av dem er 12 ENK og 1 NUF. Det er fysiske personer eller utenlandske foretak, og kald e-post til dem er ulovlig uten samtykke etter markedsføringsloven § 15. 30 av 31 har under 5 ansatte (Brreg skjuler tallet ved 1–4), og 29 av 31 har ingen nettside. De fleste e-postene er personlige gmail-adresser med personnavn. Leadsene er utenfor målgruppen, og det finnes ingenting å personalisere på.
- **Universet er stort nok til å være kresen.** AS med 5–20 ansatte, mva-registrert og ikke konkurs: NACE 41 = 2 471 og NACE 43 = 4 826, altså rundt 7 300 firmaer. Med 20 om dagen varer det i halvannet år.
- **Et NACE-filter er ødelagt.** Brreg bruker nå SN2025-koder, så `naeringskode=41.2` gir 0 treff. Standardverdien `["43","41.2"]` i `lib/outreach/import.ts` mister dermed alle 41-firmaer. `bransje.ts` bruker også SN2007-koder.
- **Generisk kald e-post er bevist død.** ~600 maler-e-poster i juni og juli ga 0 kunder, 6 åpninger og 0 klikk. `lib/outreach/autosend.ts` sender fortsatt hardkodede tekster og melder på `ny`-leads uten kvalifisering.
- **Ingen fanger opp svar.** Et interessert svar kan få steg 2 og 3 likevel. Svarene lander i Webhuset-innboksen for post@proanbud.no, og ingen kode leser den.
- **Casper gjør det riktige for hånd.** Han bruker `proanbud-salg`-skillen med filer i `../proanbud-salg`: research med kilde-URL, én konkret observasjon, generisk adresse og egen stemme. Men dette er frakoblet /selger. Han driver også et andre segment: regnskapskontor som henvisningspartnere (tre sendt 2026-09-08).
- **Varme leads ligger på feil sted.** Inngående leads fra proanbud.no/analyse (`analyse_leads`, db/89) vises bare i /sjefen, ikke i pipelinen.

**Beslutninger tatt med Casper (2026-09-11):**

1. **Autonomi:** Casper godkjenner steg 1 i en kø, og oppfølging 2–3 går automatisk. Maskinen foreslår autopilot per segment når kvaliteten er bevist, og skrur seg selv ned ved problemer.
2. **Avsender:** «Casper Nag <post@proanbud.no>». Svar fanges ved å lese Webhuset-innboksen via IMAP, kun lesing.
3. **Freemail:** Tillatt når firmaet er et AS og delen før @ tydelig er firmanavnet (`timrebygg@gmail.com`). Adresser med personnavn (`fornavn.etternavn@…`, eller daglig leders navn) er alltid blokkert fordi § 15 krever det. Slike firmaer går til telefonlisten.

## Kort fortalt

Casper åpner /selger om morgenen og ser tre ting:

1. **Svar som venter.** Hvert svar er allerede klassifisert og har et forslag til svar.
2. **Førstekontakter til godkjenning (~15 min).** Hver av dem viser dossieret og den verifiserte kilden ved siden av e-posten.
3. **Varme signaler.** Ekte klikk, analyser på proanbud.no og aktive prøvebrukere.

Resten er gjort i løpet av natten. Maskinen har funnet firmaer i målgruppen (AS med 5–20 ansatte) og researchet nettside, regnskap og anmeldelser. Den har skrevet e-poster med en krok som er sjekket mot kilden, sendt godkjente meldinger spredt utover dagen og fulgt opp i samme tråd. Alt som svarer stoppes med én gang.

## Revisjon etter arkitektgjennomgang (2026-09-11) — disse punktene overstyrer detaljer lenger ned

1. **Ingen generisk jobbkø.** Domenetabellene er selve køene:
   - `prospects.machine_stage='venter_research'` er research-køen.
   - `outreach_messages.status='godkjent' AND scheduled_for<=now()` er sendekøen.
   - Innboksen bruker en UID-markør.
   - Hver kø får én claim-RPC med `FOR UPDATE SKIP LOCKED`, lease og antall forsøk.
   - En lease-rad hindrer overlappende ticks. Tick-rekkefølgen er innboks → helse → sending → oppfølgingsutkast → research. Da vinner et svar alltid over en planlagt sending.
2. **Research er en deterministisk pipeline med ett strukturert LLM-kall, ikke en agent.**
   - Signaldetektorer i kode: tilbudsskjema, Tripletex/Fiken, stillinger, polsk, referanser, sentral godkjenning.
   - LLM-en trekker ut og formulerer. **Koden** avgjør verdict og `fit_score` 1–5 etter Caspers rubrikk. A/B/C-nivåene utgår.
   - Er det ingen lovlig e-postkanal, blir leadet `kun_telefon`, og vi stopper før LLM-kostnaden.
3. **Strengere grunding:** normalisert ordrett delstreng på minst 4 ord. Ordoverlapp à la `supportedBySite` er ikke nok.
4. **Autonomi:** `approval_mode` per segment (`alt_manuelt` | `oppfolging_auto`, standard det siste som Casper valgte) + global pause.
   - LLM-sensoren og autopilot på steg 1 **utsettes** til Caspers første ~150–200 avgjørelser finnes som kalibreringssett.
   - Utkast begrenses til gjennomgangskapasiteten (`daily_new_drafts`) og utløper etter 5 dager.
5. **Steg 1 har ingen lenke** (best leveringsdyktighet, og svar er målet). Steg 2–3 kan ha én sporet lenke.
   - **Et klikk stopper ikke sekvensen.** Det gir varm status og en oppgave. Bare et svar stopper.
   - Et klikk teller bare ved JS-beacon, eller når det kommer ≥90 s etter levering fra en user agent som ikke er en skanner.
6. **Resend Free har tak på 100 e-poster per døgn og deler det med transaksjonspost** (kundenes tilbud). Kaldkvoten må ligge godt under, eller vi går over på Resend Pro før fase 2 går live.
   - Mer enn 40 kalde e-poster per døgn: Pro + eget underdomene.
   - `idempotencyKey = outreach_messages.id` og `tags` (om, p) på hver sending.
7. **Faktaregel:** «Fra 189 kr» + «faktura via Fiken/Tripletex» villeder, fordi integrasjoner er et tillegg til 29 kr/mnd på Mini. `facts.ts` krever Proff-pris eller modulpris når begge nevnes. Provisjonen for partnere hentes fra `lib/affiliate/commission.ts`.
8. **Lenker i e-post bruker `SALES_PUBLIC_BASE_URL`.** `.env.local` har `NEXT_PUBLIC_APP_URL=http://localhost:3000`.
   - Live-modus krever `VERCEL_ENV=production`.
   - `prospects.is_test` og RFC 2606-domener simuleres alltid.
   - `sales_settings.global.paused=true` fra seed til Casper har godkjent.
9. **Avmelding og duplikatsjekk også på domene.** `outreach_unsubscribes.domain` (aldri for freemail). Et «nei» fra ola@firma.no stopper også post@firma.no. Domener til appbrukere og `analyse_leads` utelates.
10. **IMAP lagrer bare meldinger som matcher et prospekt.** Resten ignoreres (post@ er en delt postkasse).
11. **Norsk tid:** dagskvoten telles fra Oslo-midnatt, ikke UTC. Sendevinduer tar hensyn til helligdager og fellesferie.
12. **Brreg-rollen `REGN` er firmaets regnskapskontor.** Aggregert over målgruppen blir det den beste mållisten for partnersegmentet (fase 4).
13. **Avvist av Casper er treningsdata fra dag 1.** KI-original, endelig tekst og avvisningsgrunn lagres fra første utkast.
14. **Fasene justeres:**
   - Fase 1 = research + utkast + godkjenning, der godkjente meldinger sendes med én gang.
   - Fase 2 = den autonome løkka: sekvens, IMAP, tick.
   - Fase 3 = cockpit/pipeline.
   - Fase 4 = læring, partner, Places og gaven.
   - Fase 2 starter først når avvisningsraten er under 30 % over de siste 50.

## Designprinsipper (styrer alle valg under)

1. **Kvalitet før volum.** Harde filtre på målgruppen ved kilden, ikke etterpå.
2. **Ekte personalisering eller ingenting.** Hver «krok» (observasjon) har et ordrett sitat som maskinen **validerer mot den hentede teksten**. Uten en validert krok blir leadet `for_tynn`. Da skrives det ingen e-post.
3. **Faktabrannmur.** Skriveren kan bare bruke produktpåstander fra et faktaark i koden der hver påstand har `verified: true`. Prisene importeres fra `lib/billing/plans.ts`, så de kan aldri drive. Alle tall i en e-post må finnes i faktaarket eller i dossieret, ellers stopper lint-sjekken utkastet.
4. **Lovlighet håndheves i kode, ikke i prompt.** Porter for organisasjonsform, adressetype, avmelding og maks 3 meldinger står i send-stien. Promptene brukes ikke til dette.
5. **Maskinen eier trakten til noen svarer, Casper eier menneskene.** Kanban viser bare menneskestegene. Maskinstegene vises som en traktstripe.
6. **Alt kan etterprøves.** Hver påstand har en kilde-URL, og hver beslutning logges med grunn.
7. **Maskinen lærer av Casper.** Hans redigeringer og avvisningsgrunner er treningsdata for neste utkast.

## Arkitektur — flyten ett prospekt går gjennom

```
KILDE ──► PORTER ──► RESEARCH ──► KVALIFISERING ──► SKRIVING ──► KVALITETSSJEKK ──► GODKJENNING ──► SEKVENS ──► SVAR-FANGST ──► CASPER
Brreg-     orgform,   Brreg+roller,  LLM-dossier:       fakta-      lint (kode) +       steg 1: Casper   steg 1→+4→+11   IMAP Webhuset   Dialog → Demo
ICP-søk,   ansatte,   regnskap,      fag, fit A/B/C,    brannmur +  LLM-sensor;        (15 min/dag);    plaintext,       → match →       → Prøve → Kunde
analyse-   mva,       nettside-      validerte kroker   Caspers     1 auto-omskriv;    steg 2–3 auto    førstepartsklikk  klassifiser →
leads,     adresse-   oppdagelse +   m/ kilde, verdict  stemme +    ellers for_tynn                     jitter i vindu   stopp + varsle
prøve-     type,      crawl (≤6 s.)                     læring                                                          + forslag til svar
brukere    avmeldt
                                ▲ signaler inn: klikk på sporet lenke · analyse på proanbud.no · aktivitet i prøveperioden
```

**Maskinen eier alt til venstre for SVAR-FANGST.** Casper ser bare godkjenningskøen, svar som venter og varme signaler.

**Planlegger:** en jobbkø i Postgres (`selger_jobs`) med claim-RPC (`FOR UPDATE SKIP LOCKED`). Endepunktet `/api/cron/selger-tick` er tidsboksert (maxDuration 300, budsjett ~240 s). Det startes av `pg_cron` + `pg_net` hvert 10. min på hverdager 06–20. Hobby-cronen på Vercel tillater bare én kjøring per døgn, så en daglig Vercel-cron er reserve, og en «Kjør nå»-knapp gir manuell start. IMAP-lesingen trenger dette intervallet.

## Kilder og porter (deterministisk, før noen LLM-kostnad)

**ICP-søk i Brreg** (utvidelse av `searchBrregEnheter` i `lib/outreach/brreg.ts`):
- `organisasjonsform=AS` (+ASA)
- `fraAntallAnsatte=5` og `tilAntallAnsatte=20`
- `registrertIMvaregisteret=true`
- `konkurs=false` og `underAvvikling=false`
- `naeringskode` fra segmentets fagliste i SN2025

Rotasjonen er ett fag og ett fylke per kjøring, som i Caspers playbook.

**Fag i SN2025** (verifisert mot Brreg i dag). `bransje.ts` må mappes om til disse kodene:

| Fag | Kode |
|---|---|
| Bygg/tømrer | 41.000 |
| Elektro | 43.210 |
| Rør | 43.221 |
| Varmepumpe/peis | 43.222 |
| Ventilasjon | 43.223 |
| Snekker | 43.320 |
| Gulv | 43.330 |
| Maler | 43.340 |
| Tak | 43.410 |
| Mur | 43.910 |
| Grunnarbeid (lavere prioritet) | 43.120 |

42.x (vei og VA-anlegg) utelates som standard, fordi det er anbudsarena og utenfor målgruppen.

**Porter** (`lib/outreach/gates.ts`, rene funksjoner med tester). Hver av dem gir `{ ok, reason }`:
- Organisasjonsformen er AS eller ASA. ENK, NUF, ANS og DA er ute.
- Firmaet er ikke konkurs eller under avvikling.
- Antall ansatte er innenfor segmentets intervall.
- Firmaet er ikke eksisterende kunde, ikke avmeldt (`isOptedOut`), og ikke et domene vi allerede har kontaktet.
- Adresseklassifikator `classifyContactEmail(email, {companyName, domain, roleNames})` gir én av disse:

| Klasse | Eksempel | Resultat |
|---|---|---|
| `generisk_firmadomene` | post@, kontakt@, firmapost@, info@, tilbud@ … på firmaets domene | OK |
| `firmanavn_freemail` | gmail/hotmail/outlook/live/yahoo/icloud/online.no, der lokaldelen matcher tokens i firmanavnet | OK (Caspers valg) |
| `personnavn` | `fornavn.etternavn`, eller navn fra Brreg-roller | blokkert → `kun_telefon` |
| `ukjent` | ingen av delene | blokkert |

Portene kjøres **både** ved innmelding og rett før hver sending. Det tetter også dagens hull i `send-email`-ruten og i `autosend`.

**Andre kilder:**
- `analyse_leads`: varm, sendes aldri inn i en kald sekvens.
- Prøvebrukere: den eksisterende broen, som fikses.
- Manuell import og listeimport.
- Partnersegmentet regnskapskontor: eget søk på NACE **69.202** «Regnskapsføring og bokføring» og egen playbook. Merk at 69.201 i SN2025 er revisjon. Koden er verifisert mot Brreg.
  - Ideell partner: bygg/håndverk som kundegruppe og Tripletex/Fiken-partner. Store kjeder (Azets, Accountor osv.) er diskvalifisert.
  - «Vunnet» betyr en godkjent rad i `affiliate_partners` med henvisningskode (db/55). Kortet viser partnerens henvisninger (`signups`, `mrr_nok`).
  - Vinkelen er at kundene deres slipper å punche fra Word, ikke provisjon. Det er i tråd med Caspers egne e-poster fra 2026-09-08.

## Research-agenten («KI-innhenting»)

Research er én jobb per prospekt, med hentere som kjører parallelt. Hver henter skal tåle feil og gi `{ ok, data, source_url, fetched_at }`.

1. **Brreg-enhet og roller** (`/enheter/{orgnr}` + `/roller`). Gir organisasjonsform, stiftelsesdato, mva, næringskoder 1–3, adresse og daglig leder. Navnet på daglig leder brukes **kun** til ringebrief og til å oppdage adresser med personnavn, aldri i e-postteksten.
2. **Regnskapsregisteret** (`data.brreg.no/regnskapsregisteret/regnskap/{orgnr}`). Gir driftsinntekter, driftsresultat og utvikling. Tallene brukes til kvalifisering, **aldri i e-postteksten**. API-et er et «midlertidig» og uvedlikeholdt åpent API, så feil gir `null` og ingen blokkering.
3. **Oppdagelse av nettside**. Bare 15 av 100 firmaer i målgruppen har nettside registrert i Brreg. Maskinen søker med Brave (`BRAVE_SEARCH_API_KEY` finnes; klienten hentes fra `git show 7e6daec^:lib/tilbud/material-web-search.ts`) på `"<navn>" <kommune>`. Kandidatdomener verifiseres ved å hente siden og se etter orgnr, telefonnummer eller treff på firmanavnet. Ingen verifisering betyr ingen nettside, aldri en gjetning.
4. **Crawl** av forsiden og opptil 5 undersider (tjenester, om oss, prosjekter/referanser, kontakt, jobb/karriere). Bygger på den SSRF-sikre hentingen i `enrich.ts` (må eksporteres) og en portert `extractPage`/`pickSubpages` fra `proanbud-new/lib/eksempel/extract.ts`. Den finner generisk e-post på nettsiden, som foretrekkes framfor Brreg-e-posten. Sidene beholdes som tekst for kontroll av sitater.
5. **Google Places (valgfri, `SALG_PLACES=on`)**. Gir vurdering, antall anmeldelser og korte utdrag. Dette er gull for B2C-håndverkere. Krever at Places API er skrudd på for `GOOGLE_MAPS_API_KEY`.

**LLM-syntese** går via Responses API med streng `json_schema` gjennom `openaiFetch("responses")`. Modellen settes med `SALG_RESEARCH_MODEL` (standard `OPENAI_MODEL`). Resultatet er et dossier med:
- `fag`, `kundetype` (privat/borettslag/næring/offentlig) og `størrelse`
- `fit`: kriterier fra playbooken (tilbudsskjema, referanseprosjekter, Tripletex/Fiken-tegn, flere byggeplasser, rekruttering, utenlandsk arbeidskraft, ansatte 5–20). Hvert kriterium har `met`, `evidence` og `source_url`.
- `kroker[]` (1–3): `type`, `tekst`, `sitat` og `source_url`. **`sitat` valideres i kode mot den hentede sideteksten**, med normalisert delstreng og en terskel for ordoverlapp som i `supportedBySite`. Kroker som ikke valideres forkastes.
- `smerter[]` knyttet til en verdi i produktet, `diskvalifiserere[]`, `beste_vinkel` og `anbefalt_kanal`
- `verdict`: `kvalifisert` / `diskvalifisert` / `for_tynn` / `kun_telefon`, og nivå A/B/C

Regler i kode: minst én validert krok er nødvendig for `kvalifisert`. Nivået avledes deterministisk fra kriteriene, slik at LLM-en ikke kan «gi» en A.

## Skrivemotoren («skriv som Casper»)

**Innhold i prompten:**
- Dossieret (bare validerte kroker)
- Segmentets playbook (håndverker eller regnskapspartner)
- Vinkelbibliotek per fag (tømrer: tilbud fra egne prisfiler; elektro: EFO/NELFO-import; rør: VVS-prisfiler; Proff: HMS/KS på polsk)
- **Faktaarket** (`lib/outreach/write/facts.ts`, bare `verified: true`, prisene fra `PLAN_PRICING`/`TRIAL_DAYS`)
- Caspers ekte e-poster som stilforbilder (fra `../proanbud-salg/mail.md`)
- Læringsminnet: de 3–5 siste godkjente e-postene i samme segment (etter redigering) og de vanligste avvisningsgrunnene

**Output:** `emne`, `brødtekst` (ren tekst), `krok_id`, `fakta_ids[]` og `vinkel`.

**Kvalitetssjekk i to lag** (`lint.ts` + `grade.ts`):
- **Lint (kode, blokkerende):**
  - ≤120 ord i steg 1 og ≤60 i steg 2–3
  - forbudte ord: løsning, synergi, digitalisering, effektivisering, sømløs, revolusjoner
  - ingen emoji og ingen «!»
  - maks 1 lenke
  - første setning inneholder kjerneordene fra kroken
  - **alle tall finnes i faktaarket eller i dossieret**, og pris er lik `PLAN_PRICING`
  - ingen påstander om «KI-generert»
  - avslutter med et spørsmål
- **Sensor (LLM, egen billig modell):** vurderer spesifisitet, relevans, tone («byggeplass, ikke SaaS»), lavterskel-CTA og «ville Casper sendt denne uredigert?» på en skala fra 1 til 5.
- Stryker utkastet, skrives det om én gang automatisk med sensorens tilbakemelding. Stryker det igjen, blir leadet `for_tynn` og havner i Caspers «trenger deg»-liste. Utkastet sendes aldri.

**Faktaarket rettes før første bruk.** Følgende i `proanbud-salg/CONTEXT.md` er feil eller uverifisert og skal **ikke** med:
- «5200+ tilbud generert»
- «50 % spart admin-tid / 30 % høyere akseptrate»
- «Norske servere» (det er EU, jf. hjelpesenter-fasiten)
- DocuSign
- Sitatet fra Ole Kristiansen (må verifiseres)
- Sitatet fra Sander Nag (nærstående, må opplyses eller droppes)

At prøven er kortfri **er verifisert**. `createTrialSubscription` kjører uten betalingsmetode, og det løser ⚠️-punktet i CONTEXT.

## Sekvens, sending og leveringsdyktighet

- **Tre meldinger, så stopp:** steg 1 (dag 0, godkjent av Casper) → steg 2 (+4 dager, ≤60 ord, ny vinkel, `Re:` i samme tråd) → steg 3 (+11 dager, et konkret regnestykke eller eksempeltilbudet) → avsluttet dag 12. Steg 2–3 skrives personlig ut fra det samme dossieret og kvalitetssjekkes på samme måte. De sendes automatisk (autonominivå 1).
- **Sending:** `Casper Nag <post@proanbud.no>`, svar-til post@. Ren tekst uten knapp og bilder. Signaturen er Caspers egen. Bunnteksten har avsenderidentitet, kilden adressen er hentet fra, og en avmeldingslenke. `List-Unsubscribe` beholdes.
- **Tråding og svar-token:** Resend kjører på Amazon SES, og SES overstyrer normalt `Message-ID`. Derfor bygges tråding og matching slik:
  1. Steg 2–3 sendes som `Re: <emne fra steg 1>`. Gmail og Outlook tråder på emne og avsender.
  2. Svar-til er `post+<token>@proanbud.no` **hvis Webhuset støtter pluss-adresser**. Det testes i fase 2 ved å sende til `post+test@`. Da gir `Delivered-To`/`To` et eksakt treff.
  3. Uten pluss-adresser matches svar på eksakt avsender → domene → emne.

  Valgfritt: BCC av hver utsending til en loggmappe gir oss den ekte `Message-ID`-en for `In-Reply-To`, og Casper får kopien i vanlig e-postklient.
- **Klikk måles på egne sider, ikke med Resend-sporing.** Lenken går til `app.proanbud.no/eksempel-tilbud/<fag>?r=<token>` (senere proanbud.no/analyse med nettsiden forhåndsutfylt). Siden sender en beacon etter mer enn 3 s synlig eller ved interaksjon. Da regnes det som et ekte klikk, og ikke som en lenkeskanner à la Safe Links. Et klikk gir varm status, stopper sekvensen, lager en oppgave og varsler Casper. `?r=` følger med til signup, slik at prøvebrukeren kan knyttes til riktig prospekt.
- **Leveringsdyktighet på hoveddomenet:**
  - Dagskvote med oppvarming: 10 → 20 → 30 per dag de første tre ukene (`OUTREACH_DAILY_LIMIT`).
  - Sendingene spres tilfeldig over et vindu (hverdager 07:30–15:30).
  - MX-oppslag før hver sending.
  - Maks én e-post per domene.
  - **Automatisk pause** ved hard bounce over 3 % blant de siste 50, eller ved én klage. Casper varsles.
  - Test med mail-tester før opptrapping.
  - DMARC har `aspf=s`, så SPF-justering feiler via `send.proanbud.no`. DMARC hviler dermed på DKIM (`d=proanbud.no`). Det skal verifiseres i Authentication-Results på testsendingen.
- **Sendemodus** (`SALG_SEND_MODE`): `dry-run` (standard lokalt) | `test` (all post går til `SALG_TEST_RECIPIENT`) | `live`. `.env.local` peker på prod, så dette er obligatorisk.

## Svar-løkka (IMAP)

`lib/outreach/inbox/imap.ts` bruker `imapflow` og `mailparser` (nye avhengigheter). Innboksen åpnes skrivebeskyttet (`readOnly: true`, markerer ikke som lest). Maskinen henter meldinger nyere enn siste UID (lagret med `uidvalidity`) og leser også «Sendt»-mappen, slik at svar Casper skriver fra e-postklienten havner på tidslinjen. `SALG_IMAP_HOST` (`imap.webhuset.no` finnes i DNS), `SALG_IMAP_USER` og `SALG_IMAP_PASSWORD` lagres som Vercel-env.

- **Matching:** pluss-token i `To`/`Delivered-To` → `In-Reply-To`/`References` mot lagrede `Message-ID`-er (hvis BCC-loggen er i bruk) → nøyaktig avsenderadresse → avsenderdomene lik prospektets domene → emne og firmanavn. Uten treff havner meldingen i «Ukjente svar», der Casper kobler den med ett klikk.
- **Klassifisering (LLM + heuristikk):**

| Klasse | Handling |
|---|---|
| `positiv` | Stopp sekvensen, status `dialog`, oppgave «Svar innen 2 t», varsel |
| `spørsmål` | Stopp sekvensen, status `dialog`, oppgave «Svar innen 2 t», varsel |
| `ikke_nå` | Stopp, `snoozed_until` fra teksten (f.eks. «ta kontakt etter jul»), ellers 90 dager |
| `nei` | Stopp, status `tapt` med tolket grunn, **og avmelding** (en reservasjon skal respekteres) |
| `avmelding` | Avmelding og `tapt` |
| `feil_person` | Notat og eventuell ny generisk adresse |
| `autosvar` / ferie | Stopper **ikke**. Neste steg flyttes til returdato + 2 dager |
| `ikke-levert` (bounce) | Avmelding |

- **Forslag til svar:** for `positiv` og `spørsmål` skrives et utkast med faktaarket og innvendingsbiblioteket (CONTEXT § 8). **Det sendes aldri automatisk.** Casper sender fra lead-kortet i samme tråd, og svaret logges.
- **Varsling:** en e-post til Casper per positivt svar (via Resend med transaksjonsavsenderen), et merke i sidemenyen og øverst i «I dag».

## Pipeline og brukerflater

- **«I dag» = cockpit**, sortert etter hva som krever Casper:
  1. **Svar som venter** (klassifisert, med forslag til svar)
  2. **Godkjenn utkast** (antall + «Start gjennomgang»)
  3. **Varme signaler** (ekte klikk, analyse på proanbud.no, aktivitet i prøven)
  4. Oppgaver, forfalte og for i dag
  5. **Maskinrom-stripe:** «Siden i går: 40 funnet · 31 researchet · 18 kvalifisert · 12 utkast · 9 sendt · 1 svar». Viser også helse: kvote brukt, bounce-rate, autonominivå og pause-status.
- **`/selger/godkjenning` er en fokusmodus med tastatur.** Til venstre dossieret: nivå, kriterier og kroker med klikkbar kilde og uthevet sitat, slik at personaliseringen kan etterprøves på 5 sekunder. Til høyre en redigerbar e-post med lint- og sensormerker. Handlinger: `⌘↵` godkjenn, `E` rediger, `R` avvis med grunn-chips (generisk, feil fakta, feil tone, feil vinkel, for lang, feil målgruppe), `S` hopp over, `J/K` neste/forrige. Mål: 20 utkast på 15 minutter.
- **Kanban viser bare menneskestegene:** Varm (klikk eller positivt svar) → Dialog → Demo → Prøve → Vunnet/Tapt. Over den ligger en **traktstripe for maskinstegene**: Kilde → Research → Kvalifisert → Til godkjenning → I sekvens → Avsluttet. Tellingene er klikkbare og åpner prospektlisten filtrert.
- **Prøvekortene** viser en aktiveringsscore fra appdata:
  - tilbud laget og sendt
  - kunder
  - inviterte brukere
  - `last_seen_at`
  - tilkoblet regnskap

  «I dag» løfter fram «laget 3 tilbud på 2 dager, ring nå» og «ikke innlogget siden dag 1». Trial-broen fikses, slik at endringer i betaling faktisk flytter kortet.
- **Prospektlisten** (erstatter innboksen) har filtre for maskinsteg, nivå, segment, fag og fylke, og masseoperasjoner (research nå, diskvalifiser, legg i kø på nytt). **Radene lenker til lead-kortet.**
- **Lead-kortet** får:
  - **Dossier**: kilder, kroker, kriterier, regnskap og «Oppdater research»
  - **Sekvens**: steg med tidspunkt og status, og knappene pause/stopp/gjenoppta
  - **Inngående svar** i tidslinjen, med forslag til svar i composeren
  - Composeren bruker nå dossier og steg. I dag skriver den kald e-post også til folk i dialog.
- **`/selger/segmenter`:** kort per segment med ICP-filter, playbook, autonominivå, kvote, trakt og «Finn 30 nye nå».
- **`/selger/analyse`:**
  - trakt per segment: funnet → kvalifisert → godkjent → sendt → svar → positivt → prøve → betalende
  - svarrate per vinkel, krok-type, fag og fylke
  - godkjennings-, redigerings- og avvisningsrate med grunner
  - kostnad per kvalifisert lead og per svar
  - leveringsdyktighet
  - beslutningsterskler fra playbooken som varsler
  - ukesrapport fra KI
- **`/selger/innstillinger`:** avsender, sendevindu, kvote, pause, autonominivå per segment, visning av faktaarket med verifiserte flagg, og avmeldingslisten.

## Læring og autonomi

- Hvert utkast lagrer KI-versjonen og Caspers endelige versjon (med redigeringsavstand) og eventuell avvisningsgrunn. Dette er treningsdataene.
- **Autopilot må fortjenes per segment.** Når 30 steg 1-utkast på rad har minst 90 % godkjent, median redigering under 15 % og ingen «feil fakta», foreslår maskinen nivå 2 (auto-send det som består sensoren, stikkprøver i en daglig oppsummering). **Den skrur seg ned automatisk** ved bounce-topp, klage, avvisningsrate over 40 % eller et negativt svar om tonen.
- Ukentlig KI-gjennomgang av redigeringsmønstre («du fjerner alltid setningen om X») gir forslag til endringer i promptene. Forslagene vises i Analyse og **tas aldri i bruk automatisk**.

## Personvern (GDPR) og markedsføringsloven

- **Grunnlag:** berettiget interesse for B2B-prospektering. En kort interesseavveining ligger i `docs/salg-personvern.md`.
- **Dataminimering:** ingen data om ENK eller privatpersoner. Navn på daglig leder brukes bare internt.
- **Sletting:** dossiere for diskvalifiserte og ikke-svarende prospekter slettes etter 12 måneder. Ved avmelding slettes alt unntatt suppresjonsraden.
- **Bunntekst i e-posten:** avsender (Nag Software, org.nr.), hvor adressen kom fra, avmelding og personvernlenke.
- § 15 håndheves av portene. Oppringing gjelder bare AS; ENK sjekkes mot Reservasjonsregisteret.

## Datamodell (db/90–93, kjøres med `pnpm db:migrate`; RLS på uten policies = kun service-role, som resten av salgstabellene)

**`db/90_selger_maskin.sql`** — maskintilstand på `prospects` (statusverdiene er de samme som før, se under)

- `segment text not null default 'handverker'`
- `org_form text`, `founded_on date`, `mva_registered boolean`
- `domain text` (normalisert fra nettside eller e-post)
- `trade text` (fag i SN2025)
- `email_class text` og `email_source text` (brreg|nettside|manuell)
- `pipeline_state text not null default 'kilde'`, med `check` på verdiene kilde, research, kvalifisert, diskvalifisert, for_tynn, kun_telefon, til_godkjenning, i_sekvens, avsluttet, overlevert
- `fit_tier text` (A/B/C), `fit_score smallint`, `disqualify_reason text`
- `research_id uuid` (siste dossier), `researched_at timestamptz`
- `snoozed_until timestamptz`
- `tracking_token text unique` (kort, tilfeldig, for `?r=`)
- Indekser: `(pipeline_state, segment)`, `(domain)` og `(snoozed_until)` der den ikke er null

`status` er fortsatt handelssteget, altså Caspers kanban. `pipeline_state` er maskinens steg. Da slipper vi å endre status-enumen og å bygge kanbanen om.

**`prospect_research`**

| Kolonne | Type / innhold |
|---|---|
| `id`, `prospect_id` | `on delete cascade` |
| `status` | text |
| `sources` | jsonb: `[{kind, url, ok, fetched_at}]` |
| `facts` | jsonb: brreg, regnskap, nettside {tjenester, områder, referanser, sertifiseringer, verktøy, rekruttering, språk}, places |
| `hooks` | jsonb: `[{id, type, text, quote, source_url, grounded}]` |
| `fit` | jsonb: kriterier med belegg |
| `pains`, `verdict`, `summary` | |
| `model`, `tokens_in`, `tokens_out`, `cost_usd` | |
| `created_at` | |

`page_text` lagres i en egen kolonne med begrenset størrelse (≤60k tegn), slik at sitater kan kontrolleres på nytt.

**`outreach_messages`** er godkjenningskøen og treningskorpuset.

| Kolonne | Type / innhold |
|---|---|
| `id`, `prospect_id`, `research_id` | |
| `step` | smallint 1–3 |
| `kind` | kald / oppfølging / svar |
| `subject`, `body_ai`, `body_final` | |
| `angle`, `hook_id`, `fact_ids` | `fact_ids` er text[] |
| `lint`, `grade`, `grade_report` | `lint` og `grade_report` er jsonb |
| `status` | utkast, til_godkjenning, godkjent, planlagt, sendt, avvist, kansellert, feilet |
| `reject_reason`, `reject_note`, `edit_ratio` | |
| `approved_by`, `approved_at` | |
| `scheduled_for`, `sent_at` | |
| `rfc_message_id`, `email_log_id` | `email_log_id` peker til `seller_email_log` |
| `created_at` | |

Indekser:
- unik indeks `(prospect_id, step)` der status ikke er avvist eller kansellert (idempotens)
- `(status, scheduled_for)`

**`db/91_selger_innboks.sql`**

- **`inbound_emails`**:
  - `id`
  - `mailbox` og `uid` (unike sammen)
  - `message_id`, `in_reply_to`, `references`
  - `from_email`, `from_name`, `subject`, `text_body`, `received_at`
  - `prospect_id` og `match_method`
  - `classification`, `confidence`, `summary`, `suggested_reply`
  - `handled_at` og `created_at`
- **`selger_inbox_cursor`**: `mailbox` (PK), `uidvalidity`, `last_uid` og `updated_at`

**`db/92_selger_jobber.sql`**

- **`selger_jobs`**:
  - `id` og `kind` (source, research, draft, send, inbox, digest, retention)
  - `prospect_id` (nullable) og `payload jsonb`
  - `status` (queued, running, done, failed) og `attempts`
  - `run_after`, `locked_at`, `last_error`
  - `created_at` og `finished_at`
  - unik indeks `(kind, prospect_id)` der status er queued eller running
- **RPC `claim_selger_jobs(p_kinds text[], p_limit int)`**: `update … where id in (select … for update skip locked) returning *`. Den tar også tilbake jobber med `locked_at` eldre enn 10 minutter (krasjede ticks).
- **`selger_settings`** (én rad):
  - `paused` og `pause_reason`
  - `autonomy` jsonb per segment
  - `daily_cap` og `send_window` jsonb
  - `llm_daily_budget_usd`

**`db/93_selger_cron.sql`**: `create extension if not exists pg_cron` og `pg_net`, pluss en `cron.schedule`-jobb som kaller `net.http_post` mot `/api/cron/selger-tick`. `CRON_SECRET` leses fra `vault.decrypted_secrets`. **Casper legger hemmeligheten inn i Vault manuelt, så den aldri havner i git.**

Uendret: `seller_email_log` (hver sending logges som før, med `prospect_id`), `outreach_unsubscribes` (39 rader beholdes) og `prospect_tasks`.

## Filplan (nytt domene under `lib/outreach/`, UI under `app/selger/`)

**Porter og kilder**

| Fil | Innhold |
|---|---|
| `lib/outreach/gates.ts` | `checkProspectGates`, `classifyContactEmail`, `FREEMAIL_DOMAINS`, `ROLE_LOCALPARTS` |
| `lib/outreach/segments.ts` | Segmentdefinisjoner (håndverker, regnskapspartner): SN2025-koder, ansatteintervall, playbook-id |
| `lib/outreach/brreg.ts` | **Endres:** eksponer `organisasjonsform`, stiftelsesdato og mva i `mapEnhetToProspect`; nye filtre `organisasjonsform`, `registrertIMvaregisteret`, `konkurs=false`; `fetchBrregRoller` |
| `lib/outreach/import.ts` | **Endres:** standardfiltre fra segmentet; `41.2` → `41` |
| `lib/outreach/bransje.ts` | **Endres:** SN2025-mapping |

**Research**

| Fil | Innhold |
|---|---|
| `lib/outreach/research/fetch.ts` | Flyttet og eksportert SSRF-sikker `fetchHtml` fra `enrich.ts` (som importerer den tilbake) |
| `lib/outreach/research/extract.ts` | Portert `extractPage`/`pickSubpages` + funn av e-post, skjema og sertifiseringer |
| `lib/outreach/research/discover.ts` | Brave-søk + domeneverifisering |
| `lib/outreach/research/regnskap.ts` | Regnskapsregisteret |
| `lib/outreach/research/places.ts` | Google Places (valgfri) |
| `lib/outreach/research/ground.ts` | `isQuoteGrounded(quote, text)` |
| `lib/outreach/research/synthesize.ts` | LLM-dossier med `json_schema` |
| `lib/outreach/research/run.ts` | `researchProspect(id)`: orkestrerer, lagrer `prospect_research`, setter `pipeline_state` |

**Skriving og sekvens**

| Fil | Innhold |
|---|---|
| `lib/outreach/write/facts.ts` | Faktaark; importerer `PLAN_PRICING`, `TRIAL_DAYS` |
| `lib/outreach/write/playbooks.ts` | Segment- og fagvinkler, Caspers stilforbilder |
| `lib/outreach/write/generate.ts` | `draftMessage(prospect, research, step)` |
| `lib/outreach/write/lint.ts` | Lint-reglene |
| `lib/outreach/write/grade.ts` | LLM-sensoren |
| `lib/outreach/write/learning.ts` | Henter nylige redigeringer og avvisninger til prompten |
| `lib/outreach/sequence.ts` | **Erstatter** `autosend.ts`: planlegger steg 2–3, stoppregler (`stopSequence`, beholdt signatur for webhooken), jitter, sendevindu |
| `lib/outreach/send.ts` | **Endres:** ren tekst-variant, `Re:`-tråding, svar-til `post+<token>@`, `SALG_SEND_MODE`, MX-sjekk, porter kjøres på nytt rett før sending, pause-sjekk |
| `lib/outreach/templates.ts` | **Endres:** bunntekst for ren tekst |

**Innboks, jobber og felles**

| Fil | Innhold |
|---|---|
| `lib/outreach/inbox/imap.ts` | IMAP-lesing |
| `lib/outreach/inbox/match.ts` | Kobler svar til prospekt |
| `lib/outreach/inbox/classify.ts` | Klassifisering |
| `lib/outreach/inbox/suggest.ts` | Forslag til svar |
| `lib/outreach/inbox/apply.ts` | Handlinger per klasse |
| `lib/outreach/jobs/queue.ts` | `enqueue`, `claim`, `complete`, `fail` |
| `lib/outreach/jobs/tick.ts` | Tidsboksert runner med prioritet: inbox > send > draft > research > source. Maks 4 samtidige. Stopper ved LLM-budsjettet. |
| `lib/outreach/health.ts` | Bounce- og klageterskel → automatisk pause |
| `lib/outreach/autonomy.ts` | Nivå, om det er fortjent, og automatisk nedgradering |
| `lib/llm/structured.ts` | Felles hjelper for `responses` + `json_schema` + zod-parse + kostnad per token. Erstatter tre kopier av `normalizeJsonFromModel`. |

**API**

| Rute | Innhold |
|---|---|
| `app/api/cron/selger-tick/route.ts` | Ny tick-rute. Samme Bearer-sjekk som de andre cronene. `maxDuration 300` |
| `app/api/cron/selger-autosend` | **Fjernes** fra `vercel.json` (erstattes av en daglig reserve som peker på tick) |
| `app/api/selger/messages/[id]/route.ts` | Godkjenn, rediger, avvis |
| `app/api/selger/prospects/[id]/research/route.ts` | «Oppdater research» |
| `app/api/selger/replies/[id]/route.ts` | Send svar, koble, marker behandlet |
| `app/api/selger/run/route.ts` | «Kjør nå» |
| `app/api/outreach/engagement/route.ts` | Offentlig beacon: token + hendelse, rate-begrenset |

**UI**

| Sted | Endring |
|---|---|
| `app/selger/page.tsx` + `today-client.tsx` | Cockpit |
| `app/selger/godkjenning/*` | Ny |
| `app/selger/pipeline/*` | Menneskesteg + traktstripe |
| `app/selger/leads/*` | Prospektliste med filtre; radene lenker |
| `app/selger/leads/[id]/*` | Dossier-, sekvens- og svar-paneler; composeren får kontekst. Splittes ut fra filen på 1198 linjer. |
| `app/selger/segmenter/*`, `app/selger/innstillinger/*` | Nye |
| `app/selger/analyse/*` | Utvides |
| `components/selger/selger-sidebar.tsx` | Merker og aktiv tilstand |
| `app/eksempel-tilbud/[bransje]/page.tsx` | Klientbeacon for `?r=` + `r` videre til signup-lenken |

**Rettelser i eksisterende kode**

- `lib/selger/sync.ts`: prøvebroen oppdaterer koblede prospekter når betalingen endres og logger `won_prospect`.
- `lib/selger/scoring.ts`: 5–20 ansatte.
- `app/api/companies/route.ts`: kobler `?r=`-token i tillegg til orgnr, og stopper sekvensen.
- `app/api/webhooks/resend/route.ts`: bounce og klage mater `health.ts`, `stopSequenceForEmail` flyttes til `sequence.ts`, og åpne-hendelser vektes ikke lenger (Apple MPP).

**Gjenbruk:**
- `openaiFetch`
- `isOptedOut`, `recordUnsubscribe`, `countOutreachSentToday`
- `logSellerActivity`, `logSellerEmail`
- `PlanNextDialog`, `LostReasonDialog`
- `requirePlatformSellerForApi`
- `createAdminClient`, `logServerError`
- `buildSellerEmailHtml` (varsel-e-post)
- `ensureProspectsForCompanies`
- `buildExampleOfferUrl`, `resolveBransje`
- Den offentlige eksempeltilbudssiden
- `lib/analyse-leads/*` (bro til prospekter)

## Faser (hver fase kan shippes alene, og hver gir verdi med en gang)

**Fase 0 — Sikre og rydde (først, liten)**
- Portene inn i `send-email`-ruten og i `autosend` (ENK/NUF, adresser med personnavn, freemail etter regelen).
- SN2025: `41.2` → `41` og ny mapping i `bransje.ts`.
- ICP-filtre i Brreg-importen og i UI-dialogene (AS, 5–20, mva, ikke konkurs). `organisasjonsform`, stiftelsesdato og mva lagres.
- Engangsopprydding av de 31 leadsene i dag: de som stryker portene får `diskvalifisert` med grunn, uten sletting.
- Rett trial-broen.
- Scoring 5–20.
- Faktaarket i kode med verifiserte flagg.

*Ferdig når:* en import av «Tømrere, Vestland» bare gir AS med 5–20 ansatte, ingen ENK kan få e-post fra noen sti, og testene for porter og e-postklassifisering er grønne.

**Fase 1 — Research og KI-kvalifisering**
- db/90 + db/92 (inkludert `selger_settings`).
- Jobbkø, tick-rute og db/93 pg_cron.
- Research-modulene og syntese med validerte kroker.
- Dossier-panel på lead-kortet og prospektliste med filtre.
- «Finn 30 nye nå» per segment.

*Ferdig når:* 30 firmaer fra et ICP-søk får dossier automatisk innen en time, hver krok har et sitat som er verifisert i kode med en klikkbar kilde, nivå A/B/C står på kortet, og kostnaden per prospekt er logget.

**Fase 2 — Skriving, godkjenning og sending** (kjernen i 15-minuttersrutinen)
- `outreach_messages`, skrivemotoren, lint og sensor.
- `/selger/godkjenning` med tastaturflyt og lagring av læringsdata.
- Sending i ren tekst med `SALG_SEND_MODE`, tråding og svar-token, og MX-sjekk.
- Sekvensmotoren (steg 2–3 personlig og automatisk, jitter og vindu).
- Førstepartsklikk med beacon.
- Helse og automatisk pause.
- `autosend.ts` pensjoneres.

*Ferdig når:* Casper kan godkjenne 20 utkast på 15 minutter. Godkjente meldinger går ut spredt i vinduet, steg 2 kommer i samme tråd 4 dager senere, og et klikk på den sporede lenken stopper sekvensen og lager en oppgave.

**Fase 3 — Svar-løkka (IMAP)**
- db/91.
- IMAP-leser for innboks og Sendt, matching, klassifisering, handlinger per klasse.
- Forslag til svar, sending i samme tråd fra lead-kortet.
- Varsel-e-post, «Ukjente svar» og snooze med returdato.

*Ferdig når:* et svar på en testsending er klassifisert, sekvensen er stoppet og Casper er varslet innen 10 minutter. Et autosvar stopper ikke sekvensen, og «nei takk» fører til avmelding.

**Fase 4 — Cockpit, pipeline og varme signaler**
- «I dag» blir cockpit med maskinrom-stripe.
- Kanban med menneskesteg og traktstripe.
- Aktiveringsscore for prøvebrukere.
- Bro fra `analyse_leads` til prospekter (`source='analyse'`, varm, ingen kald sekvens).
- Segmentsiden, utvidet Analyse og ukesrapport.

*Ferdig når:* alt Casper trenger å gjøre en dag står på én skjerm i riktig rekkefølge, og trakten per segment kan leses fra kilde til betalende.

**Fase 5 — Autopilot, gaven og eksperimenter**
- Autonominivå 2 per segment med automatisk nedgradering.
- Personlig gave: lenke til proanbud.no/analyse med `?nettside=` forhåndsutfylt og `utm_content=<token>`. Det krever en liten endring i proanbud-new, `ExampleFlow`. Analysen matches tilbake via `analyse_leads.utm`, og det er det sterkeste intensjonssignalet vi har.
- Eksperimenter med vinkler.
- Retention-jobben for GDPR-sletting.

*Ferdig når:* et segment som har fortjent autopilot sender uten Casper, og skrur seg ned igjen ved en simulert bounce-topp.

## Verifisering

`.env.local` peker på prod-Supabase og har live-nøkler. **Lokalt kjøres alltid `SALG_SEND_MODE=dry-run`, eller `test` med `SALG_TEST_RECIPIENT` satt til Caspers egen adresse.**

- **Enhetstester (vitest, `tests/outreach/*`):**
  - porter og adresseklassifikator (ENK, NUF, `fornavn.etternavn`, firmanavn på gmail, generisk adresse på firmadomene)
  - SN2025-mapping
  - `isQuoteGrounded` (sitat som finnes, som er omskrevet, og som er hallusinert)
  - lint: ord, forbudte ord, tall uten dekning, feil pris mot `PLAN_PRICING`, to lenker
  - sekvensplanlegging (dager, vindu, helg, autosvar som flytter)
  - svar-heuristikk (ferie og «meld meg av»)
  - helseterskler
  - en snapshot-test som sikrer at prisene i faktaarket er lik `plans.ts`
- **Eval-skript `scripts/salg-eval.mjs`:** 15–20 ekte ICP-firmaer (offentlige data, med HTML-snapshot i `tests/outreach/fixtures`). Skriptet kjører research og utkast med ekte modell og skriver dossier, kroker med sitater, e-post, lint og karakter til en rapport som Casper vurderer. Settet er også regresjonstesten når promptene endres.
- **Nettleser:** start dev-serveren og gå til /selger i dry-run.
  - Kjør «Finn 30 nye nå», så «Kjør nå» på tick.
  - Se dossier og kilde på lead-kortet, og godkjenn i fokusmodus.
  - Sjekk loggført dry-run-sending, traktstripen og cockpit-tellingene.
- **Test mot prod før live** (i `test`-modus):
  - Send til Caspers egen adresse. Sjekk tråding (steg 2 som `Re:`), pluss-adressering hos Webhuset (`post+test@`), Authentication-Results (DKIM/DMARC), beacon-klikket og mail-tester-poengsum.
  - Svar fra en annen konto for å teste IMAP-løkka.
  - Deretter `live` med kvote 10.
- `pnpm build`, `npm test` og migrasjonene med `--dry-run` før hver fase går inn på main.

## Risiko og tiltak

| Risiko | Tiltak |
|---|---|
| Omdømmet til hoveddomenet (kald e-post fra post@proanbud.no, samme domene som den transaksjonelle posten) | Lavt volum med oppvarming, ren tekst, MX-sjekk, én per domene, automatisk pause på bounce og klage. Eget underdomene vurderes først når volumet passerer ~40/dag (krever Resend Pro). |
| Hallusinert personalisering | Sitater verifiseres i kode, tall må ha dekning, Casper godkjenner steg 1, og autopilot må fortjenes |
| Juss (§ 15, GDPR) | Porter i send-stien, suppresjon ved «nei», bunntekst med kilde, sletteregler og interesseavveining |
| Kostnad | Porter før LLM, billig modell til sensor og syntese, dagsbudsjett, kostnad per prospekt synlig i Analyse |
| Vercel Hobby (daglig cron, 300 s) | pg_cron-tick hvert 10. min og tidsboksede jobber. Merk også: Hobby er for ikke-kommersiell bruk ([[project-vercel-hobby-plan]]), så et Pro-bytte bør vurderes uavhengig av dette. |
| Regnskapsregisteret kan forsvinne | Valgfri henter som degraderer til `null` |
| Nettsider som blokkerer roboter eller er tomme | `for_tynn` → telefonliste, aldri en gjetning |
| Lenkeskannere som gir falske klikk | Beacon med oppholdstid, ikke GET-klikk |
| Casper blir flaskehals | Fokusmodusen skal kunne gjøres på 15 min. Autopilot etter bevist kvalitet. |

## Caspers oppgaver (utenfor koden)

1. Bekreft eller rett faktaarket: sitatene, «gratis opplæring / responstid under 2 timer», geofence og kart (de åpne `- [ ]`-punktene i CONTEXT.md).
2. Legg `SALG_IMAP_HOST`, `SALG_IMAP_USER` og `SALG_IMAP_PASSWORD` for post@proanbud.no inn i Vercel-env.
3. Legg `CRON_SECRET` inn i Supabase Vault (fase 1).
4. Skru eventuelt på Places API for `GOOGLE_MAPS_API_KEY`.
5. Sett `OUTREACH_AUTOSEND` av og `SALG_SEND_MODE=live` først etter at testsendingen er godkjent.
