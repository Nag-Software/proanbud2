# Prosjektøkonomi i ProAnbud — retning, og hvordan den spiller på lag med Fiken/Tripletex

_Skrevet: 2026-08-12. Utvider [visjon.md](visjon.md) på økonomidelen, og forutsetter
[fiken-integration-plan.md](fiken-integration-plan.md) for API-detaljene._

## 1. Setningen alt henger på

> **Regnskapssystemet er fasit for kroner ut av selskapet. ProAnbud er fasit for
> hva jobben skulle koste, hva som faktisk er gjort, og hva som er avtalt.
> Dekningsgraden oppstår når de to møtes på samme prosjektnummer.**

Vi bygger aldri regnskap. Vi bygger **driftsøkonomi**: tall som er ferske nok til
å endre en beslutning mens jobben pågår. Regnskapet er per definisjon
etterpåklokskap — det er riktig, men det kommer for sent til å redde et prosjekt.
Det er hele markedsrommet vårt, og det er også grensen vi ikke skal krysse.

**Hva vi aldri gjør:** kontoplan, MVA-melding, lønnskjøring, bilagsføring,
attestering, årsoppgjør, eller «fasit» på resultat. Ser en bruker et tall hos oss
som ikke stemmer med regnskapet, skal svaret alltid være «regnskapet har rett —
her er bilaget» med en lenke rett inn i Fiken/Tripletex.

---

## 2. Prosjektnummeret er hele integrasjonen

Dekningsgrad per prosjekt er ikke et regnestykke, det er et **merkeproblem**. Et
kostnadsbilag uten prosjekt er tapt for alltid — ingen KI og ingen synk kan
gjenskape hvilken jobb den paletten gips gikk til.

Derfor er den ene regelen som gjør resten mulig:

1. Hver ProAnbud-jobb finnes som prosjekt i regnskapet, med **samme nummer og
   navn**, opprettet av oss (Tripletex `/project` og Fiken `/projects` finnes
   begge — se kapabilitetskartet i Fiken-planen).
2. Alle kostnadsbilag merkes med det prosjektet — av regnskapsføreren, eller av
   håndverkeren når hun bestiller.
3. Vi henter bilagene tilbake, summert per prosjekt.

Praktisk betyr punkt 2 at onboarding må si dette høyt til regnskapsføreren, og at
vi bør gjøre det lett å bomme mindre: prosjektnummeret vårt bør stå på tilbudet,
på ordrebekreftelsen og på PDF-en, slik at det havner i «Deres referanse» på
leverandørfakturaen. Prosjektnummer på et sted håndverkeren kan lese det opp fra
mobilen i butikken er en billigere fiks enn all synk i verden.

---

## 3. De fire tallene som alltid blandes

Nesten all forvirring i prosjektøkonomi kommer av at «omsetning» betyr fire ting.
Vi skal navngi dem hver for seg i UI-et, og aldri regne dekningsgrad på feil par:

| Tall | Hva det er | Hvem eier det |
|---|---|---|
| **Kontraktsverdi** | Akseptert tilbud + godkjente endringer | ProAnbud |
| **Opptjent** | Verdien av det som faktisk er utført (ferdiggrad × kontrakt) | ProAnbud |
| **Fakturert** | Utstedte fakturaer | Regnskapet |
| **Innbetalt** | Penger på konto | Regnskapet |

**Dekningsbidrag = opptjent − påløpt kostnad.** Ikke fakturert minus betalt — da
måler man faktureringstakt, ikke lønnsomhet, og et prosjekt med akonto-fakturering
foran fremdriften ser strålende ut helt til det ikke gjør det.

I dag regner `lib/job-costing/project-profitability.ts` omsetning som summen av
aksepterte tilbud, altså **kontraktsverdi**. Det er riktig valg som start, men da
skal kolonnen hete «Kontrakt», ikke «Omsetning» — og prognosen (§6) er det som
gjør tallet nyttig underveis.

---

## 4. Kostnadssiden: tre kilder, tre eiere

### 4a. Timer — ProAnbud eier dem, og her er dagens svakeste ledd

Timene er vår sterkeste kort: vi har dem samme dag, regnskapet har dem tidligst
ved lønnskjøring. Men kostprisen er for grov i dag: profitability-koden tar
**snittet av alle `hourly_rates.cost_rate_nok`** i bedriften. En lærling og en
basmann koster ikke det samme, og et prosjekt med bare lærlinger får da for høy
kostnad (og motsatt).

Retning:

- **Kostpris per ansatt, med gyldig-fra-dato** (ny tabell `employee_cost_rates`),
  slik at et lønnsoppgjør ikke skriver om historikken på ferdige prosjekter.
