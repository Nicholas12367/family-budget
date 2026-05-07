import "server-only";
import type Stripe from "stripe";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { stripe, GRANDFATHERED_EMAILS } from "./stripe";
import type { SubscriptionState } from "./subscription";

export type AdminStatus =
  | NonNullable<SubscriptionState["status"]>
  | "none"
  | "grandfathered";

export type AdminUserRow = {
  user_id: string;
  email: string;
  created_at: string;
  is_grandfathered: boolean;
  status: AdminStatus;
  trial_end: number | null;
  current_period_end: number | null;
  cancel_at_period_end: boolean;
  customer_id: string | null;
  subscription_id: string | null;
  total_paid_cents: number;
  last_payment_at: number | null;
};

export type AdminStats = {
  total_users: number;
  paying_users: number;
  trialing_users: number;
  past_due_users: number;
  canceled_users: number;
  free_users: number;
  mrr_cents: number;
  revenue_this_month_cents: number;
  revenue_all_time_cents: number;
  revenue_by_month: { month: string; cents: number }[];
  signups_by_month: { month: string; count: number }[];
  currency: string;
};

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin creds missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

async function fetchAllSupabaseUsers(): Promise<User[]> {
  const supa = adminClient();
  const all: User[] = [];
  let page = 1;
  while (page < 50) {
    const { data, error } = await supa.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) throw error;
    const users = data?.users ?? [];
    if (!users.length) break;
    all.push(...users);
    if (users.length < 1000) break;
    page++;
  }
  return all;
}

async function fetchAllStripeSubscriptions(): Promise<Stripe.Subscription[]> {
  const all: Stripe.Subscription[] = [];
  let starting_after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await stripe().subscriptions.list({
      status: "all",
      limit: 100,
      ...(starting_after ? { starting_after } : {}),
    });
    all.push(...page.data);
    if (!page.has_more || !page.data.length) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return all;
}

async function fetchAllPaidInvoices(): Promise<Stripe.Invoice[]> {
  const all: Stripe.Invoice[] = [];
  let starting_after: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await stripe().invoices.list({
      status: "paid",
      limit: 100,
      ...(starting_after ? { starting_after } : {}),
    });
    all.push(...page.data);
    if (!page.has_more || !page.data.length) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return all;
}

