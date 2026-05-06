-- Family Budget — Supabase schema
-- Run this once in the Supabase SQL editor for a new project.
-- Idempotent: safe to re-run.

-- ============================================================
-- TABLES
-- ============================================================

create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

create table if not exists public.categories (
  id          bigserial primary key,
  user_id     uuid references auth.users(id) on delete cascade,  -- NULL = system default
  name        text not null,
  icon        text not null default '🏷️',
  color       text not null default '#6366f1',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists categories_user_idx on public.categories (user_id);

create table if not exists public.receipt_batches (
  id              bigserial primary key,
  user_id         uuid not null references auth.users(id) on delete cascade,
  merchant        text,
  scanned_at      timestamptz not null default now(),
  total_extracted numeric(10,2),
  notes           text,
  created_at      timestamptz not null default now()
);
create index if not exists receipt_batches_user_idx on public.receipt_batches (user_id, scanned_at desc);

create table if not exists public.expenses (
  id                bigserial primary key,
  user_id           uuid not null references auth.users(id) on delete cascade,
  category_id       bigint not null references public.categories(id),
  receipt_batch_id  bigint references public.receipt_batches(id) on delete set null,
  amount            numeric(10,2) not null,
  description       text,
  notes             text,
  date              date not null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index if not exists expenses_user_date_idx on public.expenses (user_id, date desc);

create table if not exists public.fixed_costs (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  category_id bigint not null references public.categories(id),
  name        text not null,
  amount      numeric(10,2) not null,
  frequency   text not null check (frequency in ('monthly','biweekly','weekly','yearly')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists fixed_costs_user_idx on public.fixed_costs (user_id);

create table if not exists public.budgets (
  id            bigserial primary key,
  user_id       uuid not null references auth.users(id) on delete cascade,
  category_id   bigint not null references public.categories(id),
  monthly_limit numeric(10,2) not null,
  month         int not null check (month between 0 and 11),
  year          int not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (user_id, category_id, month, year)
);
create index if not exists budgets_user_period_idx on public.budgets (user_id, year, month);

-- ============================================================
-- DEFAULT CATEGORIES (system-wide, user_id IS NULL)
-- ============================================================

insert into public.categories (user_id, name, icon, color, is_default)
select * from (values
  (null::uuid, 'Groceries & Food',     '🛒', '#22c55e', true),
  (null::uuid, 'Household Items',      '🏠', '#3b82f6', true),
  (null::uuid, 'Baby & Kids',          '🍼', '#ec4899', true),
  (null::uuid, 'Transportation & Gas', '🚗', '#f59e0b', true),
  (null::uuid, 'Dining & Restaurants', '🍽️', '#ef4444', true),
  (null::uuid, 'Utilities',            '⚡', '#8b5cf6', true),
  (null::uuid, 'Phone & Internet',     '📶', '#06b6d4', true),
  (null::uuid, 'Mortgage & Rent',      '🏦', '#64748b', true),
  (null::uuid, 'Insurance',            '🛡️', '#14b8a6', true),
  (null::uuid, 'Entertainment',        '📺', '#f97316', true),
  (null::uuid, 'Health & Medical',     '❤️', '#dc2626', true),
  (null::uuid, 'Clothing & Personal',  '👕', '#a855f7', true),
  (null::uuid, 'Subscriptions',        '🔁', '#6366f1', true),
  (null::uuid, 'Education',            '🎓', '#0ea5e9', true),
  (null::uuid, 'Other',                '🏷️', '#78716c', true)
) as v(user_id, name, icon, color, is_default)
where not exists (
  select 1 from public.categories
  where categories.user_id is null and categories.name = v.name
);

-- ============================================================
-- NEW USER TRIGGER — clone defaults into the new user's account
-- ============================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict do nothing;
  insert into public.categories (user_id, name, icon, color, is_default)
  select new.id, name, icon, color, true
  from public.categories
  where user_id is null;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

alter table public.profiles        enable row level security;
alter table public.categories      enable row level security;
alter table public.receipt_batches enable row level security;
alter table public.expenses        enable row level security;
alter table public.fixed_costs     enable row level security;
alter table public.budgets         enable row level security;

-- profiles
drop policy if exists "profile self all" on public.profiles;
create policy "profile self all" on public.profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- categories: read own + globals; write only own
drop policy if exists "cat read"   on public.categories;
drop policy if exists "cat insert" on public.categories;
drop policy if exists "cat update" on public.categories;
drop policy if exists "cat delete" on public.categories;
create policy "cat read"   on public.categories for select
  using (user_id = auth.uid() or user_id is null);
create policy "cat insert" on public.categories for insert
  with check (user_id = auth.uid());
create policy "cat update" on public.categories for update
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "cat delete" on public.categories for delete
  using (user_id = auth.uid());

-- receipt_batches, expenses, fixed_costs, budgets — strict self-only
drop policy if exists "rb own"  on public.receipt_batches;
create policy "rb own"  on public.receipt_batches for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "exp own" on public.expenses;
create policy "exp own" on public.expenses for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "fc own"  on public.fixed_costs;
create policy "fc own"  on public.fixed_costs for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "b own"   on public.budgets;
create policy "b own"   on public.budgets for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================
-- updated_at autotouch (expenses, fixed_costs, budgets)
-- ============================================================

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists touch_expenses    on public.expenses;
drop trigger if exists touch_fixed_costs on public.fixed_costs;
drop trigger if exists touch_budgets     on public.budgets;
create trigger touch_expenses    before update on public.expenses    for each row execute procedure public.touch_updated_at();
create trigger touch_fixed_costs before update on public.fixed_costs for each row execute procedure public.touch_updated_at();
create trigger touch_budgets     before update on public.budgets     for each row execute procedure public.touch_updated_at();
