-- Staging-only audience scope for Royal Events. Existing events remain GLOBAL.
-- Apply only after reviewing 0101/0102/0103 migration history and DB backup.
ALTER TABLE sharika_events ADD COLUMN country_code TEXT NOT NULL DEFAULT 'GLOBAL'
 CHECK (country_code='GLOBAL' OR (length(country_code)=2 AND country_code GLOB '[A-Z][A-Z]'));
CREATE INDEX IF NOT EXISTS ix_sharika_events_status_country_dates
 ON sharika_events(status,country_code,ends_at,starts_at);
