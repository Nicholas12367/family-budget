"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createIncome,
  deleteIncome,
  setSavingsGoal,
  updateIncome,
  type IncomeEntry,
} from "@/app/actions/income";
import {
  INCOME_SOURCES,
  type SavingsGoal,
  type GoalPeriod,
} from "@/lib/income";

const fmt = (n: number) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(n)
    .toFixed(2)
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
const fmt0 = (n: number) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(Math.round(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const todayISO = () => new Date().toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

// Back-compat marker for entries created via the old "Sold something" flow.
export const SALE_SOURCE = "sale";

const sourceMeta = (key: string | null | undefined) =>
  INCOME_SOURCES.find((s) => s.key === key) ?? {
    key: "other",
    emoji: "💵",
    label: "Income",
  };

// First day of the given month (inclusive) and of the next month (exclusive).
function monthRange(year: number, month: number) {
  const start = `${year}-${pad(month + 1)}-01`;
  const ny = month === 11 ? year + 1 : year;
  const nm = month === 11 ? 0 : month + 1;
  const end = `${ny}-${pad(nm + 1)}-01`;
  return { start, end };
}

// Income widget — sits below the 4 stat cards on the home dashboard.
export default function IncomeWidget({
  entries,
  onEntriesChange,
  year,
  month,
  totalSpent = 0,
  totalFixed = 0,
  savedThisYear = 0,
  savingsGoal = null,
  goalYear,
  onGoalChange,
}: {
  entries: IncomeEntry[];
  onEntriesChange: (next: IncomeEntry[]) => void;
  year: number;
  month: number;
  totalSpent?: number;
  totalFixed?: number;
  /** Net saved so far this calendar year (income − spend), from BudgetApp. */
  savedThisYear?: number;
  savingsGoal?: SavingsGoal | null;
  goalYear: number;
  onGoalChange?: (goal: SavingsGoal | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const { start, end } = monthRange(year, month);
  const made = useMemo(
    () =>
      entries
        .filter((e) => e.date >= start && e.date < end)
        .reduce((s, e) => s + Number(e.amount), 0),
    [entries, start, end]
  );

  // Previous month's income, for the "vs last month" momentum line.
  const prevMade = useMemo(() => {
    const pm = month === 0 ? 11 : month - 1;
    const py = month === 0 ? year - 1 : year;
    const { start: ps, end: pe } = monthRange(py, pm);
    return entries
      .filter((e) => e.date >= ps && e.date < pe)
      .reduce((s, e) => s + Number(e.amount), 0);
  }, [entries, year, month]);

  const spent = Number(totalSpent) + Number(totalFixed);
  const saved = made - spent;
  const savedPositive = saved >= 0;
  const savingsRate = made > 0 ? (saved / made) * 100 : null;
  const momentum = made - prevMade;

  // Goal progress: monthly goals track the viewed month (so they reset every
  // month); yearly goals track net saved YTD (fixed to the current year).
  const goalProgress = useMemo(() => {
    if (!savingsGoal || savingsGoal.target <= 0) return null;
    const isMonthly = savingsGoal.period === "monthly";
    const value = isMonthly ? saved : savedThisYear;
    const pct = Math.max(0, Math.min(100, (value / savingsGoal.target) * 100));
    let hint = "";
    if (isMonthly) {
      hint =
        value >= savingsGoal.target
          ? "🎉 Monthly goal reached!"
          : `${fmt0(savingsGoal.target - Math.max(0, value))} to go this month`;
    } else {
      const monthsElapsed = new Date().getMonth() + 1;
      const monthsLeft = Math.max(1, 12 - monthsElapsed);
      const remaining = Math.max(0, savingsGoal.target - value);
      const expected = savingsGoal.target * (monthsElapsed / 12);
      if (value >= savingsGoal.target) hint = "🎉 Goal reached!";
      else if (value >= expected)
        hint = `On track — ${fmt0(remaining / monthsLeft)}/mo to finish`;
      else hint = `Behind — ${fmt0(remaining / monthsLeft)}/mo to catch up`;
    }
    return { pct, isMonthly, hint, value };
  }, [savingsGoal, saved, savedThisYear]);

  return (
    <>
      <div className="w-full rounded-2xl ring-1 ring-emerald-100 bg-gradient-to-br from-emerald-50 to-emerald-100/60 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700">
              This month
            </p>
            <p className="text-[10px] text-emerald-700/70 mt-0.5">
              Income &amp; savings
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700 active:scale-95 transition"
          >
            <span className="text-sm leading-none">＋</span> Add income
          </button>
        </div>

        <button
          type="button"
          onClick={() => setOpen(true)}
          className="w-full text-left"
        >
          <div className="space-y-2.5 divide-y divide-emerald-200/60">
            <div className="flex items-baseline justify-between">
              <span className="text-sm font-semibold text-emerald-800">Made</span>
              <span className="text-xl font-extrabold tabular-nums text-emerald-900">
                {fmt(made)}
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-2.5">
              <span className="text-sm font-semibold text-emerald-800">Spent</span>
              <span className="text-xl font-extrabold tabular-nums text-emerald-900">
                {fmt(spent)}
              </span>
            </div>
            <div className="flex items-baseline justify-between pt-2.5">
              <span
                className={`text-sm font-bold ${
                  savedPositive ? "text-emerald-900" : "text-rose-700"
                }`}
              >
                Saved
              </span>
              <span
                className={`text-2xl font-extrabold tabular-nums ${
                  savedPositive ? "text-emerald-900" : "text-rose-700"
                }`}
              >
                {fmt(saved)}
              </span>
            </div>
          </div>

          {/* Savings rate + month-over-month momentum */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {savingsRate != null && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  savingsRate >= 20
                    ? "bg-emerald-600 text-white"
                    : savingsRate > 0
                      ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200"
                      : "bg-rose-100 text-rose-700 ring-1 ring-rose-200"
                }`}
              >
                {savingsRate.toFixed(0)}% saved
              </span>
            )}
            {made > 0 && prevMade > 0 && Math.abs(momentum) >= 0.01 && (
              <span
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  momentum >= 0
                    ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200"
                    : "bg-amber-100 text-amber-800 ring-1 ring-amber-200"
                }`}
              >
                {momentum >= 0 ? "▲" : "▼"} {fmt0(Math.abs(momentum))} vs last mo
              </span>
            )}
          </div>
        </button>

        {/* Savings goal progress */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 w-full text-left rounded-xl bg-white/60 ring-1 ring-emerald-100 px-3 py-2.5 hover:bg-white/80 transition"
        >
          {goalProgress ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  {goalProgress.isMonthly
                    ? "Monthly savings goal"
                    : `${goalYear} savings goal`}
                </span>
                <span className="text-xs font-bold tabular-nums text-emerald-900">
                  {fmt0(Math.max(0, goalProgress.value))} /{" "}
                  {fmt0(savingsGoal!.target)}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-emerald-200/70 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${goalProgress.pct}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-emerald-700/80">
                {goalProgress.pct.toFixed(0)}% · {goalProgress.hint}
              </p>
            </>
          ) : (
            <span className="text-xs font-semibold text-emerald-700">
              ＋ Set a savings goal
            </span>
          )}
        </button>
      </div>

      {open && (
        <IncomeEditor
          entries={entries}
          year={year}
          month={month}
          savingsGoal={savingsGoal}
          goalYear={goalYear}
          onGoalChange={onGoalChange}
          onClose={() => setOpen(false)}
          onChange={onEntriesChange}
        />
      )}
    </>
  );
}

export function IncomeEditor({
  entries,
  year,
  month,
  savingsGoal = null,
  goalYear,
  onGoalChange,
  onClose,
  onChange,
}: {
  entries: IncomeEntry[];
  year?: number;
  month?: number;
  savingsGoal?: SavingsGoal | null;
  goalYear?: number;
  onGoalChange?: (goal: SavingsGoal | null) => void;
  onClose: () => void;
  onChange: (next: IncomeEntry[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const defaultDate = () => {
    if (year == null || month == null) return todayISO();
    const now = new Date();
    if (now.getFullYear() === year && now.getMonth() === month)
      return todayISO();
    return `${year}-${pad(month + 1)}-01`;
  };
  const [date, setDate] = useState(defaultDate);
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [source, setSource] = useState<string>("paycheck");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [goalInput, setGoalInput] = useState(
    savingsGoal ? String(savingsGoal.target) : ""
  );
  const [goalPeriod, setGoalPeriod] = useState<GoalPeriod>(
    savingsGoal?.period ?? "yearly"
  );
  const [goalMsg, setGoalMsg] = useState<string | null>(null);

  function reset() {
    setDate(defaultDate());
    setAmount("");
    setDescription("");
    setSource("paycheck");
    setEditingId(null);
    setErr(null);
  }

  function add() {
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt < 0) {
      setErr("Enter a valid amount.");
      return;
    }
    startTransition(async () => {
      try {
        if (editingId != null) {
          await updateIncome({ id: editingId, date, amount: amt, description, source });
          onChange(
            entries.map((e) =>
              e.id === editingId
                ? { ...e, date, amount: amt, description: description || null, source }
                : e
            )
          );
        } else {
          await createIncome({ date, amount: amt, description, source });
          const optimistic: IncomeEntry = {
            id: Math.max(0, ...entries.map((e) => e.id)) + 1,
            user_id: "",
            date,
            amount: amt,
            description: description || null,
            source: source || null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          onChange([optimistic, ...entries]);
        }
        reset();
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  function saveGoal() {
    if (goalYear == null) return;
    const raw = goalInput.trim();
    const target = raw === "" ? 0 : Number(raw);
    if (!Number.isFinite(target) || target < 0) {
      setGoalMsg("Enter a valid amount.");
      return;
    }
    startTransition(async () => {
      try {
        await setSavingsGoal({
          year: goalYear,
          target_amount: target,
          period: goalPeriod,
        });
        onGoalChange?.(target > 0 ? { target, period: goalPeriod } : null);
        setGoalMsg("Saved.");
        setTimeout(() => setGoalMsg(null), 1500);
      } catch (e) {
        setGoalMsg((e as Error).message);
      }
    });
  }

  function startEdit(e: IncomeEntry) {
    setEditingId(e.id);
    setDate(e.date);
    setAmount(String(e.amount));
    setDescription(e.description ?? "");
    setSource(e.source ?? "other");
    setErr(null);
  }

  function remove(id: number) {
    startTransition(async () => {
      try {
        await deleteIncome(id);
        onChange(entries.filter((e) => e.id !== id));
        if (editingId === id) reset();
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  // "By source" breakdown for the viewed month (or all-time if no month set).
  const breakdown = useMemo(() => {
    let inScope = entries;
    if (year != null && month != null) {
      const { start, end } = monthRange(year, month);
      inScope = entries.filter((e) => e.date >= start && e.date < end);
    }
    const m = new Map<string, number>();
    for (const e of inScope) {
      const k = e.source ?? "other";
      m.set(k, (m.get(k) ?? 0) + Number(e.amount));
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries, year, month]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">
            {editingId != null ? "Edit income" : "Income"}
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-semibold text-gray-500">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
            />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-gray-500">
              Amount
            </label>
            <input
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="2400.00"
              className="w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
            />
          </div>
        </div>

        {/* Source category picker */}
        <div>
          <label className="text-[11px] font-semibold text-gray-500">Source</label>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {INCOME_SOURCES.filter((s) => s.key !== "scanned").map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSource(s.key)}
                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 transition ${
                  source === s.key
                    ? "bg-emerald-600 text-white ring-emerald-600"
                    : "bg-gray-50 text-gray-700 ring-gray-200 hover:bg-gray-100"
                }`}
              >
                <span>{s.emoji}</span> {s.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="text-[11px] font-semibold text-gray-500">
            Note (optional)
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Employer, client, item sold…"
            className="w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
            maxLength={200}
          />
        </div>

        {err && <p className="text-sm text-red-600">{err}</p>}
        <div className="flex gap-2">
          {editingId != null && (
            <button
              onClick={reset}
              className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
            >
              Cancel edit
            </button>
          )}
          <button
            onClick={add}
            disabled={pending || !amount}
            className="flex-1 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
          >
            {pending
              ? "Saving…"
              : editingId != null
                ? "Save changes"
                : "Add income"}
          </button>
        </div>

        {/* Savings goal */}
        {goalYear != null && (
          <>
            <hr className="border-gray-100" />
            <div className="space-y-2">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Savings goal
              </label>
              <div className="flex gap-1.5">
                {(["monthly", "yearly"] as GoalPeriod[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setGoalPeriod(p)}
                    className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold ring-1 transition ${
                      goalPeriod === p
                        ? "bg-emerald-600 text-white ring-emerald-600"
                        : "bg-gray-50 text-gray-700 ring-gray-200 hover:bg-gray-100"
                    }`}
                  >
                    {p === "monthly" ? "Per month" : "Per year"}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  placeholder={goalPeriod === "monthly" ? "e.g. 500" : "e.g. 12000"}
                  className="flex-1 px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                />
                <button
                  onClick={saveGoal}
                  disabled={pending}
                  className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                >
                  Save goal
                </button>
              </div>
              <p className="text-[11px] text-gray-500">
                {goalPeriod === "monthly"
                  ? "How much you aim to save each month (resets monthly). Leave blank to clear."
                  : "How much you aim to save across the whole year. Leave blank to clear."}
              </p>
              {goalMsg && <p className="text-[11px] text-emerald-700">{goalMsg}</p>}
            </div>
          </>
        )}

        {/* Income by source */}
        {breakdown.length > 0 && (
          <>
            <hr className="border-gray-100" />
            <div className="space-y-1.5">
              <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                By source{year != null ? " · this month" : ""}
              </h4>
              <ul className="space-y-1">
                {breakdown.map(([key, total]) => {
                  const meta = sourceMeta(key);
                  return (
                    <li
                      key={key}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="text-gray-700">
                        {meta.emoji} {meta.label}
                      </span>
                      <span className="font-semibold tabular-nums text-emerald-700">
                        {fmt(total)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </>
        )}

        <hr className="border-gray-100" />

        <div className="space-y-2">
          <h4 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
            History
          </h4>
          {sorted.length === 0 ? (
            <p className="text-sm text-gray-500">No income recorded yet.</p>
          ) : (
            <ul className="space-y-1.5">
              {sorted.map((e) => {
                const meta = sourceMeta(e.source);
                return (
                  <li key={e.id} className="flex items-center gap-2 text-sm py-1">
                    <span className="text-gray-500 tabular-nums w-20 shrink-0">
                      {e.date}
                    </span>
                    <span className="font-semibold tabular-nums w-20 shrink-0 text-emerald-700">
                      {fmt(Number(e.amount))}
                    </span>
                    <span className="flex-1 truncate text-gray-700">
                      <span className="mr-1" title={meta.label}>
                        {meta.emoji}
                      </span>
                      {e.description ?? meta.label}
                    </span>
                    <button
                      onClick={() => startEdit(e)}
                      className="text-xs text-emerald-700 hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => remove(e.id)}
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Delete
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
