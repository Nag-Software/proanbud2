# Kald-outreach: leveringsrykte og avsender

Kundemaskinen (`/selger`) sender kald e-post i volum. Kald e-post får uunngåelig
noen spam-klager og bounces. Sendes den fra **hoveddomenet** `proanbud.no`, drar
den ned leveringsrykte for *all* e-post derfra — tilbud, varsler, invitasjoner,
passord-reset. Da kan betalende kunder slutte å motta viktig e-post.

Det finnes to måter å håndtere dette på. **Vi har valgt A** (gratis); B står
beskrevet for når volumet vokser.

---

## A. Gjeldende oppsett — sender fra proanbud.no (gratis) ✅

Vi sender kald-post fra hoveddomenet `post@proanbud.no` og beskytter rykte gjennom
**disiplinert sending** i stedet for domene-separasjon. Det koster ingenting (et
ekstra Resend-domene krever betalt plan), og ved lavt volum er risikoen liten.

Sikkerhetsnettene ligger allerede i koden:

- **Lav dagsgrense + oppvarming** — `OUTREACH_DAILY_LIMIT` (kode-standard 50).
  Start lavt og øk gradvis så domenet bygger rykte:
  - Uke 1: **20/dag**
  - Uke 2: **30/dag**
  - Uke 3+: **50/dag**
  Settes i `.env.local` lokalt OG i **Vercel → Environment Variables** for prod.
  Cold + oppfølging deler grensa, så engine kan aldri overskride den.
- **Én-klikks avmelding + avsenderidentitet** i hver e-post (markedsføringsloven/
  GDPR), allerede i `lib/outreach/templates.ts`.
- **Auto-suppress** ved bounce/klage — Resend-webhooken (`/api/webhooks/resend`)
  legger adressen i `outreach_unsubscribes`, og `isOptedOut` blokkerer videre
  sending. Hold klageraten lav: e-post kun til reelle kontakter, mykt innhold,
  få lenker.
- **Pause hvis det glipper** — ser du bounce-/klagerate stige (følg med i
  `/selger/analyse`), senk `OUTREACH_DAILY_LIMIT` eller sett den til `0` en periode.

Det er alt som trengs for dagens oppsett. Resten av dokumentet (B) er kun
relevant den dagen du vil isolere kald-post på et eget subdomene.

---

## B. Senere — eget subdomene (når volumet rettferdiggjør kostnaden)

**Løsning:** send kald-outreach fra et eget subdomene, `noreply.proanbud.no`, med
sin egen SPF/DKIM/DMARC. Da er rykte til kald-post fysisk adskilt fra
hoveddomenet. Svar fra interesserte leads rutes via `Reply-To` tilbake til en
overvåket innboks på hoveddomenet, så ingen henvendelser går tapt.

> ⚠️ Krever **betalt Resend-plan** (Pro ~$20/mnd) fordi domene nr. 2 — også et
> subdomene — teller mot domene-grensa. Alternativ uten per-domene-kostnad:
> Amazon SES, som tar betalt per e-post (~1 kr/1000) i stedet for per domene, men
> krever en egen integrasjon i koden.

Koden støtter subdomene-veien allerede — den leser to miljøvariabler og faller
trygt tilbake til `post@proanbud.no` til subdomenet er klart (se
`lib/outreach/send.ts` → `getOutreachFromAddress` / `getOutreachReplyToAddress`).

---

## Steg 1 — Legg til domenet i Resend

1. Resend → **Domains** → **Add Domain**.
2. Skriv inn **`noreply.proanbud.no`** (subdomenet, ikke hoveddomenet).
3. Velg region (EU anbefales for norske mottakere/GDPR).

Resend gir deg da et sett DNS-poster å legge inn hos domeneleverandøren for
`proanbud.no`.

## Steg 2 — Legg inn DNS-postene

Hos den som styrer DNS for `proanbud.no` (Domeneshop / Cloudflare / e.l.), legg
inn det Resend viser. Det er typisk:

| Type  | Navn (host)                          | Verdi                          |
| ----- | ------------------------------------ | ------------------------------ |
| MX    | `send.noreply` (Resend-bounce)       | `feedback-smtp.<region>.amazonses.com` (prio 10) |
| TXT   | `send.noreply`                       | `v=spf1 include:amazonses.com ~all` |
| TXT   | `resend._domainkey.noreply`          | (lang DKIM-nøkkel fra Resend)  |
| TXT   | `_dmarc.noreply`                     | `v=DMARC1; p=none; rua=mailto:dmarc@proanbud.no` |

> Eksakte navn/verdier **tas alltid fra Resend-skjermen** — kopier derfra, ikke
> herfra. Tabellen viser bare formen.

DMARC kan starte på `p=none` (kun overvåking). Etter et par uker med god
leveringsstatus kan du stramme til `p=quarantine`.

## Steg 3 — Verifiser i Resend

Tilbake i Resend → **Verify**. DNS-propagering tar fra minutter til et par timer.
Domenet må vise **Verified** før du går videre — ellers avvises sending.

## Steg 4 — Skru på avsenderen

Først **etter** at subdomenet er Verified:

**Lokalt** (`.env.local`) — fjern kommentaren på blokka:

```
OUTREACH_FROM_EMAIL=Proanbud <post@noreply.proanbud.no>
OUTREACH_REPLY_TO_EMAIL=casper@proanbud.no
```

**Produksjon** (Vercel → Project → Settings → Environment Variables) — legg til de
samme to variablene og **redeploy**.

- `OUTREACH_FROM_EMAIL` — kald-avsenderen (subdomenet). Lokaldelen (`post@`) kan
  byttes til hva du vil, f.eks. `kontakt@noreply.proanbud.no`.
- `OUTREACH_REPLY_TO_EMAIL` — en **ekte, overvåket** innboks på hoveddomenet der
  svar fra leads havner. Ikke pek den på subdomenet — der leser ingen.

Sjekk i `/selger/leads`: «Full auto»-kortet og bekreftelsesdialogen viser nå den
faktiske avsenderen (drives av `getOutreachFromEmail()`), så du ser med en gang
at riktig adresse er aktiv.

## Steg 5 — Behold webhooken

Resend bounce/complaint-webhooken (`/api/webhooks/resend`) fungerer på tvers av
domener og fôrer fortsatt opt-out-lista (`outreach_unsubscribes`). Ingen endring
nødvendig.

---

## Oppvarming av nytt subdomene

Et nytt avsenderdomene har null rykte. Sender du 100 kald-e-poster dag 1, lander
de i spam og brenner domenet. Samme gradvise oppvarming som i del A gjelder —
start på ~20/dag og øk uke for uke via `OUTREACH_DAILY_LIMIT`.

## Hvorfor subdomene og ikke et helt eget domene?

Eget toppdomene (f.eks. `proanbud-kontakt.no`) isolerer *enda* mer, fordi noen
mottaksfiltre vurderer subdomene-rykte delvis opp mot rot-domenet. Men det koster
et nytt domene og ny merkevare. `noreply.proanbud.no` gir mesteparten av
isolasjonen, beholder `proanbud.no`-merkevaren, og koden er uansett env-styrt —
vil du bytte til eget domene senere, er det bare å endre `OUTREACH_FROM_EMAIL`.
