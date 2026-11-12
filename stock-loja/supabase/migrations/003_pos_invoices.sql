-- Stock: Caixa (vendas com vários artigos, preços, pagamento) e faturas.
-- Aplicar depois de 002_security_fixes.sql. Testar primeiro em staging.
begin;

alter table public.products add column if not exists price_cents integer
  check (price_cents is null or price_cents between 0 and 100000000);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  payment_method text not null check (payment_method in ('cash', 'card', 'transfer')),
  total_cents bigint not null check (total_cents >= 0),
  request_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists sales_request_id_key on public.sales (request_id) where request_id is not null;

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price_cents integer not null check (unit_price_cents >= 0),
  line_total_cents bigint not null check (line_total_cents >= 0)
);
create index if not exists sale_items_sale_idx on public.sale_items (sale_id);

-- Numeração sem falhas: um contador de linha única, atualizado dentro da mesma transação.
create table if not exists public.invoice_counter (
  singleton boolean primary key default true check (singleton),
  last_number integer not null default 0
);
insert into public.invoice_counter (singleton) values (true) on conflict do nothing;

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  number integer not null unique,
  sale_id uuid not null unique references public.sales(id) on delete restrict,
  customer_name text not null check (char_length(customer_name) between 1 and 120),
  customer_nif text check (customer_nif is null or customer_nif ~ '^[A-Za-z0-9 .-]{1,20}$'),
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  total_cents bigint not null
);

alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.invoice_counter enable row level security;
alter table public.invoices enable row level security;
revoke all on public.sales, public.sale_items, public.invoice_counter, public.invoices from anon, authenticated;
grant select on public.sales, public.sale_items, public.invoices to authenticated;

create policy "Own sales or admin" on public.sales for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));
create policy "Items of visible sales" on public.sale_items for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id
         and (s.user_id = (select auth.uid()) or (select private.is_admin()))));
create policy "Invoices of visible sales" on public.invoices for select to authenticated
  using (exists (select 1 from public.sales s where s.id = sale_id
         and (s.user_id = (select auth.uid()) or (select private.is_admin()))));

create or replace function public.set_price(p_product_id uuid, p_price_cents integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Apenas administradores aprovados podem definir preços.' using errcode = '42501';
  end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000000 then
    raise exception 'Preço inválido.' using errcode = '22023';
  end if;
  update public.products set price_cents = p_price_cents where id = p_product_id;
  if not found then raise exception 'Produto não encontrado.' using errcode = 'P0002'; end if;
end;
$$;

-- Venda atómica com vários artigos; idempotente por p_request_id.
create or replace function public.checkout_sale(p_items jsonb, p_payment text, p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sale_id uuid; r record; prod record; new_q integer; total bigint := 0;
begin
  if (select auth.uid()) is null or not private.has_inventory_access() then
    raise exception 'A conta ainda não tem acesso ao inventário.' using errcode = '42501';
  end if;
  if p_payment not in ('cash', 'card', 'transfer') then
    raise exception 'Forma de pagamento inválida.' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'Carrinho inválido.' using errcode = '22023';
  end if;
  if p_request_id is not null then
    select s.id into sale_id from public.sales s
     where s.request_id = p_request_id and s.user_id = (select auth.uid());
    if found then return sale_id; end if;
  end if;

  insert into public.sales (user_id, payment_method, total_cents, request_id)
  values ((select auth.uid()), p_payment, 0, p_request_id) returning id into sale_id;

  -- Agrupa por produto e bloqueia por ordem de id (evita deadlocks).
  for r in
    select (e ->> 'product_id')::uuid as pid, sum((e ->> 'quantity')::integer)::integer as qty
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    if r.qty < 1 or r.qty > 10000 then
      raise exception 'Quantidade inválida.' using errcode = '22023';
    end if;
    update public.products p set quantity = p.quantity - r.qty
     where p.id = r.pid and p.quantity >= r.qty and p.price_cents is not null
    returning p.name, p.price_cents, p.quantity into prod;
    if not found then
      raise exception 'Produto sem stock suficiente ou sem preço definido.' using errcode = 'P0002';
    end if;
    new_q := prod.quantity;
    insert into public.stock_movements (product_id, product_name, user_id, movement_type, quantity_delta, quantity_before, quantity_after)
    values (r.pid, prod.name, (select auth.uid()), 'sale', -r.qty, new_q + r.qty, new_q);
    insert into public.sale_items (sale_id, product_id, product_name, quantity, unit_price_cents, line_total_cents)
    values (sale_id, r.pid, prod.name, r.qty, prod.price_cents, prod.price_cents::bigint * r.qty);
    total := total + prod.price_cents::bigint * r.qty;
  end loop;

  update public.sales set total_cents = total where id = sale_id;
  return sale_id;
end;
$$;

create or replace function public.issue_invoice(p_sale_id uuid, p_customer_name text, p_customer_nif text default null)
returns table (number integer, issued_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare s public.sales%rowtype; inv public.invoices%rowtype; n integer;
begin
  if (select auth.uid()) is null or not private.has_inventory_access() then
    raise exception 'A conta ainda não tem acesso ao inventário.' using errcode = '42501';
  end if;
  select * into s from public.sales where id = p_sale_id for update;
  if not found or (s.user_id <> (select auth.uid()) and not private.is_admin()) then
    raise exception 'Venda não encontrada.' using errcode = 'P0002';
  end if;
  select * into inv from public.invoices i where i.sale_id = p_sale_id;
  if found then return query select inv.number, inv.issued_at; return; end if;
  if p_customer_name is null or char_length(trim(p_customer_name)) not between 1 and 120 then
    raise exception 'Nome do cliente inválido.' using errcode = '22023';
  end if;
  update public.invoice_counter set last_number = last_number + 1 where singleton returning last_number into n;
  insert into public.invoices (number, sale_id, customer_name, customer_nif, issued_by, total_cents)
  values (n, p_sale_id, trim(p_customer_name), nullif(trim(coalesce(p_customer_nif, '')), ''), (select auth.uid()), s.total_cents)
  returning * into inv;
  return query select inv.number, inv.issued_at;
end;
$$;

revoke all on function public.set_price(uuid, integer) from public, anon;
revoke all on function public.checkout_sale(jsonb, text, uuid) from public, anon;
revoke all on function public.issue_invoice(uuid, text, text) from public, anon;
grant execute on function public.set_price(uuid, integer) to authenticated;
grant execute on function public.checkout_sale(jsonb, text, uuid) to authenticated;
grant execute on function public.issue_invoice(uuid, text, text) to authenticated;

commit;
