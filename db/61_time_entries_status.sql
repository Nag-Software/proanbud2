-- Approval status for time entries. Default 'approved' so existing rows and
-- ordinary manual/timer entries need no sign-off (unchanged behaviour). Geofence
-- (and later automatic) check-ins are inserted as 'pending' and must be approved
-- by a manager before they count as final/billable; 'rejected' entries are hidden
-- from the normal lists/totals.

ALTER TABLE public.time_entries
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'approved'
    CHECK (status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_time_entries_company_status
  ON public.time_entries (company_id, status);