- **Sosialt påslag i prosent per bedrift** (arbeidsgiveravgift, feriepenger,
  forsikring, uproduktiv tid). Uten dette undervurderer vi lønnskost med
  typisk 30–45 %, og dekningsgraden blir systematisk for pen.
- Fall tilbake til bedriftssnittet når per-ansatt mangler — og **si det i UI-et**,
  slik fanen allerede gjør for satsen i dag.
- **RBAC:** kostpris per ansatt er reelt sett lønnsdata. Lønnsomhet skal være
  admin/prosjektleder (`canManageProjects`), og en håndverker skal aldri se
  hverken margin eller kollegers timekost.

Kostpris kan hentes fra regnskapet der det finnes (Tripletex har ansatte og
timesatser), men **kilden bør være ProAnbud**: den skal kunne settes uten at
integrasjonen er på plass, ellers har vi ingen historie før dag én med Tripletex.

### 4b. Varekjøp og underentreprenører — regnskapet eier dem, vi henter

Dette er den delen brukeren i dag må taste manuelt inn i
`project_material_costs`, og manuell inntasting er der prosjektøkonomi pleier å
dø: den gjøres i to uker, så slutter den, og etter det lyver tallet.

Så snart en integrasjon er koblet på, skal bilagene **hentes**, ikke tastes:

- **Tripletex:** rikeste kilden er hovedbokspostene filtrert på prosjekt og
  datointervall (`/ledger/posting` med prosjektfilter) — da får vi *alle*
  kostnader som er merket prosjektet, ikke bare leverandørfakturaer. Alternativ:
  `/supplierInvoice` med prosjekt på linjene. ⚠️ Begge må bekreftes i sandbox før
  vi lover det; det står allerede åpne Tripletex-spørsmål som krever sandbox.
- **Fiken:** ⚠️ **den avgjørende avklaringen.** Fiken-planen dokumenterer prosjekt
  på *salg* (`invoiceRequest.projectId`), men ikke at kjøp (`/purchases`) kan
  bære prosjekt. Kan de ikke det, finnes ikke Fikens prosjektregnskap på
  kostnadssiden, og da må materialkostnaden enten komme fra hovedbok/bilag med
  egen matching, eller fortsatt registreres i ProAnbud. **Dette må verifiseres mot
  live API før vi selger «dekningsgrad» til en Fiken-kunde.** Fiken har heller
  ingen webhooks, så uansett blir det polling med dato-cursor — helt greit for
  kostnader, som ingen trenger i sanntid.

### 4c. Egne uttak, kjøring, leie — ProAnbud

Kjørebok finnes allerede og kan bli kostnadslinjer per prosjekt. Lagerbeholdning
skal vi ikke inn i.

---

## 5. Modellen: én kostnadstabell, med kilde

Erstatt `project_material_costs` med en generell `project_costs`:

```
project_costs
  company_id, project_id
  source        'manual' | 'tripletex' | 'fiken' | 'kjorebok'
  external_id   bilags-/postering-id hos leverandøren (NULL for manuell)
  cost_kind     'material' | 'subcontractor' | 'equipment' | 'other'
  supplier_name, description, invoice_ref
  amount_nok    eks. mva
  cost_date, posted_at
  account       kontonummer fra regnskapet, når vi har det
  superseded_by UUID → raden som erstattet dette anslaget
  UNIQUE (company_id, source, external_id)
```

Unikhetsnøkkelen gjør pull-en idempotent: samme bilag hentet to ganger blir én
rad, som er nøyaktig samme prinsipp som `external_entity_links` allerede bruker
for push-siden.

**Dobbelttelling er den farligste feilen her.** Brukeren taster inn «Ahlsell
42 000», og tre uker senere kommer den samme fakturaen inn fra regnskapet.
Summeres begge, lyver dekningsgraden — og verre: den lyver *nedover*, så
brukeren tror jobben gikk dårlig. Løsning:

- Med integrasjon påkoblet blir manuelle kostnader **anslag**, tydelig merket.
- Når et bilag kommer inn som matcher (leverandør + beløp innenfor en margin +
  dato i vindu), **foreslår** vi kobling. Vi slår aldri sammen stille.
- Godkjent match setter `superseded_by` — anslaget blir liggende som historikk,
  men telles ikke.

---

## 6. Det tallet som faktisk styrer: prognosen

Kalkyle mot påløpt er ettertid. Det en driver trenger klokka sju om morgenen er:
**kommer denne jobben til å gå i pluss?**

