import * as XLSX from "xlsx";
import { fmt, fixedMonthlyEquivalent } from "./money";
import type { Budget, Category, Expense, FixedCost } from "./types";

export type ExportSnapshot = {
  email: string;
  categories: Category[];
  expenses: Expense[];
  fixedCosts: FixedCost[];
  budgets: Budget[];
};

// ---------- Excel (.xlsx) ----------
export function exportExcel(snapshot: ExportSnapshot) {
  const catMap = new Map(snapshot.categories.map((c) => [c.id, c]));

  const expensesSheet = snapshot.expenses
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id))
    .map((e) => ({
      Date: e.date,
      Category: catMap.get(e.category_id)?.name ?? "Unknown",
      Description: e.description ?? "",
      Amount: Number(e.amount),
      Notes: e.notes ?? "",
    }));

  const fixedSheet = snapshot.fixedCosts.map((f) => ({
    Name: f.name,
    Category: catMap.get(f.category_id)?.name ?? "Unknown",
    Amount: Number(f.amount),
    Frequency: f.frequency,
    "Monthly equivalent": Number(fixedMonthlyEquivalent(f).toFixed(2)),
    Active: f.is_active ? "Yes" : "No",
  }));

  const budgetsSheet = snapshot.budgets.map((b) => ({
    Category: catMap.get(b.category_id)?.name ?? "Unknown",
    "Monthly limit": Number(b.monthly_limit),
  }));

  const categoriesSheet = snapshot.categories.map((c) => ({
    Name: c.name,
    Default: c.is_default ? "Yes" : "No",
    Color: c.color,
    Icon: c.icon,
  }));

  // Per-month summary
  const monthMap = new Map<string, { spent: number; count: number }>();
  snapshot.expenses.forEach((e) => {
    const key = e.date.slice(0, 7); // YYYY-MM
    const cur = monthMap.get(key) ?? { spent: 0, count: 0 };
    cur.spent += Number(e.amount);
    cur.count += 1;
    monthMap.set(key, cur);
  });
  const summarySheet = [...monthMap.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([month, v]) => ({
      Month: month,
      "Variable Spent": Number(v.spent.toFixed(2)),
      "Transactions": v.count,
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), "Summary");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(expensesSheet), "Expenses");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(fixedSheet), "Fixed Costs");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(budgetsSheet), "Budgets");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(categoriesSheet), "Categories");

  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `family-budget-${today}.xlsx`);
}

