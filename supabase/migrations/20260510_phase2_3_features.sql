-- Phase 2 + 3 — UX features: feedback, income tracking, custom budget thresholds,
-- onboarding flag, FAQ AI rate limit.
-- Idempotent: safe to re-run from any state.
--
-- Run once in the Supabase SQL editor.

-- 1. User feedback / bug reports.
--    Submitted from a button in Settings; triaged by Gemini classifier;
--    surfaces in the admin feedback page. Notifies owner via push.
create table if not exists public.feedback (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  created_at timestamptz not null default now(),
  subject text,
  body text not null,
  category text not null default 'other'
    check (category in ('bug','feature_request','question','other')),
  source_url text,
  user_agent text,
  device_hint text,
  status text not null default 'open'
    check (status in ('open','in_progress','resolved','wont_fix')),
  resolution_note text,
  resolved_at timestamptz,
  resolved_by text
);
create index if not exists feedback_created_at_idx
  on public.feedback (created_at desc);
create index if not exists feedback_status_created_idx
  on public.feedback (status, created_at desc);
create index if not exists feedback_user_idx
  on public.feedback (user_id);
alter table public.feedback enable row level security;

drop policy if exists "users insert their own feedback" on public.feedback;
create policy "users insert their own feedback"
  on public.feedback
  for insert
  with check (
    -- Allow either authenticated user inserting their own row, or
    -- anonymous (user_id null) submissions from public flows.
    auth.uid() is null
    or auth.uid() = user_id
  );

drop policy if exists "users view their own feedback" on public.feedback;
create policy "users view their own feedback"
  on public.feedback
  for select
  using (auth.uid() = user_id);

comment on table public.feedback is
  'User-submitted bug reports / feature requests / questions. Service role manages from admin dashboard.';

-- 2. Income tracking. Separate table from expenses; one row per pay stub.
create table if not exists public.income_entries (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null default current_date,
  amount numeric(12,2) not null check (amount >= 0),
  description text,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists income_entries_user_date_idx
  on public.income_entries (user_id, date desc);
alter table public.income_entries enable row level security;

drop policy if exists "users select own income" on public.income_entries;
create policy "users select own income"
  on public.income_entries
  for select using (auth.uid() = user_id);

drop policy if exists "users insert own income" on public.income_entries;
create policy "users insert own income"
  on public.income_entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "users update own income" on public.income_entries;
create policy "users update own income"
  on public.income_entries
  for update using (auth.uid() = user_id);

drop policy if exists "users delete own income" on public.income_entries;
create policy "users delete own income"
  on public.income_entries
  for delete using (auth.uid() = user_id);

drop trigger if exists touch_income_entries_updated_at on public.income_entries;
create trigger touch_income_entries_updated_at
  before update on public.income_entries
  for each row execute function public.touch_updated_at();

comment on table public.income_entries is
  'Income entries (paychecks, etc) for the optional income widget.';

-- 3. Per-budget custom alert thresholds. Null = use defaults (50/80/100/110).
alter table public.budgets
  add column if not exists alert_thresholds jsonb;

comment on column public.budgets.alert_thresholds is
  'Optional override for budget alert thresholds. JSON array of percentages (e.g. [60, 90, 100]). When null, fall back to global defaults.';

-- 4. Onboarding flag + income widget toggle on profiles.
alter table public.profiles
  add column if not exists onboarded_at timestamptz,
  add column if not exists show_income_widget boolean not null default true;

comment on column public.profiles.onboarded_at is
  'Set when the user finishes (or skips) the first-login walkthrough tour. Null = show tour on next login.';
comment on column public.profiles.show_income_widget is
  'When true (default), the home screen shows the Income / Made / Saved widget.';

-- 5. AI question log for the FAQ Ask-the-AI feature. Used to enforce the
--    5/day per-user cap on free-form Gemini questions (separate from receipt scans).
create table if not exists public.ai_question_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  question text not null,
  answer text,
  duration_ms int,
  status text not null check (status in ('ok','error','rate_limited','blocked_by_cap'))
);
create index if not exists ai_question_log_user_created_idx
  on public.ai_question_log (user_id, created_at desc);
alter table public.ai_question_log enable row level security;

drop policy if exists "users insert their own ai_question_log" on public.ai_question_log;
create policy "users insert their own ai_question_log"
  on public.ai_question_log
  for insert with check (auth.uid() = user_id);

drop policy if exists "users read their own ai_question_log" on public.ai_question_log;
create policy "users read their own ai_question_log"
  on public.ai_question_log
  for select using (auth.uid() = user_id);

comment on table public.ai_question_log is
  'Log of FAQ Ask-the-AI questions. Used to rate-limit per user (5/day cap).';
