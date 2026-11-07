-- URL references only. Video/image/audio bytes live in R2, never in D1.
-- Preserve existing gifts, cosmetics, balances and entitlement rows.
ALTER TABLE sharika_gifts ADD COLUMN audio_url TEXT NOT NULL DEFAULT '';
ALTER TABLE sharika_cosmetics_catalog ADD COLUMN image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE sharika_cosmetics_catalog ADD COLUMN animation_url TEXT NOT NULL DEFAULT '';
ALTER TABLE sharika_cosmetics_catalog ADD COLUMN audio_url TEXT NOT NULL DEFAULT '';
