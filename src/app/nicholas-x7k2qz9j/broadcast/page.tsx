import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/stripe";
import BroadcastForm from "@/components/BroadcastForm";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!isAdminEmail(user.email)) notFound();

  return (
    <div
      className="max-w-2xl mx-auto px-4 pb-16 space-y-6"
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
            Broadcast to users
          </h1>
          <p className="text-xs text-gray-500">
            Send a push notification to everyone who has notifications
            enabled.
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
        <Link
          href="/nicholas-x7k2qz9j/feedback"
          className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 hover:bg-gray-50"
        >
          Feedback
        </Link>
        <span className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold">
          Broadcast
        </span>
      </nav>

      <BroadcastForm />

      <section className="bg-amber-50 ring-1 ring-amber-200 rounded-2xl p-4 text-sm text-amber-900 space-y-2">
        <p className="font-semibold">A few things to know:</p>
        <ul className="list-disc pl-5 space-y-1 text-xs">
          <li>
            Only users who've enabled notifications get the ping. Users on
            iOS need to have added the app to their home screen first.
          </li>
          <li>
            Every broadcast is logged to the audit trail (System health →
            Recent admin actions).
          </li>
          <li>
            Test-send first goes only to your own devices, so you can see
            what it'll look like before it goes to everyone.
          </li>
        </ul>
      </section>
    </div>
  );
}
