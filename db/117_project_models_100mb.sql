-- 117_project_models_100mb.sql
-- 3D-modellen kan nå importere filer (IFC, GLB, OBJ, FBX, DXF, PDF …), lagret i
-- bøtta `project_models` under {company_id}/{project_id}/importer/. IFC-filer
-- for større bygg er ofte over 25 MB, så grensen per fil heves til 100 MB.
--
-- NB: Supabase har i tillegg en global grense for opplasting per prosjekt
-- (Dashboard → Storage → Settings → «Upload file size limit»). På Free-planen er
-- den maks 50 MB, og den vinner over bøttas grense. Heves den ikke, avvises
-- filer mellom 50 og 100 MB med en feilmelding fra storage.
--
-- Policyene fra db/75 (lese/skrive/slette i egen bedrifts mappe) gjelder
-- uendret. Trygg å kjøre flere ganger.

UPDATE storage.buckets
SET file_size_limit = 104857600
WHERE id = 'project_models';
