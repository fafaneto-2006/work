-- Stock: correções da auditoria de segurança (A1, A2, M3, B1, B7, B8).
-- Aplicar APÓS schema.sql. Rever e testar primeiro num projeto de staging.
begin;

-- ---------------------------------------------------------------- A1
-- Acesso ao inventário = apenas contas aprovadas (um admin bloqueado perde o acesso).
create or replace function private.has_inventory_access()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.approved
  );
$$;

-- ---------------------------------------------------------------- M3 / B7 / B8
alter table public.profiles
  add constraint profiles_display_name_len check (char_length(display_name) <= 80) not valid;
alter table public.products
  add constraint products_quantity_max check (quantity <= 1000000) not valid;

create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function private.touch_updated_at();
drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function private.touch_updated_at();

-- Limitar o nome vindo do registo.
create or replace function public.handle_new_stock_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, role, approved)
  values (
    new.id,
    coalesce(new.email, ''),
    left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(new.email, '@', 1)), 80),
    'user', false
  );
  return new;
end;
$$;

-- Auditoria de alterações de acesso (M3).
create table if not exists public.access_audit (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references public.profiles(id),
  target_id uuid not null,
  old_role text, new_role text,
  old_approved boolean, new_approved boolean,
  created_at timestamptz not null default now()
);
alter table public.access_audit enable row level security;
revoke all on public.access_audit from anon, authenticated;
grant select on public.access_audit to authenticated;
drop policy if exists "Admins can read access audit" on public.access_audit;
create policy "Admins can read access audit" on public.access_audit
  for select to authenticated using ((select private.is_admin()));

create or replace function public.set_profile_access(
  target_user_id uuid, new_role text, new_approved boolean
) returns void language plpgsql security definer set search_path = '' as $$
declare
  old_row public.profiles%rowtype;
  final_role text := new_role;
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
  -- Bloquear (A1): uma conta bloqueada nunca mantém o papel de admin.
  if not new_approved then final_role := 'user'; end if;

  select * into old_row from public.profiles where id = target_user_id for update;
  if not found then
    raise exception 'Utilizador não encontrado.' using errcode = 'P0002';
  end if;

  update public.profiles
     set role = final_role, approved = new_approved
   where id = target_user_id;

  -- Nunca ficar sem administradores aprovados.
  if not exists (select 1 from public.profiles where role = 'admin' and approved) then
    raise exception 'Tem de existir pelo menos um administrador aprovado.' using errcode = '42501';
  end if;

  insert into public.access_audit (actor_id, target_id, old_role, new_role, old_approved, new_approved)
  values ((select auth.uid()), target_user_id, old_row.role, final_role, old_row.approved, new_approved);
end;
$$;

-- ---------------------------------------------------------------- A2
-- Movimentos passam a sobreviver à remoção do produto (auditoria preservada).
alter table public.stock_movements add column if not exists product_name text;
alter table public.stock_movements add column if not exists request_id uuid;
alter table public.stock_movements alter column product_id drop not null;
alter table public.stock_movements drop constraint if exists stock_movements_product_id_fkey;
alter table public.stock_movements
  add constraint stock_movements_product_id_fkey
  foreign key (product_id) references public.products(id) on delete set null;
update public.stock_movements m set product_name = p.name
  from public.products p where p.id = m.product_id and m.product_name is null;
create unique index if not exists stock_movements_request_id_key
  on public.stock_movements (request_id) where request_id is not null;

-- Escritas de inventário passam a ser feitas só por RPC (com movimento registado).
revoke insert, update, delete on public.products from authenticated;
drop policy if exists "Admins can add products" on public.products;
drop policy if exists "Admins can edit products" on public.products;
drop policy if exists "Admins can delete products" on public.products;

