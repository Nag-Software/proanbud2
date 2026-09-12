# OpenAI Ads (ChatGPT) — måling av prøvestart

Hovedkonverteringen vi optimaliserer mot er **start av prøveperiode**, som skjer
i appen (nye.proanbud.no). Markedssiden (proanbud.no, eget repo) er allerede satt
opp: pixelen ligger i `<head>`, `oppref` fra annonseklikket lagres i en
førsteparts `__oppref`-cookie, og interstitialen `/start` sender den videre som
query-parameter til `/signup` her.

## Miljøvariabler

| Variabel | Hvor | Rolle |
| --- | --- | --- |
| `NEXT_PUBLIC_OPENAI_ADS_PIXEL_ID` | klient + server | Pixel-ID. Samme som markedssiden (`UWKwj3FZm8Qh9wWzi6RWPx`), som også er innebygd default slik at prod ikke slutter å måle om variabelen mangler. Tom verdi = all måling er no-op. |
| `OPENAI_ADS_API_KEY` | **kun server** | Bearer-token til Conversions API, scoped til én annonsekonto. Aldri `NEXT_PUBLIC_`, aldri i klientkode. Uten den sender vi ingenting server-side. |
| `OPENAI_ADS_SEND_EMAIL_HASH` | kun server | `on` slår på `emails_sha256` i konverteringen. **Av som standard** — analytics-laget vårt har en «aldri PII»-linje, og e-posthash er PII selv hashet. |

`db/95_openai_ads_attribusjon.sql` må kjøres. Uten den feiler alt her lukket:
ingen attribusjon lagres, ingen konvertering sendes, appen knekker ikke.

## Kjeden

```
annonseklikk (ChatGPT)
  → proanbud.no: pixel lagrer oppref i __oppref
  → /start: sender ?oppref=… til nye.proanbud.no/signup
  → /signup: refs lagres i ad_click_refs + registration_completed fyres
  → /create-company: refs kopieres til companies.ad_oppref/ad_obref
  → prøven opprettes: trial_started i nettleseren OG via Conversions API
```

### 1. Pixelen

`components/analytics/openai-pixel.tsx`, montert i `<head>` fra
`app/layout.tsx`. Rå inline `<script>` inne i et eksplisitt `<head>`-element —
**ikke** `next/script` med `beforeInteractive`: i App Router blir den en
`__next_s`-push i `<body>` som Next kjører senere, altså ikke «i `<head>` før
alt annet». `init` og `consent` legges i samme kall-kø, consent rett etter init,
så ingen event kan gå ut i mellomtiden. `debug: true` kun utenfor produksjon.

Samtykke leses fra `pa_consent` (satt på `.proanbud.no`, derfor lesbar herfra).
Bare et uttrykkelig `denied` gir `oaiq("consent", false)`.

### 2. Registrering

`recordSignupAttribution()` i `lib/analytics/openai-ads.ts` leser `oppref` fra
URL-en med `__oppref`-cookien som fallback (og `sessionStorage` som siste
sikkerhetsnett, for tilfellet der e-postbekreftelse tar brukeren ut av flyten),
POSTer refs til `/api/attribution/ad-click`, og fyrer `registration_completed`
som sekundært signal. **Ingen konvertering sendes her.**

Refs lagres i `ad_click_refs` (per bruker) og ikke på `public.users` — den raden
finnes ikke ennå ved registrering, den skrives først i `POST /api/companies`.
Der kopieres de over på firmaet (`companies.ad_*`), slik at konverteringen senere
kan slås opp på én rad.

### 3–4. Konverteringen — to kanaler, samme ID

**Server er autoritativ.** `reportTrialStarted()` i
`lib/analytics/openai-ads-server.ts` kalles fra
`upsertCompanyBillingFromSubscription()` når status blir `trialing`. Det er det
ene stedet ALLE prøvestarter går gjennom — kortfri trial, Checkout-trial,
Stripe-webhook, reconcile-cron og admin-handlinger i `/sjefen`. I flere av dem
ser nettleseren aldri noe.

`POST https://bzr.openai.com/v1/events?pid=<PIXEL-ID>` med
`Authorization: Bearer <OPENAI_ADS_API_KEY>`:

```json
{ "events": [{
  "id": "<Stripe subscription id>",
  "type": "trial_started",
  "timestamp_ms": 1789200000000,
  "oppref": "…",
  "source_url": "https://nye.proanbud.no/signup",
  "user": { "obref": "…" },
  "data": { "type": "plan_enrollment", "plan_id": "proff" }
}] }
```

**Nettleseren er sekundær.** `measureAdEvent("trial_started", …, trialId)` fyres
der prøven startet fra en brukerhandling (`/create-company`,
`/onboarding/abonnement`, betalingssiden). Rutene returnerer `trialId`.

## Deduplisering — det som er lett å ødelegge

OpenAI dedupliserer på **pixel-ID + eventnavn + id** og beholder den **første**
de mottar. Begge kanaler bruker derfor **Stripe-abonnementets id** som event-ID
— prøveperiodens egen ID, aldri en tilfeldig verdi.

To fallgruver, begge verifisert mot den faktiske SDK-en og ikke gjettet:

1. **Opsjonsnøkkelen i pixelen er `event_id`, ikke `id`.** `{ id: … }` blir
   stille forkastet (`validation failed; event dropped` i debug-konsollen) — og
   da har serverkanalen ingenting å deduplisere mot, så konverteringen telles to
   ganger. `measureAdEvent()` sender `{ event_id }`.
2. **Serverkanalen må ikke sende på nytt ved retry.** `ad_conversions` har unik
   nøkkel på `(provider, event_name, event_id)`; vinner vi ikke INSERT-en, er
   konverteringen allerede sendt og vi gjør ingenting.

## Personvern

- Samtykke: bare uttrykkelig `denied` slår av måling. Server-side settes
  `opt_out: true` i stedet for å droppe eventet stille, når vi kjenner samtykket.
- Ingen konvertering sendes uten `oppref`/`obref` — uten en klikk-referanse kan
  OpenAI ikke knytte den til et klikk, og støy hjelper ingen.
- `emails_sha256` er av som standard, se env-tabellen.
- `ad_click_refs` og `ad_conversions` har RLS på uten policies: kun
  service-rollen (serverkoden) leser og skriver dem.
- All måling er best-effort. Ingenting her kan velte en registrering, en
  firmaopprettelse eller en prøvestart.
