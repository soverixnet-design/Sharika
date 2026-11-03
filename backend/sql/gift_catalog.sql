-- Sharika's original 30 gifts, copied from its supplied HTML.
-- Names, emoji, prices and category remain unchanged. No fake users/activity.
with source(emoji,price_coins,name,tab) as (
  values
  ('🌹',5::bigint,'Rose',0::smallint),('💖',10,'Heart',0),
  ('🍫',20,'Chocolate',0),('🧸',30,'Teddy Bear',0),
  ('💍',50,'Ring',0),('🎂',80,'Cake',0),
  ('🎤',99,'Golden Mic',0),('🌈',120,'Rainbow',0),
  ('💎',200,'Diamond',0),('🍾',300,'Champagne',0),
  ('🎸',400,'Guitar',0),('🚗',500,'Car',0),
  ('🏰',1000,'Castle',1),('🦁',2000,'Lion',1),
  ('🏎️',3000,'Sports Car',1),('🐉',5000,'Dragon',1),
  ('🛥️',7000,'Yacht',1),('🚀',9900,'Rocket',1),
  ('✈️',12000,'Private Jet',1),('🏝️',15000,'Island',1),
  ('👑',19900,'Crown',1),('🦄',25000,'Unicorn',1),
  ('🌌',39900,'Galaxy',1),('🪐',59900,'Planet',1),
  ('🍀',10,'Lucky Clover',2),('🎁',50,'Lucky Box',2),
  ('🧧',100,'Lucky Packet',2),('🎲',200,'Lucky Dice',2),
  ('🎰',500,'Lucky Slot',2),('⭐',1000,'Lucky Star',2)
)
insert into public.sharika_gifts (emoji,price_coins,name,tab)
select s.emoji,s.price_coins,s.name,s.tab from source s
where not exists (
  select 1 from public.sharika_gifts g where g.name=s.name
);
