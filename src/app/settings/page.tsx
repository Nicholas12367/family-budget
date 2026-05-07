import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "@/components/SettingsClient";
import PeopleManager from "@/components/PeopleManager";
import { listPeople } from "@/app/actions/people";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: categories = [] },
    { data: expenses = [] },
    { data: fixedCosts = [] },
    { data: budgets = [] },
    people,
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name"),
    supabase.from("expenses").select("*").eq("user_id", user.id),
    supabase.from("fixed_costs").select("*").eq("user_id", user.id),
    supabase.from("budgets").select("*").eq("user_id", user.id),
    listPeople().catch(() => []),
  ]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 text-emerald-700 text-sm font-semibold hover:bg-gray-50"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M11 6l-6 6 6 6" />
          </svg>
          Back to dashboard
        </Link>
        <h1 className="text-xl font-bold">Settings</h1>
        <span />
      </div>
      <PeopleManager initial={people} />
      <SettingsClient
        email={user.email ?? ""}
        snapshot={{
          categories: categories ?? [],
          expenses: expenses ?? [],
          fixedCosts: fixedCosts ?? [],
          budgets: budgets ?? [],
        }}
      />
      <div className="pt-2 pb-8 flex justify-center">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600"
        >
          Done — back to dashboard
        </Link>
      </div>
    </div>
  );
}
