# ProAnbud – Forbedringspotensial per modul

_Generert 2026-06-27 via grundig multi-agent kodegjennomgang. 56 bekreftede forbedringer på tvers av 20 moduler. Hvert funn er verifisert mot faktisk kode (forslag som allerede var implementert eller var unøyaktige ble forkastet)._

---

## Dashboard / Hjem

### 1. Dødt handlingsmeny på prosjekter i sidebar gjør ingenting
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** Sidebar – Pågående Prosjekter (alle sider)
- **Fil:** `components/nav-projects.tsx:62-74`
- **I dag:** Hvert pågående prosjekt i sidebaren har en "..."-meny (SidebarMenuAction) med tre valg: "Gå til prosjekt", "Rediger prosjekt" og "Inviter deltakere". Ingen av DropdownMenuItem-ene har onClick eller href, så de gjør absolutt ingenting når man klikker. Menyen ser klikkbar ut men er ren placeholder-kode. "Gå til prosjekt" bruker til og med feil ikon (PinOffIcon). Lenken på selve prosjektnavnet fungerer, men menyen er rent dødt UI.
- **Forbedring:** Enten koble valgene til faktiske handlinger (router.push(item.url) for "Gå til prosjekt", push til prosjekt-rediger/innstillinger, og åpne invitasjons-flyten), eller fjern hele "..."-menyen hvis funksjonene ikke finnes ennå. En meny som ikke gjør noe gir brukeren inntrykk av at appen er ødelagt. Bytt også PinOffIcon til et fornuftig ikon.
- **Presisering (verifisert):** Den eneste handlingen som har data tilgjengelig er "Gå til prosjekt" (router.push(item.url) eller bare gjenbruk href). "Rediger prosjekt" og "Inviter deltakere" har ingen URL/data i props og krever enten utvidet datamodell eller bør fjernes. Minst-friksjon fix: fjern hele "..."-menyen (den duplikerer uansett navne-lenken som allerede navigerer til prosjektet), eller reduser den til reelle handlinger. Bytt PinOffIcon → ArrowRightIcon/FolderOpenIcon hvis menyen beholdes.

### 2. Tilbudsmeny på dashbordet har tre valg som alle gjør det samme
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** / – Dashbord, tabellen "Siste tilbud"
- **Fil:** `app/page.tsx:88-96`
- **I dag:** OfferRowActions viser en "..."-meny per tilbudsrad med tre valg: "Rediger", "Forhåndsvis" og "Åpne tilbud". Alle tre lenker til nøyaktig samme URL `/tilbud/${offerId}`. Brukeren får altså tre tilsynelatende ulike handlinger som leder til samme sted, noe som er forvirrende og uten verdi. I tillegg lenker "Vis alle" (linje 583) og "Detaljer" (linje 531) til /prosjekter i stedet for en tilbudsliste.
- **Forbedring:** Forenkle menyen til kun reelle, distinkte handlinger (f.eks. "Åpne tilbud" + evt. "Forhåndsvis PDF"/"Dupliser"/"Endre status" hvis disse finnes), eller fjern menyen helt siden hele raden allerede er klikkbar til /tilbud/[id]. Pek "Vis alle" mot den faktiske tilbuds-/prosjektoversikten brukeren forventer.
- **Presisering (verifisert):** Forenkle OfferRowActions: fjern menyen helt (raden er allerede klikkbar via navnet), ELLER behold kun reelle distinkte handlinger. Sjekk hva /tilbud/[id] faktisk støtter (f.eks. dupliser, forhåndsvis PDF, endre status) før menypunkter legges til — ikke gjenta tre identiske lenker. Merk: det finnes ingen dedikert /tilbud-liste, så "Vis alle" mot /prosjekter er den nærmeste eksisterende oversikten; en evt. egen tilbudsliste må bygges først.

### 3. Dashbord viser fortsatt skjult demo-/mock-kode i produksjon
`Kodekvalitet` · **Effekt:** Lav · **Innsats:** Liten

- **Side:** / – Dashbord
- **Fil:** `app/page.tsx:134-195`
- **I dag:** useEffect-load() inneholder en stor blokk som leser ?mock=1 fra URL og injiserer statiske demo-tall (Demo Bygg AS, Ola, oppdiktet omsetning/kunder) i stedet for ekte data. Kommentaren sier eksplisitt "Temporary: ... Remove this block once screenshots are captured.". Koden ligger fortsatt i prod, slik at hvem som helst kan åpne /?mock=1 og få et skjermbilde som ser ut som ekte virksomhetsdata – misvisende ved demoer/support, og blokken med Math.random gir også ustabile tall.
- **Forbedring:** Fjern hele mock=1-blokken (linje 134-195) nå som skjermbildene er tatt. Hvis demo-data fortsatt trengs, flytt det bak en eksplisitt miljøflagg/route (f.eks. egen /demo-side) i stedet for en URL-parameter som er tilgjengelig for alle innloggede i produksjon.
- **Presisering (verifisert):** Fjern hele mock=1-blokken (app/page.tsx:134-195). Demo-data bør ikke kunne trigges av en URL-parameter i prod siden det produserer misvisende skjermbilder med oppdiktet virksomhetsdata og ustabile Math.random-tall. Hvis demo-data fortsatt trengs, flytt det bak en egen /demo-route eller eksplisitt miljøflagg (process.env) som ikke er nåbar for vanlige innloggede brukere.

---

## Prosjekter – liste & oppretting

### 4. Søk på UUID-kolonne knekker hele prosjektlista
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /prosjekter – søkefeltet øverst
- **Fil:** `app/prosjekter/page.tsx:35`
- **I dag:** Søket bygger filteret `name.ilike.%term%,id.ilike.%term%`. Kolonnen `projects.id` er UUID (db/00_proanbud_supabase_v2.sql:75-76), og PostgREST/Postgres støtter ikke `ILIKE` direkte på uuid – spørringen returnerer feil. page.tsx:48-52 leser kun `data` og ignorerer `error`, så ved feil blir `projects` undefined → `projects || []` gir tom liste. Resultat: så snart brukeren skriver ett tegn i søkefeltet forsvinner ALLE prosjekter uten noen feilmelding. I tillegg lover placeholderen «Søk prosjekt, kunde eller ID», men OR-klausulen søker verken i kunde-navn eller i prosjektkoden PRJ-XXXXXX som faktisk vises i UI.
- **Forbedring:** Fjern `id.ilike` (eller cast eksplisitt: `id::text.ilike.%term%` slik PostgREST tillater via cast). Søk i kundenavn via embedded resource (`customers.name.ilike.%term%`) så placeholderen stemmer. Håndter `error` fra spørringen (logg + behold visning / vis feiltilstand) i stedet for å la null kollapse til tom liste, slik at en spørrefeil aldri presenterer seg som «ingen prosjekter».
- **Presisering (verifisert):** Bytt `id.ilike.%term%` til `id::text.ilike.%term%` (PostgREST tillater cast) så et innlimt UUID fungerer uten å knekke spørringen, og håndter `error` fra spørringen (logg + behold/vis feiltilstand) i stedet for å la null bli tom liste. Merk: kundenavn-søk i samme `.or()` på embedded resource (`customers.name.ilike`) krever inner-join (`customers!inner`) og fungerer ikke som vanlig top-level kolonne — må verifiseres separat. PRJ-koden kan ikke søkes server-side fordi den genereres klient-side fra UUID; enten dokumentér begrensningen eller match på UUID-prefiks.

### 5. Søk refetcher på hvert tastetrykk og tømmes ikke ved nullstilling
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /prosjekter – søk og filter-rad
- **Fil:** `app/prosjekter/prosjekter-filters.tsx:68`
- **I dag:** `handleSearchChange` kaller `router.replace` på hvert `onChange`, dvs. en full server-roundtrip + ny DB-spørring per tastetrykk. Søke-`Input` (linje 99) bruker `defaultValue={currentQuery}` (ukontrollert). Når brukeren trykker «Nullstill» (resetFilters → `replace(pathname)`) fjernes URL-paramet, men teksten i input-feltet blir stående fordi feltet er ukontrollert. Visuelt ser det da ut som at søket fortsatt er aktivt selv om lista er nullstilt.
- **Forbedring:** Legg på debounce (f.eks. 300 ms) før `replace` slik at man ikke fyrer av en spørring per tegn. Gjør input kontrollert (`value` + lokal state synket mot `searchParams`) eller tving remount/clear ved nullstilling, slik at «Nullstill» faktisk tømmer søkefeltet.
- **Presisering (verifisert):** To uavhengige feil i samme felt: (1) ingen debounce på søk → unødvendig server-roundtrip + DB-spørring per tegn; (2) ukontrollert input med defaultValue gjør at «Nullstill» fjerner URL-param men lar teksten bli stående visuelt. Fiks: debounce replace (~300 ms), og enten gjør input kontrollert (value synket mot searchParams) eller gi feltet key={currentQuery}/remount slik at Nullstill faktisk tømmer feltet.

### 6. «Eksporter»-knappen gjør ingenting
`Manglende funksjonalitet` · **Effekt:** Middels · **Innsats:** Middels

- **Side:** /prosjekter – topp-toolbar
- **Fil:** `app/prosjekter/page.tsx:79`
- **I dag:** `<Button variant="outline">Eksporter</Button>` rendres uten `onClick`, `href` eller form-binding. Knappen er fullstendig død – håndverkeren klikker og ingenting skjer, ingen tilbakemelding.
- **Forbedring:** Enten implementer faktisk eksport (CSV/Excel av synlig prosjektliste, gjerne respekterende aktivt status/søk-filter), eller fjern knappen til funksjonen finnes. En synlig knapp som ikke gjør noe gir lavere tillit til produktet.
- **Presisering (verifisert):** Knappen «Eksporter» (app/prosjekter/page.tsx:79) er en ren <Button> uten handler og gjør ingenting ved klikk. Implementer faktisk CSV-eksport av prosjektlisten som respekterer aktivt status/søk-filter (params.status/params.search er allerede tilgjengelig i page.tsx), eller fjern knappen til funksjonen finnes. En synlig knapp uten effekt gir lavere tillit til produktet for håndverkeren.

---

## Prosjekter – detalj & faner

### 7. Rediger/slett oppgave lagrer ikke i database (data tap)
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Middels

- **Side:** /prosjekter/[id] – Oppgaver-fanen (rediger-skuff)
- **Fil:** `app/prosjekter/[id]/oppgaver-tab.tsx:577-595`
- **I dag:** I rediger-skuffen oppdaterer «Lagre endringer» kun lokal React-state (setTasks(prev => prev.map(...))) og «Slett oppgave» kun setTasks(prev => prev.filter(...)). Ingen server action kalles – det finnes verken updateTaskAction eller deleteTaskAction i app/prosjekter/actions.ts (kun getProjectTasksAction, createTaskAction, updateTaskStatusAction). Brukeren endrer tittel/beskrivelse/status/prioritet/frist/tildelt eller sletter en oppgave, ser at den «forsvinner» eller endres, men ved neste innlasting er alt tilbake/uendret. Det vises heller ingen feilmelding, så brukeren tror endringen er lagret.
- **Forbedring:** Legg til updateTaskAction(taskId, values, projectId) og deleteTaskAction(taskId, projectId) i actions.ts (med assertCanManageProjectTasks + revalidatePath, lik updateTaskStatusAction). Kall dem fra skuffen, vis lasting/feil via sonner toast, og oppdater lokal liste først etter at server svarer OK. Slett-knappen bør i tillegg gå via useConfirm() i stedet for å slette umiddelbart.
- **Presisering (verifisert):** Legg til updateTaskAction(taskId, values, projectId) og deleteTaskAction(taskId, projectId) i app/prosjekter/actions.ts med assertCanManageProjectTasks + revalidatePath (mønster som updateTaskStatusAction/createTaskAction). Wire skuffens "Lagre endringer" og "Slett oppgave" til disse, vis lasting/feil via sonner toast, oppdater lokal liste først etter OK-svar, og kjør slett via useConfirm(). Merk: selv statusendring fra skuffen går i dag tapt selv om updateTaskStatusAction finnes — den er kun koblet til drag-and-drop.

### 8. «Tildelt»-feltet på oppgaver er en blindgyte (lagres aldri)
`Manglende funksjonalitet` · **Effekt:** Høy · **Innsats:** Middels

