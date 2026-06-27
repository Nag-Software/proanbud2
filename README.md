# Proanbud

Norsk arbeidsflyt-SaaS for bygg- og anleggsbedrifter — fra lead til betalt i ett system: anbud/tilbud, kontrakter, HMS/KS, timeføring og fakturering rett til Tripletex, samt outreach-motoren «kundemaskin». Automatikk akselererer hvert steg.

Bygget med Next.js (App Router), Tailwind v4, shadcn/ui, Supabase og Stripe.

## Kom i gang

```bash
npm run dev
```

Åpne [http://localhost:3000](http://localhost:3000) i nettleseren.

Modul-spesifikt oppsett (kalender, dokumenter, nytt tilbud m.m.) er dokumentert under.

## Kalender (Google + Outlook)

Kalenderen bruker direkte OAuth mot Google Calendar og Microsoft Graph (Outlook). Du trenger **ikke** å konfigurere Google/Azure som Supabase Auth-providers for kalenderkobling.

### 1. Database

`calendar_integrations`-tabellen finnes i `db/00_proanbud_supabase_v2.sql`. Kjør denne i Supabase hvis den ikke allerede er på plass.

### 2. Environment variables

Kopier `.env.example` til `.env.local` og fyll inn:

```bash
NEXT_PUBLIC_APP_URL=http://localhost:3000

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/auth/google/calendar/callback

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_CALENDAR_REDIRECT_URI=http://localhost:3000/api/auth/microsoft/calendar/callback
```

### 3. Google Cloud Console

1. Opprett et OAuth 2.0 Client ID (Web application).
2. Legg til redirect URI: `http://localhost:3000/api/auth/google/calendar/callback` (og produksjons-URL).
3. Aktiver **Google Calendar API**.
4. OAuth consent screen: scopes `calendar` og `calendar.events`.

### 4. Microsoft Entra (Azure AD)

1. Registrer en app under **App registrations**.
2. Legg til redirect URI: `http://localhost:3000/api/auth/microsoft/calendar/callback`.
3. Opprett en **Client secret**.
4. API permissions (delegated):
   - `Calendars.ReadWrite`
   - `User.Read`
   - `offline_access`, `openid`, `profile`, `email`
5. Grant admin consent hvis organisasjonen krever det.

### 5. Bruk i appen

1. Logg inn i Proanbud.
2. Gå til `/kalender`.
3. Klikk tannhjul → **Koble til Google** / **Koble til Outlook**.
4. Godkjenn tilgang. Hendelser synkroniseres via `/api/calendar/events`.

Tokens lagres i `calendar_integrations` og fornyes automatisk med refresh token.

## Dokumenter Module Setup

The Dokumenter page now includes a full file manager with:

- Proanbud Cloud files in Supabase Storage bucket `documents`
- Google Drive integration (view, rename, delete)
- OneDrive integration (view, rename, delete)
- Unified metadata in `public.document_items`

### 1. Run database migration

Apply `db/03_documents_manager.sql` in your Supabase SQL editor.

### 2. Configure environment variables

Add these variables in your `.env.local` and your deployment environment:

```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_DRIVE_REDIRECT_URI=https://your-domain.com/api/auth/google-drive/callback

MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
ONEDRIVE_REDIRECT_URI=https://your-domain.com/api/auth/onedrive/callback
```

### 3. Add OAuth redirect URLs

Configure these redirect URLs in each provider console:

- Google: `/api/auth/google-drive/callback`
- Microsoft: `/api/auth/onedrive/callback`

### 4. Required OAuth scopes

- Google Drive: `drive.file`, `drive.readonly`, `userinfo.email`
- OneDrive (Microsoft Graph): `offline_access`, `Files.ReadWrite`, `User.Read`

## Nytt tilbud (AI-kalkyle)

Ny side: `/nytt-tilbud`

Før bruk må du kjøre migrasjonen:

```bash
# Kjør i Supabase SQL Editor
db/07_nytt_tilbud_workflow.sql
```

Valgfritt, men anbefalt for AI-analyse:

```bash
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini
```

Dokumentasjon:

- `docs/nytt-tilbud.md`
