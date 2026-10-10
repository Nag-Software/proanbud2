# Resend som e-post-CRM

Proanbud speiler alle bedrifter som har hatt prøveperiode til Resend som kontakter. Sekvenser og kampanjer lages og skrives i Resend-dashbordet. Koden sørger bare for at hver kontakt er i riktig segment, har ferske felt og at automatiseringene får beskjed når noe skjer.

Kode: `lib/resend-crm/` · tabell: `db/116_resend_crm_sync.sql` · cron: `/api/cron/resend-crm-sync` (06:00 daglig) · oppsett: `scripts/resend-crm-setup.mjs`.

## Hva som synkes

**Kontakt** = bedriftens admin (ellers første bruker, ellers firmaets e-post). `first_name` = fornavnet.

**Felt** (bruk i maler som `contact.properties.<felt>`):

| Felt | Innhold |
| --- | --- |
| `firmanavn` | Firmanavnet. Navn i bare store bokstaver skrives pent («Byggmester Marius Thorsen AS») |
| `fag` | `companies.industry` |
| `plan` | `mini` / `proff` / tom |
| `status` | `proeve` / `utlopt` / `betalende` / `avsluttet` |
| `proeve_slutt` | Dato prøven slutter, klar for tekst («15. oktober», norsk tid) |
| `antall_tilbud` | Antall sendte tilbud |
| `sum_tilbud` | Sum sendte tilbud i kr (uten avslåtte) |
| `rabattkode` | Velkomstkoden (80 % første måned). Lages automatisk når det er 4 dager igjen av prøven |

**Segmenter** (for kampanjer). Gratisplanen gir 3 segmenter:

| Segment | Hvem |
| --- | --- |
| Alle prøvebrukere | Alle som noen gang har hatt prøveperiode, også de som er i prøve nå |
| Ikke betalende | Prøven gikk ut uten betaling, eller har betalt og sagt opp |
| Betalende | Aktivt abonnement (også `past_due`) |

Feltet `status` skiller fortsatt `utlopt` fra `avsluttet` hvis du trenger det i en mal.

**Events** (starter automatiseringer). Payload: `fornavn`, `firmanavn`, `plan`, `antall_tilbud`.

| Event | Når |
| --- | --- |
| `proeve.startet` | Ny bedrift starter prøven |
| `tilbud.forste_sendt` | Første tilbud sendt til en kunde |
| `proeve.utlopt` | Prøven gikk ut uten betaling |
| `abonnement.betalt` | Første gang bedriften blir betalende |
| `abonnement.avsluttet` | En betalende kunde sier opp |

Synken kjører når billing endres (webhook, checkout, reconcile), når et tilbud sendes, og daglig som sikkerhetsnett.

## Sette det opp (én gang)

1. Kjør migreringen: `pnpm db:migrate` (db/116).
2. Legg til avsenderdomenet `mail.proanbud.no` i Resend og verifiser DNS.
3. Kjør `node --env-file=.env.local scripts/resend-crm-setup.mjs`. Det lager feltene, segmentene og eventene.
4. Sett `RESEND_CRM=on` i Vercel og deploy.
5. Importer eksisterende bedrifter uten å sende noe:
   `curl -H "Authorization: Bearer $CRON_SECRET" "https://app.proanbud.no/api/cron/resend-crm-sync?mode=backfill"`
6. Bygg automatiseringene (under). Når de er publisert, skru av de gamle hardkodede e-postene: `LIFECYCLE_EMAILS=off` og `TRIAL_REMINDER_EMAILS=off`.

## Maler: ren tekst, personlig

- Avsender `Casper <casper@mail.proanbud.no>`, svar til innboksen din.
- Ingen logo, ingen knapper, én lenke, signatur «-Casper».
- Bunntekst: `Nag Software · adresse · {{{RESEND_UNSUBSCRIBE_URL}}}`. Resend legger ikke til avmelding selv i automatiseringer.
- Slå av klikk- og åpningssporing på domenet. Sporede lenker ser mindre personlige ut.

## Automatiseringer (sekvensene fra planen)

**Mønster for «stopp når de betaler»:** bruk *Vent på event* `abonnement.betalt` med timeout i stedet for *Forsinkelse*. Kommer eventet → slutt. Timeout → send neste e-post.

**A. Prøveperioden** — trigger `proeve.startet`:

1. Send A1 (hei fra casper).
2. Vent på `tilbud.forste_sendt`, timeout 1 dag. Timeout → send A2 (eksempeltilbud).
3. Vent på `tilbud.forste_sendt`, timeout 2 dager. Mottatt → A4 (gratulerer). Timeout → A3 (vil du at jeg viser deg rundt?).
4. Vent på `abonnement.betalt`, timeout 3 dager → A5 (kundesitat).
5. Vent på `abonnement.betalt`, timeout 3 dager → betingelse `contact.properties.antall_tilbud` > 0 → A6 (dine tall).
6. Vent på `abonnement.betalt`, timeout 2 dager → A7 (3 dager igjen, `contact.properties.rabattkode`).
7. Vent på `abonnement.betalt`, timeout 2 dager → A8 (i morgen stenger kontoen).

**B. Etter prøven** — trigger `proeve.utlopt`: A9 → vent 3 d → B1 → vent 7 d → B2 → vent 20 d → B3 → vent 30 d → B4. Bruk *Vent på event* `abonnement.betalt` som pause mellom hver.

**D. Betalende** — trigger `abonnement.betalt`: vent 7 d → D1 → vent 23 d → D2.

**C. Kampanjer:** Broadcasts → velg segment (vanligvis «Alle prøvebrukere» eller «Ikke betalende») → skriv → send.

## Av/på

| Variabel | Effekt |
| --- | --- |
| `RESEND_CRM=on` | Synk på. Alt annet = av (ingen API-kall) |
| `LIFECYCLE_EMAILS=off` | Gamle velkomst/aktivering/verdi/win-back av |
| `TRIAL_REMINDER_EMAILS=off` | Gamle prøvepåminnelser av |
