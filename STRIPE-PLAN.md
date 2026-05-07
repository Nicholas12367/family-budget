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

## Promo / discount codes (free access)

Yes, Stripe supports this natively via **coupons** + **promotion codes**.
Zero extra code on our side — Stripe Checkout will show an "Add promotion
code" link in its UI when we pass `allow_promotion_codes: true`.

### How it works
1. **Coupon** (backend object): defines the discount mechanics
   (`percent_off: 100, duration: forever` for a free-forever code).
2. **Promotion code** (customer-facing): the actual string a user types
   ("FAMILY", "EARLYBIRD", "REACHSCREENS"). Each promo code is bound to
   one coupon.
3. Stripe verifies the code at checkout, applies the discount, and the
   subscription stores it. For 100%-off-forever, the user goes through
   the full checkout flow (we still need a card on file as planned),
   but every monthly invoice is $0. They never get charged.

### To create one (when ready, in Stripe Dashboard)
- **Products → Coupons → New coupon**
  - Name: e.g. "Free access"
  - Type: Percentage discount → **100%**
  - Duration: **Forever** (or Repeating for "free for X months", or Once)
  - Optional: max redemptions, expiration date
- **Products → Coupons → (your coupon) → Add promotion code**
  - Code: e.g. `FAMILY` (case-insensitive)
  - Optional: limit to N redemptions, restrict to first-time customers,
    or scope to a specific Stripe customer (so only one person can use it).

### Code change required (one line)
In `src/app/api/stripe/checkout/route.ts`, when creating the Checkout
Session, set:
```ts
allow_promotion_codes: true,
```
That makes the "Add promotion code" link appear in the Stripe Checkout
UI. User types the code, Stripe handles the rest.

### Variants worth knowing
- **Free forever**: `percent_off: 100, duration: forever`
- **First N months free**: `percent_off: 100, duration: repeating, duration_in_months: N`
- **One month free** (sweetener for paid users): `duration: once`
- **% discount**: e.g. `percent_off: 50, duration: forever` for a "friends and family" half-off code
- **Fixed amount off**: `amount_off: 200, currency: cad` knocks $2 off (for a ~50% off effective)

### Caveats / things to think about
- A 100%-forever code is effectively "free account creation by code."
  Limit redemptions or scope to a known email so it can't be shared
  publicly (otherwise anyone with the code gets free access).
- For your own grandfathering, two equally-good options:
  - **Promo code path**: create a one-redemption code, use it once at
    signup → cleaner, all state in Stripe.
  - **`is_grandfathered` flag** in the `subscriptions` table → simpler,
    no Stripe footprint at all, you skip the trial entirely.
- Promo codes don't extend the trial — they apply a discount on top of
  the regular schedule. With 100%-off-forever, the "trial" is moot since
  the user is never billed anyway.
- If you later want to revoke a code's free access for a specific user
  (rare), you'd swap their subscription's coupon via the Stripe API. Not
  needed for v1.

### What I'll wire up when keys land
- Add `allow_promotion_codes: true` to the Checkout Session.
- That's it for v1. Code creation/management stays in the Stripe
  Dashboard so you can spin up codes for friends/promos without
  touching the codebase.

## Estimated build time
3–4 hours focused, after Stripe keys land. Promo code support adds
~5 minutes (one-line change above).
