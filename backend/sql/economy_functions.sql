-- Server-only atomic money operations for Sharika.
-- Invoke through a trusted backend with the Supabase service_role key.
-- Functions run as the calling role (SECURITY INVOKER), not as SECURITY DEFINER.

create table if not exists public.sharika_gift_requests (
  sender_id uuid not null references public.sharika_users(user_id),
  request_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (sender_id,request_id)
);
alter table public.sharika_gift_requests enable row level security;

create or replace function public.sharika_wallet_delta(
  p_user_id uuid,
  p_currency text,
  p_delta bigint,
  p_reason text,
  p_ref_id text,
  p_request_id uuid
) returns bigint
language plpgsql security invoker set search_path = '' as $$
declare
  v_balance bigint;
  v_existing bigint;
begin
  if p_user_id is null or p_request_id is null or p_currency not in ('coins','diamonds')
    or p_delta is null or p_delta = 0 or nullif(btrim(p_reason),'') is null then
    raise exception 'invalid_wallet_request';
  end if;

  -- Serializes requests for one user; replays return the original balance.
  perform 1 from public.sharika_users where user_id = p_user_id and status = 'active' for update;
  if not found then raise exception 'user_unavailable'; end if;
  select balance_after into v_existing
    from public.sharika_wallet_ledger
    where user_id = p_user_id and currency = p_currency and request_id = p_request_id;
  if found then return v_existing; end if;

  if p_currency = 'coins' then
    update public.sharika_users set coins = coins + p_delta, updated_at = now()
      where user_id = p_user_id and (coins::numeric + p_delta::numeric) between 0 and 9223372036854775807
      returning coins into v_balance;
  else
    update public.sharika_users set diamonds = diamonds + p_delta, updated_at = now()
      where user_id = p_user_id and (diamonds::numeric + p_delta::numeric) between 0 and 9223372036854775807
      returning diamonds into v_balance;
  end if;
  if not found then raise exception 'insufficient_balance_or_overflow'; end if;
  insert into public.sharika_wallet_ledger(user_id,currency,delta,balance_after,reason,ref_id,request_id)
    values (p_user_id,p_currency,p_delta,v_balance,p_reason,p_ref_id,p_request_id);
  return v_balance;
end;
$$;
revoke all on function public.sharika_wallet_delta(uuid,text,bigint,text,text,uuid) from public,anon,authenticated;
grant execute on function public.sharika_wallet_delta(uuid,text,bigint,text,text,uuid) to service_role;

