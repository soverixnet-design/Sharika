-- Sharika Voice Chat: additive schema for an existing Supabase project.
-- All objects are prefixed sharika_. Existing sovera_* / Earnbd tables are untouched.
-- This is a reviewed starting schema, NOT an applied migration.

create sequence if not exists public.sharika_public_id_seq
  as bigint start with 10000001 minvalue 10000001 maxvalue 99999999 no cycle;

create table if not exists public.sharika_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  public_id text not null unique default nextval('public.sharika_public_id_seq')::text
    check (public_id ~ '^[0-9]{8}$'),
  name text not null default 'Sharika User' check (char_length(name) between 1 and 80),
  pic text, cover text, bio text, country text, birthdate date,
  -- Unknown age is treated conservatively until a birthdate is supplied.
  minor boolean not null default true,
  coins bigint not null default 0 check (coins >= 0),
  diamonds bigint not null default 0 check (diamonds >= 0),
  xp bigint not null default 0 check (xp >= 0),
  wealth_level integer not null default 1 check (wealth_level > 0),
  charm_level integer not null default 1 check (charm_level > 0),
  frame text, frame_img text, svip_until timestamptz,
  status text not null default 'active' check (status in ('active','blocked','deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id,public_id)
);

create table if not exists public.sharika_rooms (
  id text primary key check (id ~ '^[0-9]{8}$'),
  owner_id uuid not null unique,
  name text not null check (char_length(name) between 1 and 100),
  emoji text not null default '🎙️',
  theme text not null default 'mid',
  seat_count smallint not null default 12 check (seat_count between 1 and 20),
  is_live boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (owner_id,id) references public.sharika_users(user_id,public_id)
);

create table if not exists public.sharika_room_members (
  room_id text not null references public.sharika_rooms(id) on delete cascade,
  user_id uuid not null references public.sharika_users(user_id) on delete cascade,
  seat_no smallint check (seat_no between 1 and 20),
  role text not null default 'member' check (role in ('owner','member')),
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (room_id,user_id)
);
create unique index if not exists sharika_one_user_per_seat
  on public.sharika_room_members (room_id,seat_no) where seat_no is not null;
create index if not exists sharika_room_members_user_idx on public.sharika_room_members (user_id);

create table if not exists public.sharika_gifts (
  id bigint generated always as identity primary key,
  name text not null, emoji text not null default '🎁',
  tab smallint not null default 0 check (tab between 0 and 2),
  price_coins bigint not null check (price_coins >= 0),
  image_url text, animation_url text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.sharika_gifts_sent (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.sharika_users(user_id),
  recipient_id uuid not null references public.sharika_users(user_id),
  gift_id bigint not null references public.sharika_gifts(id),
  qty integer not null check (qty between 1 and 10000),
  room_id text references public.sharika_rooms(id),
  coins bigint not null check (coins >= 0),
  lucky_win_coins bigint not null default 0 check (lucky_win_coins >= 0),
  lucky_max_multiplier integer not null default 0 check (lucky_max_multiplier >= 0),
  request_id uuid not null,
  created_at timestamptz not null default now(),
  -- One request may target multiple recipients and multiple gift types.
  unique (sender_id,request_id,recipient_id,gift_id)
);
create index if not exists sharika_gifts_recipient_time_idx
  on public.sharika_gifts_sent (recipient_id,created_at desc);
create index if not exists sharika_gifts_sender_time_idx
  on public.sharika_gifts_sent (sender_id,created_at desc);

create table if not exists public.sharika_room_rewards (
  room_id text primary key references public.sharika_rooms(id) on delete cascade,
  gift_volume_since_claim bigint not null default 0 check (gift_volume_since_claim >= 0),
  last_claim_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.sharika_wallet_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.sharika_users(user_id),
  currency text not null check (currency in ('coins','diamonds')),
  delta bigint not null check (delta <> 0),
  balance_after bigint not null check (balance_after >= 0),
  reason text not null,
  ref_id text,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (user_id,currency,request_id)
);
create index if not exists sharika_wallet_ledger_user_time_idx
  on public.sharika_wallet_ledger (user_id,created_at desc);

create table if not exists public.sharika_follows (
  follower_id uuid not null references public.sharika_users(user_id) on delete cascade,
  followed_id uuid not null references public.sharika_users(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id,followed_id),
  check (follower_id <> followed_id)
);
create index if not exists sharika_follows_followed_idx on public.sharika_follows (followed_id);

create table if not exists public.sharika_messages (
  id bigint generated always as identity primary key,
  sender_id uuid not null references public.sharika_users(user_id),
  recipient_id uuid references public.sharika_users(user_id),
  room_id text references public.sharika_rooms(id),
  body text not null check (char_length(body) between 1 and 4000),
  created_at timestamptz not null default now(),
  check ((recipient_id is null) <> (room_id is null))
);
create index if not exists sharika_messages_room_time_idx
  on public.sharika_messages (room_id,created_at desc) where room_id is not null;
create index if not exists sharika_messages_recipient_time_idx
  on public.sharika_messages (recipient_id,created_at desc) where recipient_id is not null;

create table if not exists public.sharika_notifications (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.sharika_users(user_id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists sharika_notifications_user_time_idx
  on public.sharika_notifications (user_id,created_at desc);

create table if not exists public.sharika_medals (
  id bigint generated always as identity primary key,
  name text not null unique, description text, image_url text,
  active boolean not null default true
);
create table if not exists public.sharika_medal_grants (
  user_id uuid not null references public.sharika_users(user_id) on delete cascade,
  medal_id bigint not null references public.sharika_medals(id),
  granted_at timestamptz not null default now(),
  primary key (user_id,medal_id)
);

create table if not exists public.sharika_frames (
  id bigint generated always as identity primary key,
  name text not null, style text not null, img text,
  price bigint not null default 0 check (price >= 0),
  active boolean not null default true
);
create table if not exists public.sharika_user_frames (
  user_id uuid not null references public.sharika_users(user_id) on delete cascade,
  frame_id bigint not null references public.sharika_frames(id),
  purchased_at timestamptz not null default now(),
  primary key (user_id,frame_id)
);

create table if not exists public.sharika_recharges (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.sharika_users(user_id),
  coins bigint not null check (coins > 0),
  verified_by uuid references public.sharika_users(user_id),
  external_ref text unique,
  request_id uuid not null unique,
  created_at timestamptz not null default now()
);
create index if not exists sharika_recharges_user_time_idx
  on public.sharika_recharges (user_id,created_at desc);

create table if not exists public.sharika_weekly_rankings (
  week_start date not null,
  category text not null check (category in ('recharge','couple','room')),
  rank integer not null check (rank > 0),
  user_id uuid references public.sharika_users(user_id),
  room_id text references public.sharika_rooms(id),
  value bigint not null default 0 check (value >= 0),
  calculated_at timestamptz not null default now(),
  primary key (week_start,category,rank),
  check ((user_id is null) <> (room_id is null))
);
create table if not exists public.sharika_weekly_claims (
  user_id uuid not null references public.sharika_users(user_id),
  week_start date not null,
  amount_coins bigint not null default 0 check (amount_coins >= 0),
  amount_diamonds bigint not null default 0 check (amount_diamonds >= 0),
  claimed_at timestamptz not null default now(),
  primary key (user_id,week_start)
);

create table if not exists public.sharika_game_rounds (
  id bigint generated always as identity primary key,
  game text not null check (game in ('food_wheel','jackpot_fruit')),
  status text not null default 'open' check (status in ('open','locked','resolved','void')),
  opened_at timestamptz not null default now(),
  closes_at timestamptz not null,
  settled_at timestamptz,
  commitment text, result jsonb,
  check (closes_at > opened_at)
);
create index if not exists sharika_game_rounds_lookup_idx
  on public.sharika_game_rounds (game,status,closes_at desc);
create table if not exists public.sharika_game_bets (
  id bigint generated always as identity primary key,
  round_id bigint not null references public.sharika_game_rounds(id),
  user_id uuid not null references public.sharika_users(user_id),
  bet_coins bigint not null check (bet_coins > 0),
  choice jsonb not null,
  payout_coins bigint not null default 0 check (payout_coins >= 0),
  request_id uuid not null,
  placed_at timestamptz not null default now(),
  unique (user_id,request_id)
);
create index if not exists sharika_game_bets_round_idx
  on public.sharika_game_bets (round_id);

create table if not exists public.sharika_admin_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.sharika_admin_users (
  user_id uuid primary key references auth.users(id),
  role text not null check (role in ('super','support','finance')),
  assigned_at timestamptz not null default now()
);
create table if not exists public.sharika_admin_audit (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id),
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists sharika_admin_audit_time_idx
  on public.sharika_admin_audit (created_at desc);

-- All tables are protected. Browser clients never receive general write access.
alter table public.sharika_users enable row level security;
alter table public.sharika_rooms enable row level security;
alter table public.sharika_room_members enable row level security;
alter table public.sharika_gifts enable row level security;
alter table public.sharika_gifts_sent enable row level security;
alter table public.sharika_room_rewards enable row level security;
alter table public.sharika_wallet_ledger enable row level security;
alter table public.sharika_follows enable row level security;
alter table public.sharika_messages enable row level security;
alter table public.sharika_notifications enable row level security;
alter table public.sharika_medals enable row level security;
alter table public.sharika_medal_grants enable row level security;
alter table public.sharika_frames enable row level security;
alter table public.sharika_user_frames enable row level security;
alter table public.sharika_recharges enable row level security;
alter table public.sharika_weekly_rankings enable row level security;
alter table public.sharika_weekly_claims enable row level security;
alter table public.sharika_game_rounds enable row level security;
alter table public.sharika_game_bets enable row level security;
alter table public.sharika_admin_kv enable row level security;
alter table public.sharika_admin_users enable row level security;
alter table public.sharika_admin_audit enable row level security;

-- Read-only user permissions. Authenticated users may inspect their own private data.
create policy sharika_users_self_read on public.sharika_users
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_rooms_read on public.sharika_rooms
  for select to authenticated using (true);
create policy sharika_room_members_self_read on public.sharika_room_members
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_gifts_read on public.sharika_gifts
  for select to authenticated using (active);
create policy sharika_gifts_sent_self_read on public.sharika_gifts_sent
  for select to authenticated using ((select auth.uid()) in (sender_id,recipient_id));
create policy sharika_wallet_self_read on public.sharika_wallet_ledger
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_follows_self_read on public.sharika_follows
  for select to authenticated using ((select auth.uid()) in (follower_id,followed_id));
create policy sharika_messages_direct_read on public.sharika_messages
  for select to authenticated using ((select auth.uid()) in (sender_id,recipient_id));
create policy sharika_notifications_self_read on public.sharika_notifications
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_medals_read on public.sharika_medals
  for select to authenticated using (active);
create policy sharika_medal_grants_self_read on public.sharika_medal_grants
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_frames_read on public.sharika_frames
  for select to authenticated using (active);
create policy sharika_user_frames_self_read on public.sharika_user_frames
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_recharges_self_read on public.sharika_recharges
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_weekly_rankings_read on public.sharika_weekly_rankings
  for select to authenticated using (true);
create policy sharika_weekly_claims_self_read on public.sharika_weekly_claims
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_game_rounds_read on public.sharika_game_rounds
  for select to authenticated using (true);
create policy sharika_game_bets_self_read on public.sharika_game_bets
  for select to authenticated using ((select auth.uid()) = user_id);
create policy sharika_admin_users_self_read on public.sharika_admin_users
  for select to authenticated using ((select auth.uid()) = user_id);

-- No client INSERT / UPDATE / DELETE policies for money, games, moderation or rooms.
-- A verified server performs these operations transactionally and writes audit records.
