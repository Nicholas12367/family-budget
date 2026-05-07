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

export default function SettingsClient({
  email,
  snapshot,
}: {
  email: string;
  snapshot: Snapshot;
}) {
  const [exportToast, setExportToast] = useState<string | null>(null);

  function flash(msg: string) {
    setExportToast(msg);
    setTimeout(() => setExportToast(null), 4000);
  }

  function exportJson() {
    const payload = {
      email,
      exportedAt: new Date().toISOString(),
      ...snapshot,
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
    flash("JSON downloaded.");
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
          Download a snapshot in your preferred format.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <button
            onClick={() => {
              const s: ExportSnapshot = {
                email,
                categories: snapshot.categories,
                expenses: snapshot.expenses,
                fixedCosts: snapshot.fixedCosts,
                budgets: snapshot.budgets,
              };
              exportExcel(s);
              flash("Excel downloaded. You can keep using the app below.");
            }}
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
            onClick={() => {
              const s: ExportSnapshot = {
                email,
                categories: snapshot.categories,
                expenses: snapshot.expenses,
                fixedCosts: snapshot.fixedCosts,
                budgets: snapshot.budgets,
              };
              exportPdf(s);
              flash("PDF opened in a new tab — close it to return here.");
            }}
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
            onClick={exportJson}
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
    </div>
  );
}
