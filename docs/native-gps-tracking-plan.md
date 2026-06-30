# Native bakgrunns-GPS / automatisk geofence-stempling — plan

> **Status:** PLAN + første implementasjon (2026-06-30). Backend-kontrakten bygges i
> `proanbud2` og verifiseres; det native laget wires i `proanbud-app` men må testes
> via EAS dev-build på enhet. Bygger på [automatisk-timeregistrering-geofence-plan.md](automatisk-timeregistrering-geofence-plan.md).

## Mål
Automatisk innstempling når en håndverker ankommer en byggeplass, uten at han rører
telefonen — og uten å miste materialtid (geofence-utgang stopper *aldri* klokka).
Den web-baserte manuelle «Stemple inn på plassen» finnes allerede; dette legger det
**native bakgrunnslaget** som gjør det automatisk.

## Hvorfor native er nødvendig
WebView-ens JavaScript fryses i bakgrunnen → kan ikke spore. Geofencing **må** ligge i
det native laget, som vekkes av OS ved inn/ut og sender hendelser til backend.

## Arkitektur
```
[ proanbud-app (native) ]
  expo-location.startGeofencingAsync + expo-task-manager
   • Registrerer prosjekt-geofencer (sirkler: senter + radius) — de nærmeste (≤20 på iOS)
   • OS vekker bakgrunnsoppgave ved ENTER/EXIT
   • POST → backend med brukerens Supabase-token
        │
        ▼
[ proanbud2 backend ]
   POST /api/timeforing/geofence-event   (Bearer-token)
     • ENTER: valider presist (teig-polygon + 10 m) → start/bytt økt (pending)
     • EXIT:  gjør INGENTING med klokka (materialtid telles) — auto-lukking/cron + godkjenning rydder
   GET  /api/timeforing/my-geofences      (Bearer-token)
     • Brukerens prosjekt-geofencer (senter/radius/polygon) som native registrerer
        │
        ▼
[ Supabase ]  time_entries / project_geofences  ←  web-appen leser & viser (tynn klient)
```

## Bibliotekvalg
- **Nå (denne implementasjonen):** `expo-location` + `expo-task-manager` — gratis, del av
  Expo SDK 56, kjørbar i dev-build umiddelbart. Begrensning: mindre pålitelig når appen er
  *drept* på Android.
- **Produksjon (oppgradering):** `react-native-background-geolocation` (transistorsoft,
  ~$399 engang; lisens kun for Android-release, gratis i debug). Overlever terminering/omstart,
  bevegelsesbasert batterisparing, innebygd HTTP-kø. **Samme backend-kontrakt** → bytte er lokalt
  i det native laget.

## Autentisering (native → backend)
Bakgrunnsoppgaven har ingen WebView-cookies. Web-appen sender derfor brukerens Supabase
`access_token` (+ `refresh_token`) til native via broen (`gps:config`) når den kjører i wrapperen.
Native lagrer dem, sender `Authorization: Bearer <access_token>` på hver POST, og fornyer ved 401.
(transistorsoft har innebygd token-håndtering; med expo-location gjør vi det manuelt.)

## Bro-meldinger (web ↔ native)
- **web → native** (`postMessage`): `{ type: "gps:config", accessToken, refreshToken, appUrl }`
  (sendes når innlogget i wrapperen + ved token-refresh/forgrunn), og `{ type: "gps:stop" }`.
- **native → web** (`injectJavaScript`): valgfritt `{ type: "gps:status", ... }` for UI senere.

## Personvern / samtykke (MÅ være på plass før lansering)
Følger den juridiske rammen i hovedplanen: berettiget interesse (ikke samtykke), kun i arbeidstid
+ AV-knapp, formålslås, §9-2 drøfting + informasjon, DPIA, kort lagring. **Compliance-gate i
produktet før GPS kan slås på for en bedrift** bygges som eget steg. iOS «Alltid»-tillatelse og
Android `ACCESS_BACKGROUND_LOCATION` ber vi om gradvis (Når-i-bruk → Alltid) med tydelig begrunnelse.

## App-store-løpet
- **iOS:** purpose strings (Når-i-bruk + Alltid), `UIBackgroundModes: ["location"]`, App Store-review
  (begrunnelse + blå statuslinje).
- **Android:** `ACCESS_FINE/COARSE/BACKGROUND_LOCATION` (+ foreground-service ved kontinuerlig),
  Play-erklæring (skjema + ≤30 s demovideo + prominent disclosure), OEM-batteridreper-guide.
- Egen **dev-build** via EAS (ikke Expo Go).

## Faser
| Fase | Innhold | Status |
|------|---------|--------|
| 0 | Backend-kontrakt: `geofence-event` + `my-geofences` | ✅ bygget (verifisert) |
| 1 | proanbud-app: expo-location + config + geofence-task + bro | ✅ wiret (krever dev-build-test) |
| 2 | Web: send token til native (`NativeTrackingBridge`) | ✅ wiret |
| 3 | Tillatelses-UX (Når-i-bruk → Alltid), AV-knapp, compliance-gate | ⏳ |
| 4 | Bytt til transistorsoft for produksjonspålitelighet | ⏳ |
| 5 | App Store / Play-godkjenning | ⏳ |

## Det som gjenstår å teste/gjøre (etter denne implementasjonen)
1. `npx expo install` kjørt + EAS **dev-build** på fysisk enhet (geofencing virker ikke i Expo Go/simulator-bakgrunn).
2. Gi posisjonstillatelser («Alltid») og verifiser enter/exit → rader i `time_entries`.
3. Bekreft token-refresh i bakgrunn (401-håndtering) — eller bytt til transistorsoft.
4. Compliance-gate + tillatelses-UX før reell bruk.
