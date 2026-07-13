-- Distinguish 1:1 direct messages from broadcast announcements so the UI can
-- treat them differently: direct messages force an on-open modal, broadcasts
-- show as a dismissible dashboard banner. Both still count toward the bell
-- badge and appear in the inbox.

alter table public.admin_messages
  add column if not exists kind text not null default 'direct'
    check (kind in ('direct', 'broadcast'));
