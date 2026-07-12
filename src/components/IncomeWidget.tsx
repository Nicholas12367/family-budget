"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createIncome,
  deleteIncome,
  setSavingsGoal,
  updateIncome,
  type IncomeEntry,
} from "@/app/actions/income";

const fmt = (n: number) =>
  "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const todayISO = () => new Date().toISOString().slice(0, 10);
const pad = (n: number) => String(n).padStart(2, "0");

// Source marker for entries created via the "Add → Sold something" flow.
// Stored on income_entries.source so sales can be told apart from paychecks.
export const SALE_SOURCE = "sale";

// First day of the viewed month (inclusive) and of the next month
// (exclusive), as YYYY-MM-DD strings. Income dates compare lexically.
function monthRange(year: number, month: number) {
  const start = `${year}-${pad(month + 1)}-01`;
  const ny = month === 11 ? year + 1 : year;
  const nm = month === 11 ? 0 : month + 1;
  const end = `${ny}-${pad(nm + 1)}-01`;
  return { start, end };
}

// Income widget — sits below the 4 stat cards on the home dashboard.
// Three-stat layout: Made / Spent / Saved (= Made - Spent for the *viewed*
// month, so it resets when you navigate months). Below that, an annual
// savings-goal progress bar. Tap to open the editor.
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
  /** Viewed calendar year (from the month navigator). */
  year: number;
  /** Viewed month, 0-11 (from the month navigator). */
  month: number;
  /** Variable spend for the viewed month, from BudgetApp. */
  totalSpent?: number;
  /** Fixed-cost monthly equivalent for the viewed month, from BudgetApp. */
  totalFixed?: number;
  /** Net saved so far this calendar year (income − spend), from BudgetApp. */
  savedThisYear?: number;
  /** Annual savings target for goalYear, or null if none set. */
  savingsGoal?: number | null;
  /** The calendar year the goal + savedThisYear apply to. */
  goalYear: number;
  onGoalChange?: (target: number | null) => void;
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
  const spent = Number(totalSpent) + Number(totalFixed);
  const saved = made - spent;
  const savedPositive = saved >= 0;

  const goalPct =
    savingsGoal && savingsGoal > 0
      ? Math.max(0, Math.min(100, (savedThisYear / savingsGoal) * 100))
      : 0;

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

        {/* Made / Spent / Saved — all for the viewed month, so navigating
            months resets these back to that month's figures. */}
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
        </button>

        {/* Annual savings goal progress. Always reflects goalYear so the
            month navigator doesn't change the target you're tracking. */}
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 w-full text-left rounded-xl bg-white/60 ring-1 ring-emerald-100 px-3 py-2.5 hover:bg-white/80 transition"
        >
          {savingsGoal && savingsGoal > 0 ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  {goalYear} savings goal
                </span>
                <span className="text-xs font-bold tabular-nums text-emerald-900">
                  {fmt(Math.max(0, savedThisYear))} / {fmt(savingsGoal)}
                </span>
              </div>
              <div className="mt-1.5 h-2 rounded-full bg-emerald-200/70 overflow-hidden">
                <div
                  className="h-full rounded-full bg-emerald-500 transition-all"
                  style={{ width: `${goalPct}%` }}
                />
              </div>
              <p className="mt-1 text-[10px] text-emerald-700/80">
                {goalPct >= 100
                  ? "🎉 Goal reached!"
                  : `${goalPct.toFixed(0)}% of your ${goalYear} goal`}
              </p>
            </>
          ) : (
            <span className="text-xs font-semibold text-emerald-700">
              ＋ Set a {goalYear} savings goal
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
  saleMode = false,
  savingsGoal = null,
  goalYear,
  onGoalChange,
  onClose,
  onChange,
}: {
  entries: IncomeEntry[];
  /** Viewed year — new entries default into this month. */
  year?: number;
  /** Viewed month 0-11 — new entries default into this month. */
  month?: number;
  /** When true, the modal is framed as "add something you sold". */
  saleMode?: boolean;
  savingsGoal?: number | null;
  goalYear?: number;
  onGoalChange?: (target: number | null) => void;
  onClose: () => void;
  onChange: (next: IncomeEntry[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  // Default a new entry to the 1st of the viewed month if we're not looking
  // at the current month; otherwise today. Keeps entries landing where the
  // user expects relative to the month they're viewing.
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
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingSource, setEditingSource] = useState<string | null>(
    saleMode ? SALE_SOURCE : null
  );
  const [err, setErr] = useState<string | null>(null);

  const [goalInput, setGoalInput] = useState(
    savingsGoal != null ? String(savingsGoal) : ""
  );
  const [goalMsg, setGoalMsg] = useState<string | null>(null);

  function reset() {
    setDate(defaultDate());
    setAmount("");
    setDescription("");
    setEditingId(null);
    setEditingSource(saleMode ? SALE_SOURCE : null);
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
          await updateIncome({
            id: editingId,
            date,
            amount: amt,
            description,
            source: editingSource ?? "",
          });
          onChange(
            entries.map((e) =>
              e.id === editingId
                ? {
                    ...e,
                    date,
                    amount: amt,
                    description: description || null,
                    source: editingSource,
                  }
                : e
            )
          );
        } else {
          const source = saleMode ? SALE_SOURCE : "";
          await createIncome({ date, amount: amt, description, source });
          // Optimistic append; the real row lands on next server refresh.
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
        await setSavingsGoal({ year: goalYear, target_amount: target });
        onGoalChange?.(target > 0 ? target : null);
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
    setEditingSource(e.source ?? null);
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
  const title = saleMode
    ? "Add something you sold"
    : editingId != null
      ? "Edit income"
      : "Income";
  const noteLabel = saleMode ? "What did you sell?" : "Note (optional)";
  const notePlaceholder = saleMode
    ? "Couch, bike, old phone…"
    : "Paycheck, freelance, etc.";
  const submitLabel = editingId != null
    ? "Save changes"
    : saleMode
      ? "Add to income"
      : "Add income";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(ev) => {
        if (ev.target === ev.currentTarget) onClose();
      }}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3 max-h-[90vh] overflow-y-auto"
        style={{
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">{title}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {saleMode && (
          <p className="text-xs text-gray-500 -mt-1">
            Sold items count as income for the month.
          </p>
        )}

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[11px] font-semibold text-gray-500">
              Date
            </label>
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
              placeholder={saleMode ? "120.00" : "2400.00"}
              className="w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-500">
            {noteLabel}
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={notePlaceholder}
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
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>

        {/* Annual savings goal — hidden in the focused "add a sale" flow. */}
        {!saleMode && goalYear != null && (
          <>
            <hr className="border-gray-100" />
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                {goalYear} savings goal
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={goalInput}
                  onChange={(e) => setGoalInput(e.target.value)}
                  placeholder="e.g. 12000"
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
                Track how much you aim to save across the whole year. Leave
                blank to clear.
              </p>
              {goalMsg && (
                <p className="text-[11px] text-emerald-700">{goalMsg}</p>
              )}
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
              {sorted.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-2 text-sm py-1"
                >
                  <span className="text-gray-500 tabular-nums w-20 shrink-0">
                    {e.date}
                  </span>
                  <span className="font-semibold tabular-nums w-20 shrink-0 text-emerald-700">
                    {fmt(Number(e.amount))}
                  </span>
                  <span className="flex-1 truncate text-gray-700">
                    {e.source === SALE_SOURCE && (
                      <span className="mr-1" title="Sold item">
                        🏷️
                      </span>
                    )}
                    {e.description ??
                      (e.source === SALE_SOURCE ? "Sold item" : "")}
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
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
