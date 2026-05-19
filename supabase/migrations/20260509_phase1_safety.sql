-- Phase 1 — scaling safety + admin notifications.
-- Idempotent: safe to re-run from any state.
--
-- Run once in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/_/sql

-- 1. Stripe customer ID → Supabase user ID lookup table.
--    Replaces the O(n) page walk in findUserIdByCustomerId().
create table if not exists public.stripe_customer_map (
  user_id uuid primary key references auth.users(id) on delete cascade,
  customer_id text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists stripe_customer_map_customer_idx
  on public.stripe_customer_map (customer_id);
alter table public.stripe_customer_map enable row level security;

-- Backfill from existing user_metadata.subscription.customer_id.
insert into public.stripe_customer_map (user_id, customer_id, created_at)
select
  u.id,
  (u.raw_user_meta_data #>> '{subscription,customer_id}'),
  coalesce(u.created_at, now())
from auth.users u
where (u.raw_user_meta_data #>> '{subscription,customer_id}') is not null
on conflict (user_id) do update
  set customer_id = excluded.customer_id,
      updated_at = now();

comment on table public.stripe_customer_map is
  'O(1) lookup from Stripe customer_id to Supabase user_id. Written by setSubForUser, read by findUserIdByCustomerId.';

-- 2. Add request hash to gemini_scan_log so we can dedup
--    rapid double-tap retries within a short window.
alter table public.gemini_scan_log
  add column if not exists request_hash text;

create index if not exists gemini_scan_log_user_hash_created_idx
  on public.gemini_scan_log (user_id, request_hash, created_at desc);

-- Drop the old status CHECK constraint (whatever it's named) and replace
-- with one that allows our new statuses.
alter table public.gemini_scan_log drop constraint if exists gemini_scan_log_status_check;

alter table public.gemini_scan_log
  add constraint gemini_scan_log_status_check
  check (status in (
    'ok','error','rate_limited','timeout',
    'blocked_by_cap','blocked_by_user_cap','duplicate_blocked'
  ));

-- 3. Step-by-step diagnostic log for receipt-scan upload attempts.
--    Lets us debug Samsung-style silent failures from the admin page.
create table if not exists public.scan_upload_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  step text not null,
  user_agent text,
  device_hint text,
  file_name text,
  file_type text,
  file_size_bytes bigint,
  detail text
);
create index if not exists scan_upload_log_user_created_idx
  on public.scan_upload_log (user_id, created_at desc);
alter table public.scan_upload_log enable row level security;

drop policy if exists "users insert their own scan_upload_log rows" on public.scan_upload_log;
create policy "users insert their own scan_upload_log rows"
  on public.scan_upload_log
  for insert
  with check (auth.uid() = user_id);

comment on table public.scan_upload_log is
  'Step-by-step log of receipt scan upload attempts. Used by admin dashboard to diagnose mobile failures (esp. Samsung).';

-- 4. Trigger to keep stripe_customer_map.updated_at fresh.
create or replace function public.touch_updated_at_simple()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end$$;

drop trigger if exists touch_stripe_customer_map_updated_at on public.stripe_customer_map;
create trigger touch_stripe_customer_map_updated_at
  before update on public.stripe_customer_map
  for each row execute function public.touch_updated_at_simple();
