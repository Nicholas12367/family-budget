-- Adds explicit rollover + personal-budget metadata to budgets.
-- Idempotent: safe to re-run.
--
-- Run once in the Supabase SQL editor:
--   https://supabase.com/dashboard/project/_/sql

alter table public.budgets
  add column if not exists rolls_over   boolean not null default false,
  add column if not exists is_personal  boolean not null default false,
  add column if not exists person_name  text;

comment on column public.budgets.rolls_over is
  'When true, the unused balance carries forward each month and overspending deducts from next month. Compounds indefinitely.';
comment on column public.budgets.is_personal is
  'Marks a budget as belonging to a specific person (display only).';
comment on column public.budgets.person_name is
  'Free-form name shown when is_personal is true (e.g. Eric, Nick, Kate).';