// ---------- PDF (via browser print dialog) ----------
// We open a fresh window with a print-styled HTML report and call print().
// User chooses "Save as PDF" in the browser's print dialog. Zero deps.
export function exportPdf(snapshot: ExportSnapshot, monthFilter?: { year: number; month: number }) {
  const catMap = new Map(snapshot.categories.map((c) => [c.id, c]));
  const filterTitle = monthFilter
    ? new Date(monthFilter.year, monthFilter.month, 1).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : "All Time";

  const expenses = snapshot.expenses.filter((e) => {
    if (!monthFilter) return true;
    const d = new Date(e.date);
    return (
      d.getUTCFullYear() === monthFilter.year &&
      d.getUTCMonth() === monthFilter.month
    );
  });

  const totalSpent = expenses.reduce((s, e) => s + Number(e.amount), 0);
  const totalFixed = snapshot.fixedCosts.reduce(
    (s, f) => s + fixedMonthlyEquivalent(f),
    0
  );
  const totalBudget = snapshot.budgets.reduce(
    (s, b) => s + Number(b.monthly_limit),
    0
  );

  // Spend by category
  const byCat = new Map<number, number>();
  expenses.forEach((e) => {
    byCat.set(e.category_id, (byCat.get(e.category_id) ?? 0) + Number(e.amount));
  });
  const byCatRows = [...byCat.entries()]
    .sort(([, a], [, b]) => b - a)
    .map(([id, amount]) => ({
      name: catMap.get(id)?.name ?? "Unknown",
      color: catMap.get(id)?.color ?? "#9ca3af",
      amount,
      pct: totalSpent > 0 ? (amount / totalSpent) * 100 : 0,
    }));

  const expRows = expenses
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((e) => {
      const c = catMap.get(e.category_id);
      return `<tr>
        <td>${e.date}</td>
        <td>${esc(c?.name ?? "")}</td>
        <td>${esc(e.description ?? "")}</td>
        <td class="num">${fmt(e.amount)}</td>
      </tr>`;
    })
    .join("");

  const fixedRows = snapshot.fixedCosts
    .map((f) => {
      const c = catMap.get(f.category_id);
      const monthly = fixedMonthlyEquivalent(f);
      return `<tr>
        <td>${esc(f.name)}</td>
        <td>${esc(c?.name ?? "")}</td>
        <td class="num">${fmt(f.amount)}</td>
        <td>${esc(f.frequency)}</td>
        <td class="num">${fmt(monthly)}</td>
      </tr>`;
    })
    .join("");

  const budgetRows = snapshot.budgets
    .map((b) => {
      const c = catMap.get(b.category_id);
      const used = byCat.get(b.category_id) ?? 0;
      const remaining = Number(b.monthly_limit) - used;
      return `<tr>
        <td>${esc(c?.name ?? "")}</td>
        <td class="num">${fmt(b.monthly_limit)}</td>
        <td class="num">${fmt(used)}</td>
        <td class="num ${remaining < 0 ? "neg" : ""}">${fmt(remaining)}</td>
      </tr>`;
    })
    .join("");

  const html = `<!doctype html>
<html><head>
<meta charset="utf-8">
<title>Family Budget — ${filterTitle}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111827; padding: 32px; max-width: 900px; margin: 0 auto; background: #fff; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .sub { color: #6b7280; font-size: 13px; margin: 0 0 24px; }
  .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
  .stat { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px 14px; }
  .stat .l { font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; font-weight: 600; }
  .stat .v { font-size: 20px; font-weight: 700; margin-top: 4px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.05em; color: #374151; margin: 28px 0 8px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid #f3f4f6; }
  th { color: #6b7280; font-weight: 600; text-transform: uppercase; font-size: 10px; letter-spacing: 0.05em; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.neg { color: #dc2626; }
  .catrow { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .dot { width: 8px; height: 8px; border-radius: 999px; flex-shrink: 0; }
  .bar { flex: 1; height: 6px; background: #f3f4f6; border-radius: 999px; overflow: hidden; }
  .bar > div { height: 100%; background: #10b981; }
  .footer { margin-top: 32px; color: #9ca3af; font-size: 11px; text-align: center; }
  @media print { body { padding: 0; } @page { margin: 1.5cm; } }
</style>
</head><body>
  <h1>Family Budget</h1>
  <p class="sub">Report for <b>${filterTitle}</b> — generated ${new Date().toLocaleString()}</p>
  <div class="stats">
    <div class="stat"><div class="l">Total</div><div class="v">${fmt(totalSpent + totalFixed)}</div></div>
    <div class="stat"><div class="l">Variable</div><div class="v">${fmt(totalSpent)}</div></div>
    <div class="stat"><div class="l">Fixed (mo.)</div><div class="v">${fmt(totalFixed)}</div></div>
    <div class="stat"><div class="l">Budgeted</div><div class="v">${fmt(totalBudget)}</div></div>
  </div>

  <h2>Spending by Category</h2>
  ${byCatRows
    .map(
      (r) => `<div class="catrow">
    <span class="dot" style="background:${r.color}"></span>
    <span style="width:160px">${esc(r.name)}</span>
    <span class="bar"><div style="width:${r.pct.toFixed(0)}%"></div></span>
    <span class="num" style="width:90px;text-align:right">${fmt(r.amount)}</span>
  </div>`
    )
    .join("") || "<p>No spending in this period.</p>"}

  <h2>Budgets</h2>
  ${budgetRows
    ? `<table><thead><tr><th>Category</th><th class="num">Limit</th><th class="num">Spent</th><th class="num">Remaining</th></tr></thead><tbody>${budgetRows}</tbody></table>`
    : "<p>No budgets set.</p>"}

  <h2>Fixed Costs</h2>
  ${fixedRows
    ? `<table><thead><tr><th>Name</th><th>Category</th><th class="num">Amount</th><th>Frequency</th><th class="num">Monthly</th></tr></thead><tbody>${fixedRows}</tbody></table>`
    : "<p>No fixed costs.</p>"}

  <h2>Expenses</h2>
  ${expRows
    ? `<table><thead><tr><th>Date</th><th>Category</th><th>Description</th><th class="num">Amount</th></tr></thead><tbody>${expRows}</tbody></table>`
    : "<p>No expenses in this period.</p>"}

  <div class="footer">budget.reachscreens.ca</div>
  <script>window.addEventListener("load",()=>setTimeout(()=>window.print(),300));</script>
</body></html>`;

  const w = window.open("", "_blank");
  if (!w) {
    alert("Pop-up blocked. Please allow pop-ups to export PDF.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
