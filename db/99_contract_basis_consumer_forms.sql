-- 99_contract_basis_consumer_forms.sql
-- Rettelse av db/98: NS 8416 og NS 8417 er IKKE forbrukerstandarder.
--
-- NS 8416 (Forenklet norsk underentreprisekontrakt) og NS 8417 (Alminnelige
-- kontraktsbestemmelser for totalunderentrepriser) gjelder mellom profesjonelle
-- parter — de er nå valg for bedriftskunder (du som underentreprenør).
--
-- Overfor forbrukere bruker Standard Norge byggblanketter:
--   bb3501  Byggblankett 3501/3502 — håndverkertjenesteloven, arbeid på fast
--           eiendom (ikke nyoppføring). 3501 ved vederlag ≥ 2 G, 3502 under.
--   bb3425  Byggblankett 3425/3426 — bustadoppføringslova, oppføring av bolig
--           eller fritidsbolig.
-- Kilde: standard.no → Kontraktstandarder → Forbrukerblanketter.
--
-- Utvider CHECK-reglene med bb3501/bb3425, uavhengig av hva regelen heter.
-- Safe to run repeatedly.

DO $$
DECLARE
  target RECORD;
  existing RECORD;
  allowed CONSTANT TEXT :=
    '(''ns8405'', ''ns8407'', ''ns8416'', ''ns8417'', ''bb3501'', ''bb3425'', ''custom'', ''none'')';
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
