import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAllowed, readSub } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const sub = readSub(user);
  const allowed = isAllowed(user);

  const statusLabel: Record<string, string> = {
    active: "Active",
    trialing: "On free trial",
    past_due: "Payment failed — please update card",
    canceled: "Canceled",
    unpaid: "Unpaid — please update card",
    incomplete: "Incomplete — please complete checkout",
    incomplete_expired: "Expired — please re-subscribe",
  };
  const tone = allowed
    ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
    : "bg-amber-50 text-amber-800 ring-amber-200";
  const fmtDate = (s?: number | null) =>
    s ? new Date(s * 1000).toLocaleDateString() : "—";

  return (
    <div
      className="max-w-xl mx-auto px-4 pb-12 space-y-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
    >
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 text-emerald-700 text-sm font-semibold hover:bg-gray-50"
        >
          ← Back
        </Link>
        <h1 className="text-xl font-bold ml-1">Subscription</h1>
      </div>

      {params.error === "no_subscription" && (
        <p className="bg-amber-50 ring-1 ring-amber-200 text-amber-800 rounded-xl p-3 text-sm">
          You don&apos;t have an active subscription yet. Start a 7-day free
          trial below.
        </p>
      )}

      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
            Plan
          </p>
          <p className="text-2xl font-extrabold">Budget App — $4 / month CAD</p>
          <p className="text-sm text-gray-500 mt-1">
            Receipt scanning, budgets, push notifications, household tracking.
          </p>
        </div>

        <div
          className={`px-3 py-2 rounded-xl text-sm font-semibold ring-1 ${tone}`}
        >
          Status: {sub.status ? statusLabel[sub.status] ?? sub.status : "Not started"}
          {sub.is_grandfathered && " (Grandfathered free)"}
        </div>

        {sub.status && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            {sub.trial_end && sub.status === "trialing" && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  Trial ends
                </p>
                <p className="font-semibold">{fmtDate(sub.trial_end)}</p>
              </div>
            )}
            {sub.current_period_end && (
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  {sub.cancel_at_period_end ? "Access until" : "Next charge"}
                </p>
                <p className="font-semibold">
                  {fmtDate(sub.current_period_end)}
                </p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2 pt-2">
          {!allowed && (
            <Link
              href="/api/stripe/checkout-redirect"
              className="inline-flex items-center px-4 py-2.5 rounded-xl bg-emerald-500 text-white font-semibold text-sm hover:bg-emerald-600"
            >
              Start 7-day free trial
            </Link>
          )}
          {sub.customer_id && (
            <Link
              href="/api/stripe/portal"
              className="inline-flex items-center px-4 py-2.5 rounded-xl bg-white text-emerald-700 ring-1 ring-emerald-200 font-semibold text-sm hover:bg-emerald-50"
            >
              Manage subscription
            </Link>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-2 text-sm text-gray-600">
        <p className="font-semibold text-gray-900">What you get</p>
        <ul className="list-disc ml-5 space-y-1">
          <li>7 days free, then $4/month CAD. Cancel anytime.</li>
          <li>Card required upfront — first charge fires on day 8.</li>
          <li>Cancel from this screen any time before that and you won&apos;t be charged.</li>
          <li>If your card fails, access is paused until you update it.</li>
        </ul>
      </div>

      <form action="/auth/signout" method="post" className="pt-2 text-center">
        <button className="text-xs text-gray-500 hover:text-gray-900 underline">
          Log out
        </button>
      </form>
    </div>
  );
}
