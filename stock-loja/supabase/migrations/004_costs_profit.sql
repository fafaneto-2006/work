-- Stock: custo por unidade e relatório de lucro (só administradores veem custos).
-- Aplicar depois de 003_pos_invoices.sql. Testar primeiro em staging.
begin;

create table if not exists public.product_costs (
  product_id uuid primary key references public.products(id) on delete cascade,
  cost_cents integer not null check (cost_cents between 0 and 100000000)
);
create table if not exists public.sale_item_costs (
  sale_item_id uuid primary key references public.sale_items(id) on delete cascade,
  unit_cost_cents integer not null check (unit_cost_cents >= 0)
);
alter table public.product_costs enable row level security;
alter table public.sale_item_costs enable row level security;
revoke all on public.product_costs, public.sale_item_costs from anon, authenticated;
grant select on public.product_costs, public.sale_item_costs to authenticated;
create policy "Admins read costs" on public.product_costs for select to authenticated
  using ((select private.is_admin()));
create policy "Admins read item costs" on public.sale_item_costs for select to authenticated
  using ((select private.is_admin()));

create or replace function public.set_cost(p_product_id uuid, p_cost_cents integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Apenas administradores aprovados podem definir custos.' using errcode = '42501';
  end if;
  if p_cost_cents is null or p_cost_cents < 0 or p_cost_cents > 100000000 then
    raise exception 'Custo inválido.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.products where id = p_product_id) then
    raise exception 'Produto não encontrado.' using errcode = 'P0002';
  end if;
  insert into public.product_costs (product_id, cost_cents) values (p_product_id, p_cost_cents)
  on conflict (product_id) do update set cost_cents = excluded.cost_cents;
end;
$$;

-- checkout_sale passa a guardar o custo unitário no momento da venda (só admins o leem).
create or replace function public.checkout_sale(p_items jsonb, p_payment text, p_request_id uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  sale_id uuid; item_id uuid; r record; prod record; new_q integer; total bigint := 0;
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
    values (sale_id, r.pid, prod.name, r.qty, prod.price_cents, prod.price_cents::bigint * r.qty)
    returning id into item_id;
    insert into public.sale_item_costs (sale_item_id, unit_cost_cents)
    select item_id, c.cost_cents from public.product_costs c where c.product_id = r.pid;
    total := total + prod.price_cents::bigint * r.qty;
  end loop;

  update public.sales set total_cents = total where id = sale_id;
  return sale_id;
end;
$$;

-- Linhas vendidas desde p_from (só administradores). O cliente agrega por dia, semana e mês.
create or replace function public.profit_lines(p_from timestamptz)
returns table (sale_id uuid, sold_at timestamptz, product_name text, quantity integer,
               unit_price_cents integer, unit_cost_cents integer)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    raise exception 'Apenas administradores aprovados podem ver o lucro.' using errcode = '42501';
  end if;
  return query
    select s.id, s.created_at, i.product_name, i.quantity, i.unit_price_cents, c.unit_cost_cents
      from public.sale_items i
      join public.sales s on s.id = i.sale_id
      left join public.sale_item_costs c on c.sale_item_id = i.id
     where s.created_at >= p_from
     order by s.created_at desc
     limit 50000;
end;
$$;

revoke all on function public.set_cost(uuid, integer) from public, anon;
revoke all on function public.checkout_sale(jsonb, text, uuid) from public, anon;
revoke all on function public.profit_lines(timestamptz) from public, anon;
grant execute on function public.set_cost(uuid, integer) to authenticated;
grant execute on function public.checkout_sale(jsonb, text, uuid) to authenticated;
grant execute on function public.profit_lines(timestamptz) to authenticated;

commit;
