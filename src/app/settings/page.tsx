import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import SettingsClient from "@/components/SettingsClient";

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
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name"),
    supabase.from("expenses").select("*").eq("user_id", user.id),
    supabase.from("fixed_costs").select("*").eq("user_id", user.id),
    supabase.from("budgets").select("*").eq("user_id", user.id),
  ]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link href="/" className="text-emerald-700 text-sm">
          ← Back
        </Link>
        <h1 className="text-xl font-bold">Settings</h1>
        <span />
      </div>
      <SettingsClient
        email={user.email ?? ""}
        snapshot={{
          categories: categories ?? [],
          expenses: expenses ?? [],
          fixedCosts: fixedCosts ?? [],
          budgets: budgets ?? [],
        }}
      />
    </div>
  );
}
