import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/stripe";
import { loadAdminData, loadPromoCodes } from "@/lib/admin";

export const dynamic = "force-dynamic";

const fmtUnix = (ts: number | null | undefined) =>
  ts ? new Date(ts * 1000).toLocaleDateString() : "—";

export default async function AdminCodesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();

  const [codes, { rows }] = await Promise.all([
    loadPromoCodes(),
    loadAdminData(),
  ]);

  // Group user rows by promo code (only those that currently have a code).
  const usersByCode = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!r.promo_code) continue;
    const arr = usersByCode.get(r.promo_code) ?? [];
    arr.push(r);
    usersByCode.set(r.promo_code, arr);
  }

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
            Promo codes
          </h1>
          <p className="text-xs text-gray-500">
            Live from Stripe. Create or edit codes in the{" "}
            <a
              href="https://dashboard.stripe.com/promotion-codes"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Stripe dashboard
            </a>
            .
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
        <span className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold">
          Promo codes
        </span>
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

      {/* Codes table */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 space-y-3">
        <h2 className="font-semibold">All codes</h2>
        {codes.length === 0 ? (
          <p className="text-sm text-gray-500">
            No promotion codes found in Stripe (or Stripe is not reachable).
          </p>
        ) : (
          <>
            {/* Mobile: card stack */}
            <div className="md:hidden space-y-2">
              {codes.map((c) => {
                const usersOnCode = usersByCode.get(c.code) ?? [];
                return (
                  <div
                    key={c.id}
                    className="rounded-xl ring-1 ring-gray-100 p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <a
                        href={`https://dashboard.stripe.com/promotion-codes/${c.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-mono text-sm font-semibold text-emerald-700 hover:underline break-all"
                      >
                        {c.code}
                      </a>
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 shrink-0 ${
                          c.active
                            ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                            : "bg-gray-100 text-gray-700 ring-gray-200"
                        }`}
                      >
                        {c.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                      <div className="flex flex-col">
                        <dt className="text-[10px] uppercase tracking-wide text-gray-500">
                          Discount
                        </dt>
                        <dd className="tabular-nums text-gray-900 font-semibold">
                          {c.percent_off != null
                            ? `${c.percent_off}% off`
                            : c.amount_off_cents != null
                              ? `$${(c.amount_off_cents / 100).toFixed(2)} off`
                              : "—"}
                        </dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-[10px] uppercase tracking-wide text-gray-500">
                          Duration
                        </dt>
                        <dd className="text-gray-700">{c.duration ?? "—"}</dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-[10px] uppercase tracking-wide text-gray-500">
                          Redemptions
                        </dt>
                        <dd className="tabular-nums text-gray-700">
                          {c.times_redeemed}
                          {c.max_redemptions != null
                            ? ` / ${c.max_redemptions}`
                            : " / ∞"}
                          {usersOnCode.length > 0 && (
                            <span className="text-gray-500">
                              {" "}
                              · {usersOnCode.length} active
                            </span>
                          )}
                        </dd>
                      </div>
                      <div className="flex flex-col">
                        <dt className="text-[10px] uppercase tracking-wide text-gray-500">
                          Expires
                        </dt>
                        <dd className="text-gray-700">
                          {fmtUnix(c.expires_at)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                );
              })}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                    <th className="py-2 font-semibold">Code</th>
                    <th className="py-2 font-semibold">Discount</th>
                    <th className="py-2 font-semibold">Duration</th>
                    <th className="py-2 font-semibold text-right">Redemptions</th>
                    <th className="py-2 font-semibold text-right">Cap</th>
                    <th className="py-2 font-semibold">Expires</th>
                    <th className="py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {codes.map((c) => {
                    const usersOnCode = usersByCode.get(c.code) ?? [];
                    return (
                      <tr key={c.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">
                          <a
                            href={`https://dashboard.stripe.com/promotion-codes/${c.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-emerald-700 hover:underline"
                          >
                            {c.code}
                          </a>
                          {usersOnCode.length > 0 && (
                            <span className="ml-2 text-xs text-gray-500">
                              ({usersOnCode.length} active)
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 tabular-nums">
                          {c.percent_off != null
                            ? `${c.percent_off}% off`
                            : c.amount_off_cents != null
                              ? `$${(c.amount_off_cents / 100).toFixed(2)} off`
                              : "—"}
                        </td>
                        <td className="py-2 pr-4 text-gray-600">
                          {c.duration ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {c.times_redeemed}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums text-gray-600">
                          {c.max_redemptions ?? "∞"}
                        </td>
                        <td className="py-2 pr-4 text-gray-600">
                          {fmtUnix(c.expires_at)}
                        </td>
                        <td className="py-2">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${
                              c.active
                                ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                                : "bg-gray-100 text-gray-700 ring-gray-200"
                            }`}
                          >
                            {c.active ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Per-code user lists */}
      {[...usersByCode.entries()].map(([code, users]) => (
        <section
          key={code}
          className="bg-white rounded-2xl shadow-sm ring-1 ring-violet-200 p-4 space-y-3"
        >
          <div>
            <h2 className="font-semibold">
              Users on{" "}
              <span className="font-mono text-violet-800">{code}</span> —{" "}
              {users.length}
            </h2>
            <p className="text-xs text-gray-500">
              Subscribers whose current Stripe subscription has this promo
              attached.
            </p>
          </div>
          {/* Mobile: card stack */}
          <div className="md:hidden space-y-2">
            {users.map((r) => (
              <Link
                key={r.user_id}
                href={`/nicholas-x7k2qz9j/users/${r.user_id}`}
                className="block rounded-xl ring-1 ring-gray-100 hover:ring-emerald-200 p-3"
              >
                <p className="text-sm font-semibold text-emerald-700 break-all">
                  {r.email}
                </p>
                <p className="text-xs text-gray-600 mt-1">
                  {r.status} ·{" "}
                  {r.created_at
                    ? new Date(r.created_at).toLocaleDateString()
                    : "—"}
                </p>
              </Link>
            ))}
          </div>

          {/* Desktop table */}
          <div className="hidden md:block overflow-x-auto -mx-4 px-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                  <th className="py-2 font-semibold">Email</th>
                  <th className="py-2 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Signed up</th>
                </tr>
              </thead>
              <tbody>
                {users.map((r) => (
                  <tr key={r.user_id} className="border-b last:border-0 hover:bg-gray-50">
                    <td className="py-2 pr-4 font-medium break-all">
                      <Link
                        href={`/nicholas-x7k2qz9j/users/${r.user_id}`}
                        className="text-emerald-700 hover:underline"
                      >
                        {r.email}
                      </Link>
                    </td>
                    <td className="py-2 pr-4 text-gray-600">{r.status}</td>
                    <td className="py-2 text-gray-600 tabular-nums">
                      {r.created_at
                        ? new Date(r.created_at).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
