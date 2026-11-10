-- Stock: single-store inventory with Supabase Auth and role-based access.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null default '',
  display_name text not null default '',
  role text not null default 'user' check (role in ('admin', 'user')),
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 120),
  quantity integer not null default 0 check (quantity >= 0),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  movement_type text not null check (movement_type in ('sale', 'restock', 'adjustment')),
  quantity_delta integer not null check (quantity_delta <> 0),
  quantity_before integer not null check (quantity_before >= 0),
  quantity_after integer not null check (quantity_after >= 0),
  created_at timestamptz not null default now()
);

create index products_name_idx on public.products (lower(name));
create index stock_movements_product_created_idx on public.stock_movements (product_id, created_at desc);

create or replace function private.has_inventory_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and (p.approved or p.role = 'admin')
  );
$$;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.role = 'admin'
      and p.approved
  );
$$;

grant execute on function private.has_inventory_access() to authenticated;
grant execute on function private.is_admin() to authenticated;

create or replace function public.handle_new_stock_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name, role, approved)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)),
    'user',
    false
  );
  return new;
end;
$$;

revoke all on function public.handle_new_stock_user() from public, anon, authenticated;
create trigger on_auth_user_created_stock
  after insert on auth.users
  for each row execute function public.handle_new_stock_user();

create or replace function public.set_profile_access(
  target_user_id uuid,
  new_role text,
  new_approved boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Apenas administradores aprovados podem gerir acessos.' using errcode = '42501';
  end if;
  if target_user_id = (select auth.uid()) then
    raise exception 'Use outra conta de administrador para alterar o seu próprio acesso.' using errcode = '42501';
  end if;
  if new_role not in ('admin', 'user') then
    raise exception 'Perfil inválido.' using errcode = '22023';
  end if;

  update public.profiles
  set role = new_role, approved = new_approved, updated_at = now()
  where id = target_user_id;

  if not found then
    raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.record_sale(p_product_id uuid, p_quantity integer default 1)
returns table (product_id uuid, quantity integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_quantity integer;
begin
  if (select auth.uid()) is null or not private.has_inventory_access() then
    raise exception 'A conta ainda não tem acesso ao inventário.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000 then
    raise exception 'Quantidade inválida.' using errcode = '22023';
  end if;

  update public.products p
  set quantity = p.quantity - p_quantity, updated_at = now()
  where p.id = p_product_id and p.quantity >= p_quantity
  returning p.quantity into new_quantity;

  if not found then
    raise exception 'Produto não encontrado ou stock insuficiente.' using errcode = 'P0002';
  end if;

  insert into public.stock_movements (
    product_id, user_id, movement_type, quantity_delta, quantity_before, quantity_after
  ) values (
    p_product_id, (select auth.uid()), 'sale', -p_quantity, new_quantity + p_quantity, new_quantity
  );

  return query select p_product_id, new_quantity;
end;
$$;

revoke all on function public.set_profile_access(uuid, text, boolean) from public, anon;
revoke all on function public.record_sale(uuid, integer) from public, anon;
grant execute on function public.set_profile_access(uuid, text, boolean) to authenticated;
grant execute on function public.record_sale(uuid, integer) to authenticated;

alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.stock_movements enable row level security;

revoke all on public.profiles, public.products, public.stock_movements from anon, authenticated;
grant select, update (display_name) on public.profiles to authenticated;
grant select, insert, update, delete on public.products to authenticated;
grant select on public.stock_movements to authenticated;

create policy "Users can read their profile; admins can read all profiles"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id or (select private.is_admin()));
create policy "Users can update their own display name"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy "Approved users can read inventory"
  on public.products for select to authenticated
  using ((select private.has_inventory_access()));
create policy "Admins can add products"
  on public.products for insert to authenticated
  with check ((select private.is_admin()) and created_by = (select auth.uid()));
create policy "Admins can edit products"
  on public.products for update to authenticated
  using ((select private.is_admin()))
  with check ((select private.is_admin()));
create policy "Admins can delete products"
  on public.products for delete to authenticated
  using ((select private.is_admin()));

create policy "Approved users can read stock history"
  on public.stock_movements for select to authenticated
  using ((select private.has_inventory_access()));

comment on table public.profiles is 'Supabase Auth profile with database-controlled role and approval state.';
comment on table public.products is 'Products in the single Stock store inventory.';
comment on table public.stock_movements is 'Audit trail for stock changes made through approved operations.';

-- Initial administrator setup (run once in SQL Editor after creating the owner account):
-- update public.profiles p set role = 'admin', approved = true
-- from auth.users u where p.id = u.id and lower(u.email) = lower('OWNER_EMAIL_HERE');
