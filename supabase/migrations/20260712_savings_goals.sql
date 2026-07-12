-- Savings goals: one target amount per user per year. Drives the annual
-- savings progress bar on the home-screen Income widget. Kept intentionally
-- small (one row per year) so the widget can show "saved $X of $Y this year".

create table if not exists public.savings_goals (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  year int not null,
  target_amount numeric(12,2) not null check (target_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year)
);
create index if not exists savings_goals_user_year_idx
  on public.savings_goals (user_id, year);
alter table public.savings_goals enable row level security;

drop policy if exists "users select own savings goals" on public.savings_goals;
create policy "users select own savings goals"
  on public.savings_goals
  for select using (auth.uid() = user_id);

drop policy if exists "users insert own savings goals" on public.savings_goals;
create policy "users insert own savings goals"
  on public.savings_goals
  for insert with check (auth.uid() = user_id);

drop policy if exists "users update own savings goals" on public.savings_goals;
create policy "users update own savings goals"
  on public.savings_goals
  for update using (auth.uid() = user_id);

drop policy if exists "users delete own savings goals" on public.savings_goals;
create policy "users delete own savings goals"
  on public.savings_goals
  for delete using (auth.uid() = user_id);

drop trigger if exists touch_savings_goals_updated_at on public.savings_goals;
create trigger touch_savings_goals_updated_at
  before update on public.savings_goals
  for each row execute function public.touch_updated_at();

comment on table public.savings_goals is
  'Per-user annual savings target for the Income widget progress bar.';
