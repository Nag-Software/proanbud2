This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

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
