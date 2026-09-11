# Personvern og markedsføringsloven i salgsmaskinen

Gjelder `/selger` og alt i `lib/outreach/`. Sist oppdatert 2026-09-11 (fase 0).
Dette er et arbeidsdokument, ikke juridisk rådgivning. Er noe uklart, går vi for
den strengeste tolkningen.

## 1. Hvem vi kontakter på e-post (markedsføringsloven § 15)

Kald e-post til **fysiske personer** krever forhåndssamtykke. Forbrukertilsynet
regner det som et brudd når reklame sendes til en adresse som faktisk tilhører en
fysisk person, også når adressen ser ut som en firmaadresse. Derfor håndhever vi
dette i kode (`lib/outreach/gates.ts`), ikke i en prompt:

| Tilfelle | E-post | Hvorfor |
|---|---|---|
| ENK (enkeltpersonforetak) | Aldri | Innehaveren er en fysisk person |
| Adresse med personnavn (`ola.nordmann@`, `roy@firma.no`, daglig leders navn) | Aldri | Tilhører en person, selv på firmaets domene |
| Generell firmaadresse på eget domene (`post@`, `kontakt@`, `firmapost@` …) | Ja | Tilhører den juridiske personen |
| Gmail o.l. der delen før @ er firmanavnet, og firmaet er AS (`timrebygg@gmail.com`) | Ja | Caspers beslutning 2026-09-11: firmaets egen adresse |
| Ukjent eier (tredjepartsdomene, uklar lokaldel) | Nei i maskinen | Casper kan vurdere selv ved manuell sending |

Portene kjøres ved import og **rett før hver sending**. Den manuelle sendingen fra
lead-kortet stopper på lovkravene (ENK, personlig adresse, avmeldt) uansett; bare
målgruppefiltrene (ansatte, organisasjonsform utenom ENK) kan Casper overstyre.

Hver e-post har tydelig avsender (Nag Software, org.nr. 936593127), en lenke for
avmelding som virker med ett klikk (`List-Unsubscribe` + RFC 8058) og maks tre
meldinger i en sekvens.

**Avmelding gjelder hele firmaet:** et «nei takk» eller en avmelding fra én adresse
lagres med firmaets domene i `outreach_unsubscribes.domain`, så `post@firma.no`
også stoppes. Dette gjøres aldri for freemail-domener. Bounce (død adresse) avmelder
bare adressen, ikke domenet.

## 2. Telefon

Vi ringer AS i målgruppen. Enkeltpersonforetak ringes bare etter oppslag i
Reservasjonsregisteret. Navn på daglig leder brukes kun i ringebriefen.

## 3. Behandlingsgrunnlag (GDPR art. 6 f — berettiget interesse)

**Formål:** tilby Proanbud til norske håndverks- og regnskapsbedrifter som
sannsynligvis har nytte av det.

**Nødvendighet:** vi behandler bare offentlig tilgjengelige bedriftsopplysninger
(Brønnøysundregistrene, bedriftens egen nettside, Regnskapsregisteret) og det som
trengs for å skrive en relevant henvendelse.

**Avveining:**
- Mottakerne er virksomheter, og henvendelsen gjelder deres næringsvirksomhet.
- Vi velger bort ENK og personlige adresser, så vi i praksis ikke behandler
  personopplysninger om private.
- Navn på daglig leder og styremedlemmer (fra Brreg-roller) brukes bare til å
  kjenne igjen personlige e-postadresser og i ringebrief. Det står aldri i en
  e-post, og fødselsdato hentes ikke.
- Regnskapstall brukes bare til å vurdere om firmaet passer, aldri i teksten.
- Det er lett å si nei, og et nei respekteres for hele firmaet.

**Informasjon (art. 14):** e-posten sier hvor vi fant adressen, og lenker til
personvernerklæringen. ⚠️ Personvernerklæringen på `/privacy` må få et avsnitt om
salgshenvendelser før maskinen sender automatisk (fase 2). Den teksten skal Casper
godkjenne.

## 4. Lagring og sletting

| Data | Hvor | Slettes |
|---|---|---|
| Avmeldinger | `outreach_unsubscribes` | Aldri — nødvendig for å respektere nei |
| Prospekt som stoppes av portene eller ikke svarer | `prospects` | Etter 12 måneder uten dialog |
| Sideutdrag fra research (fase 1) | `prospect_research` | Etter 30 dager |
| Dossier for diskvalifiserte/for_tynn (fase 1) | `prospect_research` | Etter 90 dager |
| Sendt e-post | `seller_email_log` | Etter 24 måneder |
| Google Places-data (fase 4) | dossier | Maks 30 dager (Googles vilkår) |

Automatisk sletting kommer som en daglig jobb i fase 2. Inntil da gjøres det
manuelt ved behov.

## 5. Faktaarket

Alt maskinen påstår om Proanbud, står i `lib/outreach/facts.ts` med
`verified: true`. Villedende markedsføring (§§ 6–7, § 25 mellom næringsdrivende)
unngås ved at uverifiserte påstander aldri når prompten, og kjente feil («5200+
tilbud», «norske servere», DocuSign, udokumenterte prosenttall) stoppes av
forbudslisten.
