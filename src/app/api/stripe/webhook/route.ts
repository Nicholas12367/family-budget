import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe, STRIPE_WEBHOOK_SECRET } from "@/lib/stripe";
import {
  findUserIdByCustomerId,
  setSubForUser,
  type SubscriptionState,
} from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function statusOf(s: Stripe.Subscription): SubscriptionState["status"] {
  return s.status as SubscriptionState["status"];
}

function snapshot(sub: Stripe.Subscription): Partial<SubscriptionState> {
  // current_period_end moved to items.data[0] in newer SDK types but
  // remains at the top level on older API versions. Read both safely.
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  const itemEnd = sub.items?.data?.[0] && (sub.items.data[0] as unknown as {
    current_period_end?: number;
  }).current_period_end;
  return {
    subscription_id: sub.id,
    status: statusOf(sub),
    current_period_end: top ?? itemEnd ?? undefined,
    cancel_at_period_end: sub.cancel_at_period_end,
    trial_end: sub.trial_end ?? null,
  };
}

export async function POST(req: NextRequest) {
  if (!STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json(
      { error: "STRIPE_WEBHOOK_SECRET missing" },
      { status: 500 }
    );
  }

  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return NextResponse.json(
      { error: `Signature verification failed: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.client_reference_id;
        if (!userId) {
          // No reference — nothing to wire up.
          break;
        }
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (!customerId || !subscriptionId) break;

        // Tag the Stripe customer with our user_id so future events can
        // map back even if our local index gets out of sync.
        await stripe().customers.update(customerId, {
          metadata: { supabase_user_id: userId },
        });

        const sub = await stripe().subscriptions.retrieve(subscriptionId);
        await setSubForUser(userId, {
          customer_id: customerId,
          ...snapshot(sub),
        });
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        let userId = await findUserIdByCustomerId(customerId);
        if (!userId) {
          // Fall back to the customer's metadata
          const customer = await stripe().customers.retrieve(customerId);
          if (
            customer &&
            !("deleted" in customer && customer.deleted) &&
            customer.metadata?.supabase_user_id
          ) {
            userId = customer.metadata.supabase_user_id as string;
          }
        }
        if (!userId) break;
        await setSubForUser(userId, {
          customer_id: customerId,
          ...snapshot(sub),
        });
        break;
      }

      case "invoice.payment_failed":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        // The `subscription` field is at the top level on older API
        // versions and on `parent.subscription_details` on newer ones.
        const rawSub =
          (invoice as unknown as { subscription?: string | { id: string } })
            .subscription ??
          (invoice as unknown as {
            parent?: { subscription_details?: { subscription?: string } };
          }).parent?.subscription_details?.subscription;
        const subscriptionId =
          typeof rawSub === "string" ? rawSub : rawSub?.id;
        if (!subscriptionId) break;
        const sub = await stripe().subscriptions.retrieve(subscriptionId);
        const customerId =
          typeof sub.customer === "string" ? sub.customer : sub.customer.id;
        const userId =
          (await findUserIdByCustomerId(customerId)) ??
          (() => {
            // try metadata fallback inline
            return null;
          })();
        let resolved = userId;
        if (!resolved) {
          const customer = await stripe().customers.retrieve(customerId);
          if (
            customer &&
            !("deleted" in customer && customer.deleted) &&
            customer.metadata?.supabase_user_id
          ) {
            resolved = customer.metadata.supabase_user_id as string;
          }
        }
        if (!resolved) break;
        await setSubForUser(resolved, {
          customer_id: customerId,
          ...snapshot(sub),
        });
        break;
      }

      default:
        // Ignore other events.
        break;
    }
  } catch (err) {
    // Don't 500 — Stripe will retry indefinitely. Log and 200.
    console.error("Stripe webhook handler error:", err);
  }

  return NextResponse.json({ received: true });
}
