"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Budget, Category, Expense, FixedCost, Person } from "@/lib/types";
import PersonSelector from "./PersonSelector";
import { fmt, fixedMonthlyEquivalent } from "@/lib/money";
import {
  buildEffectiveLimitMap,
  isFutureDate,
  todayLocalISO,
  type EffectiveLimit,
} from "@/lib/rollover";
import {
  bulkDeleteExpenses,
  bulkUpdateExpenses,
  createExpense,
  deleteExpense,
  updateExpense,
} from "@/app/actions/expenses";
import {
  createFixedCost,
  deleteFixedCost,
  updateFixedCost,
} from "@/app/actions/fixed-costs";
import { setBudget } from "@/app/actions/budgets";
import {
  createCategory,
  deleteCategory,
  updateCategory,
} from "@/app/actions/categories";
import CategoryPicker from "./CategoryPicker";
import SortableWidgets from "./SortableWidgets";
import { IncomeEditor } from "./IncomeWidget";
import UpdateBanner from "./UpdateBanner";
import type { IncomeEntry } from "@/app/actions/income";
import type { AdminMessage } from "@/app/actions/messages";
import type { SavingsGoal } from "@/lib/income";
import type { WidgetLayout } from "@/lib/widgets";
import {
  IconHome,
  IconClock,
  IconCamera,
  IconReceipt,
  IconMore,
  IconSettings,
  IconTarget,
  IconTag,
  IconList,
  IconChevronLeft,
  IconChevronRight,
  IconPlus,
  IconHelp,
  IconChat,
  IconBell,
} from "./Icon";


type Tab = "dashboard" | "expenses" | "fixed" | "budgets" | "categories";

type Props = {
  email: string;
  initialCategories: Category[];
  initialExpenses: Expense[];
  initialFixedCosts: FixedCost[];
  initialBudgets: Budget[];
  initialPeople: Person[];
  // Income entries — passed straight to the home-screen Income widget.
  initialIncomeEntries?: IncomeEntry[];
  // Annual savings target for the current year (null = not set). Drives the
  // savings-goal progress bar on the Income widget.
  initialSavingsGoal?: SavingsGoal | null;
  // Count of unread admin → user messages. Drives the header inbox badge.
  unreadMessages?: number;
  // Unread broadcast updates — shown as a dismissible dashboard banner.
  broadcastUpdates?: AdminMessage[];
  // When false (or null in DB), the income widget is hidden from the
  // dashboard. Toggleable from Settings → Widgets.
  showIncomeWidget?: boolean;
  // Per-user widget layout (order + hidden). Drives SortableWidgets.
  initialWidgetLayout?: WidgetLayout;
  // Receipt batches keyed by id — used to group line items by receipt
  // in the History / drill-down expense lists.
  initialReceiptBatches?: Array<{
    id: number;
    merchant: string | null;
    total_extracted: number | null;
    scanned_at: string | null;
  }>;
};

