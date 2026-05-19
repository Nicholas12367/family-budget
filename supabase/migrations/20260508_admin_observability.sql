-- Adds two observability tables for the admin dashboard.
-- Idempotent: safe to re-run.
--
-- Run once in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/_/sql

-- 1. Per-scan telemetry. One row per Gemini call (success or failure).
--    Service role only — RLS enabled with no policies.
create table if not exists public.gemini_scan_log (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  status text not null check (status in ('ok','error','rate_limited','timeout','blocked_by_cap')),
  http_status int,
  duration_ms int,
  bytes_in int,
  error_code text,
  error_message text
);
create index if not exists gemini_scan_log_created_at_idx
  on public.gemini_scan_log (created_at desc);
create index if not exists gemini_scan_log_user_created_idx
  on public.gemini_scan_log (user_id, created_at desc);
alter table public.gemini_scan_log enable row level security;

comment on table public.gemini_scan_log is
  'One row per Gemini receipt-scan call. Read by /admin/system. Service role only.';

-- 2. Audit log for admin actions (suspend / unsuspend in v1).
create table if not exists public.admin_audit_log (
  id bigserial primary key,
  actor_email text not null,
  target_user_id uuid,
  target_email text,
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_log_created_at_idx
  on public.admin_audit_log (created_at desc);
alter table public.admin_audit_log enable row level security;

comment on table public.admin_audit_log is
  'Audit trail for admin destructive actions. Read by /admin/system. Service role only.';
