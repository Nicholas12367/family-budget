import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/stripe";
import { listFeedback } from "@/app/actions/feedback";
import FeedbackResolveButtons from "@/components/FeedbackResolveButtons";

export const dynamic = "force-dynamic";

const fmt = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString() : "—";

const CATEGORY_PILL: Record<
  string,
  { label: string; emoji: string; cls: string }
> = {
  bug: {
    label: "Bug",
    emoji: "🐛",
    cls: "bg-rose-100 text-rose-800 ring-rose-200",
  },
  feature_request: {
    label: "Feature",
    emoji: "💡",
    cls: "bg-sky-100 text-sky-800 ring-sky-200",
  },
  question: {
    label: "Question",
    emoji: "❓",
    cls: "bg-amber-100 text-amber-900 ring-amber-200",
  },
  other: {
    label: "Other",
    emoji: "📝",
    cls: "bg-gray-100 text-gray-700 ring-gray-200",
  },
};

const STATUS_PILL: Record<
  string,
  { label: string; cls: string }
> = {
  open: { label: "Open", cls: "bg-emerald-100 text-emerald-800 ring-emerald-200" },
  in_progress: {
    label: "In progress",
    cls: "bg-sky-100 text-sky-800 ring-sky-200",
  },
  resolved: {
    label: "Resolved",
    cls: "bg-gray-100 text-gray-700 ring-gray-200",
  },
  wont_fix: {
    label: "Won't fix",
    cls: "bg-gray-100 text-gray-500 ring-gray-200",
  },
};

export default async function AdminFeedbackPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();

  const items = await listFeedback({ limit: 200 }).catch(() => []);
  const open = items.filter((i) => i.status === "open");
  const inProgress = items.filter((i) => i.status === "in_progress");
  const closed = items.filter(
    (i) => i.status === "resolved" || i.status === "wont_fix"
  );

  return (
    <div
      className="max-w-4xl mx-auto px-4 pb-16 space-y-6"
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
          <h1 className="text-2xl font-extrabold tracking-tight">Feedback</h1>
          <p className="text-xs text-gray-500">
            User-submitted bug reports, feature requests, and questions.
            Auto-classified.
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
        <Link
          href="/nicholas-x7k2qz9j/system"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          System health
        </Link>
        <span className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold">
          Feedback
        </span>
        <Link
          href="/nicholas-x7k2qz9j/broadcast"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          Broadcast
        </Link>
      </nav>

      <div className="grid grid-cols-3 gap-3">
        <Counter label="Open" value={open.length} tone="emerald" />
        <Counter
          label="In progress"
          value={inProgress.length}
          tone="sky"
        />
        <Counter label="Closed" value={closed.length} tone="gray" />
      </div>

      <Section title={`Open — ${open.length}`} items={open} />
      {inProgress.length > 0 && (
        <Section
          title={`In progress — ${inProgress.length}`}
          items={inProgress}
        />
      )}
      {closed.length > 0 && (
        <Section
          title={`Closed — ${closed.length}`}
          items={closed}
          collapsible
        />
      )}
    </div>
  );
}

function Section({
  title,
  items,
  collapsible,
}: {
  title: string;
  items: Awaited<ReturnType<typeof listFeedback>>;
  collapsible?: boolean;
}) {
  if (items.length === 0) {
    return (
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4">
        <h2 className="font-semibold mb-2">{title}</h2>
        <p className="text-sm text-gray-500">Nothing here.</p>
      </section>
    );
  }
  return (
    <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 space-y-3">
      {collapsible ? (
        <details>
          <summary className="font-semibold cursor-pointer">{title}</summary>
          <div className="space-y-3 mt-3">
            {items.map((it) => (
              <FeedbackCard key={it.id} item={it} />
            ))}
          </div>
        </details>
      ) : (
        <>
          <h2 className="font-semibold">{title}</h2>
          <div className="space-y-3">
            {items.map((it) => (
              <FeedbackCard key={it.id} item={it} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function FeedbackCard({
  item,
}: {
  item: Awaited<ReturnType<typeof listFeedback>>[number];
}) {
  const cat = CATEGORY_PILL[item.category] ?? CATEGORY_PILL.other;
  const status = STATUS_PILL[item.status] ?? STATUS_PILL.open;
  return (
    <div className="border rounded-xl p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${cat.cls}`}
        >
          <span>{cat.emoji}</span>
          {cat.label}
        </span>
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1 ${status.cls}`}
        >
          {status.label}
        </span>
        <span className="text-xs text-gray-500">{fmt(item.created_at)}</span>
        {item.device_hint && (
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">
            {item.device_hint}
          </span>
        )}
        <span className="text-xs text-gray-500 ml-auto break-all">
          {item.user_email ?? "(no email)"}
        </span>
      </div>
      {item.subject && (
        <p className="font-semibold text-sm">{item.subject}</p>
      )}
      <p className="text-sm text-gray-800 whitespace-pre-wrap">{item.body}</p>
      {item.source_url && (
        <p className="text-xs text-gray-500 break-all">
          From:{" "}
          <a
            href={item.source_url}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            {item.source_url}
          </a>
        </p>
      )}
      {item.user_agent && (
        <details className="text-[11px] text-gray-500">
          <summary className="cursor-pointer">User agent</summary>
          <p className="mt-1 break-all font-mono">{item.user_agent}</p>
        </details>
      )}
      {item.resolution_note && (
        <div className="text-xs bg-emerald-50 ring-1 ring-emerald-100 rounded p-2 text-emerald-900">
          <strong>Resolution:</strong> {item.resolution_note}
          {item.resolved_at && (
            <span className="text-emerald-700">
              {" "}
              — {fmt(item.resolved_at)} by {item.resolved_by}
            </span>
          )}
        </div>
      )}
      <FeedbackResolveButtons id={item.id} status={item.status} />
    </div>
  );
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "emerald" | "sky" | "gray";
}) {
  const map = {
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
    gray: "bg-gray-50 text-gray-700 ring-gray-200",
  } as const;
  return (
    <div className={`${map[tone]} rounded-2xl p-4 ring-1`}>
      <p className="text-[11px] uppercase tracking-wide font-semibold">
        {label}
      </p>
      <p className="text-2xl font-extrabold tabular-nums mt-1">{value}</p>
    </div>
  );
}