- **Side:** /prosjekter/[id] – Oppgaver-fanen (Ny oppgave + liste)
- **Fil:** `app/prosjekter/[id]/oppgaver-tab.tsx:439-446`
- **I dag:** I «Ny oppgave»-dialogen finnes et fritekst-Input «Tildelt» (newTaskAssignee), men verdien sendes aldri til createTaskAction – action-en (actions.ts:107-157) tar ikke imot assigned_to og insert-en utelater feltet. I liste-/kanban-visning vises task.assigned_to rått (linje 261), som er en UUID/null og derfor alltid «Ufordelt». Page-en bygger allerede assigneeNameById fra project_members til oversikten, men oppgave-fanen bruker det ikke. Brukeren kan altså ikke faktisk tildele en oppgave til en person.
- **Forbedring:** Gjør «Tildelt» til en Select over prosjektets deltakere (gjenbruk normalizedMembers/assigneeNameById fra page.tsx, send som prop til OppgaverTab). Send assigned_to inn i createTaskAction (og den nye updateTaskAction) og lagre det. Vis deltakerens navn i liste/kanban via et id→navn-oppslag i stedet for rå assigned_to.
- **Presisering (verifisert):** Gjør «Tildelt» til en Select over prosjektdeltakere ved å sende normalizedMembers (id+navn) som prop til OppgaverTab fra page.tsx, og send assigned_to inn i createTaskAction (legg til feltet i type-signaturen + insert). Vis deltakerens navn via id→navn-oppslag i liste/kanban i stedet for rå assigned_to. NB: edit-Draweren («Lagre endringer», oppgaver-tab.tsx:577-581) persisterer i dag INGENTING (kun optimistisk lokal state, ingen updateTaskAction finnes) — så samme fiks bør innføre en updateTaskAction som faktisk lagrer både assigned_to og øvrige redigeringer, ellers er hele rediger-flyten en blindgyte, ikke bare tildeling.

### 9. Fjern deltaker bruker window.confirm/alert og oppdaterer ikke listen
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /prosjekter/[id] – Deltakere-fanen
- **Fil:** `app/prosjekter/[id]/deltakere-tab.tsx:149-156`
- **I dag:** «Fjern fra prosjekt» bruker window.confirm() og alert() ved feil – tvert imot prosjektkonvensjonen (useConfirm() + sonner toast, aldri window.alert/confirm). I tillegg renderes listen fra initialParticipants-propen (server), og klienten kaller removeProjectParticipantAction(...).catch(...) uten noe router.refresh(). Selv om action-en kjører revalidatePath, blir den fjernede deltakeren stående synlig i den allerede rendrede klient-listen til brukeren manuelt laster siden på nytt. Ingen suksess-tilbakemelding gis.
- **Forbedring:** Bytt window.confirm til useConfirm() og alert til sonner toast (error/success). Etter vellykket fjerning, kall router.refresh() (eller fjern raden optimistisk fra lokal state) slik at listen oppdateres umiddelbart. Samme mønster gjelder begge stedene (desktop-tabell ~149 og mobil-liste ~202).
- **Presisering (verifisert):** Bytt window.confirm til useConfirm() og alert til sonner toast.error/success begge steder (desktop ~150 og mobil ~202). Etter vellykket removeProjectParticipantAction, kall router.refresh() (eller fjern raden optimistisk fra lokal state) slik at listen oppdateres umiddelbart, og vis suksess-toast. Merk: useConfirm() returnerer en Promise, så onClick-handleren må gjøres async.

---

## Tilbud – detalj & sending

### 10. Ingen måte å angi/redigere mottakers e-post på siden – sending blokkeres helt hvis kunden mangler e-post
`Manglende funksjonalitet` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /tilbud/[id] – topp-seksjon (Send tilbud-knappen)
- **Fil:** `app/tilbud/[id]/offer-detail-client.tsx:408-413`
- **I dag:** sendOffer() leser mottaker-e-post kun fra offer.recipientEmail eller linkedCustomer.email. Det finnes ingen input-felt for recipientEmail/recipientName/recipientPhone noe sted i UI-et (kun «Melding til kunde»-tekstfelt). Hvis kunden ikke har e-post, kommer toast «Kunden mangler e-post. Oppdater kunden før du sender tilbud.» og brukeren må forlate tilbudet og redigere kunden under Kunder før han kan sende. «Send tilbud»-knappen er heller ikke deaktivert i dette tilfellet – den ser klikkbar ut og feiler først ved klikk. Datamodellen og PATCH-API-et (route.ts:111-113) støtter allerede recipient_name/email/phone, så feltene lagres bare aldri fra denne siden.
- **Forbedring:** Legg til et redigerbart «Send til»-felt (minst e-post, gjerne også navn/telefon) i send-seksjonen, forhåndsutfylt fra kunden men overstyrbart, bundet til offer.recipientEmail (autosaves allerede via saveSnapshot). Da kan håndverkeren sende til en annen kontakt enn den registrerte kunden, og rette en manglende/feil e-post uten å forlate tilbudet. Deaktiver «Send tilbud» (eller vis inline-feil ved feltet) når ingen gyldig e-post finnes, i stedet for å la knappen feile på klikk.
- **Presisering (verifisert):** Legg til redigerbart "Send til"-felt (e-post, evt. navn/telefon) i send-seksjonen, bundet til offer.recipientEmail/Name/Phone (autolagres allerede via saveSnapshot). Forhåndsutfyll fra linkedCustomer men la det overstyres. Endre Send-knappens disabled-betingelse til også å kreve gyldig e-post (eller vis inline-feil ved feltet) i stedet for å feile på klikk. Merk: state seedes med fallback til customer?.email kun ved innlasting (page.tsx:306), så feltet bør vise effektiv mottaker (offer.recipientEmail || linkedCustomer.email) for å unngå tom visning når kunden har e-post men recipient_email er null.

### 11. Debounced autolagring avbrytes ikke før sending – race kan sende/lagre utdaterte ordrelinjer
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /tilbud/[id] – Send tilbud / autolagring
- **Fil:** `app/tilbud/[id]/offer-detail-client.tsx:415-451`
- **I dag:** Autolagring kjører på en 800ms debounce (useEffect linje 457-482) via autosaveTimeoutRef. sendOffer() kaller saveOfferSnapshot() og deretter /send, men avbryter aldri den ventende/igangværende autosave-timeren. saveSequenceRef beskytter bare klient-state, ikke selve DB-skrivingen. En autosave som ble planlagt rett før «Send» trykkes kan dermed lande som en PATCH ETTER send-tidens lagring, med et eldre snapshot. Siden /send (send-offer.ts:98-115) leser line_items på nytt fra DB for å bygge e-post og totaler, kan en stale autosave overskrive nyere linjer og føre til at kunden får et tilbud med utdaterte tall/linjer.
- **Forbedring:** I sendOffer(): clear autosaveTimeoutRef (og helst sett en flag som hindrer ny autosave) FØR saveOfferSnapshot kalles, slik at kun send-tidens lagring skriver til DB. Alternativt gjør DB-skrivingen idempotent/seq-bevoktet på server, eller send line_items eksplisitt med /send i stedet for å re-lese fra DB.
- **Presisering (verifisert):** I sendOffer(): clear autosaveTimeoutRef og sett en suppress-flag FØR saveOfferSnapshot kalles, slik at ingen ny autosave planlegges/kjøres under sending. Merk at clearTimeout alene ikke lukker vinduet for en autosave-fetch som allerede er in-flight — for full korrekthet bør server-PATCH også seq-bevoktes, eller line_items sendes eksplisitt med /send i stedet for å re-lese fra DB (send-offer.ts:100-101).

### 12. «Send tilbud» utløser e-post umiddelbart uten bekreftelse eller mulighet til å sende på nytt-varsel
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /tilbud/[id] – Send tilbud-knappen
- **Fil:** `app/tilbud/[id]/offer-detail-client.tsx:646-649`
- **I dag:** «Send tilbud» sender e-post til kunden umiddelbart ved ett klikk. Etter at tilbudet er sendt (status «sent») er knappen fortsatt synlig med samme tekst «Send tilbud» og enabled, og et nytt klikk sender en ny e-post og overskriver sent_at uten noen advarsel om at kunden allerede har mottatt tilbudet. Det finnes ingen bekreftelse på en irreversibel handling (e-post til kunde) og ingen visuell forskjell mellom «send første gang» og «send på nytt».
- **Forbedring:** Vis en bekreftelsesdialog før utsending (med mottaker-e-post i teksten), og endre knappen til «Send på nytt» når status allerede er «sent» slik at brukeren forstår at en ny e-post går ut. Det reduserer utilsiktet dobbeltsending og gir trygghet før en handling som ikke kan angres.
- **Presisering (verifisert):** Vis en bekreftelsesdialog (AlertDialog) før utsending som inkluderer mottakerens e-post i teksten. Når offer.status === "sent", endre knappetekst til «Send på nytt» og bruk en tydeligere bekreftelse («Kunden har allerede mottatt tilbudet … sende på nytt?»). Merk: MEMORY refererer til useConfirim()/ConfirmProvider som app-konvensjon, men disse finnes ikke i koden — bruk eksisterende AlertDialog-mønster i stedet.

---

## Tilbud – nytt tilbud & AI

### 13. "Lagre som utkast" kaster brukeren ut av veiviseren
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /nytt-tilbud (Nytt tilbud-veiviser, toolbar-knappen + steg 3)
- **Fil:** `components/tilbud/nytt-tilbud-client.tsx:21 (+ components/tilbud/new-offer-wizard.tsx:379)`
- **I dag:** handleSaveDraft kaller onCompleted?.() etter vellykket lagring, og onCompleted i nytt-tilbud-client.tsx gjør router.push(`/prosjekter/${project.id}`). Knappen «Lagre som utkast» finnes i topp-toolbaren på alle steg (og igjen på steg 3). Når en håndverker midt i kalkylen klikker «Lagre som utkast» for å sikre arbeidet, blir vedkommende straks navigert bort fra veiviseren til prosjektsiden – feedback-teksten «Utkast lagret» vises bare et øyeblikk. Brukeren mister redigeringskonteksten og må åpne tilbudet på nytt for å fortsette. Dermed er det heller ingen reell forskjell på «Lagre som utkast» og «Gå til tilbud» på steg 3, bortsett fra hvor man havner.
- **Forbedring:** Skill mellom «lagre og bli» og «lagre og forlat». La handleSaveDraft KUN lagre og vise bekreftelse (behold offerId, bli i veiviseren slik at videre redigering oppdaterer samme utkast), og fjern onCompleted?.()-kallet fra handleSaveDraft. Reserver navigering for handleOpenOffer/«Gå til tilbud». Eventuelt vis en sonner-toast «Utkast lagret» i stedet for den flyktige feedback-boksen.
- **Presisering (verifisert):** Skill «lagre og bli» fra «lagre og forlat»: fjern onCompleted?.() fra handleSaveDraft (new-offer-wizard.tsx:379) slik at brukeren beholder offerId og blir i veiviseren for videre redigering av samme utkast. Vis i stedet en sonner-toast «Utkast lagret» (i tråd med toast-konvensjonen i prosjektet) heller enn den flyktige feedback-boksen. Reserver navigering for handleOpenOffer / «Gå til tilbud».

### 14. AI-avklaring auto-hopper etter 120 ms – fritekst sammen med valgt alternativ er umulig
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /nytt-tilbud – KI-analyse-panel (avklaringsspørsmål)
- **Fil:** `components/tilbud/ai-chat-panel.tsx:133`
- **I dag:** Når brukeren velger et svaralternativ (answerValue ≠ "custom"), starter en useEffect en timer på kun 120 ms som auto-hopper til neste spørsmål (handleAutoAdvance). Samtidig viser panelet et fritekstfelt med teksten «Valgfritt. Kan brukes alene eller sammen med et valgt alternativ.» I praksis er dette umulig: idet man klikker et alternativ, hopper visningen til neste spørsmål før man rekker å klikke i fritekstfeltet og skrive noe. UI-en lover altså en kombinasjon (alternativ + presisering) som koden aktivt hindrer.
- **Forbedring:** Ikke auto-hopp så snart et alternativ velges hvis fritekstfeltet er ment å kunne kombineres. Enten (a) fjern auto-advance og krev et bevisst «Neste»-klikk, eller (b) øk forsinkelsen betydelig og avbryt timeren straks fritekstfeltet får fokus / får innhold, slik at brukeren faktisk kan presisere svaret før hopp. Da stemmer oppførselen med hjelpeteksten.
- **Presisering (verifisert):** Auto-advance-timeren (ai-chat-panel.tsx:133, 120ms) bør avbrytes så snart fritekstfeltet får fokus eller har innhold, eller fjernes til fordel for bevisst «Neste»-klikk. Alternativt: ikke auto-hopp i det hele tatt når et alternativ velges hvis spørsmålet tillater fritekst (allowCustomAnswer/placeholder), slik at oppførselen matcher hjelpeteksten «Kan brukes alene eller sammen med et valgt alternativ».

