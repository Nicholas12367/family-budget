"use client";

import { useMemo, useState, useTransition } from "react";
import {
  createIncome,
  deleteIncome,
  updateIncome,
  type IncomeEntry,
} from "@/app/actions/income";

const fmt = (n: number) =>
  "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const todayISO = () => new Date().toISOString().slice(0, 10);

function thisMonthRange() {
  const d = new Date();
  const start = new Date(d.getFullYear(), d.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    .toISOString()
    .slice(0, 10);
  return { start, end };
}

// Income widget — sits below the 4 stat cards on the home dashboard.
// Three-stat layout: Made / Spent / Saved (= Made - Spent for the month).
// Tap to open the editor where users add/edit/delete paychecks.
export default function IncomeWidget({
  initialEntries,
  totalSpent = 0,
  totalFixed = 0,
}: {
  initialEntries: IncomeEntry[];
  /** Variable spend for the current month, from BudgetApp. */
  totalSpent?: number;
  /** Fixed-cost monthly equivalent, from BudgetApp. */
  totalFixed?: number;
}) {
  const [entries, setEntries] = useState<IncomeEntry[]>(initialEntries);
  const [open, setOpen] = useState(false);

  const { start, end } = thisMonthRange();
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl ring-1 ring-emerald-100 bg-gradient-to-br from-emerald-50 to-emerald-100/60 p-5 text-left shadow-sm hover:shadow active:scale-[0.99] transition"
      >
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[11px] uppercase tracking-wide font-semibold text-emerald-700">
              This month
            </p>
            <p className="text-[10px] text-emerald-700/70 mt-0.5">
              Tap to add a paycheck
            </p>
          </div>
          <span className="text-3xl leading-none">💵</span>
        </div>

        {/* Stacked rows so each row gets its own visual lane. Each row
            has a label on the left and the dollar amount on the right.
            Saved is highlighted with a heavier weight + tone. */}
        <div className="space-y-2.5 divide-y divide-emerald-200/60">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-semibold text-emerald-800">
              Made
            </span>
            <span className="text-xl font-extrabold tabular-nums text-emerald-900">
              {fmt(made)}
            </span>
          </div>
          <div className="flex items-baseline justify-between pt-2.5">
            <span className="text-sm font-semibold text-emerald-800">
              Spent
            </span>
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
      {open && (
        <IncomeEditor
          entries={entries}
          onClose={() => setOpen(false)}
          onChange={setEntries}
        />
      )}
    </>
  );
}

function IncomeEditor({
  entries,
  onClose,
  onChange,
}: {
  entries: IncomeEntry[];
  onClose: () => void;
  onChange: (next: IncomeEntry[]) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);

  function reset() {
    setDate(todayISO());
    setAmount("");
    setDescription("");
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
          await updateIncome({
            id: editingId,
            date,
            amount: amt,
            description,
          });
          onChange(
            entries.map((e) =>
              e.id === editingId
                ? { ...e, date, amount: amt, description: description || null }
                : e
            )
          );
        } else {
          await createIncome({ date, amount: amt, description });
          // Refresh by appending an optimistic row; full refresh on next nav.
          const optimistic: IncomeEntry = {
            id: Math.max(0, ...entries.map((e) => e.id)) + 1,
            user_id: "",
            date,
            amount: amt,
            description: description || null,
            source: null,
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

  function startEdit(e: IncomeEntry) {
    setEditingId(e.id);
    setDate(e.date);
    setAmount(String(e.amount));
    setDescription(e.description ?? "");
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

  // Sort entries by date desc; show this-month at top.
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

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
          <h3 className="font-bold text-lg">Income</h3>
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
              placeholder="2400.00"
              className="w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-semibold text-gray-500">
            Note (optional)
          </label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Paycheck, freelance, etc."
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
                    {e.description ?? ""}
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
