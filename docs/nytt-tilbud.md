# Nytt Tilbud Workflow

## Oversikt
`/nytt-tilbud` er nå en 3-stegs flyt:

1. Prosjektbeskrivelse + dokumentgrunnlag + tilknytning til prosjekt/kunde.
2. OpenAI-analyse med kalkyleforslag, deretter manuell kontroll i en redigerbar shadcn datatable.
3. Forhåndsvisning, valg av mottaker, send direkte eller lagre som utkast.

## Filer
- `app/nytt-tilbud/page.tsx`: server-side datahenting (prosjekter/kunder) + wrapper.
- `components/tilbud/new-offer-wizard.tsx`: stegflyt og UI-logikk.
- `components/tilbud/new-offer-items-table.tsx`: redigerbar datatable for produkter/elementer.
- `app/nytt-tilbud/actions.ts`: lagre utkast / send tilbud til `offers`.
- `app/api/tilbud/analyse/route.ts`: analyse-endepunkt mot OpenAI + fallback.
- `lib/tilbud/supplier-prices.ts`: prisgrunnlag fra norske byggevareleverandører.
- `lib/tilbud/types.ts`: delte typer + kalkylehelpers.
- `db/07_nytt_tilbud_workflow.sql`: migrasjon for utvidet offers-modell.

## Datamodell (offers)
Migrasjonen legger til støtte for:
- `customer_id` (tilbud kan knyttes til kunde uten prosjekt).
- `description`, `source_summary`, `source_documents`.
- `line_items` (JSONB med delprosjekt, påslag, rabatt, prisfelt m.m.).
- `analysis_result` (JSONB).
- `subtotal_nok`, `discount_nok`, mottakerfelt, gyldighet og sendt-tidspunkt.

## Viktig før bruk
Kjør SQL-migrasjonen i Supabase:

```sql
-- Supabase SQL Editor
-- Kjør hele filen:
db/07_nytt_tilbud_workflow.sql
```

## OpenAI-oppsett
Miljøvariabler:

```bash
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4.1-mini
```

Hvis `OPENAI_API_KEY` mangler, brukes fallback-kalkyle med intern prislogikk.

## Endringspunkter
Hvis du vil justere kalkylene raskt:
- Oppdater standard påslag/rabatt i `new-offer-wizard.tsx`.
- Endre prisgrunnlaget i `supplier-prices.ts`.
- Utvid AI-outputschema i `app/api/tilbud/analyse/route.ts`.
- Endre hvordan totalsummer beregnes i `lib/tilbud/types.ts`.
