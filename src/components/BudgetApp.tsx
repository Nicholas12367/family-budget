"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Chart,
  ArcElement,
  Tooltip,
  Legend,
  DoughnutController,
} from "chart.js";
import type { Budget, Category, Expense, FixedCost } from "@/lib/types";
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

Chart.register(ArcElement, Tooltip, Legend, DoughnutController);

type Tab = "dashboard" | "expenses" | "fixed" | "budgets" | "categories";

type Props = {
  email: string;
  initialCategories: Category[];
  initialExpenses: Expense[];
  initialFixedCosts: FixedCost[];
  initialBudgets: Budget[];
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
}: Props) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [tab, setTab] = useState<Tab>("dashboard");
  const [categories, setCategories] = useState(initialCategories);
  const [expenses, setExpenses] = useState(initialExpenses);
  const [fixedCosts, setFixedCosts] = useState(initialFixedCosts);
  const [budgets, setBudgets] = useState(initialBudgets);

  const [editExpense, setEditExpense] = useState<Expense | "new" | null>(null);
  const [editFixed, setEditFixed] = useState<FixedCost | "new" | null>(null);
  const [editCategory, setEditCategory] = useState<Category | "new" | null>(null);

  const [isPending, startTransition] = useTransition();

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
  const totalFixed = fixedCosts.reduce((s, f) => s + fixedMonthlyEquivalent(f), 0);
  const remaining = totalBudget - totalSpent;

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

  async function refreshAfter<T>(p: Promise<T>): Promise<T> {
    const v = await p;
    // Optimistic: caller updates local state; server-side data on next nav.
    return v;
  }

  return (
    <div>
      <Header
        email={email}
        monthLabel={`${MONTH_NAMES[month]} ${year}`}
        onPrevMonth={() => changeMonth(-1)}
        onNextMonth={() => changeMonth(1)}
      />

      <nav className="bg-white shadow-sm sticky top-[57px] z-10">
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
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-100 text-emerald-700 hover:bg-emerald-200 ml-auto"
          >
            📷 Scan
          </Link>
          <Link
            href="/settings"
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 text-gray-700 hover:bg-gray-200"
          >
            ⚙
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
            catById={catById}
            onEditExpense={(e) => setEditExpense(e)}
          />
        )}
        {tab === "expenses" && (
          <ExpensesTab
            monthLabel={`${MONTH_NAMES[month]} ${year}`}
            monthExpenses={monthExpenses}
            catById={catById}
            onAdd={() => setEditExpense("new")}
            onEdit={(e) => setEditExpense(e)}
          />
        )}
        {tab === "fixed" && (
          <FixedTab
            fixedCosts={fixedCosts}
            catById={catById}
            onAdd={() => setEditFixed("new")}
            onEdit={(f) => setEditFixed(f)}
          />
        )}
        {tab === "budgets" && (
          <BudgetsTab
            categories={categories}
            budgets={budgets}
            monthExpenses={monthExpenses}
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
          onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
          onClose={() => setEditExpense(null)}
          onSave={async (form, id) => {
            const data = Object.fromEntries(form);
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
          onClose={() => setEditFixed(null)}
          onSave={async (form, id) => {
            const data = Object.fromEntries(form);
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
    <header className="bg-white shadow-sm sticky top-0 z-20">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-white font-bold">
            $
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Family Budget</h1>
            <p className="text-xs text-gray-500">{monthLabel}</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          <button
            onClick={onPrevMonth}
            className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm"
            aria-label="Previous month"
          >
            ◀
          </button>
          <button
            onClick={onNextMonth}
            className="px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-sm"
            aria-label="Next month"
          >
            ▶
          </button>
          <span className="text-xs text-gray-500 hidden sm:inline">{email}</span>
          <form action="/auth/signout" method="post">
            <button className="text-xs text-gray-500 hover:text-gray-900 underline">
              Log out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

function Stat({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="bg-white rounded-xl p-4 shadow-sm">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className={`text-2xl font-bold ${className}`}>{value}</p>
    </div>
  );
}

function Dashboard({
  monthLabel,
  monthExpenses,
  categories,
  budgets,
  totals,
  catById,
  onEditExpense,
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
  catById: Map<number, Category>;
  onEditExpense: (e: Expense) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);

  const byCat = useMemo(() => {
    const m = new Map<number, number>();
    monthExpenses.forEach((e) => {
      m.set(e.category_id, (m.get(e.category_id) ?? 0) + Number(e.amount));
    });
    return m;
  }, [monthExpenses]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }
    const labels: string[] = [];
    const values: number[] = [];
    const colors: string[] = [];
    byCat.forEach((amount, catId) => {
      const c = catById.get(catId);
      if (!c) return;
      labels.push(c.name);
      values.push(amount);
      colors.push(c.color);
    });
    if (values.length === 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#9ca3af";
        ctx.font = "14px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          "No expenses yet this month",
          canvas.width / 2,
          canvas.height / 2
        );
      }
      return;
    }
    chartRef.current = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels,
        datasets: [
          {
            data: values,
            backgroundColor: colors,
            borderWidth: 2,
            borderColor: "#fff",
          },
        ],
      },
      options: {
        plugins: {
          legend: { position: "bottom", labels: { font: { size: 11 } } },
        },
      },
    });
    return () => {
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [byCat, catById]);

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
        <Stat label="Spent" value={fmt(totals.totalSpent)} />
        <Stat label="Budgeted" value={fmt(totals.totalBudget)} />
        <Stat label="Fixed (mo.)" value={fmt(totals.totalFixed)} />
        <Stat
          label="Remaining"
          value={fmt(totals.remaining)}
          className={totals.remaining < 0 ? "text-red-600" : "text-emerald-600"}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <h3 className="font-semibold mb-3">Spending by Category</h3>
          <div className="relative" style={{ height: 260 }}>
            <canvas ref={canvasRef} />
          </div>
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
                const used = byCat.get(b.category_id) ?? 0;
                const limit = Number(b.monthly_limit);
                const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
                const cls = used > limit ? "over" : pct > 80 ? "warn" : "ok";
                return (
                  <div key={b.id}>
                    <div className="flex justify-between text-sm mb-1">
                      <span>
                        {c.icon} {c.name}
                      </span>
                      <span className="tabular-nums">
                        {fmt(used)} / {fmt(limit)}
                      </span>
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
            </div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl p-4 shadow-sm">
        <h3 className="font-semibold mb-3">Recent Expenses</h3>
        {recent.length === 0 ? (
          <p className="text-sm text-gray-500 py-4">
            No expenses for {monthLabel}. Add one from the Expenses tab.
          </p>
        ) : (
          <div className="divide-y">
            {recent.map((e) => (
              <ExpenseRow
                key={e.id}
                e={e}
                catById={catById}
                onClick={() => onEditExpense(e)}
                compact
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
  onClick,
  compact = false,
}: {
  e: Expense;
  catById: Map<number, Category>;
  onClick?: () => void;
  compact?: boolean;
}) {
  const c = catById.get(e.category_id) ?? {
    name: "Unknown",
    icon: "❓",
    color: "#9ca3af",
  };
  const d = new Date(e.date);
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-4 py-3 ${
        onClick ? "hover:bg-gray-50 cursor-pointer" : ""
      }`}
    >
      <span className="cat-chip" style={{ background: c.color }}>
        {c.icon}
        {compact ? "" : ` ${c.name}`}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm truncate">
          {e.description || "(no description)"}
        </p>
        {!compact && (
          <p className="text-xs text-gray-500">
            {d.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}
            {e.notes ? " • " + e.notes : ""}
          </p>
        )}
      </div>
      <p className="font-semibold tabular-nums">{fmt(e.amount)}</p>
    </div>
  );
}

function ExpensesTab({
  monthLabel,
  monthExpenses,
  catById,
  onAdd,
  onEdit,
}: {
  monthLabel: string;
  monthExpenses: Expense[];
  catById: Map<number, Category>;
  onAdd: () => void;
  onEdit: (e: Expense) => void;
}) {
  const sorted = [...monthExpenses].sort((a, b) =>
    a.date > b.date ? -1 : a.date < b.date ? 1 : b.id - a.id
  );
  return (
    <section className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold">Expenses</h2>
        <button
          onClick={onAdd}
          className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold"
        >
          + Add Expense
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm">
        {sorted.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 text-center">
            No expenses for {monthLabel}. Tap “Add Expense” to log one.
          </p>
        ) : (
          <div className="divide-y">
            {sorted.map((e) => (
              <ExpenseRow
                key={e.id}
                e={e}
                catById={catById}
                onClick={() => onEdit(e)}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function FixedTab({
  fixedCosts,
  catById,
  onAdd,
  onEdit,
}: {
  fixedCosts: FixedCost[];
  catById: Map<number, Category>;
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
      <div className="bg-white rounded-xl shadow-sm">
        {fixedCosts.length === 0 ? (
          <p className="p-6 text-sm text-gray-500 text-center">
            No fixed costs yet. Add rent, utilities, subscriptions, etc.
          </p>
        ) : (
          <div className="divide-y">
            {fixedCosts.map((f) => {
              const c = catById.get(f.category_id) ?? {
                name: "Unknown",
                icon: "❓",
                color: "#9ca3af",
              };
              const monthly = fixedMonthlyEquivalent(f);
              return (
                <div
                  key={f.id}
                  onClick={() => onEdit(f)}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer"
                >
                  <span className="cat-chip" style={{ background: c.color }}>
                    {c.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      {f.name}
                      {!f.is_active && (
                        <span className="text-gray-400"> (paused)</span>
                      )}
                    </p>
                    <p className="text-xs text-gray-500">
                      {fmt(f.amount)} {f.frequency} • {fmt(monthly)}/mo
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function BudgetsTab({
  categories,
  budgets,
  monthExpenses,
  onChange,
}: {
  categories: Category[];
  budgets: Budget[];
  monthExpenses: Expense[];
  onChange: (categoryId: number, value: number) => void;
}) {
  const spentByCat = useMemo(() => {
    const m = new Map<number, number>();
    monthExpenses.forEach((e) =>
      m.set(e.category_id, (m.get(e.category_id) ?? 0) + Number(e.amount))
    );
    return m;
  }, [monthExpenses]);

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
                <span className="cat-chip" style={{ background: c.color }}>
                  {c.icon} {c.name}
                </span>
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
                <>
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
                </>
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
              className="w-3 h-3 rounded-full inline-block"
              style={{ background: c.color }}
            />
            <span className="text-xl">{c.icon}</span>
            <div className="flex-1">
              <p className="font-medium text-sm">{c.name}</p>
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
  onCategoryCreated,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Expense | "new";
  categories: Category[];
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

  return (
    <DialogShell onClose={onClose}>
      <h3 className="text-lg font-bold">{isNew ? "Add Expense" : "Edit Expense"}</h3>
      <form
        onSubmit={async (ev) => {
          ev.preventDefault();
          const fd = new FormData(ev.currentTarget);
          fd.set("category_id", String(categoryId));
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
  onClose,
  onSave,
  onDelete,
}: {
  initial: FixedCost | "new";
  categories: Category[];
  onClose: () => void;
  onSave: (form: FormData, id?: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const isNew = initial === "new";
  const f = isNew ? null : initial;
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
                {c.icon} {c.name}
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
        <Field label="Emoji / Icon">
          <input
            name="icon"
            type="text"
            maxLength={4}
            defaultValue={c?.icon ?? "🏷️"}
            placeholder="🍔"
            className="w-full border rounded-lg px-3 py-2 mt-1"
          />
        </Field>
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