### 15. «Bruk på alle» nullstiller per-linje rabatt uten varsel
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /nytt-tilbud – steg 2 Rediger prisforslag (Påslag-verktøylinje)
- **Fil:** `components/tilbud/new-offer-wizard.tsx:357`
- **I dag:** applyGlobalAdjustments setter for hver linje både markupPercent: globalMarkupPercent OG discountPercent: 0. Knappen heter «Bruk på alle» og ligger ved siden av «Påslag», så brukeren forventer at den setter felles påslag. At den samtidig stilltiende fjerner alle individuelle rabatter (f.eks. en rabatt brukeren har lagt inn manuelt på en linje) er ikke kommunisert og kan gi feil totalsum brukeren ikke oppdager.
- **Forbedring:** La «Bruk på alle» kun overskrive markupPercent og la discountPercent stå urørt. Hvis nullstilling av rabatt er ønsket, gjør det til en egen, tydelig merket handling («Nullstill rabatter») i stedet for en skjult bivirkning av påslag-knappen.
- **Presisering (verifisert):** La «Bruk på alle» kun overskrive markupPercent (fjern discountPercent: 0 fra applyGlobalAdjustments). Hvis nullstilling av rabatt fortsatt ønskes, legg det som en separat, tydelig merket knapp («Nullstill rabatter») i samme verktøylinje, slik at det ikke skjer som skjult bivirkning. Samme mønster gjelder også blokken på linje 591-592 hvis den deler intensjon.

---

## Tilbudsvisning (offentlig kundevisning)

### 16. Vedlegg fra bedriften vises aldri i kundens meldingstråd
`Manglende funksjonalitet` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /tilbudsvisning/[slug] – Meldinger (chat-panel/sheet)
- **Fil:** `app/tilbudsvisning/[slug]/customer-offer-view.tsx:53-58, 106-123`
- **I dag:** Bedriften kan sende meldinger med vedlegg til tilbudstråden fra innboksen (app/meldinger/inbox-client.tsx:273-305 setter offer_id + attachment_url/type/name), og det offentlige API-et returnerer allerede attachment_url/attachment_name/attachment_type (app/api/public/tilbud/[slug]/messages/route.ts:23,36-40). Men kundevisningen sin PublicMessage-type (linje 53-58) og chat-panelet (linje 106-123) plukker kun ut og rendrer content + tidspunkt. Hvis håndverkeren legger ved f.eks. en revidert tegning eller PDF i meldingen, ser kunden bare den eventuelle teksten – vedlegget er usynlig og kan ikke lastes ned.
- **Forbedring:** Utvid PublicMessage med attachmentUrl/attachmentName/attachmentType (mappes allerede i API-svaret), og rendr i chat-boblen en nedlastbar lenke/forhåndsvisning for vedlegg (lenke med download/target=_blank, evt. miniatyr for bilder). Da kan kunden faktisk åpne dokumentene bedriften sender.
- **Presisering (verifisert):** Utvid PublicMessage (customer-offer-view.tsx:53-58) med attachmentUrl/attachmentName/attachmentType (allerede mappet i API-svaret) og rendr i chat-boblen (:106-123) en nedlastbar lenke (target=_blank, rel=noopener) for vedlegg, med miniatyr når attachmentType starter med "image/". Bonus: POST-handleren i route.ts:69,85-92 returnerer ikke vedleggsfelt, men det er uskadelig her siden kundesendte meldinger ikke har vedlegg – endringen trengs kun for visning av bedriftens vedlegg via GET/polling.

### 17. Desktop-chat henter aldri nye svar (polling kjører kun når chatOpen)
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /tilbudsvisning/[slug] – Meldinger-sidepanel (desktop)
- **Fil:** `app/tilbudsvisning/[slug]/customer-offer-view.tsx:295-319`
- **I dag:** Polling-effekten (linje 295-301) returnerer tidlig hvis !chatOpen og henter meldinger hvert 4. sekund kun når chatOpen er true. På desktop tvinges chatOpen til false (linje 309-319: matchMedia min-width:1024px -> setChatOpen(false)), samtidig som chat-panelet alltid er synlig i det faste sidepanelet (aside, linje 538-542). Resultat: på desktop ser kunden chatten, men den oppdateres aldri etter førstegangslasting – nye svar fra bedriften dukker ikke opp før kunden laster siden på nytt.
- **Forbedring:** Skill pollingen fra chatOpen for desktop: poll når enten det mobile sheet-et er åpent ELLER vi er på desktop (sidepanelet alltid synlig). F.eks. utled en isDesktop-state fra samme matchMedia og start intervallet når (chatOpen || isDesktop). Da holder sidepanelet seg oppdatert.
- **Presisering (verifisert):** Skill polling fra chatOpen ved å utlede en isDesktop-state fra samme matchMedia ("(min-width: 1024px)") som allerede brukes på linje 310, og start intervallet når (chatOpen || isDesktop). Vurder også å pause polling når dokumentet er skjult (document.hidden / visibilitychange) for å unngå unødvendige kall i bakgrunnsfaner.

### 18. Godta/avslå utløser bindende avtale uten bekreftelse
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /tilbudsvisning/[slug] – Godta/Avslå (desktop-knapper + mobil bunnlinje)
- **Fil:** `app/tilbudsvisning/[slug]/customer-offer-view.tsx:472-479, 548-559`
- **I dag:** Knappene «Godta tilbud»/«Avslå» (desktop linje 472-479, mobil linje 548-559) kaller respond() direkte på ett klikk. Teksten i UI presiserer at godkjenning inngår en bindende avtale, men ett feilklikk – spesielt på den faste mobile bunnlinjen der knappene ligger tett – sender umiddelbart accept til serveren og oppretter avtalen. Det finnes ingen bekreftelse (useConfirm/ConfirmProvider er heller ikke montert på denne offentlige ruten).
- **Forbedring:** Legg inn et lett bekreftelsessteg før respond("accept") (og gjerne reject), f.eks. en liten inline-bekreftelse / to-trinns knapp / dialog som oppsummerer totalbeløp inkl. mva og at avtalen blir bindende, før kallet sendes. Reduserer risiko for utilsiktet bindende godkjenning.
- **Presisering (verifisert):** Legg til et lett bekreftelsessteg før respond("accept") (og helst reject) på denne offentlige ruten. Siden ConfirmProvider ikke er montert her, bruk enten en lokal AlertDialog (Radix, allerede i avhengighetene) eller en to-trinns inline-knapp ("Godta" → "Bekreft: bindende avtale, {formatNok(totalInclVat)}"). Vis totalbeløp inkl. mva og at avtalen blir bindende i bekreftelsen. Spesielt viktig for den mobile bunnlinjen der Godta/Avslå ligger tett (flex-1 side om side).

---

## Mine Priser

### 19. Ny opplasting av samme leverandørs prisfil gir duplikat – AI får både gamle og nye priser
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Middels

- **Side:** /mine-priser/prisfiler – Last opp prisfil
- **Fil:** `app/api/mine-priser/prisfiler/route.ts:71`
- **I dag:** POST oppretter alltid en HELT NY rad i supplier_price_files + nye rader, uten å sjekke om det allerede finnes en fil fra samme leverandør. Det finnes ingen «erstatt»-funksjon og ingen advarsel i veiviseren (prisfiler-page.tsx step 3). AI-verktøyene (app/api/mine-priser/sok/route.ts:91 og app/api/tilbud/ai-chat + analyse) henter ALLE supplier_price_rows for company_id på tvers av filer. Når en håndverker laster opp en oppdatert prisliste fra f.eks. Byggmakker (skjer hvert kvartal) får man to «Byggmakker»-filer, og både utdaterte og ferske priser blandes – AI kan plukke gammel pris.
- **Forbedring:** Ved opplasting: oppdag eksisterende fil fra samme leverandør (findSupplier/normalisert navn) og tilby «Erstatt eksisterende prisfil for {leverandør}» i bekreft-steget. På server: ved erstatt, slett gammel fil+rader (eller upsert) i samme operasjon før innsetting, slik at kun én aktiv prisliste per leverandør mates til AI. Minimum: vis en synlig advarsel «Du har allerede en prisfil fra {leverandør} – denne kommer i tillegg» med valg om å erstatte.
- **Presisering (verifisert):** Ved opplasting i step 3: når valgt leverandørnavn matcher en eksisterende fil i `files`-state, vis synlig advarsel + valg "Erstatt eksisterende prisfil for {leverandør}". På server (route.ts POST): ta imot et `replaceFileId`/`mode: "replace"`-flagg og slett gammel fil+rader før innsetting i samme operasjon, slik at kun én aktiv prisliste per leverandør mates til AI. findSupplier() finnes allerede (prisfiler-page.tsx:99) og kan brukes til normalisert navnematch.

### 20. Søk i prisfil-visning treffer kun produktnavn, ikke NOBB/EAN/leverandør-SKU
`Manglende funksjonalitet` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /mine-priser/prisfiler – Prisfil-visning (Sheet)
- **Fil:** `app/api/mine-priser/prisfiler/[id]/route.ts:34`
- **I dag:** Søkefeltet i prisfil-viewer (prisfiler-page.tsx:646) sender q til [id]-ruten, som kun filtrerer på product via .ilike("product", %q%). En håndverker som limer inn et NOBB-nummer eller en strekkode/EAN for å sjekke om en bestemt vare ligger i prislisten får «Ingen produkter funnet», selv om varen finnes. Til sammenligning søker den AI-rettede /sok-ruten allerede bredt på product, nobb, supplier_sku, category, product_group_code og ean (sok/route.ts:100-108) – så datakolonnene finnes.
- **Forbedring:** Utvid søket i [id]-ruten til å bruke .or() over product, nobb, ean og supplier_sku (samme mønster som sok-ruten). Da kan brukeren slå opp en konkret vare med NOBB-nr eller strekkode, som er den naturlige måten håndverkere identifiserer byggevarer på.
- **Presisering (verifisert):** Utvid søket i [id]-ruten til `.or()` over product, nobb og ean (kolonner som allerede selectes på linje 29). Vil du også støtte supplier_sku, må den legges til i .select() på linje 29 i tillegg til .or()-filteret, siden den i dag ikke hentes ut der.

### 21. Redigert lagret jobb hopper ikke på plass i listen før reload (inkonsistent sortering)
`UX` · **Effekt:** Lav · **Innsats:** Liten

- **Side:** /mine-priser/lagrede-jobber – Lagrede jobber
- **Fil:** `components/tilbud/lagrede-jobber-page.tsx:147`
- **I dag:** Ved opprettelse settes ny jobb inn og hele listen re-sorteres alfabetisk (sort på name.localeCompare). Ved redigering gjøres derimot kun prev.map som beholder jobbens opprinnelige posisjon i arrayet. Endrer man navnet på en jobb (f.eks. fra «Vindusbytte» til «Bytte av vindu») blir raden liggende på feil alfabetisk plass helt til siden lastes på nytt, mens GET-ruten sorterer på sort_order så name. Det fremstår som at sorteringen er «ødelagt».
- **Forbedring:** I edit-grenen av handleSave: kjør samme re-sortering som ved opprettelse etter prev.map (sorter resultatet på name.localeCompare(…, "no")), eventuelt respekter sort_order først for å matche server-rekkefølgen. Da holder rekkefølgen seg konsistent uten reload.
- **Presisering (verifisert):** I edit-grenen, returner samme sorterte resultat som create-grenen: `return prev.map(...).sort((a, b) => a.name.localeCompare(b.name, "no"))`. Merk at create-grenen i dag kun sorterer på name (ikke sort_order først), så den matcher heller ikke serverens sort_order-først nøyaktig; for full konsistens kan begge grener sortere på sort_order så name. PATCH-svaret bør da returnere oppdatert sort_order.

