import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "@/components/SettingsClient";
import PeopleManager from "@/components/PeopleManager";
import { listPeople } from "@/app/actions/people";
import { readSub, isAllowed } from "@/lib/subscription";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: categories = [] },
    { data: expenses = [] },
    { data: fixedCosts = [] },
    { data: budgets = [] },
    people,
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name"),
    supabase.from("expenses").select("*").eq("user_id", user.id),
    supabase.from("fixed_costs").select("*").eq("user_id", user.id),
    supabase.from("budgets").select("*").eq("user_id", user.id),
    listPeople().catch(() => []),
  ]);

  return (
    <div
      className="max-w-3xl mx-auto px-4 pb-6 space-y-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
    >
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 text-emerald-700 text-sm font-semibold hover:bg-gray-50"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M11 6l-6 6 6 6" />
          </svg>
          Back to dashboard
        </Link>
        <h1 className="text-xl font-bold">Settings</h1>
        <span />
      </div>
      <SubscriptionCard user={user} />
      <PeopleManager initial={people} />
      <SettingsClient
        email={user.email ?? ""}
        snapshot={{
          categories: categories ?? [],
          expenses: expenses ?? [],
          fixedCosts: fixedCosts ?? [],
          budgets: budgets ?? [],
        }}
      />
      <div className="pt-2 pb-8 flex justify-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600"
        >
          Done — back to dashboard
        </Link>
      </div>
    </div>
  );
}

function SubscriptionCard({
  user,
}: {
  user: { email?: string | null; user_metadata?: Record<string, unknown> };
}) {
  const sub = readSub(user as Parameters<typeof readSub>[0]);
  const allowed = isAllowed(user as Parameters<typeof isAllowed>[0]);
  const fmtDate = (s?: number | null) =>
    s ? new Date(s * 1000).toLocaleDateString() : "—";
  const label =
    sub.is_grandfathered || (user.email && user.email.toLowerCase() === "nicholas_connelly@icloud.com")
      ? "Free (grandfathered)"
      : sub.status === "trialing"
        ? `Free trial — ends ${fmtDate(sub.trial_end)}`
        : sub.status === "active"
          ? `Active — next charge ${fmtDate(sub.current_period_end)}`
          : sub.status === "past_due" || sub.status === "unpaid"
            ? "Payment failed — please update card"
            : sub.status === "canceled"
              ? "Canceled"
              : "Not started";
  return (
    <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h2 className="font-semibold">Subscription</h2>
      <p
        className={`text-sm font-semibold ${
          allowed ? "text-emerald-700" : "text-amber-700"
        }`}
      >
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {sub.customer_id && (
          <Link
            href="/api/stripe/portal"
            className="inline-flex items-center px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 text-sm font-semibold hover:bg-emerald-100"
          >
            Manage subscription
          </Link>
        )}
        <Link
          href="/billing"
          className="inline-flex items-center px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
        >
          Billing details
        </Link>
      </div>
    </section>
  );
}
