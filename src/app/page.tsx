import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BudgetApp from "@/components/BudgetApp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
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
    supabase
      .from("expenses")
      .select("*")
      .eq("user_id", user.id)
      .order("date", { ascending: false })
      .order("id", { ascending: false }),
    supabase.from("fixed_costs").select("*").eq("user_id", user.id).order("name"),
    supabase.from("budgets").select("*").eq("user_id", user.id),
  ]);

  return (
    <BudgetApp
      email={user.email ?? ""}
      initialCategories={categories ?? []}
      initialExpenses={expenses ?? []}
      initialFixedCosts={fixedCosts ?? []}
      initialBudgets={budgets ?? []}
    />
  );
}
