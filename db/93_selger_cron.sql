-- ============================================================================
-- 93: Salgsmaskin v2, fase 2 — planlegging med pg_cron
--
-- Hvorfor ikke Vercel Cron: Hobby-planen tillater én kjøring per DØGN. Svar-
-- løkka trenger å lese innboksen hvert tiende minutt — et svar som blir
-- liggende i seks timer er et tapt lead. Derfor bor planleggingen i Postgres,
-- og Vercel har bare en daglig reserve.
--
-- CRON_SECRET leses fra Vault, ikke fra denne filen. Casper legger den inn
-- manuelt, slik at hemmeligheten aldri havner i git:
--
--   select vault.create_secret('<hemmeligheten>', 'cron_secret',
--                              'Bearer-token for /api/cron/*');
--
-- Kjør deretter denne migrasjonen. Mangler hemmeligheten, opprettes ingen
-- jobb — og det er riktig: en cron som kaller uten gyldig token ville bare
-- generert 401-er hvert tiende minutt.
-- ============================================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Basis-URL til appen. Settes som en databaseinnstilling én gang:
--   alter database postgres set app.settings.base_url = 'https://app.proanbud.no';
do $$
declare
  v_secret text;
  v_base_url text;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'cron_secret' limit 1;

  v_base_url := coalesce(
    current_setting('app.settings.base_url', true),
    'https://app.proanbud.no'
  );

  if v_secret is null then
    raise notice 'cron_secret finnes ikke i Vault — selger-tick planlegges ikke. Legg den inn og kjør db/93 på nytt.';
    return;
  end if;

  -- Rydd opp i en eventuell tidligere plan før vi lager den på nytt.
  perform cron.unschedule(jobid) from cron.job where jobname = 'selger_tick';

  -- Hvert tiende minutt, hverdager 06–20 (UTC). Norsk arbeidstid ligger 1–2
  -- timer foran; vinduet er bevisst romsligere enn sendevinduet, fordi
  -- innboksen skal leses også utenfor sendetiden.
  perform cron.schedule(
    'selger_tick',
    '*/10 6-20 * * 1-5',
    format(
      $cmd$
        select net.http_post(
          url := %L,
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', %L
          ),
          body := '{}'::jsonb,
          timeout_milliseconds := 290000
        );
      $cmd$,
      v_base_url || '/api/cron/selger-tick',
      'Bearer ' || v_secret
    )
  );

  raise notice 'selger_tick planlagt hvert 10. minutt mot %', v_base_url;
end $$;

-- Slik stopper Casper maskinen fra databasen, uten en deploy:
--   select cron.unschedule('selger_tick');
-- Og slik ser han når den sist kjørte:
--   select * from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'selger_tick')
--    order by start_time desc limit 20;
