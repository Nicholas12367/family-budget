-- Run this once in the Supabase SQL editor to add "Who bought this?" support.

-- Household members. user_id is the account owner; each person is a
-- distinct buyer the owner tracks (e.g. "Kate", "Nick"), or "Shared".
create table if not exists public.people (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  color text not null default '#10b981',
  is_shared boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.people enable row level security;

drop policy if exists "own" on public.people;
create policy "own" on public.people for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Link expenses to a buyer. NULL = unassigned (back-compat for old rows).
alter table public.expenses
  add column if not exists person_id bigint
  references public.people(id) on delete set null;

create index if not exists expenses_person_id_idx on public.expenses(person_id);
