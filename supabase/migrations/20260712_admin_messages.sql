-- Direct admin → client messaging. The admin can message an individual
-- signed-up user from the admin dashboard; the message is persisted here
-- (so it shows in the user's in-app inbox) AND delivered as a web-push
-- notification. One row per message.

create table if not exists public.admin_messages (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  sender_email text,
  subject text,
  body text not null,
  url text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_messages_user_created_idx
  on public.admin_messages (user_id, created_at desc);
-- Fast unread-count lookups for the inbox badge.
create index if not exists admin_messages_user_unread_idx
  on public.admin_messages (user_id)
  where read_at is null;

alter table public.admin_messages enable row level security;

-- Recipients can read their own messages...
drop policy if exists "users select own messages" on public.admin_messages;
create policy "users select own messages"
  on public.admin_messages
  for select using (auth.uid() = user_id);

-- ...and update their own rows (used only to stamp read_at). Inserts are
-- performed exclusively by the admin via the service-role key, which
-- bypasses RLS, so there is deliberately no user INSERT policy.
drop policy if exists "users update own messages" on public.admin_messages;
create policy "users update own messages"
  on public.admin_messages
  for update using (auth.uid() = user_id);

comment on table public.admin_messages is
  'Direct messages sent from an admin to an individual user. Shown in the '
  'user in-app inbox and delivered via web push.';
