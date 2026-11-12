-- Stock: quota diária do assistente de IA (evita abuso e custos inesperados).
begin;
create table if not exists public.assistant_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default (now() at time zone 'utc')::date,
  used integer not null default 0,
  primary key (user_id, day)
);
alter table public.assistant_usage enable row level security;
revoke all on public.assistant_usage from anon, authenticated;

-- Devolve true se ainda há quota hoje (e consome 1 pedido); false se excedeu.
create or replace function public.assistant_take_quota(p_limit integer default 60)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if (select auth.uid()) is null or not private.has_inventory_access() then
    raise exception 'A conta ainda não tem acesso.' using errcode = '42501';
  end if;
  insert into public.assistant_usage (user_id, day, used)
  values ((select auth.uid()), (now() at time zone 'utc')::date, 1)
  on conflict (user_id, day) do update set used = public.assistant_usage.used + 1
  returning used into n;
  return n <= greatest(coalesce(p_limit, 60), 1);
end;
$$;
revoke all on function public.assistant_take_quota(integer) from public, anon;
grant execute on function public.assistant_take_quota(integer) to authenticated;
commit;
