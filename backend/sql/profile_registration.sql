-- Atomic first-time profile creation with the 2,000-coin signup gift
-- shown in the original Sharika app. Callable only by the trusted API.
create or replace function public.sharika_register_profile(
  p_user_id uuid,
  p_name text,
  p_birthdate date,
  p_country text,
  p_pic text
) returns public.sharika_users
language plpgsql security invoker set search_path = '' as $$
declare
  v_profile public.sharika_users;
  v_age integer;
begin
  if p_user_id is null or p_name is null or length(btrim(p_name)) not between 1 and 80
    or p_birthdate is null or p_birthdate > current_date then
    raise exception 'invalid_profile';
  end if;
  v_age := date_part('year',age(current_date,p_birthdate))::integer;
  if v_age < 13 or v_age > 120 then raise exception 'invalid_birthdate'; end if;

  -- A concurrent retry never gets a second signup gift.
  insert into public.sharika_users
    (user_id,name,birthdate,country,pic,minor,coins)
    values (p_user_id,btrim(p_name),p_birthdate,p_country,p_pic,v_age<18,2000)
    on conflict (user_id) do nothing
    returning * into v_profile;

  if found then
    insert into public.sharika_wallet_ledger
      (user_id,currency,delta,balance_after,reason,ref_id,request_id)
      values (p_user_id,'coins',2000,2000,'signup_welcome','sharika_signup',gen_random_uuid());
  else
    select * into v_profile from public.sharika_users where user_id=p_user_id;
    if not found then raise exception 'profile_creation_failed'; end if;
  end if;
  return v_profile;
end;
$$;
revoke all on function public.sharika_register_profile(uuid,text,date,text,text) from public,anon,authenticated;
grant execute on function public.sharika_register_profile(uuid,text,date,text,text) to service_role;
