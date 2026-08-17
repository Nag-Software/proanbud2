-- Interne etterfaktura (ekstrajobber opprettet direkte på prosjektet, uten
-- kobling til et tilbud) skal ikke ligge som «utkast». De går aldri ut til
-- kunden for godkjenning (sending er deaktivert), så de er godkjent arbeid med
-- en gang — og «accepted» er dessuten statusen lønnsomhet teller som omsetning
-- (lib/job-costing/project-profitability.ts summerer kun change_orders med
-- status = 'accepted').
--
-- Tilleggsarbeid fra tilbud (offer_id satt) røres IKKE — de har en ekte
-- kundeflyt draft → sent → accepted/rejected som må stå urørt.

UPDATE public.change_orders
  SET status = 'accepted',
      updated_at = now()
  WHERE offer_id IS NULL
    AND status = 'draft';
