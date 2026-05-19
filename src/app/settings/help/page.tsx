import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HelpClient from "@/components/HelpClient";
import { FAQ_ENTRIES } from "@/lib/faq";

export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div
      className="max-w-3xl mx-auto px-4 pb-16 space-y-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
    >
      <div className="flex items-center gap-3">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 text-emerald-700 text-sm font-semibold hover:bg-gray-50"
        >
          ← Settings
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">Help & FAQ</h1>
          <p className="text-xs text-gray-500">
            Search the docs or ask the AI a free-form question (5/day cap).
          </p>
        </div>
      </div>
      <HelpClient faq={FAQ_ENTRIES} />
    </div>
  );
}