---

## Meldinger (intern innboks)

### 22. Bedriftens svar dupliseres når realtime og POST-svar kolliderer
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /meldinger – åpen samtale
- **Fil:** `app/meldinger/inbox-client.tsx:308-325`
- **I dag:** Når bedriften sender en melding legges den først inn optimistisk med en midlertidig tempId (linje 293-308). Realtime INSERT-abonnementet (linje 167-172) mottar deretter den ekte raden og deduplikerer KUN på m.id === newMsg.id. Siden den optimistiske meldingen har tempId (ikke den ekte id-en) matcher ikke dedup-sjekken, og realtime legger til den ekte meldingen som en NY boble. Like etter mapper fetch-svaret tempId → result.message (linje 324), som setter inn den samme ekte meldingen en gang til. Resultatet er to bobler med identisk ekte id i tråden. Hvem som vinner kappløpet (realtime vs. POST-svar) avgjør om/når dubletten vises.
- **Forbedring:** Deduplikér på ekte id i alle innsettingsstier. I result.message-mappingen (linje 323-325): hvis en melding med result.message.id allerede finnes i state (lagt inn av realtime), fjern tempId-raden i stedet for å mappe den til en dublett – f.eks. filtrer bort tempId og legg kun til result.message hvis id ikke allerede finnes. Tilsvarende kan realtime INSERT-handleren matche/erstatte en optimistisk tempId-rad (samme customer_id + content + nær created_at) i stedet for blindt å appende. Da unngås den dupliserte boblen helt.
- **Presisering (verifisert):** I result.message-grenen (linje 323-324): hvis en melding med result.message.id allerede finnes (lagt inn av realtime), fjern bare tempId-raden i stedet for å mappe den til en dublett, f.eks.: setMessages((prev) => { const withoutTemp = prev.filter((m) => m.id !== tempId); return withoutTemp.some((m) => m.id === result.message.id) ? withoutTemp : [...withoutTemp, result.message]; }). I tillegg bør realtime INSERT-handleren (linje 169-172) erstatte en matchende optimistisk tempId-rad (samme customer_id + content + nær created_at, og id som ikke finnes i DB-form) i stedet for å appende blindt, slik at heller ikke den motsatte race-rekkefølgen gir dublett.

### 23. Kan ikke starte ny samtale eller se kunder uten meldinger
`Manglende funksjonalitet` · **Effekt:** Middels · **Innsats:** Middels

- **Side:** /meldinger – samtaleliste
- **Fil:** `app/meldinger/inbox-client.tsx:328-344`
- **I dag:** Samtalelisten viser kun kunder som allerede har minst én melding: conversations filtrerer customers på customerIdsWithMessages (linje 329-332). Det finnes ingen måte å starte en helt ny samtale med en eksisterende kunde fra innboksen. Tom-tilstanden (linje 439-443) sier eksplisitt at 'Meldinger fra kunder vises her når de skriver via tilbudsvisning', dvs. håndverkeren kan i praksis aldri ta initiativ til en melding selv – kun reagere. For en håndverker som vil sende en rask oppdatering til en kunde er dette en åpenbar mangel.
- **Forbedring:** Legg til en 'Ny melding'-knapp i listehodet som åpner en kundevelger (søk i company-kundene) og oppretter/åpner en tom tråd der bedriften kan skrive første melding. Da kan håndverkeren ta initiativ uten å vente på at kunden skriver via tilbudssiden.
- **Presisering (verifisert):** Legg til en 'Ny melding'-knapp i listehodet (ved siden av 'Meldinger', linje 388-396) som åpner en kundevelger med søk over alle company-kunder (customers er allerede lastet, linje 128-137). Ved valg settes selectedCustomerId til kunden — chat-tråden viser allerede en fungerende tom-tilstand ('Start samtalen ved å sende en melding nedenfor', linje 546-553) og handleSendMessage fungerer uten eksisterende meldinger siden offerId er nullable. Krever ingen API-endring.

---

## Kalender

### 24. Prosjektkobling bruker hardkodede falske prosjekter
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Middels

- **Side:** /kalender – Hendelsesdetaljer-dialogen (Koble til prosjekt)
- **Fil:** `app/kalender/page.tsx:578-581`
- **I dag:** Select-feltet "Koble til prosjekt" i redigeringsdialogen har tre hardkodede valg: <SelectItem value="none">Ingen</SelectItem>, <SelectItem value="project-1">Prosjekt Alpha</SelectItem> og <SelectItem value="project-2">Prosjekt Beta</SelectItem>. Det finnes ingen ekte prosjekter i listen, og verdiene "project-1"/"project-2" sendes videre til API-et (PATCH/POST → enqueueTripletexCalendarEvent), som faktisk bruker projectId i en reell Tripletex-synk-payload (lib/integrations/tripletex/sync.ts:61-66). Brukeren kan altså aldri koble en hendelse til et reelt prosjekt, og hvis funksjonen "virker" sender den ugyldige ID-er til Tripletex.
- **Forbedring:** Last brukerens faktiske prosjekter (supabase.from("projects") filtrert på company_id, slik /prosjekter gjør) ved mount og fyll Select med ekte prosjekt-ID-er og -navn. Bruk samme reelle ID som Tripletex-synken forventer. Inkluder også prosjektvalget i opprett-dialogen (Ny hendelse), ikke bare i redigering, siden det er der man oftest knytter en avtale til et prosjekt.
- **Presisering (verifisert):** Last brukerens faktiske prosjekter (supabase.from("projects") filtrert på company_id, slik app/prosjekter/page.tsx:27 gjør) ved mount, og fyll Select i redigeringsdialogen med ekte prosjekt-ID-er/-navn i stedet for de hardkodede "project-1"/"project-2". Legg samme prosjekt-select inn i opprett-dialogen "Ny hendelse" (page.tsx:492-529), som i dag mangler den helt. Merk: forslagets henvisning til lib/integrations/tripletex/sync.ts:61-66 er feil konsument — den funksjonen (syncOfferToTripletex) gjelder tilbud. Den faktiske kalender-synken er enqueueTripletexCalendarEvent i app/api/calendar/events/route.ts:112-149 → enqueueCalendarTripletexSync. Substansen (falske ID-er når en reell Tripletex-synk) stemmer likevel.

### 25. "Ny hendelse"-dialogen har låst tid og mangler felter
`UX` · **Effekt:** Høy · **Innsats:** Middels

- **Side:** /kalender – Ny hendelse-dialogen
- **Fil:** `app/kalender/page.tsx:497-521`
- **I dag:** Når man trykker "Ny hendelse" (eller klikker en dag i månedsvisning på mobil, der bare månedsvisning finnes) åpnes opprett-dialogen med start/slutt vist KUN som lesbar tekst ("Starter: …"/"Slutter: …"), satt til et fast 09:00–10:00-slott via defaultSlotTimes. Brukeren kan ikke endre tidspunkt, varighet, farge eller prosjekt før lagring; man må lagre først og deretter åpne hendelsen på nytt for å justere tid. Redigeringsdialogen har derimot datetime-local-felter, fargevalg og prosjekt.
- **Forbedring:** Gi opprett-dialogen de samme redigerbare feltene som redigeringsdialogen: datetime-local for start/slutt (med validering på at slutt er etter start), valgfri farge og prosjektkobling. Da kan en håndverker opprette en avtale med riktig tidspunkt i ett steg, spesielt viktig på mobil der bare månedsvisning er tilgjengelig og dag-klikk alltid gir 09:00.
- **Presisering (verifisert):** Gi opprett-dialogen de samme datetime-local-feltene for start/slutt som rediger-dialogen (med validering slutt > start) og fargevalg, slik at en avtale kan opprettes med riktig tidspunkt i ett steg — spesielt på mobil der dag-klikk alltid gir 09:00. MERK: "prosjektkobling" i rediger-dialogen (linje 577-581) er foreløpig hardkodede dummy-prosjekter (Prosjekt Alpha/Beta), ikke ekte data, så å speile akkurat det feltet gir liten verdi før prosjektlisten kobles til reelle prosjekter.

