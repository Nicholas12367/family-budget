import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { setSubForUser, isAllowed } from "@/lib/subscription";

export const dynamic = "force-dynamic";

// Stripe redirects here after a successful checkout. The webhook MAY
// not have run yet, so we eagerly fetch the subscription using the
// session ID from the URL and write it to the user's metadata before
// rendering — that way the user lands on the dashboard with their
// subscription already active instead of bouncing back to /billing.
export default async function BillingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ cs?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const sessionId = params.cs;

  if (sessionId && !isAllowed(user)) {
    try {
      const session = await stripe().checkout.sessions.retrieve(sessionId, {
        expand: ["subscription", "customer"],
      });
      const customerId =
        typeof session.customer === "string"
          ? session.customer
          : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      const ref = session.client_reference_id ?? user.id;

      if (customerId && subscriptionId && ref === user.id) {
        await stripe().customers.update(customerId, {
          metadata: { supabase_user_id: user.id },
        });
        const sub = await stripe().subscriptions.retrieve(subscriptionId);
        const top = (sub as unknown as { current_period_end?: number })
          .current_period_end;
        const itemEnd =
          sub.items?.data?.[0] &&
          (sub.items.data[0] as unknown as {
            current_period_end?: number;
          }).current_period_end;
        await setSubForUser(user.id, {
          customer_id: customerId,
          subscription_id: sub.id,
          status: sub.status as "trialing" | "active",
          current_period_end: top ?? itemEnd ?? undefined,
          cancel_at_period_end: sub.cancel_at_period_end,
          trial_end: sub.trial_end ?? null,
        });
      }
    } catch {
      // If retrieval fails, just show the manual link below.
    }
  }

  return (
    <div
      className="max-w-md mx-auto px-4 pb-12 space-y-5"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 4rem)" }}
    >
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-emerald-100 p-6 text-center space-y-3">
        <div className="w-14 h-14 mx-auto rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12l5 5L20 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-extrabold">You&apos;re in!</h1>
        <p className="text-sm text-gray-600">
          Your 7-day free trial just started. You won&apos;t be charged until
          day 8 — cancel any time from <b>Settings → Subscription</b> before
          then and there&apos;s no charge.
        </p>
        <Link
          href="/"
          className="inline-flex w-full justify-center px-4 py-3 rounded-xl bg-emerald-500 text-white font-semibold hover:bg-emerald-600"
        >
          Go to dashboard
        </Link>
      </div>
    </div>
  );
}
