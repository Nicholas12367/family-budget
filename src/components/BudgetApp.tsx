"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { Budget, Category, Expense, FixedCost, Person } from "@/lib/types";
import PersonSelector from "./PersonSelector";
import { fmt, fixedMonthlyEquivalent } from "@/lib/money";
import { createExpense, deleteExpense, updateExpense } from "@/app/actions/expenses";
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
} from "./Icon";


type Tab = "dashboard" | "expenses" | "fixed" | "budgets" | "categories";

type Props = {
  email: string;
  initialCategories: Category[];
  initialExpenses: Expense[];
  initialFixedCosts: FixedCost[];
  initialBudgets: Budget[];
  initialPeople: Person[];
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
}: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [tab, setTab] = useState<Tab>("dashboard");
  const [categories, setCategories] = useState(initialCategories);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [fixedCosts, setFixedCosts] = useState(initialFixedCosts);
  const [budgets, setBudgets] = useState(initialBudgets);
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

  const [, startTransition] = useTransition();

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
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

  // Remaining = sum of (limit - spent) across budgeted categories,
  // clamped at 0 per cat so a maxed-out cat doesn't hide an under-budget
  // one. Negative on the overall total still shows as "over budget."
  const remaining = budgets.reduce(
    (s, b) =>
      s + (Number(b.monthly_limit) - (spentByCat.get(b.category_id) ?? 0)),
    0
  );

  const catById = useMemo(() => {
    const m = new Map<number, Category>();
    categories.forEach((c) => m.set(c.id, c));
    return m;
  }, [categories]);

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
            catById={catById}
            peopleById={peopleById}
            onEditExpense={(e) => setEditExpense(e)}
            onDrill={setDrill}
            onCategoryDrill={(catId) => setCategoryDrill(catId)}
          />
        )}
        {tab === "expenses" && (
          <ExpensesTab
            monthLabel={`${MONTH_NAMES[month]} ${year}`}
            monthExpenses={monthExpenses}
            allExpenses={expenses}
            catById={catById}
            peopleById={peopleById}
            onAdd={() => setEditExpense("new")}
            onEdit={(e) => setEditExpense(e)}
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
            onCategoryClick={(catId) => setCategoryDrill(catId)}
            onChange={(catId, val) => {
              startTransition(async () => {
                await setBudget({ category_id: catId, monthly_limit: val });
                setBudgets((prev) => {
                  const i = prev.findIndex((b) => b.category_id === catId);
                  if (!val || val <= 0) {
                    if (i >= 0) {
                      const next = [...prev];
                      next.splice(i, 1);
                      return next;
                    }
                    return prev;
                  }
                  if (i >= 0) {
                    const next = [...prev];
                    next[i] = { ...next[i], monthly_limit: val };
                    return next;
                  }
                  return [
                    ...prev,
                    {
                      id: -Date.now(),
                      user_id: "",
                      category_id: catId,
                      monthly_limit: val,
                    },
                  ];
                });
              });
            }}
          />
        )}
        {tab === "categories" && (
          <CategoriesTab
            categories={categories}
            onAdd={() => setEditCategory("new")}
            onEdit={(c) => setEditCategory(c)}
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
            const data = Object.fromEntries(form);
            const pidRaw = String(data.person_id ?? "");
            const person_id = pidRaw === "" ? null : Number(pidRaw);
            if (id) {
              await updateExpense(id, form);
              setExpenses((prev) =>
                prev.map((e) =>
                  e.id === id
                    ? {
                        ...e,
                        category_id: Number(data.category_id),
                        amount: Number(data.amount),
                        description: String(data.description ?? ""),
                        notes: String(data.notes ?? ""),
                        date: String(data.date),
                        person_id,
                      }
                    : e
                )
              );
            } else {
              await createExpense(form);
              const newRow: Expense = {
                id: -Date.now(),
                user_id: "",
                category_id: Number(data.category_id),
                receipt_batch_id: null,
                amount: Number(data.amount),
                description: String(data.description ?? ""),
                notes: String(data.notes ?? ""),
                date: String(data.date),
                person_id,
              };
              setExpenses((prev) => [newRow, ...prev]);
            }
          }}
          onDelete={async (id) => {
            await deleteExpense(id);
            setExpenses((prev) => prev.filter((e) => e.id !== id));
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
            const data = Object.fromEntries(form);
            const pidRaw = String(data.person_id ?? "");
            const person_id = pidRaw === "" ? null : Number(pidRaw);
            if (id) {
              await updateFixedCost(id, form);
              setFixedCosts((prev) =>
                prev.map((f) =>
                  f.id === id
                    ? {
                        ...f,
                        category_id: Number(data.category_id),
                        name: String(data.name),
                        amount: Number(data.amount),
                        frequency: data.frequency as FixedCost["frequency"],
                        is_active: !!data.is_active,
                        person_id,
                      }
                    : f
                )
              );
            } else {
              await createFixedCost(form);
              const newRow: FixedCost = {
                id: -Date.now(),
                user_id: "",
                category_id: Number(data.category_id),
                name: String(data.name),
                amount: Number(data.amount),
                frequency: data.frequency as FixedCost["frequency"],
                is_active: !!data.is_active,
                person_id,
              };
              setFixedCosts((prev) => [...prev, newRow]);
            }
          }}
          onDelete={async (id) => {
            await deleteFixedCost(id);
            setFixedCosts((prev) => prev.filter((f) => f.id !== id));
          }}
        />
      )}

      {editCategory !== null && (
        <CategoryDialog
          initial={editCategory}
          onClose={() => setEditCategory(null)}
          onSave={async (form, id) => {
            const data = Object.fromEntries(form);
            if (id) {
              await updateCategory(id, form);
              setCategories((prev) =>
                prev.map((c) =>
                  c.id === id
                    ? {
                        ...c,
                        name: String(data.name),
                        icon: String(data.icon ?? "🏷️"),
                        color: String(data.color),
                      }
                    : c
                )
              );
            } else {
              await createCategory(form);
              const newCat: Category = {
                id: -Date.now(),
                user_id: "",
                name: String(data.name),
                icon: String(data.icon ?? "🏷️"),
                color: String(data.color),
                is_default: false,
              };
              setCategories((prev) => [...prev, newCat]);
            }
          }}
          onDelete={async (id) => {
            await deleteCategory(id);
            setCategories((prev) => prev.filter((c) => c.id !== id));
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
          catById={catById}
          peopleById={peopleById}
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
          onJumpBudgets={() => {
            setDrill(null);
            setTab("budgets");
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
          catById={catById}
          peopleById={peopleById}
          onClose={() => setCategoryDrill(null)}
          onPickExpense={(e) => {
            setCategoryDrill(null);
            setEditExpense(e);
          }}
          onPickFixed={(f) => {
            setCategoryDrill(null);
            setEditFixed(f);
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
      />
      <div className="h-28 md:hidden" aria-hidden="true" />
    </div>
  );
}

function Header({
  email,
  monthLabel,
  onPrevMonth,
  onNextMonth,
}: {
  email: string;
  monthLabel: string;
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
  catById,
  peopleById,
  onEditExpense,
  onDrill,
  onCategoryDrill,
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
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  onEditExpense: (e: Expense) => void;
  onDrill?: (kind: DrillKind) => void;
  onCategoryDrill?: (categoryId: number) => void;
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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Total"
          sublabel="Variable + Fixed"
          value={fmt(totals.totalSpent + totals.totalFixed)}
          accent="emerald"
          onClick={() => onDrill?.("total")}
        />
        <StatCard
          label="Variable"
          sublabel="This month"
          value={fmt(totals.totalSpent)}
          accent="sky"
          onClick={() => onDrill?.("variable")}
        />
        <StatCard
          label="Fixed"
          sublabel="Monthly equiv."
          value={fmt(totals.totalFixed)}
          accent="violet"
          onClick={() => onDrill?.("fixed")}
        />
        <StatCard
          label="Remaining"
          sublabel="Across all budgets"
          value={fmt(totals.remaining)}
          accent={totals.remaining < 0 ? "rose" : "emerald"}
          onClick={() => onDrill?.("remaining")}
        />
      </div>

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
                const limit = Number(b.monthly_limit);
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
  catById,
  peopleById,
  onAdd,
  onEdit,
}: {
  monthLabel: string;
  monthExpenses: Expense[];
  allExpenses: Expense[];
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  onAdd: () => void;
  onEdit: (e: Expense) => void;
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
        <div className="space-y-2">
          {filtered.map((e) => (
            <ExpenseRow
              key={e.id}
              e={e}
              catById={catById}
              peopleById={peopleById}
              onClick={() => onEdit(e)}
              showDate
            />
          ))}
        </div>
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
    <section className="space-y-4">
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

function BudgetsTab({
  categories,
  budgets,
  spentByCat,
  onChange,
  onCategoryClick,
}: {
  categories: Category[];
  budgets: Budget[];
  spentByCat: Map<number, number>;
  onChange: (categoryId: number, value: number) => void;
  onCategoryClick: (categoryId: number) => void;
}) {
  const sorted = useMemo(() => {
    return [...categories].sort((a, b) => {
      const aHas = budgets.some((x) => x.category_id === a.id);
      const bHas = budgets.some((x) => x.category_id === b.id);
      if (aHas !== bHas) return aHas ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [categories, budgets]);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-bold">Monthly Budgets</h2>
        <p className="text-sm text-gray-600">
          Each budget carries forward to the next month automatically. Edit any
          time — the new limit applies immediately. Leave blank to remove.
        </p>
      </div>
      <div className="bg-white rounded-xl shadow-sm divide-y">
        {sorted.map((c) => {
          const b = budgets.find((x) => x.category_id === c.id);
          const limit = b ? Number(b.monthly_limit) : 0;
          const used = spentByCat.get(c.id) ?? 0;
          const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
          const cls = used > limit ? "over" : pct > 80 ? "warn" : "ok";
          const remaining = limit - used;
          return (
            <div key={c.id} className="px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => onCategoryClick(c.id)}
                  className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold text-white shadow-sm shrink-0 max-w-[55%] hover:opacity-90"
                  style={{ background: c.color }}
                  title={`View expenses for ${c.name}`}
                >
                  <span className="truncate">{c.name}</span>
                </button>
                <div className="flex-1" />
                <div className="flex items-center gap-1">
                  <span className="text-gray-500 text-sm">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    defaultValue={limit > 0 ? limit : ""}
                    onBlur={(e) => onChange(c.id, Number(e.target.value))}
                    className="w-28 border rounded-lg px-2 py-1 text-right tabular-nums"
                    placeholder="0.00"
                  />
                </div>
              </div>
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
    </section>
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

  return (
    <DialogShell onClose={onClose}>
      <h3 className="text-lg font-bold">{isNew ? "Add Expense" : "Edit Expense"}</h3>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const fd = new FormData(ev.currentTarget);
          fd.set("category_id", String(categoryId));
          fd.set("person_id", personId == null ? "" : String(personId));
          await onSave(fd, e?.id);
          onClose();
        }}
        className="space-y-3"
      >
        <Field label="Amount">
          <input
            name="amount"
            type="number"
            step="0.01"
            required
            defaultValue={e?.amount ?? ""}
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
          onDelete={async () => {
            if (!e) return;
            if (!confirm("Delete this expense?")) return;
            await onDelete(e.id);
            onClose();
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
  return (
    <DialogShell onClose={onClose}>
      <h3 className="text-lg font-bold">
        {isNew ? "Add Fixed Cost" : "Edit Fixed Cost"}
      </h3>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const fd = new FormData(ev.currentTarget);
          if (!fd.has("is_active")) fd.set("is_active", "");
          fd.set("person_id", personId == null ? "" : String(personId));
          await onSave(fd, f?.id);
          onClose();
        }}
        className="space-y-3"
      >
        <Field label="Name">
          <input
            name="name"
            type="text"
            required
            defaultValue={f?.name ?? ""}
            placeholder="e.g. Mortgage"
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <Field label="Amount">
          <input
            name="amount"
            type="number"
            step="0.01"
            required
            defaultValue={f?.amount ?? ""}
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
        <Field label="Category">
          <select
            name="category_id"
            required
            defaultValue={f?.category_id ?? categories[0]?.id}
            className="w-full border rounded-lg px-3 py-2 mt-1"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Frequency">
          <select
            name="frequency"
            required
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
          onDelete={async () => {
            if (!f) return;
            if (!confirm("Delete this fixed cost?")) return;
            await onDelete(f.id);
            onClose();
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
  return (
    <DialogShell onClose={onClose}>
      <h3 className="text-lg font-bold">
        {isNew ? "Add Category" : "Edit Category"}
      </h3>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const fd = new FormData(ev.currentTarget);
          await onSave(fd, c?.id);
          onClose();
        }}
        className="space-y-3"
      >
        <Field label="Name">
          <input
            name="name"
            type="text"
            required
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
          onDelete={async () => {
            if (!c) return;
            if (!confirm("Delete this category?")) return;
            try {
              await onDelete(c.id);
              onClose();
            } catch (err) {
              alert((err as Error).message);
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

function DialogFooter({
  showDelete,
  onDelete,
  onCancel,
}: {
  showDelete: boolean;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex justify-between pt-2">
      {showDelete ? (
        <button
          type="button"
          onClick={onDelete}
          className="text-red-600 text-sm font-semibold"
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
  catById,
  peopleById,
  totals,
  onClose,
  onPickExpense,
  onPickFixed,
  onJumpBudgets,
}: {
  kind: DrillKind;
  monthLabel: string;
  monthExpenses: Expense[];
  fixedCosts: FixedCost[];
  budgets: Budget[];
  spentByCat: Map<number, number>;
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  totals: {
    totalSpent: number;
    totalBudget: number;
    totalFixed: number;
    remaining: number;
  };
  onClose: () => void;
  onPickExpense: (e: Expense) => void;
  onPickFixed: (f: FixedCost) => void;
  onJumpBudgets: () => void;
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
          {(kind === "total" || kind === "variable") &&
            (() => {
              const sorted = [...monthExpenses].sort((a, b) =>
                a.date > b.date ? -1 : a.date < b.date ? 1 : b.id - a.id
              );
              if (!sorted.length)
                return (
                  <p className="p-4 text-sm text-gray-500 text-center">
                    No expenses yet this month.
                  </p>
                );
              return sorted.map((e) => (
                <ExpenseRow
                  key={e.id}
                  e={e}
                  catById={catById}
                  peopleById={peopleById}
                  onClick={() => onPickExpense(e)}
                />
              ));
            })()}
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
            <FixedRows
              fixedCosts={fixedCosts}
              catById={catById}
              onPick={onPickFixed}
            />
          )}
          {kind === "remaining" && (
            <RemainingList
              budgets={budgets}
              spentByCat={spentByCat}
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
  catById,
  onJump,
}: {
  budgets: Budget[];
  spentByCat: Map<number, number>;
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
        const limit = Number(b.monthly_limit);
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
  catById,
  peopleById,
  onClose,
  onPickExpense,
  onPickFixed,
}: {
  categoryId: number;
  monthLabel: string;
  monthExpenses: Expense[];
  fixedCosts: FixedCost[];
  budgets: Budget[];
  catById: Map<number, Category>;
  peopleById: Map<number, Person>;
  onClose: () => void;
  onPickExpense: (e: Expense) => void;
  onPickFixed: (f: FixedCost) => void;
}) {
  const c = catById.get(categoryId);
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
  const budget = budgets.find((b) => b.category_id === categoryId);
  const limit = budget ? Number(budget.monthly_limit) : 0;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const cls = used > limit ? "over" : pct > 80 ? "warn" : "ok";
  const remaining = limit - used;

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
            <div className="flex-1 min-w-0">
              <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                {monthLabel}
              </p>
              <h3 className="text-lg font-bold mt-0.5 flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ background: c?.color ?? "#9ca3af" }}
                />
                <span className="truncate">{c?.name ?? "Unknown"}</span>
              </h3>
              <p className="text-2xl font-bold tabular-nums mt-1">{fmt(used)}</p>
              {limit > 0 && (
                <>
                  <div className="progress-bar mt-2">
                    <div
                      className={`progress-fill ${cls}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-xs text-gray-500 mt-1 tabular-nums">
                    {fmt(used)} of {fmt(limit)} budget (
                    {Math.round(pct)}%) •{" "}
                    {remaining >= 0
                      ? `${fmt(remaining)} left`
                      : `${fmt(-remaining)} over`}
                  </p>
                </>
              )}
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
        <div className="overflow-y-auto p-3 bg-gray-50 space-y-4">
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
            {(rows.length > 0 || billsHere.length > 0) && (
              <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold px-1">
                Expenses • {fmt(variableUsed)}
              </p>
            )}
            {rows.length === 0 && billsHere.length === 0 ? (
              <p className="p-4 text-sm text-gray-500 text-center bg-white rounded-2xl ring-1 ring-gray-100">
                Nothing in this category for {monthLabel}.
              </p>
            ) : rows.length === 0 ? (
              <p className="p-3 text-sm text-gray-500 text-center bg-white rounded-2xl ring-1 ring-gray-100">
                No variable expenses this month — only the bills above.
              </p>
            ) : (
              rows.map((e) => (
                <ExpenseRow
                  key={e.id}
                  e={e}
                  catById={catById}
                  peopleById={peopleById}
                  onClick={() => onPickExpense(e)}
                  showDate
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
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
    { label: "Bills", Icon: IconReceipt, tab: "fixed" },
    { label: "Budgets", Icon: IconTarget, tab: "budgets" },
    { label: "Categories", Icon: IconTag, tab: "categories" },
    { label: "Expenses", Icon: IconList, tab: "expenses" },
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
// Mobile bottom navigation: Home / Bills / [Scan] / History / More
// =============================================================
function BottomNav({
  currentTab,
  onTab,
  onMore,
  onAddExpense,
}: {
  currentTab: Tab;
  onTab: (t: Tab) => void;
  onMore: () => void;
  onAddExpense: () => void;
}) {
  return (
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
        <NavBtn label="Add" Icon={IconPlus} onClick={onAddExpense} />
        <Link
          href="/scan"
          aria-label="Scan receipt"
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
        <NavBtn label="More" Icon={IconMore} onClick={onMore} />
      </div>
    </nav>
  );
}

function NavBtn({
  label,
  Icon,
  active = false,
  onClick,
}: {
  label: string;
  Icon: (p: { size?: number; className?: string }) => React.ReactElement;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-0.5 py-2 ${
        active ? "text-emerald-600" : "text-gray-500"
      }`}
    >
      <Icon size={22} />
      <span className="text-[11px] font-medium">{label}</span>
    </button>
  );
}