create or replace function public.sharika_send_gift(
  p_sender uuid,
  p_recipients uuid[],
  p_gift_id bigint,
  p_qty integer,
  p_room_id text,
  p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_sender public.sharika_users%rowtype;
  v_gift public.sharika_gifts%rowtype;
  v_count integer;
  v_cost bigint;
  v_cost_numeric numeric;
  v_lucky bigint := 0;
  v_max_multi integer := 0;
  v_multi integer;
  v_roll numeric;
  v_t numeric;
  v_cfg jsonb;
  v_rows jsonb;
  v_row jsonb;
  v_weight numeric;
  v_probability_total numeric;
  v_expected_return numeric;
  v_rec uuid;
  v_i integer;
  v_owner uuid;
  v_balance bigint;
  v_xp bigint;
  v_result jsonb;
begin
  if p_sender is null or p_request_id is null or p_recipients is null or p_qty is null
    or p_qty < 1 or p_qty > 10000 or p_gift_id is null then
    raise exception 'invalid_gift_request';
  end if;

  -- The sender lock makes idempotency safe even for concurrent retries.
  select * into v_sender from public.sharika_users where user_id = p_sender for update;
  if not found or v_sender.status <> 'active' then raise exception 'sender_unavailable'; end if;
  select result into v_result from public.sharika_gift_requests
    where sender_id = p_sender and request_id = p_request_id;
  if found then return v_result; end if;

  select count(distinct x) into v_count from unnest(p_recipients) as x where x is not null;
  if v_count < 1 or v_count > 20 or array_length(p_recipients,1) <> v_count then
    raise exception 'invalid_recipients';
  end if;
  if (select count(*) from public.sharika_users
      where user_id = any(p_recipients) and status = 'active') <> v_count then
    raise exception 'recipient_unavailable';
  end if;

  select * into v_gift from public.sharika_gifts where id = p_gift_id and active;
  if not found then raise exception 'gift_unavailable'; end if;
  v_cost_numeric := v_gift.price_coins::numeric * p_qty::numeric * v_count::numeric;
  if v_cost_numeric < 0 or v_cost_numeric > 9223372036854775807 then
    raise exception 'gift_cost_overflow';
  end if;
  v_cost := v_cost_numeric::bigint;
  if v_sender.coins < v_cost then raise exception 'insufficient_coins'; end if;

  if p_room_id is not null then
    select owner_id into v_owner from public.sharika_rooms where id = p_room_id;
    if not found then raise exception 'room_not_found'; end if;
    if not exists (select 1 from public.sharika_room_members
      where room_id = p_room_id and user_id = p_sender) then raise exception 'sender_not_in_room'; end if;
    if (select count(*) from public.sharika_room_members
      where room_id = p_room_id and user_id = any(p_recipients)) <> v_count then
      raise exception 'recipient_not_in_room';
    end if;
  end if;

  if v_gift.tab = 2 then
    if v_sender.minor then raise exception 'lucky_gifts_disabled_for_minors'; end if;
    select value into v_cfg from public.sharika_admin_kv where key = 'lucky';
    if v_cfg->>'on' = 'false' then raise exception 'lucky_gifts_disabled'; end if;
    v_rows := case when jsonb_typeof(v_cfg->'rows') = 'array'
      then v_cfg->'rows'
      else '[[0,70.2],[1,15],[2,8],[5,4],[10,2.5],[50,0.3]]'::jsonb end;
    v_probability_total := 0;
    v_expected_return := 0;
    if jsonb_array_length(v_rows) < 1 or jsonb_array_length(v_rows) > 25 then
      raise exception 'invalid_lucky_configuration';
    end if;
    for v_row in select value from jsonb_array_elements(v_rows) loop
      if jsonb_typeof(v_row) <> 'array' or jsonb_array_length(v_row) <> 2 then
        raise exception 'invalid_lucky_configuration';
      end if;
      v_multi := (v_row->>0)::integer;
      v_weight := (v_row->>1)::numeric;
      if v_multi < 0 or v_multi > 10000 or v_weight < 0 or v_weight > 100 then
        raise exception 'invalid_lucky_configuration';
      end if;
      v_probability_total := v_probability_total + v_weight;
      v_expected_return := v_expected_return + v_multi * v_weight;
    end loop;
    if v_probability_total <> 100 then raise exception 'invalid_lucky_configuration'; end if;
    -- Original admin panel publishes chance-table versions within 80-95% RTP.
    if v_expected_return < 80 or v_expected_return > 95 then
      raise exception 'invalid_lucky_configuration';
    end if;
    if p_qty * v_count > 5000 then raise exception 'too_many_lucky_draws'; end if;
    for v_i in 1..(p_qty * v_count) loop
      v_roll := random() * 100;
      v_t := 0;
      v_multi := 0;
      for v_row in select value from jsonb_array_elements(v_rows) loop
        v_t := v_t + (v_row->>1)::numeric;
        if v_roll < v_t then v_multi := (v_row->>0)::integer; exit; end if;
      end loop;
      v_max_multi := greatest(v_max_multi,v_multi);
      if (v_lucky::numeric + v_multi::numeric * v_gift.price_coins::numeric) > 9223372036854775807 then
        raise exception 'lucky_payout_overflow';
      end if;
      v_lucky := v_lucky + v_multi * v_gift.price_coins;
    end loop;
  end if;

  if (v_sender.xp::numeric + v_cost::numeric) > 9223372036854775807 then
    raise exception 'xp_overflow';
  end if;
  -- Keep the original app rule: gift cost increases sender XP; lucky gift
  -- payout returns coins to the sender. Recipient gifts are recorded, not
  -- automatically converted into diamonds without a defined exchange rule.
  update public.sharika_users
    set coins = coins - v_cost + v_lucky,
        xp = xp + v_cost,
        wealth_level = least(2147483647::bigint,1 + (xp + v_cost) / 1000),
        updated_at = now()
    where user_id = p_sender
      and (coins::numeric - v_cost::numeric + v_lucky::numeric) between 0 and 9223372036854775807
    returning coins,xp into v_balance,v_xp;
  if not found then raise exception 'balance_overflow'; end if;

  if v_cost > 0 then
    insert into public.sharika_wallet_ledger(user_id,currency,delta,balance_after,reason,ref_id,request_id)
      values (p_sender,'coins',-v_cost,v_sender.coins-v_cost,'gift',p_gift_id::text,p_request_id);
  end if;
  if v_lucky > 0 then
    insert into public.sharika_wallet_ledger(user_id,currency,delta,balance_after,reason,ref_id,request_id)
      values (p_sender,'coins',v_lucky,v_balance,'lucky_gift',p_gift_id::text,gen_random_uuid());
  end if;

  for v_rec in select unnest(p_recipients) loop
    insert into public.sharika_gifts_sent
      (sender_id,recipient_id,gift_id,qty,room_id,coins,request_id,lucky_win_coins,lucky_max_multiplier)
      values (p_sender,v_rec,p_gift_id,p_qty,p_room_id,v_gift.price_coins*p_qty,p_request_id,0,0);
  end loop;
  if p_room_id is not null and v_cost > 0 then
    insert into public.sharika_room_rewards(room_id,gift_volume_since_claim)
      values (p_room_id,v_cost)
    on conflict (room_id) do update set
      gift_volume_since_claim = public.sharika_room_rewards.gift_volume_since_claim + excluded.gift_volume_since_claim,
      updated_at = now();
  end if;

  v_result := jsonb_build_object('coins',v_balance,'xp',v_xp,'cost',v_cost,
    'lucky_win',v_lucky,'max_multiplier',v_max_multi,'recipients',v_count,'request_id',p_request_id);
  insert into public.sharika_gift_requests(sender_id,request_id,result)
    values (p_sender,p_request_id,v_result);
  return v_result;
end;
$$;
revoke all on function public.sharika_send_gift(uuid,uuid[],bigint,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.sharika_send_gift(uuid,uuid[],bigint,integer,text,uuid) to service_role;

create or replace function public.sharika_claim_room_reward(
  p_owner uuid,
  p_room_id text,
  p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_state public.sharika_room_rewards%rowtype;
  v_pct numeric := 10;
  v_days integer := 7;
  v_minp bigint := 0;
  v_cfg jsonb;
  v_reward bigint;
  v_balance bigint;
  v_existing bigint;
begin
  if p_owner is null or p_room_id is null or p_request_id is null then raise exception 'invalid_claim'; end if;
  if not exists (select 1 from public.sharika_rooms where id=p_room_id and owner_id=p_owner) then
    raise exception 'not_room_owner';
  end if;
  perform 1 from public.sharika_users where user_id = p_owner and status = 'active' for update;
  if not found then raise exception 'owner_unavailable'; end if;
  select balance_after into v_existing from public.sharika_wallet_ledger
    where user_id=p_owner and currency='coins' and request_id=p_request_id;
  if found then return jsonb_build_object('coins',v_existing,'replayed',true); end if;

  select * into v_state from public.sharika_room_rewards where room_id = p_room_id for update;
  if not found or v_state.gift_volume_since_claim = 0 then raise exception 'no_room_reward'; end if;
  select value into v_cfg from public.sharika_admin_kv where key = 'rr';
  if v_cfg->>'on' = 'false' then raise exception 'room_rewards_disabled'; end if;
  if v_cfg ? 'pct' then v_pct := (v_cfg->>'pct')::numeric; end if;
  if v_cfg ? 'days' then v_days := (v_cfg->>'days')::integer; end if;
  if v_cfg ? 'minp' then v_minp := (v_cfg->>'minp')::bigint; end if;
  if v_pct < 0 or v_pct > 50 or v_days < 1 or v_days > 365 or v_minp < 0 then
    raise exception 'invalid_reward_configuration';
  end if;
  if v_state.last_claim_at is not null and now() < v_state.last_claim_at + pg_catalog.make_interval(days => v_days) then
    raise exception 'claim_not_ready';
  end if;
  v_reward := floor(v_state.gift_volume_since_claim::numeric * v_pct / 100)::bigint;
  if v_reward = 0 or v_reward < v_minp then raise exception 'no_room_reward'; end if;
  update public.sharika_users set coins = coins + v_reward,updated_at=now()
    where user_id=p_owner and (coins::numeric+v_reward::numeric) <= 9223372036854775807
    returning coins into v_balance;
  if not found then raise exception 'balance_overflow'; end if;
  insert into public.sharika_wallet_ledger(user_id,currency,delta,balance_after,reason,ref_id,request_id)
    values (p_owner,'coins',v_reward,v_balance,'room_reward',p_room_id,p_request_id);
  update public.sharika_room_rewards set gift_volume_since_claim=0,last_claim_at=now(),updated_at=now()
    where room_id=p_room_id;
  return jsonb_build_object('coins',v_balance,'reward',v_reward,'request_id',p_request_id);
end;
$$;
revoke all on function public.sharika_claim_room_reward(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.sharika_claim_room_reward(uuid,text,uuid) to service_role;