### 26. Feil og bekreftelser bruker native alert()/confirm()
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /kalender – lagring, sletting, flytting og frakobling
- **Fil:** `app/kalender/page.tsx:203,296,299,333,341,357,383`
- **I dag:** Modulen bruker nettleserens innebygde window.alert() for feilmeldinger ved lagring/oppdatering/sletting/flytting (linje 296, 299, 333, 357, 383) og window.confirm() for sletting (341) og frakobling (203). Resten av appen bruker sonner-toast for tilbakemelding (f.eks. app/prosjekter/*). Native alert/confirm blokkerer UI-tråden, ser fremmed ut, kan ikke styles, og gir dårlig mobilopplevelse. Suksess-handlinger (lagret/slettet/flyttet) gir dessuten ingen positiv tilbakemelding i det hele tatt.
- **Forbedring:** Bytt alle alert()-kall til sonner toast.error(...) og legg til toast.success(...) ved vellykket opprettelse/oppdatering/sletting/flytting. Erstatt confirm() for sletting og frakobling med en bekreftelsesdialog (samme mønster som ellers i appen) i stedet for nettleserens confirm.
- **Presisering (verifisert):** Bytt alle alert()-kall i app/kalender/page.tsx til toast.error(...) og legg til toast.success(...) ved opprett/oppdater/slett/flytt. Erstatt de to native confirm()-kallene (linje 203 frakobling, 341 sletting) med en bekreftelsesdialog. NB: det finnes ingen useConfirm()/ConfirmProvider i denne kodebasen (ingen grep-treff), så «samme mønster som ellers i appen» er unøyaktig for confirm — bruk shadcn AlertDialog/Dialog for bekreftelse i stedet. Statusmeldinger (setStatusMessage) i frakoblingsflyten kan også erstattes med toast for konsistens.

---

## Kunder (CRM-lite)

### 27. Sletting av kunde skjer uten bekreftelse
`UX` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /kunder – kundetabell, rad-meny "Fjern kunde"
- **Fil:** `components/kunder/columns.tsx:84`
- **I dag:** "Fjern kunde" i rad-menyen kaller deleteCustomerAction(customer.id) umiddelbart ved klikk (columns.tsx:84-92). Det finnes ingen bekreftelsesdialog – ett feilklikk sletter kunden permanent fra databasen (actions.ts:145 gjør en hard DELETE). Til sammenligning bruker resten av appen et bekreftelsesmønster for destruktive handlinger.
- **Forbedring:** Legg inn en bekreftelse før sletting (AlertDialog / det app-globale confirm-mønsteret) som forklarer at kunden fjernes permanent, før deleteCustomerAction kalles. Vurder også å advare/blokkere hvis kunden har tilknyttede prosjekter, siden sletting da kan etterlate foreldreløse prosjekter.
- **Presisering (verifisert):** Legg en bekreftelse foran sletting i CustomerRowActions (columns.tsx). Bruk det faktiske app-mønsteret window.confirm (f.eks. "Er du sikker på at du vil fjerne kunden permanent?") – merk: useConfirm()/ConfirmProvider nevnt i minnet finnes faktisk ikke i dette repoet, etablert mønster er window.confirm. Vurder også å advare når customer.activeProjects > 0 siden hard DELETE i actions.ts kan etterlate foreldreløse prosjekter.

### 28. Hardkodet "Sist kontaktet" og fiktivt notat vises som ekte kundedata
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /kunder – kundedrawer, Oversikt-fanen (Aktivitet & Notater)
- **Fil:** `components/kunder/customer-drawer.tsx:227`
- **I dag:** I drawer-en vises "Sist kontaktet" med customer.lastContact, men lastContact settes i page.tsx:125 til new Date().toISOString() for ALLE kunder – altså alltid dagens dato, ikke reell siste kontakt. I tillegg vises et hardkodet, oppdiktet sitat (customer-drawer.tsx:230): "Kunde foretrekker å bli kontaktet via e-post etter kl 14." identisk for hver eneste kunde. Begge presenteres som ekte kundeinfo og er villedende.
- **Forbedring:** Fjern den falske "Sist kontaktet"-datoen (eller utled den fra faktisk aktivitet, f.eks. nyeste prosjekt/tilbud-oppdatering) og fjern det hardkodede notat-sitatet. Hvis notatfunksjon ønskes, vis et reelt notes-felt fra databasen med tom-tilstand når det er tomt.
- **Presisering (verifisert):** Fjern det hardkodede notat-sitatet i customer-drawer.tsx:230 og erstatt med reell tom-tilstand (eller faktisk notes-felt fra DB). For "Sist kontaktet": enten fjern feltet, eller utled fra faktisk aktivitet (f.eks. MAX av prosjekt-/tilbud-oppdatering i page.tsx) i stedet for new Date(). Slik det er nå viser begge feltene falsk informasjon som ser ut som ekte kundedata.

### 29. Notatfelt i "Ny kunde" lagres aldri, og feil ved opprettelse skjules
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /kunder – "Ny kunde"-drawer
- **Fil:** `components/kunder/add-customer-drawer.tsx:136`
- **I dag:** Skjemaet for ny kunde har et "Notater"-tekstfelt (add-customer-drawer.tsx:136), men createCustomerAction (actions.ts:27-44) leser aldri "notes" og lagrer det ikke – det brukeren skriver forsvinner uten tilbakemelding. I tillegg fanges feil i handleSubmit (add-customer-drawer.tsx:54-56) kun med console.error; ingen toast vises, så en mislykket opprettelse ser ut akkurat som en vellykket (drawer lukkes uansett).
- **Forbedring:** Enten lagre notes i actions/DB (og vis det i drawer-en), eller fjern feltet så brukeren ikke tror notatet blir lagret. Legg samtidig på en toast.error i catch-blokken (som updateCustomerAction allerede gjør) slik at feilet opprettelse faktisk kommuniseres, og ikke lukk drawer-en ved feil.
- **Presisering (verifisert):** To separate bugs i ny-kunde-drawer: (1) Notater-feltet (add-customer-drawer.tsx:136) lagres aldri — createCustomerAction leser ikke "notes" og customers-tabellen mangler kolonnen. Enten legg til notes-kolonne (db-migrasjon) + les/insert i action + vis i drawer, eller fjern feltet. (2) Mislykket opprettelse er usynlig — catch-blokken bruker kun console.error. Legg til toast.error(message) (som customer-drawer.tsx:87 allerede gjør) og ikke kjør onOpenChange(false) ved feil.

---

## Avvik (deviations)

### 30. Full sideomlasting etter lukking og bildeopplasting
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /avvik/[id] – Avviksdetalj
- **Fil:** `app/avvik/[id]/deviation-detail-client.tsx:117 og :135`
- **I dag:** Etter at et avvik lukkes (handleClose) og etter hver bildeopplasting (handlePhotoUpload) kalles window.location.reload(). Dette gjør en hard full-omlasting av hele siden: blank skjerm, alle ressurser hentes på nytt, scroll-posisjon mistes, og på mobil/dårlig nett oppleves det tregt. Server-action har allerede revalidatePath på ruten, så dataene er allerede ferske – den harde reloaden er unødvendig.
- **Forbedring:** Bytt window.location.reload() med router.refresh() (useRouter fra next/navigation). Da re-rendres server-komponenten med oppdaterte data uten hard omlasting, scroll bevares og det føles umiddelbart. Vurder også å nullstille følg-opp-feltet/galleriet via state i stedet for reload. Samme grep brukes allerede ellers i appen iht. perceived-speed-passet.
- **Presisering (verifisert):** Bytt window.location.reload() med router.refresh() i både handleClose og handlePhotoUpload (importer useRouter fra next/navigation). Server-komponenten re-rendres med ferske data uten blank skjerm/scroll-tap. For bildeopplasting kan PhotoCaptureField-feltet i tillegg nullstilles via state slik at galleriet føles umiddelbart oppdatert.

### 31. Avvikslisten henter hele deviations-tabellen to ganger
`Ytelse` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /avvik – Avviksoversikt
- **Fil:** `app/avvik/page.tsx:17-21 (getDeviationsAction + getDeviationStatsAction)`
- **I dag:** Siden kjører getDeviationsAction() (henter ALLE avvik med joins til projects/reporter/checklist) og getDeviationStatsAction() (henter hele deviations-tabellen på nytt, kun id/status/type/created_at) parallelt. Tellingene (åpne/lukket/RUH siste 30 dager) regnes altså ut fra en separat full spørring mot samme tabell som allerede er hentet i listen. Med mange avvik blir dette dobbel last på DB og dobbelt payload.
- **Forbedring:** Regn stats ut fra deviations-arrayet som allerede hentes (åpne = filter på OPEN_DEVIATION_STATUSES, lukket = status==='closed', RUH siste 30 dager = type==='ruh' && created_at >= -30d), enten i page.tsx eller i AvvikClient via useMemo. Da fjernes den andre fulle spørringen helt. (getDeviationStatsAction/getOpenDeviationCountAction kan beholdes for badge i navigasjon der listen ikke er hentet.)
- **Presisering (verifisert):** Fjern getDeviationStatsAction-kallet fra app/avvik/page.tsx og regn stats med useMemo i AvvikClient fra den fulle deviations-arrayen (openCount via OPEN_DEVIATION_STATUSES, closedCount via status==='closed', ruhLast30Days via type==='ruh' && created_at >= -30d). Behold getDeviationStatsAction/getOpenDeviationCountAction for nav-badge der listen ikke er hentet. Merk: list-payloaden er stor (3 joins) mens stats-spørringen var slank — gevinsten er primært å spare den ekstra full-table-scanen, ikke payload.

### 32. Umulig å gjenåpne et lukket avvik
`Manglende funksjonalitet` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /avvik/[id] – Avviksdetalj
- **Fil:** `app/avvik/[id]/deviation-detail-client.tsx:210 og app/avvik/actions.ts:273`
- **I dag:** Lukke-skjemaet vises bare når deviation.status === 'open', og den eneste statusendringen som finnes er closeDeviationAction (status -> 'closed', setter closed_at/closed_by). Det finnes ingen handling eller knapp for å gjenåpne. Lukker en bruker et avvik ved en feil, eller dukker det opp ny informasjon, er det permanent låst uten å lage et nytt avvik.
- **Forbedring:** Legg til en reopenDeviationAction (med samme assertCanManageDeviation-sjekk) som setter status tilbake til 'open' og nullstiller closed_at/closed_by, og vis en 'Gjenåpne avvik'-knapp i detaljvisningen når status === 'closed' for brukere med manage-tilgang. Bekreft med useConfirm før gjenåpning.
- **Presisering (verifisert):** Legg til `reopenDeviationAction(id)` i app/avvik/actions.ts som bruker samme `assertCanManageDeviation`-sjekk, setter status="open" og nullstiller closed_at/closed_by/follow_up_notes (eller behold follow_up_notes), og kjør samme revalidatePath som closeDeviationAction. I deviation-detail-client.tsx vis en "Gjenåpne avvik"-knapp når `canManage && deviation.status === "closed"`, bekreftet via useConfirm() før kall. Merk: useConfirm/ConfirmProvider er allerede konvensjon i appen, så bruk den i stedet for window.confirm.

---

## HMS & KS (sjekklister, maler)

### 33. "Ubesvart"-knappen markerer faktisk punktet som besvart (N/A)
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /prosjekter/[id]/ks/[checklistId] – Fyll ut sjekkliste
- **Fil:** `components/ks/checklist-item-row.tsx:119`
- **I dag:** De tre svarknappene rendres som OK / Ikke OK / "Ubesvart". Den siste knappen sender response="na". I lib/ks/constants.ts er "na" definert som "N/A" (ikke aktuelt), og i actions.ts (computeProgress/deriveChecklistStatus) telles ethvert ikke-null svar – inkludert "na" – som besvart. En håndverker som trykker "Ubesvart" for å hoppe over et punkt markerer det i realiteten som ferdig besvart, øker fremdriften, og kan dermed flippe hele sjekklisten til "Fullført" selv om punkter er hoppet over.
- **Forbedring:** Bytt knappeteksten fra "Ubesvart" til "Ikke aktuelt" (eller "N/A"), i tråd med CHECKLIST_RESPONSE_LABELS. Dette fjerner motsetningen mellom etikett og faktisk semantikk slik at brukeren forstår at punktet blir besvart (som ikke-aktuelt) og talt med i fremdriften.
- **Presisering (verifisert):** Bytt knappeteksten på linje 119 fra "Ubesvart" til "Ikke aktuelt" (samsvarer med CHECKLIST_RESPONSE_LABELS.na = "N/A"). Vurder samtidig om "na" bør telles separat i computeProgress/deriveChecklistStatus slik at "Fullført" krever at alle punkter er aktivt vurdert (ok/not_ok/na), ikke bare ikke-null – men minimumsfiksen er relabel for å fjerne den misvisende etiketten.

### 34. Flervalg ved "Last opp" laster bare opp første bilde – resten forsvinner uten varsel
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Middels

- **Side:** /prosjekter/[id]/ks/[checklistId] – Bilder på sjekklistepunkt
- **Fil:** `components/ks/checklist-item-photos.tsx:121`
- **I dag:** Gallery-inputen har attributtet multiple (linje 197), så brukeren kan velge flere bilder samtidig. Men handleFiles itererer over filene og kjører break etter første fil (linje 130), så kun det første bildet behandles og åpnes i annotatoren. De øvrige valgte bildene blir stille forkastet uten noen tilbakemelding. En montør som velger 5 dokumentasjonsbilder fra galleriet ender opp med bare 1 lagret.
- **Forbedring:** Enten håndter alle valgte filer (komprimer + last opp hver, evt. annoter sekvensielt), eller fjern multiple-attributtet og gi tydelig at det er ett bilde av gangen. Minst mulig: hvis flere filer velges, vis en toast om at kun ett bilde behandles av gangen slik at brukeren ikke tror alle ble lagret.
- **Presisering (verifisert):** Minst mulig-fiks med høy verdi: når files.length > 1, vis toast.info ("Kun ett bilde behandles av gangen") slik at montøren ikke tror alle 5 ble lagret. Bedre fiks: kø de øvrige filene og annoter/last opp sekvensielt etter at hver er lagret, slik at multiple faktisk fungerer. Alternativt fjern multiple fra galleri-inputen for å gjøre én-av-gangen eksplisitt.

### 35. Hvert svar trigger to fulle gjenhentinger av hele sjekklisten
`Ytelse` · **Effekt:** Middels · **Innsats:** Middels

- **Side:** /prosjekter/[id]/ks/[checklistId] – Fyll ut sjekkliste
- **Fil:** `app/prosjekter/[id]/ks/[checklistId]/checklist-fill-client.tsx:24`
- **I dag:** refresh() kaller både getProjectChecklistByIdAction(checklist.id) OG router.refresh(). updateChecklistItemAction returnerer allerede ny status, og den lokale state oppdateres optimistisk i raden. router.refresh() re-kjører i tillegg hele server-siden (page.tsx linje 29) som selv kaller getProjectChecklistByIdAction. Resultatet er at hvert eneste trykk på OK/Ikke OK/N/A på et punkt utløser to fulle henting av hele sjekklisten med alle joins (creator, responder, attachments). På en lang sjekkliste på mobil i felt blir dette merkbart tregt og gir unødig nettverkstrafikk.
- **Forbedring:** Dropp router.refresh() i refresh(), og oppdater kun lokal state ut fra svaret fra updateChecklistItemAction (status + det enkelte punktet) i stedet for å re-hente hele sjekklisten ved hvert trykk. Behold én lett gjenhenting ved behov (f.eks. etter bildeopplasting/avvik), ikke ved hvert avkrysning.
- **Presisering (verifisert):** Dropp router.refresh() i refresh(). Raden holder allerede sin egen optimistiske state (response/comment via setResponse/useEffect), så foreldrekomponenten trenger kun ny aggregert status for fremdriftslinjen. La updateChecklistItemAction returnere (eller behold dagens { status }) og oppdater progress lokalt i klienten i stedet for å re-hente hele sjekklisten med alle joins ved hvert avkrysning. Behold én lett gjenhenting kun ved bildeopplasting/avvik-opprettelse.

---

## Min Bedrift (profil, ansatte & roller)

### 36. Tre menyhandlinger på ansatte gjør ingenting
`Manglende funksjonalitet` · **Effekt:** Høy · **Innsats:** Middels

- **Side:** /min-bedrift/ansatte-og-roller
- **Fil:** `app/min-bedrift/ansatte-og-roller/ansatte-client.tsx:145`
- **I dag:** I handlingsmenyen (...) for hver ansatt finnes «Gjensend invitasjon» (linje 145 og 206), «Trekk tilbake» (linje 147 og 208) og «Deaktiver ansatt» (linje 171 og 232). Ingen av disse DropdownMenuItem-ene har onClick — de er rene døde knapper. Bruker klikker, menyen lukkes, og ingenting skjer (ingen feilmelding, ingen handling). Kun «Endre rolle» er faktisk koblet opp. En admin har dermed ingen reell måte å trekke tilbake en feilsendt invitasjon, gjensende den, eller deaktivere en ansatt — selv om grensesnittet lover det.
- **Forbedring:** Koble de tre handlingene til faktiske operasjoner: «Trekk tilbake» bør DELETE/sette invitations.status='revoked' (og fjerne raden lokalt), «Gjensend invitasjon» bør kalle invitasjons-API på nytt for samme e-post, og «Deaktiver ansatt» bør sette users.is_active=false via en server action (med samme RBAC- og samme-bedrift-sjekk som updateUserRole). Bruk useConfirm() før destruktive handlinger og sonner-toast for resultat. Hvis noe ikke kan bygges nå, fjern menypunktene heller enn å la dem se klikkbare ut.
- **Presisering (verifisert):** Tre menyhandlinger på ansatte er døde knapper (ingen onClick). Wire dem opp: «Trekk tilbake» → sett invitations.status='revoked' (eller slett) + fjern rad lokalt; «Gjensend invitasjon» → POST /api/invitations på nytt for samme e-post; «Deaktiver ansatt» → ny server action som setter users.is_active=false med samme RBAC/samme-bedrift-sjekk som updateUserRole. Bruk useConfirm() før destruktive handlinger og sonner-toast for resultat (merk: filen bruker fortsatt window.alert i handleInvite/handleRoleChange — bør også byttes til toast). Hvis noe ikke kan bygges nå, fjern menypunktene i stedet for å la dem se klikkbare ut.

### 37. alert() brukes til feilmeldinger i strid med konvensjonen
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /min-bedrift/ansatte-og-roller
- **Fil:** `app/min-bedrift/ansatte-og-roller/ansatte-client.tsx:59`
- **I dag:** Ved feil under invitasjon (linje 59) og rolleendring (linje 70 og 75) vises native window.alert(). Prosjektkonvensjonen er å aldri bruke window.alert/confirm, men sonner toast (søsterkomponenten bedriftsprofil-client.tsx bruker allerede toast korrekt). Resultatet er en blokkerende, ustilt nettleser-popup som bryter med resten av appen og ser uprofesjonell ut på mobil.
- **Forbedring:** Bytt de tre alert()-kallene med toast.error(...) fra sonner (allerede importert/brukt ellers i appen). Vurder også toast.success ved vellykket rolleendring, siden det i dag ikke gis noen positiv bekreftelse på at rollen faktisk ble lagret.
- **Presisering (verifisert):** Bytt de tre alert()-kallene (linje 59, 69, 75) med toast.error(...) fra sonner, og legg til toast.success("Rolle oppdatert") etter vellykket setEmployees i handleRoleChange (linje 72). Det gir konsistent, ikke-blokkerende tilbakemelding på linje med resten av appen. Merk: handleInvite har allerede god suksess-flyt via inviteLink-dialogen, så kun feilstien der trenger toast.error.

### 38. Optimistisk ansatt-rad får tilfeldig id og feil status-merking
`Korrekthet/Bug` · **Effekt:** Lav · **Innsats:** Liten

- **Side:** /min-bedrift/ansatte-og-roller
- **Fil:** `app/min-bedrift/ansatte-og-roller/ansatte-client.tsx:48`
- **I dag:** Etter sendt invitasjon legges en lokal rad til med id = Math.random() og status «Invitert» (linje 48-54). Denne id-en matcher ikke den faktiske invitasjonens id fra serveren. Statusbadgen i tabellen behandler kun «Aktiv» som grønn og alt annet som gult (linje 128-133), så «Deaktivert»-ansatte vises også som gul «Invitert»-aktig farge. Siden listen aldri refetches etter invitasjon, vil enhver fremtidig handling mot den optimistiske raden (når den kobles opp) treffe en ikke-eksisterende id.
- **Forbedring:** Bruk invitasjonens faktiske id fra API-responsen (data.invitation?.id) på den optimistiske raden i stedet for Math.random(), eller kall router.refresh() etter vellykket invitasjon for å hente server-sannheten. Skill også «Deaktivert» visuelt fra «Invitert» i statusbadgen (f.eks. grå/rød for deaktivert) slik at admin ser forskjell.
- **Presisering (verifisert):** Erstatt optimistisk setEmployees-blokk (ansatte-client.tsx:48-54) med router.refresh() etter vellykket invitasjon for å hente server-sannheten (faktisk invitasjon-id og rolle), siden API-et ikke returnerer invitasjonens id. Skill dessuten "Deaktivert" visuelt fra "Invitert" i statusbadgen (linje 128-133): f.eks. grå/rød for "Deaktivert", amber kun for "Invitert", grønn for "Aktiv".

---

## Timeføring

### 39. Umulig å rette opp eller slette en timeregistrering
`Manglende funksjonalitet` · **Effekt:** Høy · **Innsats:** Middels

- **Side:** /prosjekter/[id] – Timeføring-fanen og /min-bedrift/timeforing
- **Fil:** `app/timeforing/actions.ts:145 (stopWorkSessionAction) og lib/time-tracking.ts:20 (calculateSessionHours)`
- **I dag:** Hele modulen er kun start/stopp-timer. Timer beregnes utelukkende fra veggklokke (ended_at - started_at) i calculateSessionHours, og verdien klemmes mellom 0,01 og 24 timer (Math.max(0.01, Math.min(24, hours))). Det finnes ingen updateTimeEntryAction, deleteTimeEntryAction eller manuell registrering noen steder — time_entries skrives bare i denne ene actions-filen. Glemmer en håndverker å trykke «Avslutt arbeid» (f.eks. lar timeren stå på over natten), lagres en feilaktig økt på opptil 24 timer som hverken kan endres, slettes eller korrigeres, og som da forurenser tallene i prosjekt-summer og «Arbeidstimer per ansatt».
- **Forbedring:** Legg til en redigerings- og slett-funksjon på hver fullført registrering (rediger start/slutt eller timer + notat, og slett med useConfirm). Da kan en glemt/feil økt rettes i stedet for å ødelegge lønns-/faktureringsgrunnlaget. Vurder også manuell registrering (legg inn timer for en dato uten å ha kjørt timeren), siden start/stopp ofte ikke passer når man fører timer i etterkant.
- **Presisering (verifisert):** Legg til rediger- og slett-action for fullførte time_entries (rediger started_at/ended_at eller hours + description; slett via useConfirm), med RBAC slik at worker kun kan endre egne økter og manager/admin kan endre alle i bedriften. Vis rediger/slett-knapper per registrering i både timeforing-tab.tsx og timeforing-client.tsx. Vurder i tillegg en «Registrer timer manuelt»-flyt (velg dato + antall timer + notat) for etterregistrering, siden start/stopp ikke dekker timer ført i etterkant. Husk revalidatePath på begge sidene og ny RLS for UPDATE/DELETE.

### 40. Mangler eksport av timer (CSV/Excel) for lønn og fakturering
`Manglende funksjonalitet` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /min-bedrift/timeforing – Samlet timeføring / Arbeidstimer
- **Fil:** `app/min-bedrift/timeforing/timeforing-client.tsx:90`
- **I dag:** Oversikten viser timer i tabeller per registrering, per prosjekt og per ansatt, med dagfilter, men det finnes ingen måte å eksportere dataene på. En leder som skal kjøre lønn eller fakturere kunde må manuelt skrive av tallene fra skjermen.
- **Forbedring:** Legg til en «Eksporter»-knapp som laster ned synlige (dagfiltrerte) registreringer som CSV/Excel med dato, ansatt, prosjekt, start–slutt, timer og notat. Dette er det åpenbare neste steget for et timeverktøy i en håndverksbedrift, og bygger direkte på de allerede beregnede filteredEntries.
- **Presisering (verifisert):** Legg til en «Eksporter CSV»-knapp øverst (ved siden av DayFilterPicker) som genererer en CSV fra filteredEntries med kolonnene Dato, Ansatt (kun når canViewAll), Prosjekt, Start, Slutt, Timer og Notat, respekterer det aktive dagfilteret, og lastes ned client-side via en Blob. Vurder også en knapp i «Per prosjekt»- og «Arbeidstimer»-fanene for aggregert eksport (sum per prosjekt/ansatt) siden disse er det reelle lønns-/faktureringsgrunnlaget.

---

## Tripletex & integrasjoner (UI + bakende)

### 41. DocuSign-kortet lenker til en side som ikke finnes (404)
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /innstillinger/integrasjoner – integrasjonsoversikten
- **Fil:** `app/innstillinger/integrasjoner/page.tsx:22`
- **I dag:** DocuSign-integrasjonen har url: "/min-bedrift/integrasjoner/docusign". Den faktiske DocuSign-siden ligger på /innstillinger/integrasjoner/docusign, og det finnes ingen mappe app/min-bedrift/integrasjoner i det hele tatt. Det er ingen rewrite eller redirect i next.config.ts som fanger opp dette. Når brukeren trykker «Åpne» på DocuSign-kortet havner de derfor på en 404-side, og DocuSign-integrasjonen blir reelt sett uoppnåelig fra UI.
- **Forbedring:** Endre url-en for DocuSign til den faktiske ruten «/innstillinger/integrasjoner/docusign» (eller flytt siden til /min-bedrift/integrasjoner/docusign hvis den ønskes der, men da må også sidemappen opprettes). Verifiser at lenken faktisk åpner DocuSign-testeren.
- **Presisering (verifisert):** Endre DocuSign-kortets url på app/innstillinger/integrasjoner/page.tsx:22 fra "/min-bedrift/integrasjoner/docusign" til "/innstillinger/integrasjoner/docusign" (den faktiske ruten der docusign/page.tsx ligger).

### 42. «Min Bedrift» i sidemenyen redirecter til en 404-rute
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** Sidemeny → Min Bedrift (/min-bedrift → /min-bedrift/integrasjoner)
- **Fil:** `app/min-bedrift/page.tsx:4`
- **I dag:** app-sidebar.tsx lenker «Min Bedrift» til /min-bedrift. app/min-bedrift/page.tsx gjør redirect("/min-bedrift/integrasjoner"), men den ruten finnes ikke (det finnes ingen app/min-bedrift/integrasjoner). Den faktiske integrasjonsoversikten ligger på /innstillinger/integrasjoner. Brukere som klikker «Min Bedrift» i menyen lander dermed på en 404.
- **Forbedring:** Endre redirecten til en eksisterende side, f.eks. redirect("/innstillinger/integrasjoner") eller en av de faktiske min-bedrift-undersidene (bedriftsprofil/ansatte-og-roller/tripletex). Sørg for at redirect-mål og sidemeny-lenke peker på samme, eksisterende rute.
- **Presisering (verifisert):** Bytt redirect-målet i app/min-bedrift/page.tsx:4 fra det ikke-eksisterende "/min-bedrift/integrasjoner" til en faktisk side, f.eks. "/min-bedrift/bedriftsprofil" (eller "/innstillinger/integrasjoner"). Merk: sidemeny-lenken «Min bedrift» er en collapsible-trigger og navigerer ikke, så 404 rammer kun direkte besøk/bokmerker på /min-bedrift — ikke menyklikk slik forslaget hevder.

### 43. Endrede synk-valg går tapt uten varsel hvis man ikke trykker «Lagre»
`UX` · **Effekt:** Middels · **Innsats:** Middels

- **Side:** /min-bedrift/tripletex – Tilkobling/Synkroniser
- **Fil:** `app/min-bedrift/tripletex/tripletex-client.tsx:546`
- **I dag:** Synk-bryterne (Kunder, Prosjekter, Tilbud osv.) oppdaterer kun lokal React-state (setScopes). De persisteres først når man trykker den separate «Lagre»-knappen (saveScopes, action update_scope). Det finnes ingen dirty-state-indikasjon, og refreshState() i useEffect/etter andre handlinger overskriver lokale endringer med serververdiene. En bruker som skrur av/på en bryter og navigerer videre (eller utløser en refresh) mister endringene uten noe varsel om at de ikke ble lagret.
- **Forbedring:** Vis tydelig at det finnes ulagrede endringer (f.eks. fremhev «Lagre»-knappen / vis «ulagrede endringer»-tekst når lokale scopes avviker fra connection.scope_config), og/eller lagre bryterendringer automatisk. Unngå at refreshState overskriver lokale, ulagrede bryterverdier.
- **Presisering (verifisert):** Vis dirty-state: sammenlign lokale `scopes` mot `readScopeConfig(state.connection)`; når de avviker, fremhev «Lagre»-knappen og vis «Ulagrede endringer». Hindre at refreshState() (linje 217) overskriver lokale, ulagrede bryterverdier — f.eks. ikke kall setScopes i refreshState når det finnes ulagrede endringer, eller autolagre bryterendringer ved onCheckedChange.

---

## Innstillinger & Billing

### 44. Retur fra Stripe-checkout bekrefter ikke abonnementet (webhook-race)
`Korrekthet/Bug` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /innstillinger/betaling
- **Fil:** `components/billing/billing-page-client.tsx:79-105`
- **I dag:** startCheckout() sender brukeren til Stripe med successPath "/innstillinger/betaling?checkout=success". Når brukeren kommer tilbake gjør BillingPageClient kun ett kall til loadSummary() i useEffect ved mount. Den leser aldri ?checkout=success / session_id og kaller aldri /api/stripe/confirm-checkout. Statusen i company_billing oppdateres derfor kun hvis Stripe-webhooken allerede har rukket å kjøre. Er webhooken forsinket/tapt, viser siden fortsatt "Start gratis prøveperiode"-skjermen (isActive=false), som om ingenting skjedde – og brukeren kan trigge en ny checkout. Onboarding-sidene (app/onboarding/velkommen/page.tsx og abonnement/page.tsx) gjør allerede dette riktig ved å kalle confirm-checkout med sessionId og reconcile:true, så fallback-mekanismen finnes men brukes ikke her.
- **Forbedring:** Etter retur fra checkout: les session_id/checkout=success fra URL i BillingPageClient. Hvis til stede, kall POST /api/stripe/confirm-checkout (med sessionId hvis tilgjengelig, ellers {reconcile:true}) FØR/i stedet for ren loadSummary(), vis en kort 'Aktiverer abonnement…'-tilstand, og rydd query-parameteren fra URL etterpå. Da blir status korrekt umiddelbart selv om webhooken er treg, og man unngår dobbel checkout. Bruk samme mønster som onboarding/velkommen.
- **Presisering (verifisert):** I BillingPageClient: les session_id og checkout fra URL (useSearchParams). Hvis checkout=success, vis en «Aktiverer abonnement …»-tilstand og kall POST /api/stripe/confirm-checkout med {sessionId} (eller {reconcile:true} hvis sessionId mangler) FØR loadSummary(), og fjern query-parameterne fra URL etterpå (router.replace). Gjenbruk nøyaktig samme aktiveringsmønster som app/onboarding/velkommen/page.tsx. Merk: successPath i seg selv inneholder ikke session_id — den legges på av lib/billing/checkout.ts:116 — men den er likevel tilgjengelig i URL ved retur.

### 45. Setekostnad for ansatte er usynlig på betalingssiden
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /innstillinger/betaling
- **Fil:** `components/billing/billing-page-client.tsx:197-275`
- **I dag:** Proff inkluderer 5 ansatt-seter; utover det koster hvert sete 19 kr/mnd (SEAT_PRICE_NOK), og antall seter synkroniseres automatisk til Stripe når ansatte inviteres (syncSeatQuantity). /api/billing/summary returnerer allerede seat_count, billable_seats, included_seats, chargeable_seats og seat_price_nok, og typen i klienten har alle feltene – men UI-en viser dem aldri. Siden viser bare plan, KI-tilbud-kvote, evt. overforbruk og Timeføring-bryteren. En håndverker med f.eks. 8 ansatte betaler dermed 3×19 kr/mnd ekstra uten å se det noe sted på betalingssiden.
- **Forbedring:** Legg til en seksjon på betalingssiden som viser ansatt-seter: f.eks. "Ansatte: {billable_seats} ({included_seats} inkludert)" og, når chargeable_seats > 0, "{chargeable_seats} ekstra seter à {seat_price_nok} kr/mnd" med beregnet sum. Dataene finnes allerede i summary-responsen, så det er kun rendering. Dette gir reell kostnadsoversikt og samsvar mellom det Stripe fakturerer og det brukeren ser.
- **Presisering (verifisert):** Legg til en seksjon (f.eks. under Tillegg) på /innstillinger/betaling som viser ansatt-seter når summary er aktiv: "Ansatte: {billable_seats} ({included_seats} inkludert)" og, hvis chargeable_seats > 0, "{chargeable_seats} ekstra seter à {seat_price_nok} kr/mnd = {chargeable_seats * seat_price_nok} kr/mnd". Rent rendering — alle felt finnes allerede i summary-responsen.

---

## Selger (intern salgs-CRM/outreach)

### 46. Status-endring til «Ukontaktet» sletter ekte kontakthistorikk
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /selger/firmaer/[id] – Kontaktstatus-kort
- **Fil:** `app/api/selger/companies/[id]/route.ts:34-41`
- **I dag:** PATCH-ruten setter alltid seller_last_contacted_at = now når status != «ukontaktet», men NULLER feltet (seller_last_contacted_at: null) når selgeren setter status tilbake til «ukontaktet». Hvis et firma faktisk er ringt/mailet og selgeren senere endrer status tilbake til «ukontaktet» (f.eks. feilklikk eller rydding), forsvinner det reelle «sist kontaktet»-tidspunktet for godt. I tillegg overskrives feltet med ny now() hver gang man bare bytter mellom andre statuser (f.eks. fra «demo» til «oppfølging»), selv om ingen ny kontakt faktisk har skjedd — så «sist kontaktet» blir feil/oppblåst.
- **Forbedring:** Skill «sist kontaktet»-tidsstemplet fra status-feltet. seller_last_contacted_at bør KUN settes ved faktiske kontakthendelser (ring i /contact, e-post i /emails/send), ikke ved status-redigering. I PATCH bør seller_last_contacted_at enten ikke røres i det hele tatt, eller maks settes hvis det er null OG status går fra ukontaktet→kontaktet. Aldri sett det til null fra en status-endring.
- **Presisering (verifisert):** I PATCH-ruten (route.ts:38-41): fjern seller_last_contacted_at helt fra update-objektet ved statusendring. Reell kontakt-tidsstempel settes allerede i /api/selger/contact (og bør settes i /emails/send). Sett aldri feltet til null fra en statusendring; vurder evt. å kun sette now hvis feltet er null OG status går ukontaktet→kontaktet.

### 47. «Ring»-knapp flipper CRM-status og logger samtale selv ved feilklikk/desktop
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Middels

- **Side:** /selger – Oversikt (handlingsknapper) og /selger/firmaer/[id]
- **Fil:** `app/api/selger/contact/route.ts:22-25`
- **I dag:** Trykk på «Ring»-knappen kaller /api/selger/contact som umiddelbart og ubetinget setter seller_contact_status = «kontaktet» og logger en «phone_call»-aktivitet, før window.location.href = tel: kjøres. På desktop gjør tel:-lenken ofte ingenting (ingen telefon-app), og et feilklikk i tabellen registrerer dermed en samtale som aldri skjedde og degraderer/endrer kontaktstatusen permanent. En selger kan ikke ringe uten å forplikte seg til en status-endring.
- **Forbedring:** Ikke flipp status til «kontaktet» automatisk ved klikk på tel:-lenken. Logg heller samtalen/oppdater status først etter bekreftelse — f.eks. en liten «Registrer samtale»-bekreftelse etter at ringeforsøket er gjort, eller behold tel: som ren lenke og la status-/loggføring være en eksplisitt handling. Minst bør status kun heves fra «ukontaktet», ikke overskrive «demo»/«kunde» osv. til «kontaktet».
- **Presisering (verifisert):** Skill ringe-handling fra logging: behold tel:-lenken som ren lenke, og gjør status/loggføring til en eksplisitt handling (f.eks. "Registrer samtale"-knapp eller bekreftelse etter ringeforsøk). Som minimum: i route.ts kun heve status til "kontaktet" når nåværende status er "ukontaktet"/null (legg til betinget update), aldri overskrive "demo"/"kunde"/andre høyere statuser.

### 48. Firma-detalj viser utdatert «sist kontaktet» og svelger feil ved status-lagring
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /selger/firmaer/[id] – Kontaktstatus-kort
- **Fil:** `app/selger/firmaer/[id]/firma-detail-client.tsx:49-64`
- **I dag:** updateContactStatus oppdaterer lokal contactStatus og kaller router.refresh(), men «Sist kontaktet»-teksten leser company.seller_last_contacted_at som er en prop som ikke endres i klienten — så verdien ser uendret ut til full reload slår inn (forvirrende, særlig siden serveren faktisk endrer feltet). Ved feil (response ikke ok) skjer INGENTING: ingen toast, ingen tilbakestilling av select-verdien, selgeren tror endringen ble lagret. Ring/E-post-handlingene oppdaterer heller ikke aktivitets-tidslinjen på siden.
- **Forbedring:** Vis tydelig tilbakemelding: bruk sonner toast.success ved lagret status og toast.error + tilbakestill select til forrige verdi ved feil (modulen bruker allerede sonner ellers). Oppdater «Sist kontaktet» optimistisk lokalt (eller stol på router.refresh ved å hente verdien fra refresh i stedet for statisk prop). Vurder å trigge router.refresh() også etter ring/e-post-retur slik at tidslinjen og «sist kontaktet» reflekterer handlingen.
- **Presisering (verifisert):** Legg til feedback i updateContactStatus: toast.error ved !response.ok (i dag svelges feilen helt — ingen indikasjon på at lagring feilet) og toast.success ved lagret. Kall router.refresh() i handlePhoneClick etter contact-POST slik at aktivitets-tidslinjen og «Sist kontaktet» reflekterer ringingen (i dag oppdateres ingenting før manuell reload). Drop «tilbakestill select»-delen — controlled select viser allerede forrige verdi ved feil.

---

## Sjefen (plattform-admin)

### 49. Firma-filter på tilbud/kontrakter/meldinger er en blindvei uten firmanavn eller «vis alle»
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /sjefen/tilbud, /sjefen/kontrakter, /sjefen/meldinger (med ?company=)
- **Fil:** `app/sjefen/tilbud/tilbud-client.tsx:78-82`
- **I dag:** Fra firma-detaljsiden lenker «Se tilbud/kontrakter/meldinger» til f.eks. /sjefen/tilbud?company=<id>. Klientene filtrerer på company_id, men headeren viser bare «X tilbud for valgt firma» – uten firmanavn. Det finnes ingen knapp/lenke for å fjerne filteret; brukeren må manuelt redigere URL-en eller bruke tilbake-knappen for å se alle igjen. Samme mønster i kontrakter-client.tsx og meldinger-client.tsx.
- **Forbedring:** Når ?company= er satt: vis firmanavnet i headeren (finnes allerede i de filtrerte radene via company_name) og legg til en tydelig «Vis alle» / «Fjern filter»-lenke som går til siden uten query-parameter. Gir brukeren kontekst om hvem de ser på og en åpenbar vei ut av filteret.
- **Presisering (verifisert):** Når ?company= er satt: vis firmanavnet i headeren (f.eks. "{N} tilbud for {firfilteredOffers[0]?.company_name}") og legg til en tydelig «Vis alle»-lenke (next/link til samme side uten query). Gjelder identisk i tilbud-, kontrakter- og meldinger-client. Edge case: hvis filteret gir 0 rader finnes ikke company_name i radene — vurder å sende firmanavn via query-param eller vise en nøytral tom-tilstand med fjern-filter-lenke.

### 50. KPI-kortene på oversikten er ikke klikkbare – uleste meldinger leder ikke videre
`UX` · **Effekt:** Lav · **Innsats:** Liten

- **Side:** /sjefen (Oversikt)
- **Fil:** `app/sjefen/overview-client.tsx:173-195`
- **I dag:** De syv KPI-kortene (Firmaer, Brukere, Tilbud, Kontrakter, Fakturaer, Meldinger med «X uleste fra kunder», Aktive abonnement) er rene statiske kort uten lenke. For å handle på f.eks. uleste kundemeldinger må brukeren finne riktig punkt i sidemenyen manuelt, selv om tallet roper på oppfølging.
- **Forbedring:** Gjør de relevante KPI-kortene til lenker til tilhørende underside (Firmaer→/sjefen/firmaer, Tilbud→/sjefen/tilbud, Kontrakter, Fakturaer, Meldinger→/sjefen/meldinger). Spesielt «uleste fra kunder» bør være en direkte snarvei. Liten endring, men kutter klikk og gjør oversikten til et reelt utgangspunkt for handling.
- **Presisering (verifisert):** Legg til en valgfri href-prop på KpiCard som pakker kortet i next/link (Link er allerede importert linje 3). Lenk Firmaer→/sjefen/firmaer, Brukere→/sjefen/brukere, Tilbud→/sjefen/tilbud, Kontrakter→/sjefen/kontrakter, Fakturaer→/sjefen/fakturaer, Meldinger→/sjefen/meldinger. Spesielt «uleste fra kunder» bør være en direkte snarvei. Merk: dette er en intern plattform-admin-side (Sjefen), ikke sluttbrukeren (håndverker), så verdien er moderat snarere enn høy.

---

## Dokumenter

### 51. Rå feilkoder vises til brukeren i stedet for norsk tekst
`UX` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /dokumenter
- **Fil:** `components/dokumenter/documents-manager.tsx:331 (onDelete), :381 (onCreateFolder), :412 (onCreateArea), :274 (onUpload)`
- **I dag:** Klient-koden gjør toast.error(data.error ?? "...fallback") for slett/opprett/last opp. Men API-et returnerer maskinkoder, ikke ferdig tekst: ved sletting av en mappe som inneholder filer returnerer route.ts:811 { error: "folder_not_empty" }, ved navnekollisjon route.ts:315/599 { error: "folder_exists" }, og route.ts:282 { error: "invalid_name" }. Siden data.error finnes (men er en kode), brukes ALDRI fallback-teksten, og håndverkeren ser den rå strengen "folder_not_empty" / "folder_exists" som toast. Ingen oversettelse av disse kodene finnes noe sted i modulen.
- **Forbedring:** Map de kjente API-feilkodene til norsk i klienten (f.eks. en liten errorMessages-tabell): folder_not_empty → "Mappen må være tom før du kan slette den.", folder_exists → "Det finnes allerede en mappe med dette navnet her.", invalid_name → "Ugyldig navn.". Vis fallback kun når koden er ukjent. Spesielt folder_not_empty er en vanlig vei (slett-knappen ligger på hver mappe-rad uten hint om at den må tømmes først).
- **Presisering (verifisert):** Legg en liten kode→norsk-tabell i documents-manager.tsx og bruk den i alle fem catch-grenene: folder_not_empty → "Mappen må være tom før du kan slette den.", folder_exists → "Det finnes allerede en mappe med dette navnet her.", invalid_name → "Ugyldig navn." Bruk eksisterende norske fallback kun når koden er ukjent. Merk: faktisk filsti er app/api/documents/route.ts (ikke route.ts i rot).

### 52. Ingen fremdrift eller bekreftelse ved filopplasting
`UX` · **Effekt:** Middels · **Innsats:** Middels

- **Side:** /dokumenter
- **Fil:** `components/dokumenter/documents-manager.tsx:251-290 (onUpload)`
- **I dag:** onUpload setter kun busyId="__upload__" som disabler Last opp-knappen, men gir ingen synlig fremdrift. Store filer (tegninger, PDF-er) lastes opp via fetch uten progress-indikator – brukeren ser ingenting skje før hele opplastingen er ferdig og lista oppdateres. I tillegg vises suksess-toast bare når files.length > 1 (linje 281); opplasting av én enkelt fil gir null bekreftelse på at den faktisk ble lagret.
- **Forbedring:** Vis en tydelig pågår-tilstand (f.eks. toast.loading / spinner med filnavn) mens opplastingen kjører, og gi alltid en suksess-bekreftelse også for én fil (toast.success(`${file.name} lastet opp.`)). Helst en ekte fremdriftsindikator via XHR upload-progress for store filer, slik at håndverkere på mobilt nett ser at noe skjer.
- **Presisering (verifisert):** Vis pågår-tilstand under opplasting (toast.loading med filnavn eller spinner + endret knappetekst "Laster opp..."), og gi alltid suksess-bekreftelse, også for én fil (f.eks. toast.success(`${file.name} lastet opp.`) når files.length === 1). Vurder ekte XHR upload-progress for store tegninger/PDF-er slik at brukere på mobilt nett ser fremdrift.

### 53. Duplikate filer med samme navn samles opp uten advarsel
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Middels

- **Side:** /dokumenter
- **Fil:** `app/api/documents/route.ts:390 (storagePath), :394 (upsert:false)`
- **I dag:** Ved opplasting bygges storage-path som `${user.id}/${prefix}${Date.now()}-${cleanName}` og storage.upload kjøres med upsert:false. Fordi Date.now()-prefikset gjør hver path unik, kolliderer to opplastinger av samme filnavn aldri på lagringsnivå – og det finnes ingen sjekk mot eksisterende document_items-rad med samme navn i mappen. Resultatet er at brukeren kan ende opp med flere filer med nøyaktig identisk visningsnavn i samme mappe, uten noe varsel, og uten å vite hvilken som er nyest.
- **Forbedring:** Sjekk om det allerede finnes en fil med samme name + external_parent_id for brukeren før opplasting. Enten avvis med en oversatt melding ("Det finnes allerede en fil med dette navnet – vil du erstatte den?") eller versjoner navnet automatisk (filnavn (2).pdf). Mapper har allerede duplikatsjekk (folder_exists), så filer bør ha tilsvarende konsistent oppførsel.
- **Presisering (verifisert):** Filopplasting (POST i app/api/documents/route.ts) mangler duplikatsjekken som mapper allerede har. Før insert: kjør en spørring på document_items filtrert på user_id, provider='supabase', item_type='file', name=cleanName og external_parent_id=parentPath. Ved treff: enten returner 409 med oversatt melding ("Det finnes allerede en fil med dette navnet – vil du erstatte den?") med klient-prompt om å erstatte, eller auto-versjoner visningsnavnet ("filnavn (2).pdf"). Storage-path kan beholde Date.now()-prefikset; det er document_items.name som vises for brukeren og må være entydig i mappen. Merk: dagens folder-duplikatsjekk filtrerer på item_type='folder', så en fil og mappe med samme navn tillates fortsatt — vurder om sjekken bør dekke begge typer for full konsistens.

---

## Onboarding & Auth

### 54. Invitert bruker kan registrere seg med hvilken som helst e-post
`Sikkerhet` · **Effekt:** Høy · **Innsats:** Liten

- **Side:** /signup?invite=… – Aksepter invitasjon
- **Fil:** `components/signup-form.tsx:31-75 (sammen med app/api/auth/register-invited/route.ts:33)`
- **I dag:** Når man åpner signup med en invite-token, vises et tomt, fritt redigerbart e-postfelt. Skjemaet kaller aldri /api/invitations/[token]/validate for å hente/forhåndsutfylle/låse e-posten. Den brukerinntastede e-posten sendes til register-invited, som bruker `targetEmail = (email || invite.email)` – altså blir kontoen opprettet med det brukeren skriver, ikke e-posten admin inviterte. En invitasjon ment for ola@firma.no kan dermed brukes til å opprette konto med en helt annen e-post, og brukeren får full tilgang (rolle) til bedriften via invitasjonen.
- **Forbedring:** Kall validate-endepunktet når inviteToken finnes, vis bedriftsnavnet («Du er invitert til X») og forhåndsutfyll e-postfeltet med invitasjonens e-post som read-only/disabled. På serversiden i register-invited bør man ignorere klientens `email` helt og alltid bruke `invite.email` (evt. avvise hvis de ikke matcher), slik at invitasjonen er bundet til den inviterte adressen.
- **Presisering (verifisert):** To-delt fiks: (1) I signup-form.tsx, når inviteToken finnes, kall GET /api/invitations/[token]/validate i en useEffect, vis «Du er invitert til {companyName}», og forhåndsutfyll e-postfeltet read-only/disabled med invitasjonens e-post. (2) Viktigst — på serversiden i register-invited bør klientens `email` ignoreres helt og `invite.email` brukes ubetinget (evt. avvis med 400 hvis innsendt email ≠ invite.email), slik at invitasjonen er kryptografisk bundet til den inviterte adressen. Server-fiksen er den sikkerhetskritiske delen; UI-fiksen alene er utilstrekkelig siden API-et kan kalles direkte.

### 55. Felter i «Opprett bedrift» samles inn men forkastes stille
`Korrekthet/Bug` · **Effekt:** Middels · **Innsats:** Liten

- **Side:** /create-company – Opprett din bedrift (Stepper)
- **Fil:** `app/create-company/page.tsx:120-130 (sammen med app/api/companies/route.ts:14)`
- **I dag:** Skjemaet ber brukeren fylle ut «Antall ansatte», «Årlig omsetning», «Hovedleverandør» (trinn 1) og «Hvordan hørte du om oss?» (trinn 3, rett før Fullfør). Men handleCreateCompany sender kun name, org_number, full_name, phone og website, og /api/companies leser bare disse. employees, turnover, supplier og source kastes derfor uten at brukeren får vite det – inkludert «kilde»-spørsmålet som er det aller siste man svarer på.
- **Forbedring:** Enten send disse feltene til API-et og lagre dem (employees/turnover/supplier på companies, source som onboarding/markedsføringskilde – verdifull data for bedriften selv), eller fjern feltene fra skjemaet hvis de ikke skal lagres. Å be om data man kaster er friksjon og gir feil forventning. Source-spørsmålet bør i det minste persisteres siden det er bevisst plassert som siste steg.
- **Presisering (verifisert):** Send employees/turnover/supplier/source til /api/companies og persister dem (employees/turnover/supplier på companies, source som markedsføringskilde). source-spørsmålet er spesielt verdifullt som onboarding-attribusjon og bør minst lagres. Alternativt: fjern feltene som ikke skal brukes, slik at man ikke ber om data som forkastes. NB: krever ny DB-migrasjon (db/NN_*.sql) for å legge til kolonner på companies, jf. prosjektets manuelle migrasjonskonvensjon.

### 56. Ingen klientvalidering av passordlengde ved registrering
`UX` · **Effekt:** Lav · **Innsats:** Liten

- **Side:** /signup – Opprett konto
- **Fil:** `components/signup-form.tsx:160-165`
- **I dag:** Passordfeltet i signup har ingen minLength eller validering. Supabase krever som regel minst 6-8 tegn, så et for kort passord gir en rå engelsk feilmelding fra Supabase («Password should be at least …») etter at brukeren har trykket «Opprett konto» og ventet på nettverkskall. reset-password-form.tsx validerer derimot lokalt (min. 8 tegn) før kallet – signup mangler tilsvarende.
- **Forbedring:** Legg til minLength + lokal validering (f.eks. min. 8 tegn) med en norsk feilmelding før supabase.auth.signUp kalles, på samme måte som reset-password-form gjør. Det gir umiddelbar tilbakemelding og konsistent passordkrav på tvers av modulen.
- **Presisering (verifisert):** Legg til lokal validering i handleSubmit (f.eks. if (password.length < 8) { setError("Passordet må være minst 8 tegn."); return }) før supabase.auth.signUp, samt minLength={8} og autoComplete="new-password" på passord-Input — på samme måte som reset-password-form.tsx. Gjelder også invite-grenen som sender passord til /api/auth/register-invited. Merk: dette dekker kun lengde; for full konsistens bør terskelen matche faktisk Supabase-krav.

