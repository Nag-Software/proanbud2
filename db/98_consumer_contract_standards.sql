-- 98_consumer_contract_standards.sql
-- Forbrukerstandardene NS 8416 og NS 8417 som kontraktsgrunnlag.
--
-- NS 8405/8407 er laget for avtaler mellom næringsdrivende. Når kunden er en
-- privatperson, tilbyr tilbudet i stedet NS 8416 (ny bolig/fritidsbolig,
-- bustadoppføringslova) og NS 8417 (arbeid på eksisterende bolig,
-- håndverkertjenesteloven). Hvilke som vises styres av kundetypen
-- (bedrift = kunden har org.nr., ellers privatperson — samme regel som Kunder-siden).
--
-- Utvider CHECK-reglene på offers.contract_basis, contracts.contract_basis og
-- companies.default_contract_basis (db/23, db/96). Den gamle regelen fikk et
-- autogenerert navn, så vi fjerner enhver CHECK som gjelder kolonnen i stedet
-- for å gjette navnet.
-- Safe to run repeatedly.

DO $$
DECLARE
  target RECORD;
  existing RECORD;
  allowed CONSTANT TEXT := '(''ns8405'', ''ns8407'', ''ns8416'', ''ns8417'', ''custom'', ''none'')';
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('offers', 'contract_basis'),
      ('contracts', 'contract_basis'),
      ('companies', 'default_contract_basis')
    ) AS t(table_name, column_name)
  LOOP
    CONTINUE WHEN NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE c.table_schema = 'public' AND c.table_name = target.table_name AND c.column_name = target.column_name
    );

    FOR existing IN
      SELECT con.conname
      FROM pg_constraint con
      WHERE con.conrelid = format('public.%I', target.table_name)::regclass
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%' || target.column_name || '%'
    LOOP
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', target.table_name, existing.conname);
    END LOOP;

    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IN %s)',
      target.table_name,
      target.table_name || '_' || target.column_name || '_check',
      target.column_name,
      allowed
    );
  END LOOP;
END $$;
