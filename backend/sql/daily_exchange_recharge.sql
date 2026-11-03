-- User economy functions for Sharika's existing check-in/recharge/exchange UI.
-- No changes to the app's layout or any Sovera tables.

create table if not exists public.sharika_daily_claims (
  user_id uuid not null references public.sharika_users(user_id) on delete cascade,
  claim_day date not null,
  streak integer not null check (streak between 1 and 7),
  coins bigint not null check (coins > 0),
  request_id uuid not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id,claim_day),
  unique (user_id,request_id)
);
alter table public.sharika_daily_claims enable row level security;
create policy sharika_daily_claims_self_read on public.sharika_daily_claims
  for select to authenticated using ((select auth.uid())=user_id);

create table if not exists public.sharika_recharge_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.sharika_users(user_id),
  coins bigint not null check (coins > 0 and coins <= 1000000000),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  request_id uuid not null,
  reviewed_by uuid references public.sharika_admin_users(user_id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id,request_id)
);
create index if not exists sharika_recharge_pending_idx on public.sharika_recharge_requests(status,created_at desc);
alter table public.sharika_recharge_requests enable row level security;
create policy sharika_recharge_requests_self_read on public.sharika_recharge_requests
  for select to authenticated using ((select auth.uid())=user_id);

create or replace function public.sharika_daily_checkin(
  p_user_id uuid,
  p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_day date := (now() at time zone 'UTC')::date;
  v_prev public.sharika_daily_claims%rowtype;
  v_streak integer;
  v_coins bigint;
  v_balance bigint;
begin
  if p_user_id is null or p_request_id is null then raise exception 'invalid_daily_request'; end if;
  perform 1 from public.sharika_users where user_id=p_user_id and status='active' for update;
  if not found then raise exception 'user_unavailable'; end if;
  select * into v_prev from public.sharika_daily_claims
    where user_id=p_user_id order by claim_day desc limit 1;
  if found and v_prev.claim_day=v_day then
    return jsonb_build_object('already_claimed',true,'coins_awarded',v_prev.coins,'streak',v_prev.streak);
  end if;
  v_streak := case when v_prev.claim_day=v_day-1 then v_prev.streak % 7 + 1 else 1 end;
  v_coins := (array[100,150,200,300,400,600,1000]::bigint[])[v_streak];
  update public.sharika_users set coins=coins+v_coins,updated_at=now()
    where user_id=p_user_id and (coins::numeric+v_coins::numeric) <= 9223372036854775807
    returning coins into v_balance;
  if not found then raise exception 'balance_overflow'; end if;
  insert into public.sharika_daily_claims(user_id,claim_day,streak,coins,request_id)
    values(p_user_id,v_day,v_streak,v_coins,p_request_id);
  insert into public.sharika_wallet_ledger(user_id,currency,delta,balance_after,reason,ref_id,request_id)
    values(p_user_id,'coins',v_coins,v_balance,'daily_checkin',v_day::text,p_request_id);
  return jsonb_build_object('coins',v_balance,'coins_awarded',v_coins,'streak',v_streak,'already_claimed',false);
end;
$$;
revoke all on function public.sharika_daily_checkin(uuid,uuid) from public,anon,authenticated;
grant execute on function public.sharika_daily_checkin(uuid,uuid) to service_role;

create or replace function public.sharika_exchange_diamonds(
  p_user_id uuid,
  p_diamonds bigint,
  p_request_id uuid
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_profile public.sharika_users%rowtype;
  v_existing bigint;
  v_coins bigint;
  v_diamonds bigint;
begin
  if p_user_id is null or p_request_id is null or p_diamonds is null
    or p_diamonds not in (500,1000,5000,20000) then raise exception 'invalid_exchange'; end if;
  select * into v_profile from public.sharika_users where user_id=p_user_id and status='active' for update;
  if not found then raise exception 'user_unavailable'; end if;
  select balance_after into v_existing from public.sharika_wallet_ledger
    where user_id=p_user_id and currency='coins' and request_id=p_request_id and reason='diamond_exchange';
  if found then return jsonb_build_object('coins',v_existing,'replayed',true); end if;
  if v_profile.diamonds < p_diamonds then raise exception 'insufficient_diamonds'; end if;
  if (v_profile.coins::numeric+p_diamonds::numeric) > 9223372036854775807 then
    raise exception 'balance_overflow';
  end if;
  -- Matches the supplied Sharika UI's rate: 1 diamond = 1 coin.
  update public.sharika_users
    set coins=coins+p_diamonds,diamonds=diamonds-p_diamonds,updated_at=now()
    where user_id=p_user_id returning coins,diamonds into v_coins,v_diamonds;
  insert into public.sharika_wallet_ledger(user_id,currency,delta,balance_after,reason,ref_id,request_id)
    values(p_user_id,'diamonds',-p_diamonds,v_diamonds,'diamond_exchange','1:1',p_request_id);
  insert into public.sharika_wallet_ledger(user_id,currency,delta,balance_after,reason,ref_id,request_id)
    values(p_user_id,'coins',p_diamonds,v_coins,'diamond_exchange','1:1',p_request_id);
  return jsonb_build_object('coins',v_coins,'diamonds',v_diamonds,'received',p_diamonds,'replayed',false);
end;
$$;
revoke all on function public.sharika_exchange_diamonds(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.sharika_exchange_diamonds(uuid,bigint,uuid) to service_role;

create or replace function public.sharika_recharge_request(
  p_user_id uuid,
  p_coins bigint,
  p_request_id uuid
) returns public.sharika_recharge_requests
language plpgsql security invoker set search_path = '' as $$
declare v_request public.sharika_recharge_requests;
begin
  if p_user_id is null or p_request_id is null or p_coins is null or p_coins <= 0 or p_coins > 1000000000 then
    raise exception 'invalid_recharge';
  end if;
  if not exists (select 1 from public.sharika_users where user_id=p_user_id and status='active') then
    raise exception 'user_unavailable';
  end if;
  insert into public.sharika_recharge_requests(user_id,coins,request_id)
    values (p_user_id,p_coins,p_request_id)
    on conflict (user_id,request_id) do nothing returning * into v_request;
  if not found then
    select * into v_request from public.sharika_recharge_requests
      where user_id=p_user_id and request_id=p_request_id;
  end if;
  return v_request;
end;
$$;
revoke all on function public.sharika_recharge_request(uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.sharika_recharge_request(uuid,bigint,uuid) to service_role;

create or replace function public.sharika_review_recharge(
  p_actor uuid,
  p_recharge_id bigint,
  p_approve boolean
) returns public.sharika_recharge_requests
language plpgsql security invoker set search_path = '' as $$
declare
  v_role text;
  v_request public.sharika_recharge_requests;
  v_balance bigint;
begin
  select role into v_role from public.sharika_admin_users where user_id=p_actor;
  if v_role not in ('super','finance') or v_role is null then raise exception 'admin_forbidden'; end if;
  select * into v_request from public.sharika_recharge_requests
    where id=p_recharge_id for update;
  if not found then raise exception 'recharge_not_found'; end if;
  if v_request.status <> 'pending' then return v_request; end if;
  if p_approve is null then raise exception 'invalid_recharge'; end if;
  if p_approve then
    perform 1 from public.sharika_users where user_id=v_request.user_id and status='active' for update;
    if not found then raise exception 'user_unavailable'; end if;
    update public.sharika_users set coins=coins+v_request.coins,updated_at=now()
      where user_id=v_request.user_id and (coins::numeric+v_request.coins::numeric) <= 9223372036854775807
      returning coins into v_balance;
    if not found then raise exception 'balance_overflow'; end if;
    insert into public.sharika_wallet_ledger(user_id,currency,delta,balance_after,reason,ref_id,request_id)
      values(v_request.user_id,'coins',v_request.coins,v_balance,'recharge_approved',p_recharge_id::text,v_request.request_id);
    insert into public.sharika_recharges(user_id,coins,verified_by,request_id)
      values(v_request.user_id,v_request.coins,p_actor,v_request.request_id);
  end if;
  update public.sharika_recharge_requests set
    status=case when p_approve then 'approved' else 'rejected' end,
    reviewed_by=p_actor,reviewed_at=now() where id=p_recharge_id returning * into v_request;
  insert into public.sharika_admin_audit(actor_id,action,details)
    values(p_actor,'recharge_review',jsonb_build_object('id',p_recharge_id,'approved',p_approve));
  return v_request;
end;
$$;
revoke all on function public.sharika_review_recharge(uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.sharika_review_recharge(uuid,bigint,boolean) to service_role;
