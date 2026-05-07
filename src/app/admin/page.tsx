import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/stripe";
import { loadAdminData, type AdminUserRow, type AdminStatus } from "@/lib/admin";

export const dynamic = "force-dynamic";

const fmtMoney = (cents: number, currency = "cad") =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString() : "—";

const fmtUnix = (ts: number | null | undefined) =>
  ts ? new Date(ts * 1000).toLocaleDateString() : "—";

const fmtMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, (mo ?? 1) - 1, 1)).toLocaleDateString("en-CA", {
    month: "short",
    year: "numeric",
  });
};

const STATUS_PILL: Record<
  AdminStatus,
  { label: string; cls: string }
> = {
  active: { label: "Paying", cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  trialing: { label: "Trial", cls: "bg-sky-100 text-sky-800 ring-sky-200" },
  past_due: { label: "Past due", cls: "bg-amber-100 text-amber-900 ring-amber-300" },
  unpaid: { label: "Unpaid", cls: "bg-amber-100 text-amber-900 ring-amber-300" },
  canceled: { label: "Canceled", cls: "bg-gray-100 text-gray-700 ring-gray-200" },
  incomplete: { label: "Incomplete", cls: "bg-gray-100 text-gray-700 ring-gray-200" },
  incomplete_expired: { label: "Expired", cls: "bg-gray-100 text-gray-700 ring-gray-200" },
  grandfathered: { label: "Free (owner)", cls: "bg-violet-100 text-violet-800 ring-violet-200" },
  none: { label: "No sub", cls: "bg-gray-100 text-gray-600 ring-gray-200" },
};

export default async function AdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) {
    // Owner-only — show 404 to anyone else so the page's existence isn't
    // even leaked.
    notFound();
  }

  const { stats, rows } = await loadAdminData();
  const active = rows.filter(
    (r) => r.status === "active" || r.status === "trialing"
  );
  const inactive = rows.filter(
    (r) => r.status === "canceled" || r.status === "incomplete_expired"
  );
  const free = rows.filter(
    (r) =>
      r.is_grandfathered ||
      r.status === "grandfathered" ||
      r.status === "none"
  );
  const distressed = rows.filter(
    (r) => r.status === "past_due" || r.status === "unpaid"
  );

  return (
    <div
      className="max-w-5xl mx-auto px-4 pb-16 space-y-6"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
    >
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 text-emerald-700 text-sm font-semibold hover:bg-gray-50"
        >
          ← Back
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">
            Admin dashboard
          </h1>
          <p className="text-xs text-gray-500">
            Owner-only. Live data pulled from Supabase + Stripe on each load.
          </p>
        </div>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Signups"
          value={stats.total_users.toString()}
          tone="emerald"
        />
        <Stat
          label="Paying"
          value={stats.paying_users.toString()}
          sub={`+${stats.trialing_users} on trial`}
          tone="sky"
        />
        <Stat
          label="MRR"
          value={fmtMoney(stats.mrr_cents, stats.currency)}
          sub={`${stats.paying_users} active subs`}
          tone="violet"
        />
        <Stat
          label="This month"
          value={fmtMoney(stats.revenue_this_month_cents, stats.currency)}
          sub={`${fmtMoney(stats.revenue_all_time_cents, stats.currency)} all time`}
          tone="rose"
        />
      </div>

      {/* Status breakdown */}
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
        <Mini label="Active" value={stats.paying_users} />
        <Mini label="Trialing" value={stats.trialing_users} />
        <Mini label="Past due" value={stats.past_due_users} tone="amber" />
        <Mini label="Canceled" value={stats.canceled_users} />
        <Mini label="Free / owner" value={stats.free_users} />
      </div>

      {/* Distressed accounts (call out) */}
      {distressed.length > 0 && (
        <UserTable
          title={`Needs attention — ${distressed.length}`}
          subtitle="Past due or unpaid. They've been blocked from the app until they update their card."
          rows={distressed}
          tone="amber"
        />
      )}

      {/* Active subscribers */}
      <UserTable
        title={`Active subscribers — ${active.length}`}
        subtitle="Paying clients (trial counts here too)."
        rows={active}
      />

      {/* Past clients */}
      {inactive.length > 0 && (
        <UserTable
          title={`Past clients — ${inactive.length}`}
          subtitle="Canceled or expired."
          rows={inactive}
          tone="gray"
        />
      )}

      {/* Free / owner */}
      {free.length > 0 && (
        <UserTable
          title={`Free accounts — ${free.length}`}
          subtitle="Grandfathered, signed up but no subscription, or owner."
          rows={free}
          tone="violet"
        />
      )}

      {/* Revenue by month */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-3">
        <h2 className="font-semibold">Revenue by month</h2>
        {stats.revenue_by_month.length === 0 ? (
          <p className="text-sm text-gray-500">No revenue yet.</p>
        ) : (
          <div className="space-y-2">
            {stats.revenue_by_month.slice(-12).map((row) => {
              const max = Math.max(
                ...stats.revenue_by_month.map((r) => r.cents),
                1
              );
              const pct = (row.cents / max) * 100;
              return (
                <div key={row.month} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-20 shrink-0">
                    {fmtMonth(row.month)}
                  </span>
                  <div className="flex-1 h-5 rounded-full bg-emerald-50 overflow-hidden ring-1 ring-emerald-100">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold tabular-nums w-24 text-right shrink-0">
                    {fmtMoney(row.cents, stats.currency)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Signups by month */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-3">
        <h2 className="font-semibold">Signups by month</h2>
        {stats.signups_by_month.length === 0 ? (
          <p className="text-sm text-gray-500">No users yet.</p>
        ) : (
          <div className="space-y-2">
            {stats.signups_by_month.slice(-12).map((row) => {
              const max = Math.max(
                ...stats.signups_by_month.map((r) => r.count),
                1
              );
              const pct = (row.count / max) * 100;
              return (
                <div key={row.month} className="flex items-center gap-3">
                  <span className="text-xs text-gray-500 w-20 shrink-0">
                    {fmtMonth(row.month)}
                  </span>
                  <div className="flex-1 h-5 rounded-full bg-sky-50 overflow-hidden ring-1 ring-sky-100">
                    <div
                      className="h-full bg-sky-500"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-sm font-semibold tabular-nums w-12 text-right shrink-0">
                    {row.count}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-gray-400 text-center pt-2">
        Data refreshes on every load. Stripe links open the live dashboard.
      </p>
    </div>
  );

  function Stat({
    label,
    value,
    sub,
    tone,
  }: {
    label: string;
    value: string;
    sub?: string;
    tone: "emerald" | "sky" | "violet" | "rose";
  }) {
    const map = {
      emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
      sky: "bg-sky-50 text-sky-700 ring-sky-100",
      violet: "bg-violet-50 text-violet-700 ring-violet-100",
      rose: "bg-rose-50 text-rose-700 ring-rose-100",
    } as const;
    return (
      <div className={`${map[tone]} rounded-2xl p-4 ring-1`}>
        <p className="text-[11px] uppercase tracking-wide font-semibold">
          {label}
        </p>
        <p className="text-2xl font-extrabold tabular-nums mt-1">{value}</p>
        {sub && <p className="text-[11px] mt-0.5 opacity-80">{sub}</p>}
      </div>
    );
  }

  function Mini({
    label,
    value,
    tone,
  }: {
    label: string;
    value: number;
    tone?: "amber";
  }) {
    return (
      <div>
        <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
          {label}
        </p>
        <p
          className={`text-xl font-bold tabular-nums ${
            tone === "amber" ? "text-amber-700" : "text-gray-900"
          }`}
        >
          {value}
        </p>
      </div>
    );
  }

  function UserTable({
    title,
    subtitle,
    rows,
    tone,
  }: {
    title: string;
    subtitle: string;
    rows: AdminUserRow[];
    tone?: "amber" | "gray" | "violet";
  }) {
    const ringClass =
      tone === "amber"
        ? "ring-amber-200"
        : tone === "violet"
          ? "ring-violet-200"
          : "ring-gray-100";
    return (
      <section
        className={`bg-white rounded-2xl shadow-sm ring-1 ${ringClass} p-4 space-y-3`}
      >
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                <th className="py-2 font-semibold">Email</th>
                <th className="py-2 font-semibold">Status</th>
                <th className="py-2 font-semibold">Signed up</th>
                <th className="py-2 font-semibold">Trial / next charge</th>
                <th className="py-2 font-semibold text-right">Total paid</th>
                <th className="py-2 font-semibold">Stripe</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const pill = STATUS_PILL[r.status] ?? STATUS_PILL.none;
                const dateField =
                  r.status === "trialing"
                    ? `Trial ends ${fmtUnix(r.trial_end)}`
                    : r.status === "active"
                      ? r.cancel_at_period_end
                        ? `Ends ${fmtUnix(r.current_period_end)}`
                        : `Renews ${fmtUnix(r.current_period_end)}`
                      : r.status === "canceled"
                        ? "Canceled"
                        : "—";
                return (
                  <tr key={r.user_id} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-medium break-all">
                      {r.email || <span className="text-gray-400">no email</span>}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${pill.cls}`}
                      >
                        {pill.label}
                      </span>
                    </td>
                    <td className="py-2 pr-4 tabular-nums text-gray-600">
                      {fmtDate(r.created_at)}
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{dateField}</td>
                    <td className="py-2 pr-4 tabular-nums text-right">
                      {r.total_paid_cents > 0
                        ? fmtMoney(r.total_paid_cents, stats.currency)
                        : "—"}
                    </td>
                    <td className="py-2">
                      {r.customer_id ? (
                        <a
                          href={`https://dashboard.stripe.com/customers/${r.customer_id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-emerald-700 underline"
                        >
                          customer ↗
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-6 text-sm text-gray-500 text-center"
                  >
                    Nobody here yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  }
}
