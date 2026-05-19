import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/stripe";
import { loadSystemHealth } from "@/lib/admin";
import { SOFT_DAILY_SCAN_CAP } from "@/lib/ai/scan-log";

export const dynamic = "force-dynamic";

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : "—";

const fmtRelative = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
};

export default async function AdminSystemPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();

  const h = await loadSystemHealth();

  const errorRate7d =
    h.scans_7d > 0 ? (h.scans_7d_errors / h.scans_7d) * 100 : 0;

  const capPctToday = (h.scans_today / SOFT_DAILY_SCAN_CAP) * 100;
  const capTone =
    h.scans_today >= SOFT_DAILY_SCAN_CAP
      ? "rose"
      : h.scans_today > SOFT_DAILY_SCAN_CAP * 0.7
        ? "amber"
        : "emerald";

  const maxDayCount = Math.max(
    ...h.scans_per_day_30d.map((d) => d.count),
    1
  );

  return (
    <div
      className="max-w-5xl mx-auto px-4 pb-16 space-y-6"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
    >
      <div className="flex items-center gap-3">
        <Link
          href="/nicholas-x7k2qz9j"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 text-emerald-700 text-sm font-semibold hover:bg-gray-50"
        >
          ← Admin
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">
            System health
          </h1>
          <p className="text-xs text-gray-500">
            Gemini receipt scans, webhook freshness, and recent admin actions.
          </p>
        </div>
      </div>

      <nav className="flex flex-wrap gap-2 text-sm">
        <Link
          href="/nicholas-x7k2qz9j"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          Users
        </Link>
        <Link
          href="/nicholas-x7k2qz9j/codes"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          Promo codes
        </Link>
        <span className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold">
          System health
        </span>
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

      {/* Quota banner */}
      <div
        className={`rounded-2xl p-4 ring-1 ${
          capTone === "rose"
            ? "bg-rose-50 ring-rose-200 text-rose-900"
            : capTone === "amber"
              ? "bg-amber-50 ring-amber-200 text-amber-900"
              : "bg-emerald-50 ring-emerald-200 text-emerald-900"
        }`}
      >
        <p className="text-sm font-semibold">
          {capTone === "rose"
            ? "Daily scan cap reached"
            : capTone === "amber"
              ? "Approaching daily scan cap"
              : "Gemini quota: healthy"}
        </p>
        <p className="text-xs mt-0.5">
          {h.scans_today} / {SOFT_DAILY_SCAN_CAP} scans today (
          {capPctToday.toFixed(1)}%). Google's free-tier ceiling is 1500/day —
          we soft-block at {SOFT_DAILY_SCAN_CAP} so users see a friendly
          message instead of a hard 429.
        </p>
        <div className="mt-2 h-2 rounded-full bg-white/60 overflow-hidden ring-1 ring-black/5">
          <div
            className={`h-full ${
              capTone === "rose"
                ? "bg-rose-500"
                : capTone === "amber"
                  ? "bg-amber-500"
                  : "bg-emerald-500"
            }`}
            style={{ width: `${Math.min(100, capPctToday)}%` }}
          />
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat
          label="Scans today"
          value={h.scans_today.toString()}
          sub={`${h.scans_today_errors} errors`}
        />
        <Stat
          label="Scans 7d"
          value={h.scans_7d.toString()}
          sub={`${errorRate7d.toFixed(1)}% error rate`}
        />
        <Stat
          label="Scans 30d"
          value={h.scans_30d.toString()}
          sub={`${h.scans_30d_errors} errors`}
        />
        <Stat
          label="p95 latency 7d"
          value={h.scans_p95_ms_7d != null ? `${h.scans_p95_ms_7d} ms` : "—"}
          sub="Gemini round-trip"
        />
      </div>

      {/* Scans per day chart */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-3">
        <h2 className="font-semibold">Scans per day (last 30)</h2>
        <div className="space-y-1">
          {h.scans_per_day_30d.map((d) => {
            const pct = (d.count / maxDayCount) * 100;
            const overCap = d.count >= SOFT_DAILY_SCAN_CAP;
            return (
              <div key={d.day} className="flex items-center gap-3">
                <span className="text-[11px] text-gray-500 w-16 shrink-0 tabular-nums">
                  {d.day.slice(5)}
                </span>
                <div className="flex-1 h-4 rounded-full bg-emerald-50 overflow-hidden ring-1 ring-emerald-100">
                  <div
                    className={`h-full ${
                      overCap
                        ? "bg-rose-500"
                        : d.errors > 0
                          ? "bg-amber-500"
                          : "bg-emerald-500"
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="text-xs tabular-nums w-20 text-right shrink-0 text-gray-600">
                  {d.count}
                  {d.errors > 0 && (
                    <span className="text-amber-700"> ({d.errors})</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Errors by code */}
      {h.errors_by_code_7d.length > 0 && (
        <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-3">
          <h2 className="font-semibold">Errors by code (last 7d)</h2>
          <div className="space-y-2">
            {h.errors_by_code_7d.map((e) => (
              <div
                key={e.code}
                className="flex items-center justify-between text-sm"
              >
                <code className="font-mono text-gray-700">{e.code}</code>
                <span className="tabular-nums font-semibold text-amber-800">
                  {e.count}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Webhook freshness */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-2">
        <h2 className="font-semibold">Stripe webhook freshness</h2>
        <p className="text-sm text-gray-700">
          Last invoice seen by Stripe:{" "}
          <span className="font-semibold">
            {fmtRelative(h.last_webhook_seen_at)}
          </span>{" "}
          <span className="text-xs text-gray-500">
            ({fmtDate(h.last_webhook_seen_at)})
          </span>
        </p>
        <p className="text-xs text-gray-500">
          If this stops moving, the Stripe webhook may be broken or no
          invoices are flowing.
        </p>
      </section>

      {/* Audit log */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 space-y-3">
        <h2 className="font-semibold">Recent admin actions</h2>
        {h.recent_audit.length === 0 ? (
          <p className="text-sm text-gray-500">No admin actions yet.</p>
        ) : (
          <>
            {/* Mobile: card stack */}
            <div className="md:hidden space-y-2">
              {h.recent_audit.map((a) => (
                <div
                  key={a.id}
                  className="rounded-xl ring-1 ring-gray-100 p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 bg-amber-100 text-amber-900 ring-amber-300 shrink-0">
                      {a.action}
                    </span>
                    <span className="text-[11px] text-gray-500 tabular-nums">
                      {fmtDate(a.created_at)}
                    </span>
                  </div>
                  <div className="text-xs space-y-1">
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">
                        Actor
                      </span>
                      <span className="text-gray-800 break-all">
                        {a.actor_email}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wide text-gray-500">
                        Target
                      </span>
                      <span className="text-gray-800 break-all">
                        {a.target_email || a.target_user_id || "—"}
                      </span>
                    </div>
                    {(a.details?.reason as string) && (
                      <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wide text-gray-500">
                          Reason
                        </span>
                        <span className="text-gray-700 break-words">
                          {a.details?.reason as string}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                    <th className="py-2 font-semibold">When</th>
                    <th className="py-2 font-semibold">Actor</th>
                    <th className="py-2 font-semibold">Action</th>
                    <th className="py-2 font-semibold">Target</th>
                    <th className="py-2 font-semibold">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {h.recent_audit.map((a) => (
                    <tr key={a.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-gray-600 tabular-nums">
                        {fmtDate(a.created_at)}
                      </td>
                      <td className="py-2 pr-4 break-all">{a.actor_email}</td>
                      <td className="py-2 pr-4">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 bg-amber-100 text-amber-900 ring-amber-300">
                          {a.action}
                        </span>
                      </td>
                      <td className="py-2 pr-4 break-all">
                        {a.target_email || a.target_user_id || "—"}
                      </td>
                      <td className="py-2 text-gray-600 break-all">
                        {(a.details?.reason as string) ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* External links */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 space-y-2">
        <h2 className="font-semibold">External dashboards</h2>
        <div className="flex flex-wrap gap-2 text-sm">
          <a
            href="https://dashboard.stripe.com"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
          >
            Stripe ↗
          </a>
          <a
            href="https://supabase.com/dashboard"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
          >
            Supabase ↗
          </a>
          <a
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
            className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
          >
            Google AI Studio (Gemini quota) ↗
          </a>
        </div>
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-emerald-50 ring-1 ring-emerald-100 rounded-2xl p-4">
      <p className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold">
        {label}
      </p>
      <p className="text-2xl font-extrabold tabular-nums mt-1 text-emerald-900">
        {value}
      </p>
      {sub && <p className="text-[11px] text-emerald-700 mt-0.5">{sub}</p>}
    </div>
  );
}
