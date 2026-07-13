-- Let a savings goal be tracked per-month or per-year. Existing rows keep
-- the original yearly behaviour via the default. One goal row per user/year
-- still holds; `period` just changes how progress is measured & displayed.

alter table public.savings_goals
  add column if not exists period text not null default 'yearly'
    check (period in ('monthly', 'yearly'));

comment on column public.savings_goals.period is
  'How the target is tracked: yearly (progress = net saved YTD) or monthly '
  '(progress = net saved in the viewed month).';
