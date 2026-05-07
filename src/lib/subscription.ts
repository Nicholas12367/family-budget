import "server-only";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { ACTIVE_STATUSES, GRANDFATHERED_EMAILS } from "./stripe";

// Subscription state stored on auth.users.user_metadata.subscription —
// avoids having to add another Supabase table. Read by middleware and
// the /billing page; written only by the Stripe webhook handler via
// the service-role admin client.
export type SubscriptionState = {
  customer_id?: string;
  subscription_id?: string;
  status?:
    | "active"
    | "trialing"
    | "past_due"
    | "canceled"
    | "unpaid"
    | "incomplete"
    | "incomplete_expired";
  current_period_end?: number; // unix seconds
  cancel_at_period_end?: boolean;
  trial_end?: number | null;
  is_grandfathered?: boolean;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin creds missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export function readSub(user: User | null | undefined): SubscriptionState {
  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const sub = meta?.subscription as SubscriptionState | undefined;
  return sub ?? {};
}

export function isAllowed(user: User | null | undefined): boolean {
  if (!user) return false;
  if (user.email && GRANDFATHERED_EMAILS.has(user.email.toLowerCase())) {
    return true;
  }
  const sub = readSub(user);
  if (sub.is_grandfathered) return true;
  if (sub.status && ACTIVE_STATUSES.has(sub.status)) return true;
  return false;
}

export async function setSubForUser(
  userId: string,
  patch: Partial<SubscriptionState>
) {
  const supa = adminClient();
  const { data: existingUser } = await supa.auth.admin.getUserById(userId);
  const prev =
    (existingUser?.user?.user_metadata as { subscription?: SubscriptionState })
      ?.subscription ?? {};
  const next: SubscriptionState = { ...prev, ...patch };
  await supa.auth.admin.updateUserById(userId, {
    user_metadata: {
      ...(existingUser?.user?.user_metadata ?? {}),
      subscription: next,
    },
  });
  return next;
}

// Look up Supabase user id by Stripe customer id, by walking auth.users
// pages and reading the customer_id we stored in user_metadata. There's
// no built-in index, but the user count in this app is small. For
// scale we'd add a `stripe_customers` Supabase table; not worth it yet.
export async function findUserIdByCustomerId(
  customerId: string
): Promise<string | null> {
  const supa = adminClient();
  let page = 1;
  while (page < 50) {
    const { data, error } = await supa.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const users = data?.users ?? [];
    if (!users.length) return null;
    for (const u of users) {
      const sub = (u.user_metadata as { subscription?: SubscriptionState })
        ?.subscription;
      if (sub?.customer_id === customerId) return u.id;
    }
    if (users.length < 1000) return null;
    page++;
  }
  return null;
}
