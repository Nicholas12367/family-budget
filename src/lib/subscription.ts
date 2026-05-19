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

  // Mirror the customer_id into the lookup table so the webhook can
  // resolve user_id in O(1) instead of paging through all auth.users.
  if (next.customer_id) {
    try {
      await supa
        .from("stripe_customer_map")
        .upsert(
          { user_id: userId, customer_id: next.customer_id },
          { onConflict: "user_id" }
        );
    } catch (e) {
      // Table may not exist yet (migration not run). Don't break sub updates.
      console.error("[stripe_customer_map] upsert failed:", e);
    }
  }

  return next;
}

// Look up Supabase user id by Stripe customer id. Fast path uses the
// `stripe_customer_map` table (O(1) indexed lookup). Falls back to the
// legacy O(n) page walk through auth.users if the map is missing the row
// (e.g. an old user who signed up before the map existed).
export async function findUserIdByCustomerId(
  customerId: string
): Promise<string | null> {
  const supa = adminClient();

  // Fast path.
  try {
    const { data, error } = await supa
      .from("stripe_customer_map")
      .select("user_id")
      .eq("customer_id", customerId)
      .maybeSingle();
    if (!error && data?.user_id) return data.user_id;
  } catch {
    // Table may not exist yet — fall through to slow path.
  }

  // Slow fallback: walk auth.users metadata. Lazily backfills the map.
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
      if (sub?.customer_id === customerId) {
        // Backfill so future lookups are O(1).
        try {
          await supa
            .from("stripe_customer_map")
            .upsert(
              { user_id: u.id, customer_id: customerId },
              { onConflict: "user_id" }
            );
        } catch {
          // Non-fatal.
        }
        return u.id;
      }
    }
    if (users.length < 1000) return null;
    page++;
  }
  return null;
}
