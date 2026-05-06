"use client";

import { useState } from "react";
import type { Budget, Category, Expense, FixedCost } from "@/lib/types";
import { importCsvFiles } from "@/app/actions/import";
import { exportExcel, exportPdf, type ExportSnapshot } from "@/lib/exporters";
import {
  IconSpreadsheet,
  IconDocument,
  IconBraces,
  IconUpload,
} from "./Icon";
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
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
  }

  async function onImport(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const fd = new FormData();
      Array.from(files).forEach((f) => fd.append("csv", f));
      const summary = await importCsvFiles(fd);
      setResult(
        `Imported: ${summary.expenses} expenses, ${summary.fixed_costs} fixed costs, ${summary.budgets} budgets, ${summary.categories_created} categories total touched.`
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
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
        <h2 className="font-semibold">Import from Manus</h2>
        <p className="text-sm text-gray-600">
          Upload one or more <code>family-budget-YYYY-MM.csv</code> files exported
          from your old Manus app. Expenses, fixed costs, budgets and any new
          categories will be imported under your account.
        </p>
        <label className="block w-full">
          <input
            type="file"
            accept=".csv,text/csv"
            multiple
            disabled={busy}
            onChange={(e) => onImport(e.target.files)}
            className="hidden"
          />
          <span className="block w-full text-center px-4 py-3 rounded-lg bg-emerald-500 text-white font-semibold cursor-pointer hover:bg-emerald-600">
            {busy ? "Importing…" : "Upload CSV files"}
          </span>
        </label>
        {result && (
          <p className="text-sm text-emerald-700 bg-emerald-50 rounded-lg p-3">
            {result}
          </p>
        )}
        {error && (
          <p className="text-sm text-red-700 bg-red-50 rounded-lg p-3">
            {error}
          </p>
        )}
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
