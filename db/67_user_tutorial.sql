-- 67: Tutorial-veiviser (velkomstkort + kom-i-gang-guide) for nye brukere.
--
-- NULL = ikke ferdig → veiviseren auto-åpner for admin/prosjektleder ved
-- innlogging. Settes både ved fullføring og ved avvisning («Utforsk på egen
-- hånd» / X) — begge betyr «ikke mas mer». Skrives fra klienten via den
-- eksisterende owner_manage_profile-policyen (upsert på user_id).
--
-- Koden feiler lukket: mangler kolonnen (migrasjonen ikke kjørt), vises
-- veiviseren aldri — appen knekker ikke.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS tutorial_completed_at TIMESTAMPTZ;
