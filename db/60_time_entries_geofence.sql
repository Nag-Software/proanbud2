-- Geofence check-in metadata on time entries. When a worker clocks in via the
-- map/geofence (GPS-confirmed on-site), we record where and how the entry began.
-- `source` distinguishes manual entry, the start/stop timer, geofence check-in,
-- and (later) fully automatic native geofence events. All additive + nullable,
-- so existing rows are unaffected.

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS check_in_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_in_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS check_in_accuracy_m NUMERIC(7,2);
