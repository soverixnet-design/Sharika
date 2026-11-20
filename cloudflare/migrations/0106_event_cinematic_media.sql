-- Optional, separately editable cinematic media for each published Sharika Event.
-- No changes to wallets, rewards, historical game activity or room audio.
ALTER TABLE sharika_events ADD COLUMN video_url TEXT NOT NULL DEFAULT ''
 CHECK(length(video_url)<=500);
ALTER TABLE sharika_events ADD COLUMN animation_style TEXT NOT NULL DEFAULT 'cinematic'
 CHECK(animation_style IN ('cinematic','subtle','off'));
