import "server-only";
import type Stripe from "stripe";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import type { User } from "@supabase/supabase-js";
import { stripe, GRANDFATHERED_EMAILS, STRIPE_PRICE_ID } from "./stripe";
import type { SubscriptionState } from "./subscription";

// Pulls the price id off a Stripe invoice line item. Stripe has moved this
// field around between API versions; check both shapes.
function lineItemPriceId(line: Stripe.InvoiceLineItem): string | null {
  const a = (line as unknown as { price?: string | { id?: string } | null }).price;
  if (typeof a === "string") return a;
  if (a && typeof a === "object" && a.id) return a.id;
  const b = (line as unknown as {
    pricing?: { price_details?: { price?: string } };
  }).pricing?.price_details?.price;
  return typeof b === "string" ? b : null;
}

// True if any line item references the budget-app price. Used to scope
// revenue numbers so unrelated products in the same Stripe account don't
// pollute the dashboard.
function invoiceMatchesBudgetApp(inv: Stripe.Invoice): boolean {
  if (!STRIPE_PRICE_ID) return true;
  const lines = inv.lines?.data ?? [];
  return lines.some((line) => lineItemPriceId(line) === STRIPE_PRICE_ID);
}

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
  // Promo code applied to current Stripe subscription, if any.
  promo_code: string | null;
  discount_pct: number | null;
  discount_amount_off_cents: number | null;
  // Supabase ban state — true if banned_until is in the future.
  is_suspended: boolean;
  banned_until: string | null;
  // Scan activity from gemini_scan_log.
  scans_30d: number;
  scans_30d_errors: number;
};

export type AdminStats = {
  total_users: number;
  paying_users: number;
  trialing_users: number;
  past_due_users: number;
  canceled_users: number;
  free_users: number;
  users_with_promo: number;
  scans_today: number;
  scans_today_errors: number;
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
      // Scope to the budget-app price so other products in the same Stripe
      // account don't show up as "users" or contribute to MRR.
      ...(STRIPE_PRICE_ID ? { price: STRIPE_PRICE_ID } : {}),
      expand: [
        "data.discount.promotion_code",
        "data.discount.coupon",
      ],
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
    // Filter in-memory to invoices that include the budget-app price.
    // Stripe doesn't support filtering invoices.list by price directly.
    for (const inv of page.data) {
      if (invoiceMatchesBudgetApp(inv)) all.push(inv);
    }
    if (!page.has_more || !page.data.length) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return all;
}

