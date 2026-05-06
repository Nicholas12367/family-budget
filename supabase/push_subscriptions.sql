-- Run this once in the Supabase SQL editor to add web-push support.
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

alter table public.push_subscriptions enable row level security;

drop policy if exists "own" on public.push_subscriptions;
create policy "own" on public.push_subscriptions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Per-category threshold tracking, so we don't re-notify on the same threshold.
create table if not exists public.budget_alert_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  category_id bigint not null,
  year int not null,
  month int not null,
  last_threshold int not null default 0,
  primary key (user_id, category_id, year, month)
);

alter table public.budget_alert_state enable row level security;

drop policy if exists "own" on public.budget_alert_state;
create policy "own" on public.budget_alert_state for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