function monthKey(ts: number): string {
  // ts is unix seconds. Format as YYYY-MM.
  const d = new Date(ts * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function thisMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// Pull MRR from one subscription. Assumes all priced items are recurring;
// normalizes to monthly cents.
function mrrFor(sub: Stripe.Subscription): number {
  if (sub.status !== "active" && sub.status !== "trialing") return 0;
  // Trialing subs aren't paying yet — count as MRR potential, not actual.
  // For "MRR" we only count active.
  if (sub.status !== "active") return 0;
  let cents = 0;
  for (const item of sub.items?.data ?? []) {
    const price = item.price;
    if (!price?.recurring || !price.unit_amount) continue;
    const qty = item.quantity ?? 1;
    const monthly = (() => {
      const interval = price.recurring.interval;
      const count = price.recurring.interval_count ?? 1;
      const unit = price.unit_amount * qty;
      switch (interval) {
        case "day":
          return (unit / count) * 30;
        case "week":
          return (unit / count) * (52 / 12);
        case "month":
          return unit / count;
        case "year":
          return unit / count / 12;
        default:
          return unit;
      }
    })();
    cents += monthly;
  }
  return Math.round(cents);
}

export async function loadAdminData(): Promise<{
  stats: AdminStats;
  rows: AdminUserRow[];
}> {
  const [users, subs, invoices] = await Promise.all([
    fetchAllSupabaseUsers(),
    fetchAllStripeSubscriptions().catch(() => [] as Stripe.Subscription[]),
    fetchAllPaidInvoices().catch(() => [] as Stripe.Invoice[]),
  ]);

  // Map Stripe customer_id → most recent subscription (any status).
  const subByCustomer = new Map<string, Stripe.Subscription>();
  for (const s of subs) {
    const cid = typeof s.customer === "string" ? s.customer : s.customer.id;
    const existing = subByCustomer.get(cid);
    if (!existing || s.created > existing.created) {
      subByCustomer.set(cid, s);
    }
  }

  // Index invoices by customer for total paid lookup.
  const invByCustomer = new Map<string, Stripe.Invoice[]>();
  for (const inv of invoices) {
    const cid = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
    if (!cid) continue;
    const arr = invByCustomer.get(cid) ?? [];
    arr.push(inv);
    invByCustomer.set(cid, arr);
  }

  const currency = invoices[0]?.currency ?? "cad";

  const rows: AdminUserRow[] = users.map((u) => {
    const meta = u.user_metadata as { subscription?: SubscriptionState };
    const sub = meta?.subscription ?? {};
    const email = (u.email ?? "").toLowerCase();
    const isGrand =
      sub.is_grandfathered ?? GRANDFATHERED_EMAILS.has(email);
    let status: AdminStatus = sub.status ?? "none";
    if (isGrand && (status === "none" || !sub.status)) {
      status = "grandfathered";
    }

    // Reconcile with the live Stripe subscription if we have a customer_id.
    let stripeSub: Stripe.Subscription | undefined;
    if (sub.customer_id) {
      stripeSub = subByCustomer.get(sub.customer_id);
      if (stripeSub) {
        status = stripeSub.status as AdminStatus;
      }
    }

    const customerInvoices = sub.customer_id
      ? invByCustomer.get(sub.customer_id) ?? []
      : [];
    const total_paid_cents = customerInvoices.reduce(
      (s, inv) => s + (inv.amount_paid ?? 0),
      0
    );
    const last_payment_at = customerInvoices.reduce(
      (latest, inv) =>
        inv.status_transitions?.paid_at &&
        (latest === null || inv.status_transitions.paid_at > latest)
          ? inv.status_transitions.paid_at
          : latest,
      null as number | null
    );

    return {
      user_id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      is_grandfathered: isGrand,
      status,
      trial_end:
        (stripeSub?.trial_end ?? sub.trial_end ?? null) || null,
      current_period_end:
        (stripeSub &&
          ((stripeSub as unknown as { current_period_end?: number })
            .current_period_end ??
            (stripeSub.items?.data?.[0] as unknown as {
              current_period_end?: number;
            })?.current_period_end)) ??
        sub.current_period_end ??
        null,
      cancel_at_period_end:
        stripeSub?.cancel_at_period_end ?? sub.cancel_at_period_end ?? false,
      customer_id: sub.customer_id ?? null,
      subscription_id: sub.subscription_id ?? null,
      total_paid_cents,
      last_payment_at,
    };
  });

  // Stats
  const paying_users = rows.filter((r) => r.status === "active").length;
  const trialing_users = rows.filter((r) => r.status === "trialing").length;
  const past_due_users = rows.filter(
    (r) => r.status === "past_due" || r.status === "unpaid"
  ).length;
  const canceled_users = rows.filter(
    (r) => r.status === "canceled" || r.status === "incomplete_expired"
  ).length;
  const free_users = rows.filter(
    (r) => r.is_grandfathered || r.status === "none" || r.status === "grandfathered"
  ).length;

  // MRR from live subscriptions
  const mrr_cents = subs.reduce((s, sub) => s + mrrFor(sub), 0);

  // Revenue by month (paid invoices)
  const revenueByMonth = new Map<string, number>();
  for (const inv of invoices) {
    const ts = inv.status_transitions?.paid_at ?? inv.created;
    const k = monthKey(ts);
    revenueByMonth.set(k, (revenueByMonth.get(k) ?? 0) + (inv.amount_paid ?? 0));
  }
  const sortedMonths = [...revenueByMonth.keys()].sort();
  const revenue_by_month = sortedMonths.map((month) => ({
    month,
    cents: revenueByMonth.get(month) ?? 0,
  }));

  const tm = thisMonthKey();
  const revenue_this_month_cents = revenueByMonth.get(tm) ?? 0;
  const revenue_all_time_cents = invoices.reduce(
    (s, inv) => s + (inv.amount_paid ?? 0),
    0
  );

  // Signups by month (Supabase auth.users.created_at)
  const signupsByMonth = new Map<string, number>();
  for (const u of users) {
    if (!u.created_at) continue;
    const ts = Math.floor(new Date(u.created_at).getTime() / 1000);
    const k = monthKey(ts);
    signupsByMonth.set(k, (signupsByMonth.get(k) ?? 0) + 1);
  }
  const signupMonths = [...signupsByMonth.keys()].sort();
  const signups_by_month = signupMonths.map((month) => ({
    month,
    count: signupsByMonth.get(month) ?? 0,
  }));

  const stats: AdminStats = {
    total_users: users.length,
    paying_users,
    trialing_users,
    past_due_users,
    canceled_users,
    free_users,
    mrr_cents,
    revenue_this_month_cents,
    revenue_all_time_cents,
    revenue_by_month,
    signups_by_month,
    currency,
  };

  // Sort rows: paying first, then trialing, then past_due, then everyone else, by created_at desc.
  const order = (s: AdminStatus) =>
    s === "active"
      ? 0
      : s === "trialing"
        ? 1
        : s === "past_due" || s === "unpaid"
          ? 2
          : s === "grandfathered"
            ? 3
            : s === "none"
              ? 4
              : 5;
  rows.sort((a, b) => {
    const o = order(a.status) - order(b.status);
    if (o !== 0) return o;
    return (b.created_at ?? "").localeCompare(a.created_at ?? "");
  });

  return { stats, rows };
}
