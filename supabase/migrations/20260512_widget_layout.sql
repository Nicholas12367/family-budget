-- Phase C — home screen widget layout per user.
-- Idempotent: safe to re-run.
--
-- Run once in the Supabase SQL editor.

alter table public.profiles
  add column if not exists home_widgets jsonb;

comment on column public.profiles.home_widgets is
  'Per-user dashboard widget layout. Shape: {"order": ["spent","variable","fixed","remaining","income"], "hidden": ["variable"]}. Null = default order, all visible.';
