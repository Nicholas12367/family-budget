import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import BudgetApp from "@/components/BudgetApp";
import OnboardingFlow from "@/components/OnboardingFlow";
import { listPeople } from "@/app/actions/people";
import { getSavingsGoal, listIncome } from "@/app/actions/income";
import { listMyMessages } from "@/app/actions/messages";
import AppOpenPrompts from "@/components/AppOpenPrompts";
import { normalizeLayout } from "@/lib/widgets";

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
    people,
    { data: profileRow },
    incomeRows,
    { data: receiptBatches = [] },
    savingsGoal,
    myMessages,
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
    listPeople().catch(() => []),
    supabase
      .from("profiles")
      .select("onboarded_at, show_income_widget, home_widgets")
      .eq("id", user.id)
      .maybeSingle(),
    listIncome().catch(() => []),
    supabase
      .from("receipt_batches")
      .select("id, merchant, total_extracted, scanned_at")
      .eq("user_id", user.id),
    getSavingsGoal(new Date().getFullYear()).catch(() => null),
    listMyMessages().catch(() => []),
  ]);

  const needsOnboarding = !profileRow?.onboarded_at;
  const showIncomeWidget = profileRow?.show_income_widget ?? true;
  const widgetLayout = normalizeLayout(profileRow?.home_widgets);
  const unreadList = myMessages.filter((m) => !m.read_at);
  const unreadDirect = unreadList.filter((m) => m.kind !== "broadcast");
  const unreadBroadcasts = unreadList.filter((m) => m.kind === "broadcast");

  return (
    <>
      <BudgetApp
        email={user.email ?? ""}
        initialCategories={categories ?? []}
        initialExpenses={expenses ?? []}
        initialFixedCosts={fixedCosts ?? []}
        initialBudgets={budgets ?? []}
        initialPeople={people}
        initialIncomeEntries={incomeRows}
        initialSavingsGoal={savingsGoal}
        unreadMessages={unreadList.length}
        broadcastUpdates={unreadBroadcasts}
        showIncomeWidget={showIncomeWidget}
        initialWidgetLayout={widgetLayout}
        initialReceiptBatches={receiptBatches ?? []}
      />
      {needsOnboarding ? (
        <OnboardingFlow userId={user.id} />
      ) : (
        <AppOpenPrompts unreadMessages={unreadDirect} />
      )}
    </>
  );
}