export type ReceiptBatchRow = {
  id: number;
  merchant: string | null;
  total_extracted: number | null;
  scanned_at: string | null;
};

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function BudgetApp({
  email,
  initialCategories,
  initialExpenses,
  initialFixedCosts,
  initialBudgets,
  initialPeople,
  initialIncomeEntries = [],
  initialSavingsGoal = null,
  unreadMessages = 0,
  broadcastUpdates = [],
  showIncomeWidget = true,
  initialWidgetLayout,
  initialReceiptBatches = [],
}: Props) {
  const receiptBatchesById = useMemo(() => {
    const m = new Map<number, ReceiptBatchRow>();
    for (const r of initialReceiptBatches) m.set(r.id, r);
    return m;
  }, [initialReceiptBatches]);
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [tab, setTab] = useState<Tab>("dashboard");
  const [categories, setCategories] = useState(initialCategories);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [fixedCosts, setFixedCosts] = useState(initialFixedCosts);
  const [budgets, setBudgets] = useState(initialBudgets);

  // Sync local state with fresh server props after router.refresh() (or any
  // re-render of the parent server component). Without this, optimistic
  // updates with placeholder IDs would persist forever and freshly-saved
  // rows would never get their real DB ids/created_at back.
  useEffect(() => setCategories(initialCategories), [initialCategories]);
  useEffect(() => setExpenses(initialExpenses), [initialExpenses]);
  useEffect(() => setFixedCosts(initialFixedCosts), [initialFixedCosts]);
  useEffect(() => setBudgets(initialBudgets), [initialBudgets]);

  // Income + savings goal are lifted here so the Income widget and the
  // "Add → Add income" flow stay in sync without a full page refresh.
  const [incomeEntries, setIncomeEntries] = useState(initialIncomeEntries);
  const [savingsGoal, setSavingsGoal] = useState<SavingsGoal | null>(
    initialSavingsGoal
  );
  useEffect(() => setIncomeEntries(initialIncomeEntries), [initialIncomeEntries]);
  useEffect(() => setSavingsGoal(initialSavingsGoal), [initialSavingsGoal]);
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);

  const people = initialPeople;
  const peopleById = useMemo(() => {
    const m = new Map<number, Person>();
    people.forEach((p) => m.set(p.id, p));
    return m;
  }, [people]);

  const [editExpense, setEditExpense] = useState<Expense | "new" | null>(null);
  const [editFixed, setEditFixed] = useState<FixedCost | "new" | null>(null);
  const [editCategory, setEditCategory] = useState<Category | "new" | null>(null);
  const [drill, setDrill] = useState<DrillKind | null>(null);
  const [categoryDrill, setCategoryDrill] = useState<number | null>(null);
  const [showMore, setShowMore] = useState(false);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // Onboarding tour bridge — listens for events fired from OnboardingFlow
  // so the tour can switch tabs, open the + menu, etc. Safe to no-op when
  // no tour is mounted (events just fan out into the void).
  useEffect(() => {
    const onGoto = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string") setTab(detail as Tab);
    };
    const onOpenAdd = () => {
      // Programmatically click the bottom-add button so the action sheet
      // opens with the exact same code path users tap.
      const el = document.querySelector<HTMLButtonElement>(
        "[data-tour-id='bottom-add']"
      );
      el?.click();
    };
    window.addEventListener("tour:goto-tab", onGoto);
    window.addEventListener("tour:open-add-sheet", onOpenAdd);
    return () => {
      window.removeEventListener("tour:goto-tab", onGoto);
      window.removeEventListener("tour:open-add-sheet", onOpenAdd);
    };
  }, []);

  const monthExpenses = useMemo(
    () =>
      expenses.filter((e) => {
        const d = new Date(e.date);
        return d.getUTCFullYear() === year && d.getUTCMonth() === month;
      }),
    [expenses, year, month]
  );

  const totalSpent = monthExpenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalBudget = budgets.reduce((s, b) => s + Number(b.monthly_limit), 0);
  const activeFixed = useMemo(
    () => fixedCosts.filter((f) => f.is_active),
    [fixedCosts]
  );
  const totalFixed = activeFixed.reduce(
    (s, f) => s + fixedMonthlyEquivalent(f),
    0
  );

  // Combined "spent in category this month" — variable expenses + monthly
  // equivalent of every active fixed cost in that category. Used for
  // every budget/category calculation so bills show up where users
  // expect them.
  const spentByCat = useMemo(() => {
    const m = new Map<number, number>();
    monthExpenses.forEach((e) => {
      m.set(e.category_id, (m.get(e.category_id) ?? 0) + Number(e.amount));
    });
    activeFixed.forEach((f) => {
      m.set(
        f.category_id,
        (m.get(f.category_id) ?? 0) + fixedMonthlyEquivalent(f)
      );
    });
    return m;
  }, [monthExpenses, activeFixed]);

  // Budgets with rolls_over=true compound surplus/deficit forward each
  // month. All others: effective = base. Compounding is anchored to
  // the budget's created_at, so empty months still add to the rollover.
  const effectiveLimitByCat = useMemo(
    () => buildEffectiveLimitMap(budgets, year, month, expenses, activeFixed),
    [budgets, year, month, expenses, activeFixed]
  );

  function effectiveOf(catId: number, baseLimit: number): number {
    return effectiveLimitByCat.get(catId)?.effective ?? baseLimit;
  }

  // Remaining = sum of (effective limit - spent) across budgeted categories.
  // Effective limit folds in personal-budget rollover.
  const remaining = budgets.reduce(
    (s, b) =>
      s +
      (effectiveOf(b.category_id, Number(b.monthly_limit)) -
        (spentByCat.get(b.category_id) ?? 0)),
    0
  );

  const catById = useMemo(() => {
    const m = new Map<number, Category>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

  // Annual savings progress for the savings-goal bar. Always the *real*
  // current calendar year (independent of the month navigator): income
  // earned this year minus variable spend this year minus the monthly
  // equivalent of active fixed costs for each month elapsed so far.
  const goalYear = today.getFullYear();
  const savedThisYear = useMemo(() => {
    const monthsElapsed = today.getMonth() + 1; // Jan = 1 … current month
    const incomeYTD = incomeEntries
      .filter((e) => new Date(e.date).getUTCFullYear() === goalYear)
      .reduce((s, e) => s + Number(e.amount), 0);
    const variableYTD = expenses
      .filter((e) => new Date(e.date).getUTCFullYear() === goalYear)
      .reduce((s, e) => s + Number(e.amount), 0);
    const fixedMonthly = activeFixed.reduce(
      (s, f) => s + fixedMonthlyEquivalent(f),
      0
    );
    return incomeYTD - variableYTD - fixedMonthly * monthsElapsed;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomeEntries, expenses, activeFixed, goalYear]);

  function changeMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 0) {
      m = 11;
      y--;
    } else if (m > 11) {
      m = 0;
      y++;
    }
    setMonth(m);
    setYear(y);
  }

  return (
    <div>
      <Header
        email={email}
        monthLabel={`${MONTH_NAMES[month]} ${year}`}
        unreadMessages={unreadMessages}
        onPrevMonth={() => changeMonth(-1)}
        onNextMonth={() => changeMonth(1)}
      />

      <nav className="bg-white shadow-sm sticky top-[57px] z-10 hidden md:block">
        <div className="max-w-5xl mx-auto px-4 pb-2 flex gap-2 overflow-x-auto">
          {(
            [
              ["dashboard", "Dashboard"],
              ["expenses", "Expenses"],
              ["fixed", "Fixed Costs"],
              ["budgets", "Budgets"],
              ["categories", "Categories"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold ${
                tab === key ? "tab-active" : "tab-inactive"
              }`}
            >
              {label}
            </button>
          ))}
          <Link
            href="/scan"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 ml-auto inline-flex items-center gap-1.5"
          >
            <IconCamera size={16} />
            Scan
          </Link>
          <Link
            href="/settings"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200 inline-flex items-center"
            aria-label="Settings"
          >
            <IconSettings size={16} />
          </Link>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-6">
        {broadcastUpdates.length > 0 && (
          <UpdateBanner updates={broadcastUpdates} />
        )}
        {tab === "dashboard" && (
          <Dashboard
            year={year}
            month={month}
            monthLabel={`${MONTH_NAMES[month]} ${year}`}
            monthExpenses={monthExpenses}
            categories={categories}
            budgets={budgets}
            totals={{ totalSpent, totalBudget, totalFixed, remaining }}
            spentByCat={spentByCat}
            effectiveLimitByCat={effectiveLimitByCat}
            catById={catById}
            peopleById={peopleById}
            onEditExpense={(e) => setEditExpense(e)}
            onDrill={setDrill}
            onCategoryDrill={(catId) => setCategoryDrill(catId)}
            widgets={
              <SortableWidgets
                layout={
                  initialWidgetLayout ?? {
                    order: ["spent", "variable", "fixed", "remaining", "income"],
                    hidden: [],
                  }
                }
                totals={{ totalSpent, totalBudget, totalFixed, remaining }}
                onDrill={setDrill}
                incomeEntries={incomeEntries}
                onIncomeChange={setIncomeEntries}
                showIncomeWidget={showIncomeWidget}
                year={year}
                month={month}
                savedThisYear={savedThisYear}
                savingsGoal={savingsGoal}
                goalYear={goalYear}
                onGoalChange={setSavingsGoal}
              />
            }
          />
        )}
        {tab === "expenses" && (
          <ExpensesTab
            monthLabel={`${MONTH_NAMES[month]} ${year}`}
            monthExpenses={monthExpenses}
            allExpenses={expenses}
            categories={categories}
            people={people}
            catById={catById}
            peopleById={peopleById}
            receiptBatchesById={receiptBatchesById}
            onAdd={() => setEditExpense("new")}
            onEdit={(e) => setEditExpense(e)}
            onBulkUpdate={async (ids, patch) => {
              await bulkUpdateExpenses({ ids, ...patch });
              setExpenses((prev) =>
                prev.map((e) =>
                  ids.includes(e.id) ? { ...e, ...patch } : e
                )
              );
              router.refresh();
            }}
            onBulkDelete={async (ids) => {
              await bulkDeleteExpenses(ids);
              setExpenses((prev) => prev.filter((e) => !ids.includes(e.id)));
              router.refresh();
            }}
          />
        )}
        {tab === "fixed" && (
          <FixedTab
            fixedCosts={fixedCosts}
            catById={catById}
            peopleById={peopleById}
            onAdd={() => setEditFixed("new")}
            onEdit={(f) => setEditFixed(f)}
          />
        )}
        {tab === "budgets" && (
          <BudgetsTab
            categories={categories}
            budgets={budgets}
            spentByCat={spentByCat}
            effectiveLimitByCat={effectiveLimitByCat}
            onCategoryClick={(catId) => setCategoryDrill(catId)}
            onSave={async (catId, settings) => {
              const saved = await setBudget({
                category_id: catId,
                monthly_limit: settings.monthly_limit,
                rolls_over: settings.rolls_over,
                is_personal: settings.is_personal,
                person_name: settings.person_name,
              });
              setBudgets((prev) => {
                const i = prev.findIndex((b) => b.category_id === catId);
                if (!saved) {
                  if (i >= 0) {
                    const next = [...prev];
                    next.splice(i, 1);
                    return next;
                  }
                  return prev;
                }
                if (i >= 0) {
                  const next = [...prev];
                  next[i] = saved;
                  return next;
                }
                return [...prev, saved];
              });
              router.refresh();
            }}
          />
        )}
        {tab === "categories" && (
          <CategoriesTab
            categories={categories}
            onAdd={() => setEditCategory("new")}
            onEdit={(c) => setCategoryDrill(c.id)}
          />
        )}
      </main>

      {editExpense !== null && (
        <ExpenseDialog
          initial={editExpense}
          categories={categories}
          people={people}
          onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
          onClose={() => setEditExpense(null)}
          onSave={async (form, id) => {
            if (id) {
              const updated = await updateExpense(id, form);
              setExpenses((prev) =>
                prev.map((e) => (e.id === id ? updated : e))
              );
            } else {
              const created = await createExpense(form);
              setExpenses((prev) => [created, ...prev]);
            }
            router.refresh();
          }}
          onDelete={async (id) => {
            await deleteExpense(id);
            setExpenses((prev) => prev.filter((e) => e.id !== id));
            router.refresh();
          }}
        />
      )}

      {editFixed !== null && (
        <FixedDialog
          initial={editFixed}
          categories={categories}
          people={people}
          onClose={() => setEditFixed(null)}
          onSave={async (form, id) => {
            if (id) {
              const updated = await updateFixedCost(id, form);
              setFixedCosts((prev) =>
                prev.map((f) => (f.id === id ? updated : f))
              );
            } else {
              const created = await createFixedCost(form);
              setFixedCosts((prev) => [...prev, created]);
            }
            router.refresh();
          }}
          onDelete={async (id) => {
            await deleteFixedCost(id);
            setFixedCosts((prev) => prev.filter((f) => f.id !== id));
            router.refresh();
          }}
        />
      )}

      {editCategory !== null && (
        <CategoryDialog
          initial={editCategory}
          onClose={() => setEditCategory(null)}
          onSave={async (form, id) => {
            if (id) {
              const updated = await updateCategory(id, form);
              setCategories((prev) =>
                prev.map((c) => (c.id === id ? updated : c))
              );
            } else {
              const created = await createCategory(form);
              setCategories((prev) => [...prev, created]);
            }
            router.refresh();
          }}
          onDelete={async (id) => {
            await deleteCategory(id);
            setCategories((prev) => prev.filter((c) => c.id !== id));
            router.refresh();
          }}
        />
      )}

      {drill !== null && (
        <DrillDrawer
          kind={drill}
          monthLabel={`${MONTH_NAMES[month]} ${year}`}
          monthExpenses={monthExpenses}
          fixedCosts={fixedCosts}
          budgets={budgets}
          spentByCat={spentByCat}
          effectiveLimitByCat={effectiveLimitByCat}
          catById={catById}
          peopleById={peopleById}
          categories={categories}
          people={people}
          receiptBatchesById={receiptBatchesById}
          totals={{ totalSpent, totalBudget, totalFixed, remaining }}
          onClose={() => setDrill(null)}
          onPickExpense={(e) => {
            setDrill(null);
            setEditExpense(e);
          }}
          onPickFixed={(f) => {
            setDrill(null);
            setEditFixed(f);
          }}
          onAddFixed={() => {
            setDrill(null);
            setEditFixed("new");
          }}
          onJumpBudgets={() => {
            setDrill(null);
            setTab("budgets");
          }}
          onBulkUpdate={async (ids, patch) => {
            await bulkUpdateExpenses({ ids, ...patch });
            setExpenses((prev) =>
              prev.map((e) =>
                ids.includes(e.id) ? { ...e, ...patch } : e
              )
            );
            router.refresh();
          }}
          onBulkDelete={async (ids) => {
            await bulkDeleteExpenses(ids);
            setExpenses((prev) => prev.filter((e) => !ids.includes(e.id)));
            router.refresh();
          }}
        />
      )}

      {categoryDrill !== null && (
        <CategoryDrawer
          categoryId={categoryDrill}
          monthLabel={`${MONTH_NAMES[month]} ${year}`}
          monthExpenses={monthExpenses}
          fixedCosts={activeFixed}
          budgets={budgets}
          effectiveLimitByCat={effectiveLimitByCat}
          catById={catById}
          peopleById={peopleById}
          categories={categories}
          people={people}
          onClose={() => setCategoryDrill(null)}
          onPickExpense={(e) => {
            setCategoryDrill(null);
            setEditExpense(e);
          }}
          onPickFixed={(f) => {
            setCategoryDrill(null);
            setEditFixed(f);
          }}
          onBulkUpdate={async (ids, patch) => {
            await bulkUpdateExpenses({ ids, ...patch });
            setExpenses((prev) =>
              prev.map((e) =>
                ids.includes(e.id) ? { ...e, ...patch } : e
              )
            );
            router.refresh();
          }}
          onBulkDelete={async (ids) => {
            await bulkDeleteExpenses(ids);
            setExpenses((prev) => prev.filter((e) => !ids.includes(e.id)));
            router.refresh();
          }}
          onSaveCategory={async (id, patch) => {
            const fd = new FormData();
            fd.set("name", patch.name);
            fd.set("color", patch.color);
            const existing = catById.get(id);
            fd.set("icon", existing?.icon ?? "🏷️");
            const updated = await updateCategory(id, fd);
            setCategories((prev) =>
              prev.map((c) => (c.id === id ? updated : c))
            );
            router.refresh();
          }}
          onDeleteCategory={async (id) => {
            await deleteCategory(id);
            setCategories((prev) => prev.filter((c) => c.id !== id));
            router.refresh();
          }}
          onSaveBudget={async (catId, settings) => {
            const saved = await setBudget({
              category_id: catId,
              monthly_limit: settings.monthly_limit,
              rolls_over: settings.rolls_over,
              is_personal: settings.is_personal,
              person_name: settings.person_name,
            });
            setBudgets((prev) => {
              const i = prev.findIndex((b) => b.category_id === catId);
              if (!saved) {
                if (i >= 0) {
                  const next = [...prev];
                  next.splice(i, 1);
                  return next;
                }
                return prev;
              }
              if (i >= 0) {
                const next = [...prev];
                next[i] = saved;
                return next;
              }
              return [...prev, saved];
            });
            router.refresh();
          }}
        />
      )}

      {showMore && (
        <MoreSheet
          onClose={() => setShowMore(false)}
          onTab={(t) => {
            setShowMore(false);
            setTab(t);
          }}
        />
      )}

      <BottomNav
        currentTab={tab}
        onTab={(t) => setTab(t)}
        onMore={() => setShowMore(true)}
        onAddExpense={() => setEditExpense("new")}
        onAddFixed={() => setEditFixed("new")}
        onAddBudget={() => setTab("budgets")}
        onAddIncome={() => setAddIncomeOpen(true)}
      />

      {addIncomeOpen && (
        <IncomeEditor
          entries={incomeEntries}
          year={year}
          month={month}
          savingsGoal={savingsGoal}
          goalYear={goalYear}
          onGoalChange={setSavingsGoal}
          onChange={setIncomeEntries}
          onClose={() => setAddIncomeOpen(false)}
        />
      )}
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  );
}

function Header({
  email,
  monthLabel,
  unreadMessages = 0,
  onPrevMonth,
  onNextMonth,
}: {
  email: string;
  monthLabel: string;
  unreadMessages?: number;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  return (
    <header
      className="bg-white/80 backdrop-blur-md border-b border-gray-200/70 sticky top-0 z-20"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
    >
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-500/30 ring-1 ring-emerald-300/40">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M12 3v18" />
              <path d="M16.5 7.5h-6a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5h-6.5" />
            </svg>
          </div>
          <div>
            <h1 className="font-bold text-base leading-tight tracking-tight">
              Budget App
            </h1>
            <p className="text-xs text-gray-500 font-medium">{monthLabel}</p>
          </div>
        </div>
        <div className="flex gap-1.5 items-center">
          <Link
            href="/inbox"
            aria-label={
              unreadMessages > 0
                ? `Messages (${unreadMessages} unread)`
                : "Messages"
            }
            className="relative w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700 mr-0.5"
          >
            <IconBell size={16} />
            {unreadMessages > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold leading-4 text-center ring-2 ring-white">
                {unreadMessages > 9 ? "9+" : unreadMessages}
              </span>
            )}
          </Link>
          <button
            onClick={onPrevMonth}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700"
            aria-label="Previous month"
          >
            <IconChevronLeft size={16} />
          </button>
          <button
            onClick={onNextMonth}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-700"
            aria-label="Next month"
          >
            <IconChevronRight size={16} />
          </button>
          <span className="text-xs text-gray-500 hidden sm:inline ml-2">
            {email}
          </span>
          <form action="/auth/signout" method="post" className="hidden sm:block">
            <button className="text-xs text-gray-500 hover:text-gray-900 underline ml-2">
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

type Accent = "emerald" | "sky" | "violet" | "rose";

const ACCENT_STYLES: Record<
  Accent,
  { ring: string; text: string; bg: string; dot: string }
> = {
  emerald: {
    ring: "ring-emerald-100 hover:ring-emerald-200",
    text: "text-emerald-700",
    bg: "from-emerald-50 to-white",
    dot: "bg-emerald-500",
  },
  sky: {
    ring: "ring-sky-100 hover:ring-sky-200",
    text: "text-sky-700",
    bg: "from-sky-50 to-white",
    dot: "bg-sky-500",
  },
  violet: {
    ring: "ring-violet-100 hover:ring-violet-200",
    text: "text-violet-700",
    bg: "from-violet-50 to-white",
    dot: "bg-violet-500",
  },
  rose: {
    ring: "ring-rose-100 hover:ring-rose-200",
    text: "text-rose-700",
    bg: "from-rose-50 to-white",
    dot: "bg-rose-500",
  },
};

function StatCard({
  label,
  sublabel,
  value,
  accent = "emerald",
  onClick,
}: {
  label: string;
  sublabel?: string;
  value: string;
  accent?: Accent;
  onClick?: () => void;
}) {
  const s = ACCENT_STYLES[accent];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left bg-gradient-to-br ${s.bg} rounded-2xl p-4 ring-1 ${s.ring} shadow-sm transition active:scale-[0.98] focus:outline-none focus:ring-2`}
    >
      <div className="flex items-center gap-1.5">
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${s.dot}`} />
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${s.text}`}>
          {label}
        </p>
      </div>
      <p className="text-2xl font-bold tabular-nums mt-1.5">{value}</p>
      {sublabel && (
        <p className="text-[11px] text-gray-500 mt-0.5">{sublabel}</p>
      )}
    </button>
  );
}

type DrillKind = "total" | "variable" | "fixed" | "remaining";

function Dashboard({
  monthLabel,
  monthExpenses,
  budgets,
  totals,
  spentByCat,
  effectiveLimitByCat,
  catById,
  peopleById,
  onEditExpense,
  onDrill,
  onCategoryDrill,
  widgets,
}: {
  year: number;
  month: number;
  monthLabel: string;
  monthExpenses: Expense[];
  categories: Category[];
  budgets: Budget[];
  totals: {
    totalSpent: number;
    totalBudget: number;
    totalFixed: number;
    remaining: number;
  };
  spentByCat: Map<number, number>;
  effectiveLimitByCat: Map<number, EffectiveLimit>;
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  onEditExpense: (e: Expense) => void;
  onDrill?: (kind: DrillKind) => void;
  onCategoryDrill?: (categoryId: number) => void;
  // Sortable widgets grid (4 stat cards + optional income). Locked by
  // default; tap Edit to drag-reorder or remove. Re-add hidden widgets in
  // Settings.
  widgets: React.ReactNode;
}) {
  const ranked = useMemo(() => {
    const total = totals.totalSpent + totals.totalFixed;
    return [...spentByCat.entries()]
      .map(([catId, amount]) => {
        const c = catById.get(catId);
        return c
          ? {
              id: catId,
              name: c.name,
              color: c.color,
              amount,
              pct: total > 0 ? (amount / total) * 100 : 0,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      .sort((a, b) => b.amount - a.amount);
  }, [spentByCat, catById, totals.totalSpent, totals.totalFixed]);

  const recent = useMemo(
    () =>
      [...monthExpenses]
        .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : b.id - a.id))
        .slice(0, 8),
    [monthExpenses]
  );

  return (
    <section className="space-y-4">
      {/* 4 stat cards + (optional) income widget — locked by default; tap
          Edit to drag-reorder or remove. Layout persists per user. */}
      {widgets}

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h3 className="font-semibold mb-3">Spending by Category</h3>
          {ranked.length === 0 ? (
            <p className="text-sm text-gray-500 py-6 text-center">
              No expenses yet this month.
            </p>
          ) : (
            <div className="space-y-2.5">
              {ranked.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onCategoryDrill?.(r.id)}
                  className="w-full text-left flex items-center gap-3 hover:bg-gray-50 rounded-lg px-1 py-1"
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ background: r.color }}
                  />
                  <span className="flex-1 min-w-0 text-sm truncate">
                    {r.name}
                  </span>
                  <span className="text-sm font-semibold tabular-nums shrink-0">
                    {fmt(r.amount)}
                  </span>
                  <span className="text-[11px] text-gray-500 tabular-nums w-10 text-right shrink-0">
                    {r.pct.toFixed(0)}%
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h3 className="font-semibold mb-3">Budget Progress</h3>
          {budgets.length === 0 ? (
            <p className="text-sm text-gray-500">
              No budgets set. Go to the <b>Budgets</b> tab to set monthly limits.
            </p>
          ) : (
            <div className="space-y-3 max-h-[260px] overflow-y-auto">
              {budgets.map((b) => {
                const c = catById.get(b.category_id);
                if (!c) return null;
                const used = spentByCat.get(b.category_id) ?? 0;
                const eff = effectiveLimitByCat.get(b.category_id);
                const limit = eff?.effective ?? Number(b.monthly_limit);
                const rollover = eff?.rollover ?? 0;
                const rollsOver = !!eff?.rollsOver;
                const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
                const cls = used > limit ? "over" : pct > 80 ? "warn" : "ok";
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => onCategoryDrill?.(b.category_id)}
                    className="w-full text-left hover:bg-gray-50 rounded-lg p-1"
                  >
                    <div className="flex justify-between text-sm mb-1 gap-2">
                      <span className="flex items-center gap-1.5 min-w-0">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: c.color }}
                        />
                        <span className="truncate">{c.name}</span>
                        {rollsOver && rollover !== 0 && (
                          <span
                            className={`text-[10px] font-bold tabular-nums shrink-0 px-1.5 py-0.5 rounded-full ring-1 ${
                              rollover > 0
                                ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                : "bg-rose-50 text-rose-700 ring-rose-200"
                            }`}
                            title="Rollover from prior months"
                          >
                            {rollover > 0 ? "+" : ""}
                            {fmt(rollover)}
                          </span>
                        )}
                      </span>
                      <span className="tabular-nums shrink-0">
                        {fmt(used)} / {fmt(limit)}
                      </span>
                    </div>
                    <div className="progress-bar">
                      <div
                        className={`progress-fill ${cls}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div>
        <h3 className="font-semibold mb-3 px-1">Recent Expenses</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500 py-4 bg-white rounded-2xl px-4 ring-1 ring-gray-100">
            No expenses for {monthLabel}. Add one from the Expenses tab.
          </p>
        ) : (
          <div className="space-y-2">
            {recent.map((e) => (
              <ExpenseRow
                key={e.id}
                e={e}
                catById={catById}
                peopleById={peopleById}
                onClick={() => onEditExpense(e)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ExpenseRow({
  e,
  catById,
  peopleById,
  onClick,
  showDate = false,
}: {
  e: Expense;
  catById: Map<number, Category>;
  peopleById?: Map<number, Person>;
  onClick?: () => void;
  showDate?: boolean;
}) {
  const c = catById.get(e.category_id) ?? {
    name: "Unknown",
    color: "#9ca3af",
  };
  const person = e.person_id != null ? peopleById?.get(e.person_id) : null;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`w-full text-left bg-white rounded-2xl ring-1 ring-gray-100 shadow-sm px-3.5 py-3 flex items-start gap-3 ${
        onClick ? "hover:ring-emerald-200 hover:shadow active:scale-[0.99] transition" : ""
      } disabled:cursor-default`}
    >
      <span
        className="w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0 mt-0.5"
        style={{ background: `${c.color}22` }}
        aria-hidden="true"
      >
        <span
          className="w-2.5 h-2.5 rounded-full"
          style={{ background: c.color }}
        />
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-bold text-[15px] text-gray-900 truncate">
          {e.description || "(no description)"}
        </p>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          <span
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
            style={{ background: c.color }}
            title={c.name}
          >
            <span className="truncate max-w-[120px]">{c.name}</span>
          </span>
          {person && (
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1"
              style={{
                background: `${person.color}22`,
                color: person.color,
                borderColor: `${person.color}66`,
              }}
            >
              {person.name}
            </span>
          )}
          {showDate && (
            <span className="text-[11px] text-gray-500 tabular-nums">
              {new Date(e.date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                timeZone: "UTC",
              })}
            </span>
          )}
        </div>
      </div>
      <p className="font-extrabold text-[15px] tabular-nums shrink-0 text-gray-900 mt-0.5">
        {fmt(e.amount)}
      </p>
    </button>
  );
}

function ExpensesTab({
  monthLabel,
  monthExpenses,
  allExpenses,
  categories,
  people,
  catById,
  peopleById,
  receiptBatchesById,
  onAdd,
  onEdit,
  onBulkUpdate,
  onBulkDelete,
}: {
  monthLabel: string;
  monthExpenses: Expense[];
  allExpenses: Expense[];
  categories: Category[];
  people: Person[];
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  receiptBatchesById?: Map<number, ReceiptBatchRow>;
  onAdd: () => void;
  onEdit: (e: Expense) => void;
  onBulkUpdate: (
    ids: number[],
    patch: { category_id?: number; date?: string; person_id?: number | null }
  ) => Promise<void>;
  onBulkDelete: (ids: number[]) => Promise<void>;
}) {
  const [dateFilter, setDateFilter] = useState("");

  const filtered = useMemo(() => {
    const source = dateFilter ? allExpenses : monthExpenses;
    const list = dateFilter
      ? source.filter((e) => e.date === dateFilter)
      : source;
    return [...list].sort((a, b) =>
      a.date > b.date ? -1 : a.date < b.date ? 1 : b.id - a.id
    );
  }, [dateFilter, allExpenses, monthExpenses]);

  const total = filtered.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center gap-2">
        <h2 className="text-xl font-bold">Expenses</h2>
        <button
          onClick={onAdd}
          className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold"
        >
          + Add Expense
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm p-3 flex flex-wrap items-center gap-2">
        <label className="text-sm font-medium text-gray-700">
          Find by date
        </label>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="border rounded-lg px-2 py-1 text-sm flex-1 min-w-[140px]"
        />
        {dateFilter && (
          <button
            onClick={() => setDateFilter("")}
            className="text-xs text-gray-600 underline"
          >
            Clear
          </button>
        )}
        <span className="ml-auto text-xs text-gray-500 tabular-nums">
          {filtered.length} item{filtered.length === 1 ? "" : "s"} • {fmt(total)}
        </span>
      </div>
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl ring-1 ring-gray-100 shadow-sm p-6 text-sm text-gray-500 text-center">
          {dateFilter
            ? `No expenses on ${dateFilter}.`
            : `No expenses for ${monthLabel}. Tap "Add Expense" to log one.`}
        </div>
      ) : (
        <BulkEditableExpenseList
          expenses={filtered}
          categories={categories}
          people={people}
          catById={catById}
          peopleById={peopleById}
          receiptBatchesById={receiptBatchesById}
          onPickExpense={onEdit}
          onBulkUpdate={onBulkUpdate}
          onBulkDelete={onBulkDelete}
          showDate
        />
      )}
    </section>
  );
}

function FixedTab({
  fixedCosts,
  catById,
  peopleById,
  onAdd,
  onEdit,
}: {
  fixedCosts: FixedCost[];
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  onAdd: () => void;
  onEdit: (f: FixedCost) => void;
}) {
  return (
    <section className="space-y-4" data-tour-id="fixed-tab">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Fixed Costs</h2>
        <button
          onClick={onAdd}
          className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold"
        >
          + Add Fixed Cost
        </button>
      </div>
      {fixedCosts.length === 0 ? (
        <p className="bg-white rounded-2xl ring-1 ring-gray-100 shadow-sm p-6 text-sm text-gray-500 text-center">
          No fixed costs yet. Add rent, utilities, subscriptions, etc.
        </p>
      ) : (
        <div className="space-y-2">
          {fixedCosts.map((f) => {
              const c = catById.get(f.category_id) ?? {
                name: "Unknown",
                color: "#9ca3af",
              };
              const monthly = fixedMonthlyEquivalent(f);
              const person =
                f.person_id != null ? peopleById.get(f.person_id) : null;
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => onEdit(f)}
                  className="w-full text-left bg-white rounded-2xl ring-1 ring-gray-100 shadow-sm px-3.5 py-3 flex items-start gap-3 hover:ring-emerald-200 hover:shadow active:scale-[0.99] transition"
                >
                  <span
                    className="w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: `${c.color}22` }}
                    aria-hidden="true"
                  >
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: c.color }}
                    />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-[15px] text-gray-900 truncate">
                      {f.name}
                      {!f.is_active && (
                        <span className="text-gray-400 font-normal"> (paused)</span>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white"
                        style={{ background: c.color }}
                      >
                        <span className="truncate max-w-[120px]">{c.name}</span>
                      </span>
                      {person && (
                        <span
                          className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ring-1"
                          style={{
                            background: `${person.color}22`,
                            color: person.color,
                            borderColor: `${person.color}66`,
                          }}
                        >
                          {person.name}
                        </span>
                      )}
                      <span className="text-[11px] text-gray-500 tabular-nums">
                        {fmt(f.amount)} {f.frequency}
                      </span>
                    </div>
                  </div>
                  <p className="font-extrabold text-[15px] tabular-nums shrink-0 text-gray-900 mt-0.5">
                    {fmt(monthly)}/mo
                  </p>
                </button>
              );
            })}
        </div>
      )}
    </section>
  );
}

type BudgetSettings = {
  monthly_limit: number;
  rolls_over: boolean;
  is_personal: boolean;
  person_name: string | null;
};

function BudgetsTab({
  categories,
  budgets,
  spentByCat,
  effectiveLimitByCat,
  onSave,
  onCategoryClick,
}: {
  categories: Category[];
  budgets: Budget[];
  spentByCat: Map<number, number>;
  effectiveLimitByCat: Map<number, EffectiveLimit>;
  onSave: (categoryId: number, settings: BudgetSettings) => void;
  onCategoryClick: (categoryId: number) => void;
}) {
  const [editing, setEditing] = useState<Category | null>(null);
  const sorted = useMemo(() => {
    return [...categories].sort((a, b) => {
      const aHas = budgets.some((x) => x.category_id === a.id);
      const bHas = budgets.some((x) => x.category_id === b.id);
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [categories, budgets]);

  const editingBudget = editing
    ? budgets.find((b) => b.category_id === editing.id) ?? null
    : null;

  return (
    <section className="space-y-4" data-tour-id="budgets-tab">
      <div>
        <h2 className="text-xl font-bold">Monthly Budgets</h2>
        <p className="text-sm text-gray-600">
          Tap a row to set the limit and decide whether it rolls over. When
          rollover is on, unused balance carries forward and overspending
          deducts from next month — compounds indefinitely.
        </p>
      </div>
      <div className="bg-white rounded-xl shadow-sm divide-y">
        {sorted.map((c) => {
          const b = budgets.find((x) => x.category_id === c.id);
          const baseLimit = b ? Number(b.monthly_limit) : 0;
          const eff = effectiveLimitByCat.get(c.id);
          const limit = eff?.effective ?? baseLimit;
          const rollover = eff?.rollover ?? 0;
          const rollsOver = !!eff?.rollsOver;
          const isPersonal = !!eff?.isPersonal;
          const personName = eff?.personName ?? null;
          const used = spentByCat.get(c.id) ?? 0;
          const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
          const cls = used > limit ? "over" : pct > 80 ? "warn" : "ok";
          const remaining = limit - used;
          return (
            <div key={c.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => onCategoryClick(c.id)}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white shadow-sm shrink-0 max-w-[55%] hover:opacity-90"
                  style={{ background: c.color }}
                  title={`View expenses for ${c.name}`}
                >
                  <span className="truncate">{c.name}</span>
                </button>
                {isPersonal && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide text-sky-700 bg-sky-50 ring-1 ring-sky-200 rounded-full px-2 py-0.5 shrink-0"
                    title={
                      personName
                        ? `Personal budget for ${personName}`
                        : "Personal budget"
                    }
                  >
                    {personName ? `Personal · ${personName}` : "Personal"}
                  </span>
                )}
                {rollsOver && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-2 py-0.5 shrink-0"
                    title="Unused balance rolls into next month"
                  >
                    Rolls over
                  </span>
                )}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => setEditing(c)}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
                >
                  {baseLimit > 0 ? (
                    <span className="tabular-nums">{fmt(baseLimit)}/mo</span>
                  ) : (
                    "Set budget"
                  )}
                </button>
              </div>
              {rollsOver && baseLimit > 0 && rollover !== 0 && (
                <p className="text-xs tabular-nums text-gray-600">
                  Base {fmt(baseLimit)} {rollover > 0 ? "+" : "−"}{" "}
                  <span
                    className={
                      rollover > 0
                        ? "text-emerald-700 font-semibold"
                        : "text-rose-700 font-semibold"
                    }
                  >
                    {fmt(Math.abs(rollover))}
                  </span>{" "}
                  {rollover > 0 ? "rollover" : "from overspend"} ={" "}
                  <b>{fmt(limit)}</b> available
                </p>
              )}
              {limit > 0 && (
                <button
                  type="button"
                  onClick={() => onCategoryClick(c.id)}
                  className="w-full text-left space-y-1.5"
                  aria-label={`View expenses in ${c.name}`}
                >
                  <div className="progress-bar">
                    <div
                      className={`progress-fill ${cls}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-gray-600 tabular-nums">
                    <span>
                      {fmt(used)} of {fmt(limit)} ({Math.round(pct)}%)
                    </span>
                    <span
                      className={
                        remaining < 0
                          ? "text-red-600 font-semibold"
                          : "text-gray-600"
                      }
                    >
                      {remaining >= 0
                        ? `${fmt(remaining)} left`
                        : `${fmt(-remaining)} over`}
                    </span>
                  </div>
                </button>
              )}
            </div>
          );
        })}
      </div>

      {editing && (
        <BudgetSettingsDialog
          category={editing}
          budget={editingBudget}
          onClose={() => setEditing(null)}
          onSave={(s) => {
            onSave(editing.id, s);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function BudgetSettingsDialog({
  category,
  budget,
  onClose,
  onSave,
}: {
  category: Category;
  budget: Budget | null;
  onClose: () => void;
  onSave: (s: BudgetSettings) => void;
}) {
  const [limit, setLimit] = useState<string>(
    budget && Number(budget.monthly_limit) > 0
      ? String(Number(budget.monthly_limit))
      : ""
  );
  const [rollsOver, setRollsOver] = useState<boolean>(!!budget?.rolls_over);
  const [isPersonal, setIsPersonal] = useState<boolean>(!!budget?.is_personal);
  const [personName, setPersonName] = useState<string>(
    budget?.person_name ?? ""
  );

  return (
    <DialogShell onClose={onClose}>
      <div>
        <h3 className="text-lg font-bold">Budget settings</h3>
        <p className="text-xs text-gray-500 mt-0.5">
          <span
            className="inline-block w-2 h-2 rounded-full align-middle mr-1.5"
            style={{ background: category.color }}
          />
          {category.name}
        </p>
      </div>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          const value = Number(limit);
          onSave({
            monthly_limit: Number.isFinite(value) ? value : 0,
            rolls_over: rollsOver,
            is_personal: isPersonal,
            person_name: isPersonal ? personName.trim() || null : null,
          });
        }}
        className="space-y-3"
      >
        <Field label="Monthly limit ($)">
          <input
            type="number"
            step="0.01"
            min="0"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            placeholder="0.00 (leave blank to remove)"
            className="w-full border rounded-lg px-3 py-2 mt-1 tabular-nums"
            autoFocus
          />
        </Field>

        <ToggleRow
          label="Is this a personal budget?"
          description="Mark this budget as belonging to one person."
          checked={isPersonal}
          onChange={setIsPersonal}
        />
        {isPersonal && (
          <Field label="Whose budget is it?">
            <input
              type="text"
              value={personName}
              onChange={(e) => setPersonName(e.target.value)}
              placeholder="e.g. Eric, Nick, Kate"
              maxLength={60}
              className="w-full border rounded-lg px-3 py-2 mt-1"
            />
          </Field>
        )}

        <ToggleRow
          label="Roll over unused balance?"
          description="Surplus carries forward; overspending deducts from next month. Compounds indefinitely."
          checked={rollsOver}
          onChange={setRollsOver}
        />

        <div className="flex justify-between pt-2">
          {budget ? (
            <button
              type="button"
              onClick={() => {
                if (!confirm(`Remove the budget for ${category.name}?`)) return;
                onSave({
                  monthly_limit: 0,
                  rolls_over: false,
                  is_personal: false,
                  person_name: null,
                });
              }}
              className="text-red-600 text-sm font-semibold"
            >
              Remove budget
            </button>
          ) : (
            <span />
          )}
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-gray-100 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold"
            >
              Save
            </button>
          </div>
        </div>
      </form>
    </DialogShell>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer select-none">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`shrink-0 mt-0.5 inline-flex h-6 w-10 items-center rounded-full transition ${
          checked ? "bg-emerald-500" : "bg-gray-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </button>
      <span className="flex-1">
        <span className="text-sm font-medium block">{label}</span>
        {description && (
          <span className="text-xs text-gray-500 block mt-0.5">
            {description}
          </span>
        )}
      </span>
    </label>
  );
}

function CategoriesTab({
  categories,
  onAdd,
  onEdit,
}: {
  categories: Category[];
  onAdd: () => void;
  onEdit: (c: Category) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Categories</h2>
        <button
          onClick={onAdd}
          className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold"
        >
          + Add Category
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm divide-y">
        {categories.map((c) => (
          <div
            key={c.id}
            onClick={() => onEdit(c)}
            className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
          >
            <span
              className="w-3 h-3 rounded-full inline-block shrink-0"
              style={{ background: c.color }}
            />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{c.name}</p>
              {c.is_default && (
                <p className="text-xs text-gray-400">Default</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ExpenseDialog({
  initial,
  categories,
  people,
  onCategoryCreated,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Expense | "new";
  categories: Category[];
  people: Person[];
  onCategoryCreated?: (c: Category) => void;
  onClose: () => void;
  onSave: (form: FormData, id?: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const isNew = initial === "new";
  const e = isNew ? null : initial;
  const today = new Date().toISOString().slice(0, 10);
  const [categoryId, setCategoryId] = useState<number>(
    e?.category_id ?? categories[0]?.id ?? 0
  );
  const [personId, setPersonId] = useState<number | null>(e?.person_id ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <DialogShell onClose={onClose}>
      <h3 className="text-lg font-bold">{isNew ? "Add Expense" : "Edit Expense"}</h3>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (saving) return;
          const fd = new FormData(ev.currentTarget);

          const amount = parseAmountInput(fd.get("amount"));
          if (!Number.isFinite(amount) || amount <= 0) {
            setError(
              "Enter an amount greater than 0 — numbers only (e.g. 24.99)."
            );
            return;
          }
          if (!categoryId) {
            setError("Pick a category.");
            return;
          }
          fd.set("amount", String(amount));
          fd.set("category_id", String(categoryId));
          fd.set("person_id", personId == null ? "" : String(personId));
          const dateValue = String(fd.get("date") ?? "");
          if (isFutureDate(dateValue)) {
            if (
              !confirm(
                "You're setting a date in the future. Save this expense for that date?"
              )
            )
              return;
          }
          setSaving(true);
          setError(null);
          try {
            await onSave(fd, e?.id);
            onClose();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setSaving(false);
          }
        }}
        className="space-y-3"
      >
        <Field label="Amount">
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            defaultValue={e?.amount ?? ""}
            placeholder="e.g. 24.99"
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <Field label="Category">
          <CategoryPicker
            value={categoryId}
            categories={categories}
            onChange={setCategoryId}
            onCreated={(c) => {
              onCategoryCreated?.(c);
              setCategoryId(c.id);
            }}
            className="mt-1"
          />
        </Field>
        {people.length > 0 && (
          <PersonSelector
            people={people}
            value={personId}
            onChange={setPersonId}
            className="mt-1"
          />
        )}
        <Field label="Description">
          <input
            name="description"
            type="text"
            defaultValue={e?.description ?? ""}
            placeholder="e.g. Costco run"
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <Field label="Date">
          <input
            name="date"
            type="date"
            required
            defaultValue={e?.date ?? today}
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <Field label="Notes">
          <textarea
            name="notes"
            rows={2}
            defaultValue={e?.notes ?? ""}
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <DialogFooter
          showDelete={!isNew}
          saving={saving}
          error={error}
          onDelete={async () => {
            if (!e) return;
            if (!confirm("Delete this expense?")) return;
            setSaving(true);
            setError(null);
            try {
              await onDelete(e.id);
              onClose();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setSaving(false);
            }
          }}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}

function FixedDialog({
  initial,
  categories,
  people,
  onClose,
  onSave,
  onDelete,
}: {
  initial: FixedCost | "new";
  categories: Category[];
  people: Person[];
  onClose: () => void;
  onSave: (form: FormData, id?: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const isNew = initial === "new";
  const f = isNew ? null : initial;
  const [personId, setPersonId] = useState<number | null>(f?.person_id ?? null);
  const [categoryId, setCategoryId] = useState<number>(
    f?.category_id ?? categories[0]?.id ?? 0
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noCategories = categories.length === 0;

  return (
    <DialogShell onClose={onClose}>
      <h3 className="text-lg font-bold">
        {isNew ? "Add Fixed Cost" : "Edit Fixed Cost"}
      </h3>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (saving) return;
          const fd = new FormData(ev.currentTarget);

          // Validate here so problems surface with a clear message. Previously
          // bad input threw inside the Server Action, the promise rejected
          // unhandled, and Save just looked dead.
          const name = String(fd.get("name") ?? "").trim();
          if (!name) {
            setError("Give this fixed cost a name.");
            return;
          }
          const amount = parseAmountInput(fd.get("amount"));
          if (!Number.isFinite(amount) || amount <= 0) {
            setError(
              "Enter an amount greater than 0 — numbers only (e.g. 1200 or 1,200)."
            );
            return;
          }
          if (!categoryId) {
            setError(
              noCategories
                ? "You have no categories yet — add one under Categories first."
                : "Pick a category."
            );
            return;
          }

          // Send clean, normalised values.
          fd.set("name", name);
          fd.set("amount", String(amount));
          fd.set("category_id", String(categoryId));
          if (!fd.has("is_active")) fd.set("is_active", "");
          fd.set("person_id", personId == null ? "" : String(personId));

          setSaving(true);
          setError(null);
          try {
            await onSave(fd, f?.id);
            onClose();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setSaving(false);
          }
        }}
        className="space-y-3"
      >
        <Field label="Name">
          <input
            name="name"
            type="text"
            defaultValue={f?.name ?? ""}
            placeholder="e.g. Mortgage"
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <Field label="Amount">
          {/* Deliberately type=text + inputMode=decimal: a number input
              silently blanks values like "1,200", which used to make Save
              fail with no explanation. parseAmountInput handles the rest. */}
          <input
            name="amount"
            type="text"
            inputMode="decimal"
            defaultValue={f?.amount ?? ""}
            placeholder="e.g. 1200"
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <Field label="Category">
          {noCategories ? (
            <p className="text-sm text-rose-700 mt-1">
              You have no categories yet — add one under Categories first.
            </p>
          ) : (
            <select
              name="category_id"
              value={categoryId}
              onChange={(ev) => setCategoryId(Number(ev.target.value))}
              className="w-full border rounded-lg px-3 py-2 mt-1"
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Frequency">
          <select
            name="frequency"
            defaultValue={f?.frequency ?? "monthly"}
            className="w-full border rounded-lg px-3 py-2 mt-1"
          >
            <option value="monthly">Monthly</option>
            <option value="biweekly">Biweekly</option>
            <option value="weekly">Weekly</option>
            <option value="yearly">Yearly</option>
          </select>
        </Field>
        {people.length > 0 && (
          <PersonSelector
            people={people}
            value={personId}
            onChange={setPersonId}
            className="mt-1"
          />
        )}
        <label className="flex items-center gap-2">
          <input
            name="is_active"
            type="checkbox"
            value="true"
            defaultChecked={f?.is_active ?? true}
          />
          <span className="text-sm">Active</span>
        </label>
        <DialogFooter
          showDelete={!isNew}
          saving={saving}
          error={error}
          onDelete={async () => {
            if (!f) return;
            if (!confirm("Delete this fixed cost?")) return;
            setSaving(true);
            setError(null);
            try {
              await onDelete(f.id);
              onClose();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setSaving(false);
            }
          }}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}

function CategoryDialog({
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Category | "new";
  onClose: () => void;
  onSave: (form: FormData, id?: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const isNew = initial === "new";
  const c = isNew ? null : initial;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <DialogShell onClose={onClose}>
      <h3 className="text-lg font-bold">
        {isNew ? "Add Category" : "Edit Category"}
      </h3>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (saving) return;
          const fd = new FormData(ev.currentTarget);
          const name = String(fd.get("name") ?? "").trim();
          if (!name) {
            setError("Give this category a name.");
            return;
          }
          fd.set("name", name);
          setSaving(true);
          setError(null);
          try {
            await onSave(fd, c?.id);
            onClose();
          } catch (err) {
            setError(errorText(err));
          } finally {
            setSaving(false);
          }
        }}
        className="space-y-3"
      >
        <Field label="Name">
          <input
            name="name"
            type="text"
            defaultValue={c?.name ?? ""}
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <Field label="Color">
          <input
            name="color"
            type="color"
            defaultValue={c?.color ?? "#6366f1"}
            className="w-full border rounded-lg h-10 mt-1"
          />
        </Field>
        <input name="icon" type="hidden" defaultValue={c?.icon ?? "•"} />
        <DialogFooter
          showDelete={!isNew && !c?.is_default}
          saving={saving}
          error={error}
          onDelete={async () => {
            if (!c) return;
            if (!confirm("Delete this category?")) return;
            setSaving(true);
            setError(null);
            try {
              await onDelete(c.id);
              onClose();
            } catch (err) {
              setError(errorText(err));
            } finally {
              setSaving(false);
            }
          }}
          onCancel={onClose}
        />
      </form>
    </DialogShell>
  );
}

function DialogShell({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3">
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

// Accepts what people actually type into a money field — "1,200", "$1,200",
// " 1200 " — and returns a number. NaN when there's nothing usable, so the
// caller can show a precise message instead of failing silently server-side.
function parseAmountInput(raw: unknown): number {
  const s = String(raw ?? "")
    .trim()
    .replace(/[^0-9.\-]/g, "");
  if (!s || s === "-" || s === ".") return NaN;
  return Number(s);
}

// Server Actions have their error messages masked in production builds, so a
// raw throw reaches the client as useless noise. Turn anything unrecognisable
// into a short, honest message the user can act on.
function errorText(e: unknown): string {
  const m = (e as { message?: string })?.message ?? "";
  if (
    !m ||
    m.length > 200 ||
    /server components render|an error occurred|digest/i.test(m)
  ) {
    return "Couldn't save. Check the fields above and try again.";
  }
  return m;
}

function DialogFooter({
  showDelete,
  onDelete,
  onCancel,
  saving = false,
  error = null,
}: {
  showDelete: boolean;
  onDelete: () => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string | null;
}) {
  return (
    <>
      {error && (
        <p
          role="alert"
          className="text-sm text-rose-700 bg-rose-50 ring-1 ring-rose-200 rounded-lg px-3 py-2"
        >
          {error}
        </p>
      )}
      <div className="flex justify-between pt-2">
        {showDelete ? (
          <button
            type="button"
            onClick={onDelete}
            disabled={saving}
            className="text-red-600 text-sm font-semibold disabled:opacity-50"
          >
            Delete
          </button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-2 rounded-lg bg-gray-100 text-sm disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </>
  );
}

// =============================================================
// Drill-down drawer (opens when a stat card is clicked)
// =============================================================
function DrillDrawer({
  kind,
  monthLabel,
  monthExpenses,
  fixedCosts,
  budgets,
  spentByCat,
  effectiveLimitByCat,
  catById,
  peopleById,
  categories,
  people,
  totals,
  onClose,
  onPickExpense,
  onPickFixed,
  onAddFixed,
  onJumpBudgets,
  onBulkUpdate,
  receiptBatchesById,
  onBulkDelete,
}: {
  kind: DrillKind;
  monthLabel: string;
  monthExpenses: Expense[];
  fixedCosts: FixedCost[];
  budgets: Budget[];
  spentByCat: Map<number, number>;
  effectiveLimitByCat: Map<number, EffectiveLimit>;
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  categories: Category[];
  people: Person[];
  totals: {
    totalSpent: number;
    totalBudget: number;
    totalFixed: number;
    remaining: number;
  };
  onClose: () => void;
  onPickExpense: (e: Expense) => void;
  onPickFixed: (f: FixedCost) => void;
  onAddFixed?: () => void;
  onJumpBudgets: () => void;
  onBulkUpdate: (
    ids: number[],
    patch: { category_id?: number; date?: string; person_id?: number | null }
  ) => Promise<void>;
  onBulkDelete: (ids: number[]) => Promise<void>;
  receiptBatchesById?: Map<number, ReceiptBatchRow>;
}) {
  const title =
    kind === "total"
      ? "Total Spending"
      : kind === "variable"
        ? "Variable Spending"
        : kind === "fixed"
          ? "Fixed Costs"
          : "Remaining Budget";

  const subtitle =
    kind === "total"
      ? `${monthLabel} • includes fixed`
      : kind === "variable"
        ? `${monthLabel} • expenses only`
        : kind === "fixed"
          ? "Monthly equivalent"
          : `${monthLabel}`;

  const headlineValue =
    kind === "total"
      ? totals.totalSpent + totals.totalFixed
      : kind === "variable"
        ? totals.totalSpent
        : kind === "fixed"
          ? totals.totalFixed
          : totals.remaining;

  const showBulk = kind === "total" || kind === "variable";
  const sortedExpenses = useMemo(
    () =>
      [...monthExpenses].sort((a, b) =>
        a.date > b.date ? -1 : a.date < b.date ? 1 : b.id - a.id
      ),
    [monthExpenses]
  );

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 flex items-end md:items-center md:justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full md:max-w-md md:rounded-2xl rounded-t-2xl shadow-xl max-h-[85vh] flex flex-col overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b">
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                {subtitle}
              </p>
              <h3 className="text-lg font-bold mt-0.5">{title}</h3>
              <p className="text-2xl font-bold tabular-nums mt-1">
                {fmt(headlineValue)}
              </p>
            </div>
            <button
              onClick={onClose}
              aria-label="Close"
              className="text-gray-400 hover:text-gray-700 inline-flex"
            >
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
        <div className="overflow-y-auto p-3 space-y-1">
          {showBulk && (
            <BulkEditableExpenseList
              expenses={sortedExpenses}
              categories={categories}
              people={people}
              catById={catById}
              peopleById={peopleById}
              receiptBatchesById={receiptBatchesById}
              onPickExpense={onPickExpense}
              onBulkUpdate={onBulkUpdate}
              onBulkDelete={onBulkDelete}
              emptyText="No expenses yet this month."
            />
          )}
          {kind === "total" && (
            <>
              <p className="px-3 pt-3 pb-1 text-xs uppercase tracking-wide text-gray-500 font-semibold">
                Plus fixed costs
              </p>
              <FixedRows
                fixedCosts={fixedCosts}
                catById={catById}
                onPick={onPickFixed}
              />
            </>
          )}
          {kind === "fixed" && (
            <>
              {onAddFixed && (
                <button
                  type="button"
                  onClick={onAddFixed}
                  className="w-full px-4 py-3 rounded-xl bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 font-semibold text-sm hover:bg-emerald-100 active:scale-[0.99] transition mb-2"
                >
                  + Add fixed cost
                </button>
              )}
              <FixedRows
                fixedCosts={fixedCosts}
                catById={catById}
                onPick={onPickFixed}
              />
            </>
          )}
          {kind === "remaining" && (
            <RemainingList
              budgets={budgets}
              spentByCat={spentByCat}
              effectiveLimitByCat={effectiveLimitByCat}
              catById={catById}
              onJump={onJumpBudgets}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function FixedRows({
  fixedCosts,
  catById,
  onPick,
}: {
  fixedCosts: FixedCost[];
  catById: Map<number, Category>;
  onPick: (f: FixedCost) => void;
}) {
  if (!fixedCosts.length)
    return (
      <p className="p-4 text-sm text-gray-500 text-center">No fixed costs.</p>
    );
  return (
    <>
      {fixedCosts.map((f) => {
        const c = catById.get(f.category_id);
        const monthly = fixedMonthlyEquivalent(f);
        return (
          <button
            key={f.id}
            onClick={() => onPick(f)}
            className="w-full text-left flex items-center gap-2 px-3 py-2 hover:bg-gray-50 rounded-lg"
          >
            <span
              className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white shadow-sm shrink-0 max-w-[35%]"
              style={{ background: c?.color ?? "#9ca3af" }}
              title={c?.name ?? "Unknown"}
            >
              <span className="truncate">{c?.name ?? "Unknown"}</span>
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm truncate">{f.name}</p>
              <p className="text-[11px] text-gray-500 truncate">
                {fmt(f.amount)} {f.frequency}
              </p>
            </div>
            <p className="font-semibold text-sm tabular-nums shrink-0">
              {fmt(monthly)}/mo
            </p>
          </button>
        );
      })}
    </>
  );
}

function RemainingList({
  budgets,
  spentByCat,
  effectiveLimitByCat,
  catById,
  onJump,
}: {
  budgets: Budget[];
  spentByCat: Map<number, number>;
  effectiveLimitByCat: Map<number, EffectiveLimit>;
  catById: Map<number, Category>;
  onJump: () => void;
}) {
  if (!budgets.length)
    return (
      <div className="p-5 text-center space-y-3">
        <p className="text-sm text-gray-600">
          You haven&apos;t set any budgets yet.
        </p>
        <button
          onClick={onJump}
          className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold"
        >
          Set up budgets
        </button>
      </div>
    );

  return (
    <>
      {budgets.map((b) => {
        const c = catById.get(b.category_id);
        const used = spentByCat.get(b.category_id) ?? 0;
        const eff = effectiveLimitByCat.get(b.category_id);
        const limit = eff?.effective ?? Number(b.monthly_limit);
        const rollover = eff?.rollover ?? 0;
        const rollsOver = !!eff?.rollsOver;
        const remaining = limit - used;
        const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
        const cls = used > limit ? "over" : pct > 80 ? "warn" : "ok";
        return (
          <div key={b.id} className="px-4 py-2.5 space-y-1.5">
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white shadow-sm shrink-0 max-w-[55%]"
                style={{ background: c?.color ?? "#9ca3af" }}
                title={c?.name ?? "Unknown"}
              >
                <span className="truncate">{c?.name ?? "Unknown"}</span>
              </span>
              {rollsOver && rollover !== 0 && (
                <span
                  className={`text-[10px] font-bold tabular-nums shrink-0 px-1.5 py-0.5 rounded-full ring-1 ${
                    rollover > 0
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      : "bg-rose-50 text-rose-700 ring-rose-200"
                  }`}
                  title="Rollover from prior months"
                >
                  {rollover > 0 ? "+" : ""}
                  {fmt(rollover)}
                </span>
              )}
              <p
                className={`ml-auto font-semibold tabular-nums shrink-0 ${
                  remaining < 0 ? "text-red-600" : "text-emerald-700"
                }`}
              >
                {remaining >= 0
                  ? `${fmt(remaining)} left`
                  : `${fmt(-remaining)} over`}
              </p>
            </div>
            <div className="progress-bar">
              <div
                className={`progress-fill ${cls}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}

// =============================================================
// Category drill drawer — opens when a budget/category is clicked
// =============================================================
function CategoryDrawer({
  categoryId,
  monthLabel,
  monthExpenses,
  fixedCosts,
  budgets,
  effectiveLimitByCat,
  catById,
  peopleById,
  categories,
  people,
  onClose,
  onPickExpense,
  onPickFixed,
  onBulkUpdate,
  onBulkDelete,
  onSaveCategory,
  onDeleteCategory,
  onSaveBudget,
}: {
  categoryId: number;
  monthLabel: string;
  monthExpenses: Expense[];
  fixedCosts: FixedCost[];
  budgets: Budget[];
  effectiveLimitByCat: Map<number, EffectiveLimit>;
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  categories: Category[];
  people: Person[];
  onClose: () => void;
  onPickExpense: (e: Expense) => void;
  onPickFixed: (f: FixedCost) => void;
  onBulkUpdate: (
    ids: number[],
    patch: { category_id?: number; date?: string; person_id?: number | null }
  ) => Promise<void>;
  onBulkDelete: (ids: number[]) => Promise<void>;
  onSaveCategory: (
    id: number,
    patch: { name: string; color: string }
  ) => Promise<void>;
  onDeleteCategory: (id: number) => Promise<void>;
  onSaveBudget: (
    categoryId: number,
    settings: BudgetSettings
  ) => Promise<void>;
}) {
  const c = catById.get(categoryId);
  const budget = budgets.find((b) => b.category_id === categoryId);

  // Inline-edit state for category + budget settings. Initialised from the
  // current category/budget; resets when the drawer is opened on a new
  // category id.
  const [name, setName] = useState(c?.name ?? "");
  const [color, setColor] = useState(c?.color ?? "#6366f1");
  const [limitStr, setLimitStr] = useState<string>(
    budget && Number(budget.monthly_limit) > 0
      ? String(Number(budget.monthly_limit))
      : ""
  );
  const [rollsOverEdit, setRollsOverEdit] = useState<boolean>(
    !!budget?.rolls_over
  );
  const [isPersonal, setIsPersonal] = useState<boolean>(!!budget?.is_personal);
  const [personName, setPersonName] = useState<string>(
    budget?.person_name ?? ""
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed local form state when switching categories.
  useEffect(() => {
    setName(c?.name ?? "");
    setColor(c?.color ?? "#6366f1");
    setLimitStr(
      budget && Number(budget.monthly_limit) > 0
        ? String(Number(budget.monthly_limit))
        : ""
    );
    setRollsOverEdit(!!budget?.rolls_over);
    setIsPersonal(!!budget?.is_personal);
    setPersonName(budget?.person_name ?? "");
    setError(null);
    // We intentionally key off categoryId so the form resets when the
    // user picks a different category without remounting the drawer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId]);

  const baseLimitNumeric = Number(limitStr);
  const baseLimitFromForm = Number.isFinite(baseLimitNumeric)
    ? baseLimitNumeric
    : 0;

  const dirty =
    !!c &&
    (name.trim() !== c.name ||
      color !== c.color ||
      baseLimitFromForm !== Number(budget?.monthly_limit ?? 0) ||
      rollsOverEdit !== !!budget?.rolls_over ||
      isPersonal !== !!budget?.is_personal ||
      (isPersonal ? personName.trim() : "") !== (budget?.person_name ?? ""));

  const rows = [...monthExpenses]
    .filter((e) => e.category_id === categoryId)
    .sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : b.id - a.id));
  const billsHere = fixedCosts.filter((f) => f.category_id === categoryId);
  const variableUsed = rows.reduce((s, e) => s + Number(e.amount), 0);
  const billsUsed = billsHere.reduce(
    (s, f) => s + fixedMonthlyEquivalent(f),
    0
  );
  const used = variableUsed + billsUsed;
  const baseLimit = budget ? Number(budget.monthly_limit) : 0;
  const eff = effectiveLimitByCat.get(categoryId);
  const limit = eff?.effective ?? baseLimit;
  const rollover = eff?.rollover ?? 0;
  const rollsOver = !!eff?.rollsOver;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const cls = used > limit ? "over" : pct > 80 ? "warn" : "ok";
  const remaining = limit - used;

  async function handleSave() {
    if (!c) return;
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSaveCategory(c.id, { name: name.trim(), color });
      await onSaveBudget(c.id, {
        monthly_limit: baseLimitFromForm,
        rolls_over: rollsOverEdit,
        is_personal: isPersonal,
        person_name: isPersonal ? personName.trim() || null : null,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!c) return;
    if (
      !confirm(
        `Delete "${c.name}"? This only works if no expenses or bills use it.`
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await onDeleteCategory(c.id);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 flex items-end md:items-center md:justify-center"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full md:max-w-md md:rounded-2xl rounded-t-2xl shadow-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
              {monthLabel}
            </p>
            <h3 className="text-lg font-bold mt-0.5 flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block"
                style={{ background: color || "#9ca3af" }}
              />
              <span className="truncate">{name || "Unknown"}</span>
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-gray-400 hover:text-gray-700 inline-flex p-0.5 shrink-0"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-3 bg-gray-50 space-y-4">
          {/* Editable category + budget settings */}
          {c && (
            <form
              onSubmit={(ev) => {
                ev.preventDefault();
                handleSave();
              }}
              className="bg-white rounded-2xl ring-1 ring-gray-100 shadow-sm p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  Category settings
                </p>
                {dirty && (
                  <span className="text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-full px-2 py-0.5">
                    Unsaved changes
                  </span>
                )}
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 rounded p-2">
                  {error}
                </p>
              )}
              <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                <Field label="Name">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="w-full border rounded-lg px-3 py-2 mt-1"
                  />
                </Field>
                <Field label="Color">
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="border rounded-lg h-10 w-14 mt-1 p-1 cursor-pointer"
                    aria-label="Category color"
                  />
                </Field>
              </div>
              <Field label="Monthly budget ($)">
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={limitStr}
                  onChange={(e) => setLimitStr(e.target.value)}
                  placeholder="0.00 (leave blank for no budget)"
                  className="w-full border rounded-lg px-3 py-2 mt-1 tabular-nums"
                />
              </Field>
              <ToggleRow
                label="Is this a personal budget?"
                description="Mark this category as belonging to one person."
                checked={isPersonal}
                onChange={setIsPersonal}
              />
              {isPersonal && (
                <Field label="Whose budget is it?">
                  <input
                    type="text"
                    value={personName}
                    onChange={(e) => setPersonName(e.target.value)}
                    placeholder="e.g. Eric, Nick, Kate"
                    maxLength={60}
                    className="w-full border rounded-lg px-3 py-2 mt-1"
                  />
                </Field>
              )}
              <ToggleRow
                label="Roll over unused balance?"
                description="Surplus carries forward; overspending deducts from next month. Compounds indefinitely."
                checked={rollsOverEdit}
                onChange={setRollsOverEdit}
              />
              <div className="flex items-center justify-between gap-2 pt-1">
                {!c.is_default ? (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busy}
                    className="text-red-600 text-sm font-semibold disabled:opacity-50"
                  >
                    Delete category
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="submit"
                  disabled={busy || !dirty}
                  className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Save"}
                </button>
              </div>
            </form>
          )}

          {/* Spending summary */}
          <div className="bg-white rounded-2xl ring-1 ring-gray-100 shadow-sm p-4 space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
              Spending • {monthLabel}
            </p>
            <p className="text-2xl font-bold tabular-nums">{fmt(used)}</p>
            {limit > 0 && (
              <>
                <div className="progress-bar">
                  <div
                    className={`progress-fill ${cls}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500 tabular-nums">
                  {fmt(used)} of {fmt(limit)} budget ({Math.round(pct)}%) •{" "}
                  {remaining >= 0
                    ? `${fmt(remaining)} left`
                    : `${fmt(-remaining)} over`}
                </p>
                {rollsOver && rollover !== 0 && (
                  <p className="text-xs tabular-nums">
                    <span className="text-gray-500">
                      Base {fmt(baseLimit)}
                    </span>{" "}
                    <span
                      className={
                        rollover > 0
                          ? "text-emerald-700 font-semibold"
                          : "text-rose-700 font-semibold"
                      }
                    >
                      {rollover > 0 ? "+ " : "− "}
                      {fmt(Math.abs(rollover))}
                    </span>{" "}
                    <span className="text-gray-500">
                      {rollover > 0 ? "rolled over" : "from overspend"}
                    </span>
                  </p>
                )}
              </>
            )}
          </div>

          {billsHere.length > 0 && (
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold px-1">
                Recurring bills • {fmt(billsUsed)}/mo
              </p>
              {billsHere.map((f) => {
                const monthly = fixedMonthlyEquivalent(f);
                return (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => onPickFixed(f)}
                    className="w-full text-left bg-white rounded-2xl ring-1 ring-violet-100 shadow-sm px-3.5 py-3 flex items-start gap-3 hover:ring-violet-200 hover:shadow active:scale-[0.99] transition"
                  >
                    <span
                      className="w-9 h-9 rounded-full inline-flex items-center justify-center shrink-0 mt-0.5 bg-violet-100 text-violet-700"
                      aria-hidden="true"
                    >
                      <svg
                        width="18"
                        height="18"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21V3z" />
                        <path d="M9 8h6M9 12h6M9 16h4" />
                      </svg>
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-[15px] text-gray-900 truncate">
                        {f.name}
                      </p>
                      <p className="text-[11px] text-gray-500 mt-0.5 tabular-nums">
                        {fmt(f.amount)} {f.frequency}
                      </p>
                    </div>
                    <p className="font-extrabold text-[15px] tabular-nums shrink-0 text-gray-900 mt-0.5">
                      {fmt(monthly)}/mo
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold px-1">
              Expenses • {fmt(variableUsed)}
            </p>
            {rows.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 text-center bg-white rounded-2xl ring-1 ring-gray-100">
                {billsHere.length === 0
                  ? `Nothing in this category for ${monthLabel}.`
                  : "No variable expenses this month — only the bills above."}
              </p>
            ) : (
              <BulkEditableExpenseList
                expenses={rows}
                categories={categories}
                people={people}
                catById={catById}
                peopleById={peopleById}
                onPickExpense={onPickExpense}
                onBulkUpdate={onBulkUpdate}
                onBulkDelete={onBulkDelete}
                showDate
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================
// Bulk edit — works on expense lists wherever they appear
// =============================================================
function BulkEditableExpenseList({
  expenses,
  categories,
  people,
  catById,
  peopleById,
  onPickExpense,
  onBulkUpdate,
  onBulkDelete,
  showDate = false,
  emptyText,
  receiptBatchesById,
}: {
  expenses: Expense[];
  categories: Category[];
  people: Person[];
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  onPickExpense: (e: Expense) => void;
  onBulkUpdate: (
    ids: number[],
    patch: { category_id?: number; date?: string; person_id?: number | null }
  ) => Promise<void>;
  onBulkDelete: (ids: number[]) => Promise<void>;
  showDate?: boolean;
  emptyText?: string;
  receiptBatchesById?: Map<number, ReceiptBatchRow>;
}) {
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  // If the visible list shrinks, drop any IDs that fell out of view.
  useEffect(() => {
    if (!selected.size) return;
    const visible = new Set(expenses.map((e) => e.id));
    let changed = false;
    const next = new Set<number>();
    for (const id of selected) {
      if (visible.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) setSelected(next);
  }, [expenses, selected]);

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(expenses.map((e) => e.id)));
  }

  function exitSelect() {
    setSelectMode(false);
    setSelected(new Set());
  }

  if (expenses.length === 0) {
    return (
      <p className="p-4 text-sm text-gray-500 text-center">
        {emptyText ?? "No expenses to show."}
      </p>
    );
  }

  const ids = Array.from(selected);
  const allSelected = ids.length === expenses.length && expenses.length > 0;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap text-sm">
        {!selectMode ? (
          <button
            type="button"
            onClick={() => setSelectMode(true)}
            className="px-3 py-1.5 rounded-lg font-semibold bg-white ring-1 ring-gray-200 text-gray-700 hover:bg-gray-50"
          >
            Bulk edit
          </button>
        ) : (
          <>
            <span className="font-semibold tabular-nums">
              {ids.length} selected
            </span>
            <button
              type="button"
              onClick={allSelected ? () => setSelected(new Set()) : selectAll}
              className="text-xs underline text-gray-700"
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={ids.length === 0 || busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white disabled:opacity-50"
            >
              Edit fields
            </button>
            <button
              type="button"
              onClick={async () => {
                if (ids.length === 0) return;
                if (
                  !confirm(
                    `Delete ${ids.length} expense${ids.length === 1 ? "" : "s"}?`
                  )
                )
                  return;
                setBusy(true);
                try {
                  await onBulkDelete(ids);
                  exitSelect();
                } catch (err) {
                  // Never fail silently — a dead-looking button is worse than
                  // an error message.
                  alert(errorText(err));
                } finally {
                  setBusy(false);
                }
              }}
              disabled={ids.length === 0 || busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-50 text-rose-700 ring-1 ring-rose-200 disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={exitSelect}
              className="ml-auto text-xs underline text-gray-500"
            >
              Done
            </button>
          </>
        )}
      </div>
      <div className="space-y-2">
        {(() => {
          const elements: React.ReactNode[] = [];
          let prevBatchId: number | null | undefined = undefined;
          for (const e of expenses) {
            const batchId = e.receipt_batch_id ?? null;
            if (batchId !== prevBatchId) {
              if (batchId != null && receiptBatchesById?.has(batchId)) {
                const batch = receiptBatchesById.get(batchId)!;
                const dateStr = batch.scanned_at
                  ? new Date(batch.scanned_at).toLocaleDateString()
                  : null;
                elements.push(
                  <div
                    key={`batch-${batchId}`}
                    className="flex items-center gap-2 text-xs text-emerald-800 bg-emerald-50/80 ring-1 ring-emerald-100 rounded-lg px-3 py-1.5 mt-2"
                  >
                    <span aria-hidden="true">🧾</span>
                    <span className="font-semibold">
                      Receipt: {batch.merchant || "(no merchant)"}
                    </span>
                    {batch.total_extracted != null && (
                      <span className="tabular-nums">
                        · {fmt(Number(batch.total_extracted))}
                      </span>
                    )}
                    {dateStr && (
                      <span className="text-emerald-700/80 ml-auto">
                        {dateStr}
                      </span>
                    )}
                  </div>
                );
              }
              prevBatchId = batchId;
            }
            elements.push(
              <SelectableExpenseRow
                key={e.id}
                e={e}
                catById={catById}
                peopleById={peopleById}
                selectMode={selectMode}
                checked={selected.has(e.id)}
                onToggle={() => toggle(e.id)}
                onClick={() => onPickExpense(e)}
                showDate={showDate}
                indented={
                  batchId != null && receiptBatchesById?.has(batchId)
                }
              />
            );
          }
          return elements;
        })()}
      </div>
      {editing && (
        <BulkEditExpenseDialog
          count={ids.length}
          categories={categories}
          people={people}
          onClose={() => setEditing(false)}
          onApply={async (patch) => {
            setBusy(true);
            try {
              await onBulkUpdate(ids, patch);
              exitSelect();
            } finally {
              setBusy(false);
            }
          }}
        />
      )}
    </div>
  );
}

function SelectableExpenseRow({
  e,
  catById,
  peopleById,
  selectMode,
  checked,
  onToggle,
  onClick,
  showDate,
  indented = false,
}: {
  e: Expense;
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  selectMode: boolean;
  checked: boolean;
  onToggle: () => void;
  onClick: () => void;
  showDate: boolean;
  indented?: boolean;
}) {
  if (!selectMode) {
    return (
      <div className={indented ? "ml-4 border-l-2 border-emerald-100 pl-2" : ""}>
        <ExpenseRow
          e={e}
          catById={catById}
          peopleById={peopleById}
          onClick={onClick}
          showDate={showDate}
        />
      </div>
    );
  }
  return (
    <div
      className={`flex items-stretch gap-2 ${
        indented ? "ml-4 border-l-2 border-emerald-100 pl-2" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={checked}
        aria-label={checked ? "Deselect" : "Select"}
        className={`shrink-0 w-9 rounded-2xl flex items-center justify-center transition ${
          checked
            ? "bg-emerald-500 text-white"
            : "bg-white text-gray-400 ring-1 ring-gray-200"
        }`}
      >
        {checked ? (
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12l5 5L20 7" />
          </svg>
        ) : (
          <span className="w-4 h-4 rounded-full border-2 border-current" />
        )}
      </button>
      <div className="flex-1">
        <button
          type="button"
          onClick={onToggle}
          className="w-full text-left"
        >
          <ExpenseRow
            e={e}
            catById={catById}
            peopleById={peopleById}
            showDate={showDate}
          />
        </button>
      </div>
    </div>
  );
}

function BulkEditExpenseDialog({
  count,
  categories,
  people,
  onClose,
  onApply,
}: {
  count: number;
  categories: Category[];
  people: Person[];
  onClose: () => void;
  onApply: (patch: {
    category_id?: number;
    date?: string;
    person_id?: number | null;
  }) => Promise<void>;
}) {
  const [applyCategory, setApplyCategory] = useState(false);
  const [applyDate, setApplyDate] = useState(false);
  const [applyPerson, setApplyPerson] = useState(false);
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 0);
  const [date, setDate] = useState(todayLocalISO());
  const [personId, setPersonId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nothingToDo = !applyCategory && !applyDate && !applyPerson;

  return (
    <DialogShell onClose={onClose}>
      <h3 className="text-lg font-bold">
        Edit {count} expense{count === 1 ? "" : "s"}
      </h3>
      <p className="text-sm text-gray-600">
        Tick the field you want to change for all selected expenses.
      </p>
      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>
      )}
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          if (nothingToDo) {
            onClose();
            return;
          }
          if (applyDate && isFutureDate(date)) {
            if (
              !confirm(
                "You're setting a date in the future. Apply this date to all selected expenses?"
              )
            )
              return;
          }
          setBusy(true);
          setError(null);
          try {
            const patch: {
              category_id?: number;
              date?: string;
              person_id?: number | null;
            } = {};
            if (applyCategory) patch.category_id = categoryId;
            if (applyDate) patch.date = date;
            if (applyPerson) patch.person_id = personId;
            await onApply(patch);
            onClose();
          } catch (err) {
            setError((err as Error).message);
          } finally {
            setBusy(false);
          }
        }}
        className="space-y-3"
      >
        <div className="space-y-2">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={applyCategory}
              onChange={(e) => setApplyCategory(e.target.checked)}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="text-sm font-medium block">Category</span>
              {applyCategory && (
                <CategoryPicker
                  value={categoryId}
                  categories={categories}
                  onChange={setCategoryId}
                  className="mt-1"
                />
              )}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={applyDate}
              onChange={(e) => setApplyDate(e.target.checked)}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="text-sm font-medium block">Date</span>
              {applyDate && (
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 mt-1"
                  required
                />
              )}
            </span>
          </label>
          {people.length > 0 && (
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={applyPerson}
                onChange={(e) => setApplyPerson(e.target.checked)}
                className="mt-1"
              />
              <span className="flex-1">
                <span className="text-sm font-medium block">Person</span>
                {applyPerson && (
                  <PersonSelector
                    people={people}
                    value={personId}
                    onChange={setPersonId}
                    className="mt-1"
                  />
                )}
              </span>
            </label>
          )}
        </div>
        <div className="flex justify-between pt-2">
          <span />
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-gray-100 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy || nothingToDo}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              {busy ? "Saving…" : `Apply to ${count}`}
            </button>
          </div>
        </div>
      </form>
    </DialogShell>
  );
}

// =============================================================
// "More" sheet — for the mobile bottom-nav More button
// =============================================================
function MoreSheet({
  onClose,
  onTab,
}: {
  onClose: () => void;
  onTab: (t: Tab) => void;
}) {
  const items: {
    label: string;
    Icon: (p: { size?: number; className?: string }) => React.ReactElement;
    href?: string;
    tab?: Tab;
  }[] = [
    { label: "Fixed Costs", Icon: IconReceipt, tab: "fixed" },
    { label: "Budgets", Icon: IconTarget, tab: "budgets" },
    { label: "Categories", Icon: IconTag, tab: "categories" },
    { label: "Expenses", Icon: IconList, tab: "expenses" },
    { label: "Help & FAQ", Icon: IconHelp, href: "/settings/help" },
    { label: "Send feedback", Icon: IconChat, href: "/settings#feedback" },
    { label: "Settings & Export", Icon: IconSettings, href: "/settings" },
  ];
  return (
    <div
      className="fixed inset-0 z-40 bg-black/30 flex items-end"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white w-full rounded-t-2xl shadow-xl pb-6">
        <div className="flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>
        <div className="px-5 pt-2 pb-4">
          <h3 className="text-lg font-bold">More</h3>
        </div>
        <div className="grid grid-cols-2 gap-3 px-5">
          {items.map((it) =>
            it.href ? (
              <Link
                key={it.label}
                href={it.href}
                onClick={onClose}
                className="bg-gray-50 hover:bg-gray-100 rounded-2xl p-4 flex flex-col gap-2 text-emerald-700"
              >
                <it.Icon size={24} />
                <span className="text-sm font-semibold text-gray-800">
                  {it.label}
                </span>
              </Link>
            ) : (
              <button
                key={it.label}
                onClick={() => it.tab && onTab(it.tab)}
                className="bg-gray-50 hover:bg-gray-100 rounded-2xl p-4 flex flex-col gap-2 text-left text-emerald-700"
              >
                <it.Icon size={24} />
                <span className="text-sm font-semibold text-gray-800">
                  {it.label}
                </span>
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

// =============================================================
// Mobile bottom navigation: Home / Add / [Scan] / History / More
// =============================================================
function BottomNav({
  currentTab,
  onTab,
  onMore,
  onAddExpense,
  onAddFixed,
  onAddBudget,
  onAddIncome,
}: {
  currentTab: Tab;
  onTab: (t: Tab) => void;
  onMore: () => void;
  onAddExpense: () => void;
  onAddFixed: () => void;
  onAddBudget: () => void;
  onAddIncome: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);

  function pick(action: () => void) {
    setAddOpen(false);
    action();
  }

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.25rem)" }}
      >
        <div className="max-w-5xl mx-auto px-2 grid grid-cols-5 items-end pt-3">
          <NavBtn
            label="Home"
            Icon={IconHome}
            active={currentTab === "dashboard"}
            onClick={() => onTab("dashboard")}
          />
          <NavBtn
            label="Add"
            Icon={IconPlus}
            onClick={() => setAddOpen(true)}
            tourId="bottom-add"
          />
          <Link
            href="/scan"
            aria-label="Scan receipt"
            data-tour-id="bottom-scan"
            className="flex justify-center -mt-6"
          >
            <span className="w-14 h-14 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-lg ring-4 ring-white">
              <IconCamera size={26} strokeWidth={2} />
            </span>
          </Link>
          <NavBtn
            label="History"
            Icon={IconClock}
            active={currentTab === "expenses"}
            onClick={() => onTab("expenses")}
          />
          <NavBtn label="More" Icon={IconMore} onClick={onMore} tourId="bottom-more" />
        </div>
      </nav>

      {addOpen && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 flex items-end"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAddOpen(false);
          }}
        >
          <div
            className="w-full bg-white rounded-t-3xl shadow-2xl p-4 space-y-2"
            style={{
              paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex justify-center pb-2">
              <span className="block w-10 h-1 rounded-full bg-gray-300" />
            </div>
            <h3 className="text-sm font-semibold text-gray-500 text-center pb-1">
              What do you want to add?
            </h3>
            <button
              onClick={() => pick(onAddExpense)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-50 hover:bg-emerald-100 ring-1 ring-emerald-100"
            >
              <span className="text-2xl">💸</span>
              <span className="flex-1 text-left">
                <span className="block font-semibold text-emerald-900">
                  Expense
                </span>
                <span className="block text-xs text-emerald-700">
                  One-time spend (groceries, gas, takeout)
                </span>
              </span>
            </button>
            <button
              onClick={() => pick(onAddFixed)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-sky-50 hover:bg-sky-100 ring-1 ring-sky-100"
            >
              <span className="text-2xl">🏠</span>
              <span className="flex-1 text-left">
                <span className="block font-semibold text-sky-900">
                  Fixed cost
                </span>
                <span className="block text-xs text-sky-700">
                  Recurring bill (rent, subscription, insurance)
                </span>
              </span>
            </button>
            <button
              onClick={() => pick(onAddIncome)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-amber-50 hover:bg-amber-100 ring-1 ring-amber-100"
            >
              <span className="text-2xl">💵</span>
              <span className="flex-1 text-left">
                <span className="block font-semibold text-amber-900">
                  Add Income
                </span>
                <span className="block text-xs text-amber-700">
                  Paycheck, sale, side gig, or any money in
                </span>
              </span>
            </button>
            <button
              onClick={() => pick(onAddBudget)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-violet-50 hover:bg-violet-100 ring-1 ring-violet-100"
            >
              <span className="text-2xl">🎯</span>
              <span className="flex-1 text-left">
                <span className="block font-semibold text-violet-900">
                  Budget
                </span>
                <span className="block text-xs text-violet-700">
                  Set a monthly cap on a category
                </span>
              </span>
            </button>
            <Link
              href="/scan"
              onClick={() => setAddOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-rose-50 hover:bg-rose-100 ring-1 ring-rose-100"
            >
              <span className="text-2xl">📸</span>
              <span className="flex-1 text-left">
                <span className="block font-semibold text-rose-900">
                  Scan a receipt
                </span>
                <span className="block text-xs text-rose-700">
                  AI extracts every line item
                </span>
              </span>
            </Link>
            <button
              onClick={() => setAddOpen(false)}
              className="w-full px-4 py-3 mt-1 rounded-xl bg-gray-100 text-gray-700 font-semibold hover:bg-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function NavBtn({
  label,
  Icon,
  active = false,
  onClick,
  tourId,
}: {
  label: string;
  Icon: (p: { size?: number; className?: string }) => React.ReactElement;
  active?: boolean;
  onClick: () => void;
  tourId?: string;
}) {
  return (
    <button
      onClick={onClick}
      data-tour-id={tourId}
      className={`flex flex-col items-center gap-0.5 py-2 ${
        active ? "text-emerald-600" : "text-gray-500"
      }`}
    >
      <Icon size={22} />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}
