import "server-only";
import webpush from "web-push";
import { createClient } from "@/lib/supabase/server";

let configured = false;
function configure() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) {
    throw new Error("VAPID keys missing — push notifications disabled");
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function sendToUser(userId: string, payload: PushPayload) {
  configure();
  const supabase = await createClient();
  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);
  if (!subs?.length) return { sent: 0, removed: 0 };

  let sent = 0;
  const dead: number[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint,
            keys: { p256dh: s.p256dh, auth: s.auth },
          },
          JSON.stringify(payload)
        );
        sent++;
      } catch (err: unknown) {
        const status = (err as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) dead.push(s.id);
      }
    })
  );

  if (dead.length) {
    await supabase.from("push_subscriptions").delete().in("id", dead);
  }
  return { sent, removed: dead.length };
}

// Compute monthly spent for a category and trigger threshold notifications.
// Thresholds: 50%, 80%, 100%, 110%. Don't re-notify the same threshold twice
// per (user, category, month).
const THRESHOLDS = [50, 80, 100, 110] as const;

export async function checkBudgetThreshold(
  userId: string,
  categoryId: number,
  expenseDate: string
) {
  const supabase = await createClient();
  const d = new Date(expenseDate + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-11

  const { data: budget } = await supabase
    .from("budgets")
    .select("monthly_limit")
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .maybeSingle();
  if (!budget?.monthly_limit) return;
  const limit = Number(budget.monthly_limit);

  const startOfMonth = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
  const startOfNext = new Date(Date.UTC(year, month + 1, 1)).toISOString().slice(0, 10);
  const { data: rows } = await supabase
    .from("expenses")
    .select("amount")
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .gte("date", startOfMonth)
    .lt("date", startOfNext);

  const used = (rows ?? []).reduce((s, r) => s + Number(r.amount), 0);
  const pct = (used / limit) * 100;

  let crossed = 0;
  for (const t of THRESHOLDS) if (pct >= t) crossed = t;
  if (!crossed) return;

  const { data: state } = await supabase
    .from("budget_alert_state")
    .select("last_threshold")
    .eq("user_id", userId)
    .eq("category_id", categoryId)
    .eq("year", year)
    .eq("month", month)
    .maybeSingle();

  const last = state?.last_threshold ?? 0;
  if (crossed <= last) return;

  await supabase.from("budget_alert_state").upsert(
    {
      user_id: userId,
      category_id: categoryId,
      year,
      month,
      last_threshold: crossed,
    },
    { onConflict: "user_id,category_id,year,month" }
  );

  const { data: cat } = await supabase
    .from("categories")
    .select("name")
    .eq("id", categoryId)
    .maybeSingle();

  const catName = cat?.name ?? "category";
  const fmt = (n: number) =>
    "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  let title: string;
  let body: string;
  if (crossed >= 110) {
    title = `${catName}: way over budget`;
    body = `You've spent ${fmt(used)} of ${fmt(limit)} (${Math.round(pct)}%).`;
  } else if (crossed >= 100) {
    title = `${catName}: budget reached`;
    body = `You've hit ${fmt(used)} of ${fmt(limit)} this month.`;
  } else if (crossed >= 80) {
    title = `${catName}: 80% used`;
    body = `${fmt(used)} of ${fmt(limit)} spent — ${fmt(limit - used)} left.`;
  } else {
    title = `${catName}: halfway`;
    body = `Used ${fmt(used)} of ${fmt(limit)} this month.`;
  }

  await sendToUser(userId, { title, body, url: "/", tag: `budget-${categoryId}` });
}
