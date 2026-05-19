"use client";

import { useState } from "react";
import type { Budget, Category, Expense, FixedCost } from "@/lib/types";
import { exportExcel, exportPdf, type ExportSnapshot } from "@/lib/exporters";
import { IconSpreadsheet, IconDocument, IconBraces } from "./Icon";
import PushSubscribe from "./PushSubscribe";

type Snapshot = {
  categories: Category[];
  expenses: Expense[];
  fixedCosts: FixedCost[];
  budgets: Budget[];
};

type Format = "excel" | "pdf" | "json";

type Preset = "this_month" | "last_month" | "ytd" | "all" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "ytd", label: "Year-to-date" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom" },
];

function rangeForPreset(preset: Preset): { start: string | null; end: string | null } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (preset === "this_month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: iso(start), end: iso(end) };
  }
  if (preset === "last_month") {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: iso(start), end: iso(end) };
  }
  if (preset === "ytd") {
    const start = new Date(now.getFullYear(), 0, 1);
    return { start: iso(start), end: iso(now) };
  }
  return { start: null, end: null };
}

function filterSnapshot(
  base: Snapshot & { email: string },
  start: string | null,
  end: string | null
): ExportSnapshot {
  if (!start && !end) {
    return {
      email: base.email,
      categories: base.categories,
      expenses: base.expenses,
      fixedCosts: base.fixedCosts,
      budgets: base.budgets,
    };
  }
  const inRange = (date: string) => {
    if (!date) return false;
    if (start && date < start) return false;
    if (end && date > end) return false;
    return true;
  };
  return {
    email: base.email,
    categories: base.categories,
    fixedCosts: base.fixedCosts,
    budgets: base.budgets,
    expenses: base.expenses.filter((e) => inRange(e.date)),
  };
}

export default function SettingsClient({
  email,
  snapshot,
}: {
  email: string;
  snapshot: Snapshot;
}) {
  const [exportToast, setExportToast] = useState<string | null>(null);
  const [exportDialog, setExportDialog] = useState<Format | null>(null);

  function flash(msg: string) {
    setExportToast(msg);
    setTimeout(() => setExportToast(null), 4000);
  }

  function runExport(format: Format, start: string | null, end: string | null) {
    const filtered = filterSnapshot({ email, ...snapshot }, start, end);
    if (format === "json") {
      const payload = {
        email,
        exportedAt: new Date().toISOString(),
        range: { start, end },
        categories: filtered.categories,
        expenses: filtered.expenses,
        fixedCosts: filtered.fixedCosts,
        budgets: filtered.budgets,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `family-budget-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      flash(`JSON downloaded · ${filtered.expenses.length} expenses.`);
    } else if (format === "excel") {
      exportExcel(filtered);
      flash(`Excel downloaded · ${filtered.expenses.length} expenses.`);
    } else if (format === "pdf") {
      exportPdf(filtered);
      flash("PDF opened in a new tab — save as PDF in print dialog.");
    }
    setExportDialog(null);
  }

  return (
    <div className="space-y-4">
      {exportToast && (
        <div className="bg-emerald-50 ring-1 ring-emerald-200 text-emerald-800 rounded-xl px-4 py-3 text-sm">
          {exportToast}
        </div>
      )}
      <PushSubscribe />

      <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h2 className="font-semibold">Account</h2>
        <p className="text-sm text-gray-600">
          Logged in as <span className="font-medium">{email}</span>
        </p>
        <form action="/auth/signout" method="post">
          <button className="text-sm text-red-600 underline">Log out</button>
        </form>
      </section>

      <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
        <h2 className="font-semibold">Export your data</h2>
        <p className="text-sm text-gray-600">
          Pick a date range when you click an export — get a report for a
          specific month, year-to-date, or all time.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            onClick={() => setExportDialog("excel")}
            className="px-4 py-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 ring-1 ring-emerald-100 text-left"
          >
            <div className="flex items-center gap-2 text-base">
              <IconSpreadsheet size={20} />
              <span>Excel</span>
            </div>
            <div className="text-xs text-emerald-600/80 font-normal mt-1">
              .xlsx with summary, expenses, fixed, budgets, categories
            </div>
          </button>
          <button
            onClick={() => setExportDialog("pdf")}
            className="px-4 py-3 rounded-xl bg-rose-50 text-rose-700 text-sm font-semibold hover:bg-rose-100 ring-1 ring-rose-100 text-left"
          >
            <div className="flex items-center gap-2 text-base">
              <IconDocument size={20} />
              <span>PDF report</span>
            </div>
            <div className="text-xs text-rose-600/80 font-normal mt-1">
              Print-ready summary. Save as PDF in print dialog.
            </div>
          </button>
          <button
            onClick={() => setExportDialog("json")}
            className="px-4 py-3 rounded-xl bg-gray-50 text-gray-700 text-sm font-semibold hover:bg-gray-100 ring-1 ring-gray-100 text-left"
          >
            <div className="flex items-center gap-2 text-base">
              <IconBraces size={20} />
              <span>JSON</span>
            </div>
            <div className="text-xs text-gray-500 font-normal mt-1">
              Raw data, re-importable later
            </div>
          </button>
        </div>
      </section>

      <section className="bg-white rounded-xl shadow-sm p-4 space-y-2">
        <h2 className="font-semibold">Snapshot</h2>
        <ul className="text-sm text-gray-600 space-y-1">
          <li>{snapshot.expenses.length} expenses</li>
          <li>{snapshot.fixedCosts.length} fixed costs</li>
          <li>{snapshot.budgets.length} budgets</li>
          <li>
            {snapshot.categories.length} categories visible (defaults + yours)
          </li>
        </ul>
      </section>

      {exportDialog && (
        <ExportDialog
          format={exportDialog}
          onCancel={() => setExportDialog(null)}
          onExport={runExport}
        />
      )}
    </div>
  );
}

function ExportDialog({
  format,
  onCancel,
  onExport,
}: {
  format: Format;
  onCancel: () => void;
  onExport: (
    format: Format,
    start: string | null,
    end: string | null
  ) => void;
}) {
  const [preset, setPreset] = useState<Preset>("this_month");
  const todayISO = new Date().toISOString().slice(0, 10);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const [customStart, setCustomStart] = useState(monthStart);
  const [customEnd, setCustomEnd] = useState(todayISO);

  function generate() {
    if (preset === "custom") {
      onExport(format, customStart || null, customEnd || null);
    } else {
      const r = rangeForPreset(preset);
      onExport(format, r.start, r.end);
    }
  }

  const formatLabel =
    format === "excel" ? "Excel" : format === "pdf" ? "PDF" : "JSON";

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3"
        style={{
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
        }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">Export as {formatLabel}</h3>
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-gray-600 text-xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-sm text-gray-600">Pick a date range.</p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPreset(p.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-semibold ring-1 transition ${
                preset === p.id
                  ? "bg-emerald-600 text-white ring-emerald-600"
                  : "bg-white text-gray-700 ring-gray-200 hover:bg-gray-50"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {preset === "custom" && (
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Start
              </label>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                End
              </label>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
              />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={generate}
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
          >
            Generate
          </button>
        </div>
      </div>
    </div>
  );
}
