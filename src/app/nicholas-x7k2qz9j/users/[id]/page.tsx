import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/stripe";
import { loadUserDetail, type AdminStatus } from "@/lib/admin";
import { adminSuspendUser, adminUnsuspendUser } from "@/app/actions/admin";
import { listMessagesForUser } from "@/app/actions/messages";
import DeleteUserButton from "@/components/DeleteUserButton";
import AdminMessageForm from "@/components/AdminMessageForm";

export const dynamic = "force-dynamic";

const fmtMoney = (cents: number, currency = "cad") =>
  new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);

const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : "—";

const fmtUnix = (ts: number | null | undefined) =>
  ts ? new Date(ts * 1000).toLocaleString() : "—";

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

export default async function AdminUserPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();

  const detail = await loadUserDetail(id);
  if (!detail) notFound();

  const messages = await listMessagesForUser(id).catch(() => []);

  const pill = STATUS_PILL[detail.status] ?? STATUS_PILL.none;

  // Wrappers so we can pass server actions to a <form action={...}>.
  // Each reads the reason from FormData and forwards to the action.
  async function suspendAction(formData: FormData) {
    "use server";
    const reason = (formData.get("reason") as string | null) ?? "";
    await adminSuspendUser(id, reason);
  }
  async function unsuspendAction(formData: FormData) {
    "use server";
    const reason = (formData.get("reason") as string | null) ?? "";
    await adminUnsuspendUser(id, reason);
  }

  return (
    <div
      className="max-w-3xl mx-auto px-4 pb-16 space-y-6"
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
          <h1 className="text-2xl font-extrabold tracking-tight break-all">
            {detail.email || "(no email)"}
          </h1>
          <p className="text-xs text-gray-500">
            User ID: <code className="font-mono">{detail.user_id}</code>
          </p>
        </div>
      </div>

      {/* Status row */}
      <div className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${pill.cls}`}
          >
            {pill.label}
          </span>
          {detail.is_grandfathered && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 bg-violet-100 text-violet-800 ring-violet-200">
              Grandfathered
            </span>
          )}
          {detail.promo_code && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 bg-violet-100 text-violet-800 ring-violet-200">
              Promo: {detail.promo_code}
              {detail.discount_pct ? ` (${detail.discount_pct}% off)` : ""}
            </span>
          )}
          {detail.is_suspended && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ring-1 bg-amber-100 text-amber-900 ring-amber-300">
              SUSPENDED
            </span>
          )}
          {detail.cancel_at_period_end && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 bg-amber-50 text-amber-800 ring-amber-200">
              Cancels at period end
            </span>
          )}
        </div>

        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <DetailRow label="Signed up" value={fmtDate(detail.created_at)} />
          <DetailRow
            label="Trial ends"
            value={fmtUnix(detail.trial_end)}
          />
          <DetailRow
            label="Next charge / period end"
            value={fmtUnix(detail.current_period_end)}
          />
          <DetailRow
            label="Lifetime spend"
            value={fmtMoney(detail.total_paid_cents)}
          />
          <DetailRow
            label="Last payment"
            value={fmtUnix(detail.last_payment_at)}
          />
          <DetailRow
            label="Banned until"
            value={detail.banned_until ?? "—"}
          />
        </dl>

        {detail.customer_id && (
          <div className="flex flex-wrap gap-2 text-xs">
            <a
              href={`https://dashboard.stripe.com/customers/${detail.customer_id}`}
              target="_blank"
              rel="noreferrer"
              className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
            >
              Stripe customer ↗
            </a>
            {detail.subscription_id && (
              <a
                href={`https://dashboard.stripe.com/subscriptions/${detail.subscription_id}`}
                target="_blank"
                rel="noreferrer"
                className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
              >
                Stripe subscription ↗
              </a>
            )}
          </div>
        )}
      </div>

      {/* Activity */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-3">
        <h2 className="font-semibold">Activity</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat
            label="Expenses"
            value={detail.expenses_count.toString()}
            sub={fmtMoney(detail.expenses_total_cents)}
          />
          <Stat
            label="Receipts saved"
            value={detail.receipt_batches_count.toString()}
          />
          <Stat
            label="Categories"
            value={detail.categories_count.toString()}
          />
          <Stat
            label="Scans 30d"
            value={detail.scans_30d.toString()}
            sub={
              detail.scans_30d_errors > 0
                ? `${detail.scans_30d_errors} errors`
                : "all ok"
            }
          />
        </div>
        <p className="text-xs text-gray-500">
          Last activity: {fmtDate(detail.last_activity_at)}
        </p>
      </section>

      {/* Direct message */}
      <AdminMessageForm
        userId={detail.user_id}
        email={detail.email ?? ""}
        initialMessages={messages}
      />

      {/* Recent scans */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 space-y-3">
        <h2 className="font-semibold">Recent receipt scans</h2>
        {detail.recent_scans.length === 0 ? (
          <p className="text-sm text-gray-500">No scans yet.</p>
        ) : (
          <>
            {/* Mobile: card stack */}
            <div className="md:hidden space-y-2">
              {detail.recent_scans.map((s) => (
                <div
                  key={s.id}
                  className="rounded-xl ring-1 ring-gray-100 p-3 space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 shrink-0 ${
                        s.status === "ok"
                          ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                          : "bg-amber-100 text-amber-900 ring-amber-300"
                      }`}
                    >
                      {s.status}
                    </span>
                    <span className="text-[11px] text-gray-500 tabular-nums">
                      {fmtDate(s.created_at)}
                    </span>
                  </div>
                  <div className="text-xs text-gray-600">
                    Duration:{" "}
                    <span className="tabular-nums">
                      {s.duration_ms != null ? `${s.duration_ms} ms` : "—"}
                    </span>
                  </div>
                  {s.error_code && (
                    <div className="text-xs text-amber-800 break-words">
                      <span className="font-semibold">{s.error_code}</span>
                      {s.error_message && `: ${s.error_message}`}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto -mx-4 px-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b">
                    <th className="py-2 font-semibold">When</th>
                    <th className="py-2 font-semibold">Status</th>
                    <th className="py-2 font-semibold text-right">Duration</th>
                    <th className="py-2 font-semibold">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recent_scans.map((s) => (
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 text-gray-600 tabular-nums">
                        {fmtDate(s.created_at)}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${
                            s.status === "ok"
                              ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                              : "bg-amber-100 text-amber-900 ring-amber-300"
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right tabular-nums text-gray-600">
                        {s.duration_ms != null ? `${s.duration_ms} ms` : "—"}
                      </td>
                      <td className="py-2 text-xs text-gray-500 break-all">
                        {s.error_code
                          ? `${s.error_code}${
                              s.error_message ? `: ${s.error_message}` : ""
                            }`
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* Actions */}
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-amber-200 p-5 space-y-3">
        <h2 className="font-semibold">Actions</h2>
        <p className="text-xs text-gray-500">
          {detail.is_suspended
            ? "This account is currently suspended. Lifting the ban lets them log back in."
            : "Suspending blocks them from logging in. Reversible. Their data is preserved either way."}
        </p>
        <form
          action={detail.is_suspended ? unsuspendAction : suspendAction}
          className="flex flex-col sm:flex-row gap-2"
        >
          <input
            name="reason"
            placeholder="Reason (optional, logged for the audit trail)"
            className="flex-1 px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
          />
          <button
            type="submit"
            className={`px-4 py-2 rounded-lg text-white text-sm font-semibold ${
              detail.is_suspended
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-amber-600 hover:bg-amber-700"
            }`}
          >
            {detail.is_suspended ? "Unsuspend" : "Suspend"}
          </button>
        </form>

        {/* Hard-delete option — only for inactive accounts. Refuses to render
            for active/trialing/past_due or grandfathered users. */}
        {!detail.is_grandfathered &&
          (detail.status === "canceled" ||
            detail.status === "incomplete_expired" ||
            detail.status === "incomplete" ||
            detail.status === "none") && (
            <div className="pt-3 border-t border-amber-200/60">
              <p className="text-xs text-gray-500 mb-2">
                Account is inactive. You can permanently delete it (cascades
                their Supabase data). Stripe customer is preserved.
              </p>
              <DeleteUserButton
                userId={detail.user_id}
                email={detail.email}
              />
            </div>
          )}
      </section>
    </div>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col">
      <dt className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
        {label}
      </dt>
      <dd className="text-sm text-gray-900 tabular-nums">{value}</dd>
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
    <div className="bg-emerald-50 ring-1 ring-emerald-100 rounded-xl p-3">
      <p className="text-[11px] uppercase tracking-wide text-emerald-700 font-semibold">
        {label}
      </p>
      <p className="text-xl font-bold tabular-nums mt-1 text-emerald-900">
        {value}
      </p>
      {sub && <p className="text-[11px] text-emerald-700 mt-0.5">{sub}</p>}
    </div>
  );
}
