# Stripe billing — implementation plan (paused, waiting on keys)

## Decisions confirmed
- Price: **$4.00 / month CAD** (or USD — user to pick when creating the Stripe product).
- Trial: **7 days, card required upfront**.
  - Stripe `subscription_data.trial_period_days = 7` on Checkout Session.
  - First $4 charge fires automatically on day 8.
  - User can cancel anytime in those 7 days at no cost.
- Cancel: handled via Stripe Customer Portal (zero custom UI).
- Card expired / payment failed: middleware blocks access to all app routes
  except `/billing`, `/login`, `/signup`, `/forgot`, `/reset`, `/auth/*`.
- Existing user (nicholas_connelly@icloud.com) is grandfathered free —
  see `is_grandfathered` flag on profile or hardcode user_id check.

## Environment variables to add to Vercel later
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_PRICE_ID` (the `price_...` id of the $4/mo recurring price)

## Supabase migration to run
```sql
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'incomplete',
  current_period_end timestamptz,
  cancel_at_period_end boolean default false,
  trial_end timestamptz,
  is_grandfathered boolean default false,
  updated_at timestamptz not null default now()
);

alter table public.subscriptions enable row level security;
drop policy if exists "own_select" on public.subscriptions;
create policy "own_select" on public.subscriptions for select
  using (user_id = auth.uid());
-- writes happen via service-role from the webhook only, not directly from client
```

## Files to add (rough)
- `src/lib/stripe.ts` — server-only Stripe SDK init
- `src/app/api/stripe/checkout/route.ts` — creates Customer + Checkout Session w/ 7-day trial
- `src/app/api/stripe/portal/route.ts` — creates Customer Portal Session
- `src/app/api/stripe/webhook/route.ts` — verify signature, upsert subscription state
- `src/app/billing/page.tsx` — status + "Update payment" / "Cancel" buttons
- `src/lib/supabase/middleware.ts` — extend gate: if subscription.status not in
  ('active','trialing') AND user is not grandfathered → redirect to /billing

## Signup flow change
After Supabase signup succeeds and session is created, redirect to
`/api/stripe/checkout` instead of `/`. Checkout returns the user to `/`
on success or `/billing` on cancel.

## Webhook events to handle
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.payment_succeeded`
- `invoice.payment_failed`

## Estimated build time
3–4 hours focused, after Stripe keys land.
