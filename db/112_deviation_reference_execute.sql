-- 112_deviation_reference_execute.sql
-- Avvik kunne ikke opprettes av noen (admin, leder eller håndverker) siden db/80.
--
-- db/80 trakk EXECUTE på alle rutiner fra `authenticated` og ga det tilbake
-- bare til RLS-hjelperne. Triggeren set_deviation_reference() kjører uten
-- rettighetssjekk (triggere gjør det), men den KALLER
-- generate_deviation_reference(uuid) som en vanlig funksjon — og det kallet
-- sjekkes mot den innloggede rollen. Resultatet: «permission denied for
-- function generate_deviation_reference» på hver INSERT i deviations, pakket
-- inn som React #441 i klienten («Kunne ikke registrere avviket»).
--
-- Funksjonen gjør bare nextval() på en sekvens klientrollen allerede har
-- USAGE på, så EXECUTE for authenticated er trygt. I tillegg gjøres triggeren
-- SECURITY DEFINER (med låst search_path, jf. db/70), så referansenummeret
-- aldri igjen avhenger av hva klientrollen tilfeldigvis får kalle.

GRANT EXECUTE ON FUNCTION public.generate_deviation_reference(uuid) TO authenticated;

ALTER FUNCTION public.set_deviation_reference() SECURITY DEFINER;
ALTER FUNCTION public.set_deviation_reference() SET search_path = public;
