-- Fix a Supabase Security Advisor CRITICAL finding
-- ("rls_disabled_in_public") flagged 2026-07-20: the internal
-- schema_migrations tracking table lived in the public schema without
-- row-level security, so the anon key exposed it via PostgREST. Nothing
-- in the app reads or writes this table — it's populated by ad-hoc
-- migration scripts — so enabling RLS with no policies is the correct
-- lockdown (service role bypasses RLS and can still record migrations).

alter table if exists public.schema_migrations enable row level security;