Lønnsomhetsfanen bør derfor ha tre kolonner, ikke to:

| | Kalkyle | Påløpt | Prognose |
|---|---|---|---|
| Timer | 240 t | 186 t | 265 t |
| Lønnskost | … | … | … |
| Materiell | … | … | … |
| **Dekningsgrad** | 34 % | – | **26 %** |

Prognose = påløpt + gjenstående kalkyle (justert for ferdiggrad). Den enkleste
ærlige varianten: ferdiggrad settes manuelt av prosjektlederen (et tall hun
uansett har i hodet), og vi regner resten. Da får vi også de varslene som er
verdt penger: **«80 % av timene brukt ved 50 % fremdrift»** — sendt mens det
fortsatt går an å gjøre noe.

Hvert tall skal vise **kilde og ferskhet**: «Materiell: 6 bilag fra Tripletex,
sist hentet 09:12 · 1 anslag ikke bekreftet». Uten det stoler ingen på tallet den
dagen det avviker fra regnskapet — og det kommer til å avvike, fordi vi teller
påløpt og de teller bokført.

---

## 7. Retningen mot de to systemene, oppsummert

**Push dimensjonen, pull kostnadene.** Hver retning eier sine felter, så det
aldri oppstår en flettekonflikt:

| | ProAnbud → regnskap | Regnskap → ProAnbud |
|---|---|---|
| Kunde | ✅ finnes (Tripletex) | – |
| Prosjekt (nummer/navn) | ✅ finnes | – |
| Tilbud → ordre → faktura | ✅ finnes | – |
| Fakturastatus/betaling | – | ✅ webhook (Tripletex) / polling (Fiken) |
| **Kostnadsbilag per prosjekt** | – | **⬅ dette er det som mangler** |
| Timer | valgfritt (lønnsgrunnlag) | – |

Push-siden er i praksis bygget for Tripletex. Hele det manglende stykket for
dekningsgrad er **én ny pull-jobb** på den eksisterende jobbkøen
(`integration_jobs`, backoff, dead-letter, reaper — alt finnes):
`costs.pull_for_project` / `costs.pull_all`, kjørt på cron og ved åpning av
lønnsomhetsfanen.

Timer *til* regnskapet er bevisst valgfritt: det er lønnsgrunnlag, det er
sensitivt, og det er en helt annen godkjenningsflyt. Ikke bland det inn i
lønnsomhet.

---

## 8. Faseplan

**Fase 0 — uten integrasjon (nå, mens lønnsomhetsfanen bygges)**
Kostpris per ansatt + sosialt påslag. Tre kolonner med prognose. Kilde og
ferskhet på hvert tall. Gjør manuell kostnadsregistrering rask på mobil (bilde av
kvittering → beløp + leverandør). Dette må stå på egne ben — de fleste kundene
har ingen integrasjon den første måneden.

**Fase 1 — Tripletex-pull**
`project_costs` + `costs.pull_*`-jobb + match/anslag-flyten. Bekreft
prosjektfilter på hovedbokspostene i sandbox først.

**Fase 2 — Fiken**
Avklar prosjekt-på-kjøp mot live API. Går det, samme pull med dato-cursor. Går
det ikke, si det ærlig i UI-et: «Fiken gir oss ikke kostnader per prosjekt —
registrer materiell her» er tusen ganger bedre enn et tall som stille mangler
halve kostnaden.

**Fase 3 — porteføljen**
Dekningsgrad på tvers: per kunde, per jobbtype, per prosjektleder, per måned.
«Vi tjener penger på bad, vi taper på kjøkken» er innsikten ingen av
punktverktøyene kan gi, fordi den krever kalkyle + timer + bilag i samme base.
Det er her moaten i visjonen faktisk realiseres.

---

## 9. Åpne spørsmål som må avgjøres av Casper

1. **Kostpris per ansatt** — skal vi be om det? Det er sensitivt, men uten det er
   lønnskosten et gjennomsnitt. Alternativ mellomting: kostpris per *rolle*
   (lærling/svenn/bas) i stedet for per person.
2. **Ferdiggrad** — manuelt tall fra prosjektleder (enkelt, ærlig) eller utledet
   fra timer mot kalkyle (automatisk, men sirkulært)?
3. **Fiken-kunder først eller Tripletex-kunder først?** Tripletex-push er bygget,
   Fiken er kun plan — men Fiken er der de små faktisk er.
4. **Skal ProAnbud kunne fakturere akonto/delfaktura mot fremdrift?** Det er
   naturlig neste steg fra opptjent verdi, men det flytter oss nærmere
   regnskapsgrensen enn noe annet i dette dokumentet.
