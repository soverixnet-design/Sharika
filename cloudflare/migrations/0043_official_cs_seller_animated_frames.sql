-- Animated official-role frame artwork supplied by the owner.
-- Store catalogue entries without changing balances, permissions or ownership.
-- These frames are visible as Shop previews, but Super Admin grants only.
INSERT OR IGNORE INTO sharika_cosmetics_catalog
  (id,kind,name,art_key,price_coins,active)
VALUES
  ('frame_style:cs-royal-wings','frame_style','CS Royal Wings · Official','cs-royal-wings',1000000,0),
  ('frame_style:coin-seller-royal','frame_style','Coin Seller Crown · Official','coin-seller-royal',1000000,0);
