import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/stripe";
import { loadAdminData, type AdminUserRow, type AdminStatus } from "@/lib/admin";
import PushSubscribe from "@/components/PushSubscribe";

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

export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
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

  const sp = (await searchParams) ?? {};
  const q = (sp.q ?? "").trim().toLowerCase();

  const { stats, rows: allRows } = await loadAdminData();
  const rows = q
    ? allRows.filter(
        (r) =>
          r.email.toLowerCase().includes(q) ||
          (r.promo_code ?? "").toLowerCase().includes(q)
      )
    : allRows;
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
  const suspended = rows.filter((r) => r.is_suspended);

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

      {/* Sub-page nav */}
      <nav className="flex flex-wrap gap-2 text-sm">
        <span className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold">
          Users
        </span>
        <Link
          href="/nicholas-x7k2qz9j/codes"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          Promo codes
        </Link>
        <Link
          href="/nicholas-x7k2qz9j/system"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          System health
        </Link>
        <Link
          href="/nicholas-x7k2qz9j/feedback"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          Feedback
        </Link>
        <Link
          href="/nicholas-x7k2qz9j/broadcast"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          Broadcast
        </Link>
      </nav>

      {/* Owner push notifications — enable once per device to get pings on
          new signups, cancellations, payment failures, and bug reports. */}
      <PushSubscribe />

      {/* Top stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
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
        <Stat
          label="Free via promo"
          value={stats.users_with_promo.toString()}
          sub={
            stats.users_with_promo === 0
              ? "no codes redeemed"
              : "active promo redemptions"
          }
          tone="violet"
        />
        <Stat
          label="Scans today"
          value={stats.scans_today.toString()}
          sub={
            stats.scans_today_errors > 0
              ? `${stats.scans_today_errors} errors`
              : "Gemini receipt scans"
          }
          tone={stats.scans_today > 1000 ? "rose" : "emerald"}
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

      {/* Search */}
      <form
        action="/nicholas-x7k2qz9j"
        method="get"
        className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-3 flex gap-2 items-center"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by email or promo code…"
          className="flex-1 px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
        />
        <button
          type="submit"
          className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
        >
          Search
        </button>
        {q && (
          <Link
            href="/nicholas-x7k2qz9j"
            className="px-3 py-2 rounded-lg bg-white ring-1 ring-gray-200 text-sm hover:bg-gray-50"
          >
            Clear
          </Link>
        )}
      </form>

      {/* Suspended (call out — these are blocked from logging in) */}
      {suspended.length > 0 && (
        <UserTable
          title={`Suspended — ${suspended.length}`}
          subtitle="Blocked from logging in. Click a row to unsuspend."
          rows={suspended}
          tone="amber"
        />
      )}

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
        Data refreshes on every load. Click any user row to drill in.
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

        {/* Mobile: card stack. Each row is a card with stacked key/value
            so emails don't wrap into a column-shaped pile. Desktop keeps
            the table at md+. */}
        <div className="md:hidden space-y-2">
          {rows.length === 0 ? (
            <p className="py-6 text-sm text-gray-500 text-center">
              Nobody here yet.
            </p>
          ) : (
            rows.map((r) => {
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
                <Link
                  key={r.user_id}
                  href={`/nicholas-x7k2qz9j/users/${r.user_id}`}
                  className="block rounded-xl ring-1 ring-gray-100 hover:ring-emerald-200 hover:bg-emerald-50/30 active:bg-emerald-50/50 p-3 transition"
                >
                  {/* Top row: email + status pill + suspended/promo */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <p className="text-sm font-semibold text-emerald-700 break-all flex-1 min-w-0">
                      {r.email || (
                        <span className="text-gray-400">no email</span>
                      )}
                    </p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 shrink-0 ${pill.cls}`}
                    >
                      {pill.label}
                    </span>
                  </div>
                  {(r.is_suspended || r.promo_code) && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {r.is_suspended && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 ring-1 ring-amber-300">
                          SUSPENDED
                        </span>
                      )}
                      {r.promo_code && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-800 ring-1 ring-violet-200">
                          PROMO: {r.promo_code}
                        </span>
                      )}
                    </div>
                  )}
                  {/* Key/value grid — 2 columns on mobile */}
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                    <div className="flex flex-col">
                      <dt className="text-[10px] uppercase tracking-wide text-gray-500">
                        Signed up
                      </dt>
                      <dd className="tabular-nums text-gray-700">
                        {fmtDate(r.created_at)}
                      </dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="text-[10px] uppercase tracking-wide text-gray-500">
                        {r.status === "trialing"
                          ? "Trial"
                          : r.status === "active"
                            ? "Next charge"
                            : "Status"}
                      </dt>
                      <dd className="text-gray-700">{dateField}</dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="text-[10px] uppercase tracking-wide text-gray-500">
                        Total paid
                      </dt>
                      <dd className="tabular-nums font-semibold text-gray-900">
                        {r.total_paid_cents > 0
                          ? fmtMoney(r.total_paid_cents, stats.currency)
                          : "—"}
                      </dd>
                    </div>
                    <div className="flex flex-col">
                      <dt className="text-[10px] uppercase tracking-wide text-gray-500">
                        Scans 30d
                      </dt>
                      <dd className="tabular-nums text-gray-700">
                        {r.scans_30d > 0 ? (
                          <>
                            {r.scans_30d}
                            {r.scans_30d_errors > 0 && (
                              <span className="text-amber-700">
                                {" "}
                                ({r.scans_30d_errors} err)
                              </span>
                            )}
                          </>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                  </dl>
                </Link>
              );
            })
          )}
        </div>

        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                <th className="py-2 font-semibold">Email</th>
                <th className="py-2 font-semibold">Status</th>
                <th className="py-2 font-semibold">Promo</th>
                <th className="py-2 font-semibold">Signed up</th>
                <th className="py-2 font-semibold">Trial / next charge</th>
                <th className="py-2 font-semibold text-right">Total paid</th>
                <th className="py-2 font-semibold text-right">Scans 30d</th>
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
                  <tr
                    key={r.user_id}
                    className="border-b last:border-0 hover:bg-gray-50"
                  >
                    <td className="py-2 pr-4 font-medium break-all">
                      <Link
                        href={`/nicholas-x7k2qz9j/users/${r.user_id}`}
                        className="text-emerald-700 hover:underline"
                      >
                        {r.email || (
                          <span className="text-gray-400">no email</span>
                        )}
                      </Link>
                      {r.is_suspended && (
                        <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-900 ring-1 ring-amber-300">
                          SUSPENDED
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${pill.cls}`}
                      >
                        {pill.label}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      {r.promo_code ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 bg-violet-100 text-violet-800 ring-violet-200">
                          {r.promo_code}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
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
                    <td className="py-2 tabular-nums text-right text-gray-600">
                      {r.scans_30d > 0 ? (
                        <span>
                          {r.scans_30d}
                          {r.scans_30d_errors > 0 && (
                            <span className="text-amber-700">
                              {" "}
                              ({r.scans_30d_errors} err)
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
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