create or replace function public.create_product(p_name text, p_quantity integer default 0, p_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Apenas administradores aprovados podem criar produtos.' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Nome inválido.' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 1000000 then
    raise exception 'Quantidade inválida.' using errcode = '22023';
  end if;
  insert into public.products (id, name, quantity, created_by)
  values (coalesce(p_id, gen_random_uuid()), trim(p_name), p_quantity, (select auth.uid()))
  returning id into new_id;
  if p_quantity > 0 then
    insert into public.stock_movements (product_id, product_name, user_id, movement_type, quantity_delta, quantity_before, quantity_after)
    values (new_id, trim(p_name), (select auth.uid()), 'restock', p_quantity, 0, p_quantity);
  end if;
  return new_id;
end;
$$;

create or replace function public.rename_product(p_product_id uuid, p_name text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Apenas administradores aprovados podem editar produtos.' using errcode = '42501';
  end if;
  if p_name is null or char_length(trim(p_name)) not between 1 and 80 then
    raise exception 'Nome inválido.' using errcode = '22023';
  end if;
  update public.products set name = trim(p_name) where id = p_product_id;
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;
end;
$$;

create or replace function public.adjust_stock(p_product_id uuid, p_delta integer, p_reason text default 'adjustment')
returns table (product_id uuid, quantity integer)
language plpgsql security definer set search_path = '' as $$
declare new_q integer; prod_name text;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Apenas administradores aprovados podem ajustar stock.' using errcode = '42501';
  end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 1000000 then
    raise exception 'Ajuste inválido.' using errcode = '22023';
  end if;
  if p_reason not in ('restock', 'adjustment') then
    raise exception 'Motivo inválido.' using errcode = '22023';
  end if;
  update public.products p
     set quantity = p.quantity + p_delta
   where p.id = p_product_id and p.quantity + p_delta between 0 and 1000000
  returning p.quantity, p.name into new_q, prod_name;
  if not found then
    raise exception 'Produto não encontrado ou quantidade fora dos limites.' using errcode = 'P0002';
  end if;
  insert into public.stock_movements (product_id, product_name, user_id, movement_type, quantity_delta, quantity_before, quantity_after)
  values (p_product_id, prod_name, (select auth.uid()), p_reason, p_delta, new_q - p_delta, new_q);
  return query select p_product_id, new_q;
end;
$$;

create or replace function public.delete_product(p_product_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare prod public.products%rowtype;
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Apenas administradores aprovados podem eliminar produtos.' using errcode = '42501';
  end if;
  select * into prod from public.products where id = p_product_id for update;
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;
  if prod.quantity > 0 then
    insert into public.stock_movements (product_id, product_name, user_id, movement_type, quantity_delta, quantity_before, quantity_after)
    values (prod.id, prod.name, (select auth.uid()), 'adjustment', -prod.quantity, prod.quantity, 0);
  end if;
  delete from public.products where id = p_product_id;
end;
$$;

-- ---------------------------------------------------------------- B1
-- record_sale idempotente (p_request_id) e com nome do produto no movimento.
drop function if exists public.record_sale(uuid, integer);
create or replace function public.record_sale(
  p_product_id uuid, p_quantity integer default 1, p_request_id uuid default null
) returns table (product_id uuid, quantity integer)
language plpgsql security definer set search_path = '' as $$
declare new_q integer; prod_name text; prev public.stock_movements%rowtype;
begin
  if (select auth.uid()) is null or not private.has_inventory_access() then
    raise exception 'A conta ainda não tem acesso ao inventário.' using errcode = '42501';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 10000 then
    raise exception 'Quantidade inválida.' using errcode = '22023';
  end if;
  if p_request_id is not null then
    select * into prev from public.stock_movements m
     where m.request_id = p_request_id and m.user_id = (select auth.uid());
    if found then
      return query select prev.product_id, prev.quantity_after; return;
    end if;
  end if;
  update public.products p
     set quantity = p.quantity - p_quantity
   where p.id = p_product_id and p.quantity >= p_quantity
  returning p.quantity, p.name into new_q, prod_name;
  if not found then
    raise exception 'Produto não encontrado ou stock insuficiente.' using errcode = 'P0002';
  end if;
  insert into public.stock_movements (product_id, product_name, user_id, movement_type, quantity_delta, quantity_before, quantity_after, request_id)
  values (p_product_id, prod_name, (select auth.uid()), 'sale', -p_quantity, new_q + p_quantity, new_q, p_request_id);
  return query select p_product_id, new_q;
end;
$$;

-- Permissões das funções (nada para anon/public).
revoke all on function public.create_product(text, integer, uuid) from public, anon;
revoke all on function public.rename_product(uuid, text) from public, anon;
revoke all on function public.adjust_stock(uuid, integer, text) from public, anon;
revoke all on function public.delete_product(uuid) from public, anon;
revoke all on function public.record_sale(uuid, integer, uuid) from public, anon;
revoke all on function public.set_profile_access(uuid, text, boolean) from public, anon;
grant execute on function public.create_product(text, integer, uuid) to authenticated;
grant execute on function public.rename_product(uuid, text) to authenticated;
grant execute on function public.adjust_stock(uuid, integer, text) to authenticated;
grant execute on function public.delete_product(uuid) to authenticated;
grant execute on function public.record_sale(uuid, integer, uuid) to authenticated;
grant execute on function public.set_profile_access(uuid, text, boolean) to authenticated;

-- Admins bloqueados existentes passam a utilizadores (A1).
update public.profiles set role = 'user' where role = 'admin' and not approved;

-- Opcional (M2): exigir MFA nas ações de admin, depois de todos os admins terem TOTP:
--   em private.is_admin(): and coalesce((select auth.jwt() ->> 'aal'), '') = 'aal2'

commit;