// Pulls scan counts per user for the last 30 days, plus today's totals.
async function fetchScanStats(): Promise<{
  perUser: Map<string, { total: number; errors: number }>;
  scansToday: number;
  scansTodayErrors: number;
}> {
  const supa = adminClient();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sinceToday = startOfToday.toISOString();

  const { data, error } = await supa
    .from("gemini_scan_log")
    .select("user_id, status, created_at")
    .gte("created_at", since30)
    .limit(50000);

  const perUser = new Map<string, { total: number; errors: number }>();
  let scansToday = 0;
  let scansTodayErrors = 0;

  if (error || !data) {
    // Table may not exist yet (migration not run). Return empty stats.
    return { perUser, scansToday, scansTodayErrors };
  }

  for (const row of data as Array<{
    user_id: string | null;
    status: string;
    created_at: string;
  }>) {
    const uid = row.user_id ?? "";
    const isError = row.status !== "ok";
    const cur = perUser.get(uid) ?? { total: 0, errors: 0 };
    cur.total += 1;
    if (isError) cur.errors += 1;
    perUser.set(uid, cur);
    if (row.created_at >= sinceToday) {
      scansToday += 1;
      if (isError) scansTodayErrors += 1;
    }
  }

  return { perUser, scansToday, scansTodayErrors };
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
// normalizes to monthly cents. Only counts items on the budget-app price
// so a subscription with extra add-ons doesn't pull in unrelated revenue.
function mrrFor(sub: Stripe.Subscription): number {
  if (sub.status !== "active" && sub.status !== "trialing") return 0;
  // Trialing subs aren't paying yet — count as MRR potential, not actual.
  // For "MRR" we only count active.
  if (sub.status !== "active") return 0;
  let cents = 0;
  for (const item of sub.items?.data ?? []) {
    const price = item.price;
    if (!price?.recurring || !price.unit_amount) continue;
    if (STRIPE_PRICE_ID && price.id !== STRIPE_PRICE_ID) continue;
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

// Extract promo code + discount info from a Stripe subscription's discount.
// Cast through a structural shape so we don't depend on Stripe SDK type
// changes (the `discount` field has moved between versions).
type LooseDiscount = {
  coupon?: {
    percent_off?: number | null;
    amount_off?: number | null;
  } | null;
  promotion_code?: string | { code?: string } | null;
};
function extractDiscount(sub: Stripe.Subscription): {
  promo_code: string | null;
  discount_pct: number | null;
  discount_amount_off_cents: number | null;
} {
  const subAny = sub as unknown as {
    discount?: LooseDiscount | null;
    discounts?: LooseDiscount[] | null;
  };
  const discount =
    subAny.discount ??
    (subAny.discounts && subAny.discounts.length > 0
      ? subAny.discounts[0]
      : null);
  if (!discount) {
    return {
      promo_code: null,
      discount_pct: null,
      discount_amount_off_cents: null,
    };
  }
  const promo = discount.promotion_code;
  const code =
    typeof promo === "string"
      ? null
      : promo?.code ?? null;
  const coupon = discount.coupon ?? null;
  return {
    promo_code: code,
    discount_pct: coupon?.percent_off ?? null,
    discount_amount_off_cents: coupon?.amount_off ?? null,
  };
}

// Read the Supabase ban state from a User. The supabase-js types don't
// always include banned_until; cast to read it safely.
function readBan(u: User): { banned_until: string | null; suspended: boolean } {
  const banned = (u as unknown as { banned_until?: string | null })
    .banned_until ?? null;
  if (!banned) return { banned_until: null, suspended: false };
  // Supabase sometimes uses the string "none" for cleared bans.
  if (banned === "none") return { banned_until: null, suspended: false };
  const t = new Date(banned).getTime();
  if (!Number.isFinite(t)) return { banned_until: banned, suspended: false };
  return { banned_until: banned, suspended: t > Date.now() };
}

export async function loadAdminData(): Promise<{
  stats: AdminStats;
  rows: AdminUserRow[];
}> {
  const [users, subs, invoices, scanStats] = await Promise.all([
    fetchAllSupabaseUsers(),
    fetchAllStripeSubscriptions().catch(() => [] as Stripe.Subscription[]),
    fetchAllPaidInvoices().catch(() => [] as Stripe.Invoice[]),
    fetchScanStats(),
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

    const discount = stripeSub
      ? extractDiscount(stripeSub)
      : {
          promo_code: null,
          discount_pct: null,
          discount_amount_off_cents: null,
        };

    const ban = readBan(u);

    const userScans = scanStats.perUser.get(u.id) ?? { total: 0, errors: 0 };

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
      promo_code: discount.promo_code,
      discount_pct: discount.discount_pct,
      discount_amount_off_cents: discount.discount_amount_off_cents,
      is_suspended: ban.suspended,
      banned_until: ban.banned_until,
      scans_30d: userScans.total,
      scans_30d_errors: userScans.errors,
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
  const users_with_promo = rows.filter((r) => !!r.promo_code).length;

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
    users_with_promo,
    scans_today: scanStats.scansToday,
    scans_today_errors: scanStats.scansTodayErrors,
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

// Per-user detail loader for the drill-down page.
export type AdminUserDetail = AdminUserRow & {
  expenses_count: number;
  expenses_total_cents: number;
  receipt_batches_count: number;
  categories_count: number;
  last_activity_at: string | null;
  recent_scans: Array<{
    id: number;
    created_at: string;
    status: string;
    duration_ms: number | null;
    error_code: string | null;
    error_message: string | null;
  }>;
};

export async function loadUserDetail(
  userId: string
): Promise<AdminUserDetail | null> {
  const { rows } = await loadAdminData();
  const base = rows.find((r) => r.user_id === userId);
  if (!base) return null;

  const supa = adminClient();
  const [expenses, batches, cats, recent] = await Promise.all([
    supa
      .from("expenses")
      .select("amount, created_at", { count: "exact" })
      .eq("user_id", userId),
    supa
      .from("receipt_batches")
      .select("scanned_at", { count: "exact" })
      .eq("user_id", userId),
    supa
      .from("categories")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
    supa
      .from("gemini_scan_log")
      .select("id, created_at, status, duration_ms, error_code, error_message")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const expensesRows = (expenses.data ?? []) as Array<{
    amount: number;
    created_at: string;
  }>;
  const batchesRows = (batches.data ?? []) as Array<{
    scanned_at: string | null;
  }>;
  const recentRows = (recent.data ?? []) as Array<{
    id: number;
    created_at: string;
    status: string;
    duration_ms: number | null;
    error_code: string | null;
    error_message: string | null;
  }>;

  const expenses_total_cents = Math.round(
    expensesRows.reduce((s, e) => s + (Number(e.amount) || 0), 0) * 100
  );

  const lastExpense = expensesRows.reduce<string | null>(
    (latest, e) =>
      e.created_at && (!latest || e.created_at > latest) ? e.created_at : latest,
    null
  );
  const lastBatch = batchesRows.reduce<string | null>(
    (latest, b) =>
      b.scanned_at && (!latest || b.scanned_at > latest) ? b.scanned_at : latest,
    null
  );
  const lastScan = recentRows[0]?.created_at ?? null;
  const last_activity_at =
    [lastExpense, lastBatch, lastScan]
      .filter((x): x is string => !!x)
      .sort()
      .pop() ?? null;

  return {
    ...base,
    expenses_count: expenses.count ?? expensesRows.length,
    expenses_total_cents,
    receipt_batches_count: batches.count ?? batchesRows.length,
    categories_count: cats.count ?? 0,
    last_activity_at,
    recent_scans: recentRows,
  };
}

// System health data for /admin/system.
export type AdminSystemHealth = {
  scans_today: number;
  scans_today_errors: number;
  scans_7d: number;
  scans_7d_errors: number;
  scans_30d: number;
  scans_30d_errors: number;
  scans_p95_ms_7d: number | null;
  scans_per_day_30d: { day: string; count: number; errors: number }[];
  errors_by_code_7d: { code: string; count: number }[];
  last_webhook_seen_at: string | null;
  recent_audit: Array<{
    id: number;
    actor_email: string;
    target_user_id: string | null;
    target_email: string | null;
    action: string;
    created_at: string;
    details: Record<string, unknown> | null;
  }>;
};

export async function loadSystemHealth(): Promise<AdminSystemHealth> {
  const supa = adminClient();
  const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const sinceToday = startOfToday.toISOString();

  const [scansRes, auditRes] = await Promise.all([
    supa
      .from("gemini_scan_log")
      .select("created_at, status, duration_ms, error_code")
      .gte("created_at", since30)
      .limit(50000),
    supa
      .from("admin_audit_log")
      .select(
        "id, actor_email, target_user_id, target_email, action, details, created_at"
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  type ScanRow = {
    created_at: string;
    status: string;
    duration_ms: number | null;
    error_code: string | null;
  };
  const scans: ScanRow[] = (scansRes.data ?? []) as ScanRow[];

  let scans_today = 0;
  let scans_today_errors = 0;
  let scans_7d = 0;
  let scans_7d_errors = 0;
  let scans_30d = 0;
  let scans_30d_errors = 0;

  const perDay = new Map<string, { count: number; errors: number }>();
  const errorsByCode = new Map<string, number>();
  const durations7d: number[] = [];

  for (const s of scans) {
    const isError = s.status !== "ok";
    scans_30d += 1;
    if (isError) scans_30d_errors += 1;
    if (s.created_at >= since7) {
      scans_7d += 1;
      if (isError) scans_7d_errors += 1;
      if (s.duration_ms != null) durations7d.push(s.duration_ms);
      if (isError && s.error_code) {
        errorsByCode.set(
          s.error_code,
          (errorsByCode.get(s.error_code) ?? 0) + 1
        );
      }
    }
    if (s.created_at >= sinceToday) {
      scans_today += 1;
      if (isError) scans_today_errors += 1;
    }
    const day = s.created_at.slice(0, 10);
    const cur = perDay.get(day) ?? { count: 0, errors: 0 };
    cur.count += 1;
    if (isError) cur.errors += 1;
    perDay.set(day, cur);
  }

  const scans_per_day_30d: { day: string; count: number; errors: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const cur = perDay.get(key) ?? { count: 0, errors: 0 };
    scans_per_day_30d.push({ day: key, ...cur });
  }

  let scans_p95_ms_7d: number | null = null;
  if (durations7d.length > 0) {
    durations7d.sort((a, b) => a - b);
    const idx = Math.min(
      durations7d.length - 1,
      Math.floor(durations7d.length * 0.95)
    );
    scans_p95_ms_7d = durations7d[idx];
  }

  const errors_by_code_7d = [...errorsByCode.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => b.count - a.count);

  // Webhook health proxy: most recent paid invoice or subscription update.
  // Querying user metadata isn't easy; instead we use the most recent paid
  // invoice timestamp from Stripe — if Stripe is sending events, this updates.
  let last_webhook_seen_at: string | null = null;
  try {
    const list = await stripe().invoices.list({ limit: 1 });
    const inv = list.data[0];
    if (inv?.created) {
      last_webhook_seen_at = new Date(inv.created * 1000).toISOString();
    }
  } catch {
    last_webhook_seen_at = null;
  }

  return {
    scans_today,
    scans_today_errors,
    scans_7d,
    scans_7d_errors,
    scans_30d,
    scans_30d_errors,
    scans_p95_ms_7d,
    scans_per_day_30d,
    errors_by_code_7d,
    last_webhook_seen_at,
    recent_audit: (auditRes.data ?? []) as AdminSystemHealth["recent_audit"],
  };
}

// Promo code data for /admin/codes.
export type AdminPromoCode = {
  id: string;
  code: string;
  active: boolean;
  expires_at: number | null;
  max_redemptions: number | null;
  times_redeemed: number;
  percent_off: number | null;
  amount_off_cents: number | null;
  duration: string | null;
};

export async function loadPromoCodes(): Promise<AdminPromoCode[]> {
  try {
    const list = await stripe().promotionCodes.list({ limit: 100 });
    return list.data.map((pc) => {
      // Stripe's TS types for PromotionCode have moved between SDK
      // versions; cast structurally to read the coupon fields we want.
      const coupon = (pc as unknown as {
        coupon?: {
          percent_off?: number | null;
          amount_off?: number | null;
          duration?: string | null;
        } | null;
      }).coupon ?? null;
      return {
        id: pc.id,
        code: pc.code,
        active: pc.active,
        expires_at: pc.expires_at,
        max_redemptions: pc.max_redemptions,
        times_redeemed: pc.times_redeemed,
        percent_off: coupon?.percent_off ?? null,
        amount_off_cents: coupon?.amount_off ?? null,
        duration: coupon?.duration ?? null,
      };
    });
  } catch {
    return [];
  }
}
