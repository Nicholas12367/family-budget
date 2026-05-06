// Parses Manus's family-budget CSV export into typed sections.
// Format (per file):
//   Family Budget - <Month YYYY>
//   <blank>
//   SUMMARY
//   Total Spent,N
//   Fixed Costs,N
//   <blank>
//   SPENDING BY CATEGORY
//   Category,Amount,Transactions
//   <rows>
//   <blank>
//   BUDGETS
//   Category,Budget,Spent,Remaining
//   <rows>
//   <blank>
//   FIXED COSTS
//   Name,Category,Amount,Frequency
//   <rows>
//   <blank>
//   ALL EXPENSES
//   Date,Description,Category,Amount,Notes
//   <rows>

export type ParsedExpense = {
  date: string; // YYYY-MM-DD
  description: string;
  category_name: string;
  amount: number;
  notes: string;
};

export type ParsedFixedCost = {
  name: string;
  category_name: string;
  amount: number;
  frequency: "monthly" | "biweekly" | "weekly" | "yearly";
};

export type ParsedBudget = {
  category_name: string;
  monthly_limit: number;
  month: number;
  year: number;
};

export type ParsedFile = {
  month: number;
  year: number;
  expenses: ParsedExpense[];
  fixed_costs: ParsedFixedCost[];
  budgets: ParsedBudget[];
};

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function parseRow(line: string): string[] {
  // RFC 4180-ish: comma separated, fields may be wrapped in "...", with "" escaping ".
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQ = false;
      } else {
        cur += c;
      }
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") {
        out.push(cur);
        cur = "";
      } else cur += c;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function toIsoDate(mdy: string): string {
  // Input like "5/25/2026" or "5/2/2026". Output "2026-05-25".
  const [m, d, y] = mdy.split("/").map((s) => s.trim());
  if (!m || !d || !y) return mdy;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

export function parseCsv(text: string): ParsedFile {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let month = 0;
  let year = new Date().getFullYear();

  // Header line: "Family Budget - May 2026"
  const titleMatch = lines[0]?.match(/Family Budget\s*-\s*(\w+)\s+(\d{4})/i);
  if (titleMatch) {
    const m = MONTHS[titleMatch[1].toLowerCase()];
    if (m !== undefined) month = m;
    year = Number(titleMatch[2]);
  }

  let section = "";
  const expenses: ParsedExpense[] = [];
  const fixed_costs: ParsedFixedCost[] = [];
  const budgets: ParsedBudget[] = [];

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      section = "";
      continue;
    }
    if (
      trimmed === "SUMMARY" ||
      trimmed === "SPENDING BY CATEGORY" ||
      trimmed === "BUDGETS" ||
      trimmed === "FIXED COSTS" ||
      trimmed === "ALL EXPENSES"
    ) {
      section = trimmed;
      // Skip the header row that follows
      i++;
      continue;
    }

    const cells = parseRow(raw);

    if (section === "ALL EXPENSES" && cells.length >= 4) {
      const [d, desc, cat, amt, note = ""] = cells;
      const amount = Number(amt);
      if (!isFinite(amount)) continue;
      expenses.push({
        date: toIsoDate(d),
        description: desc || "",
        category_name: cat || "Other",
        amount,
        notes: note || "",
      });
    } else if (section === "FIXED COSTS" && cells.length >= 4) {
      const [name, cat, amt, freq] = cells;
      const amount = Number(amt);
      if (!isFinite(amount)) continue;
      const f = (freq || "monthly").toLowerCase();
      const frequency =
        f === "biweekly" || f === "weekly" || f === "yearly" ? f : "monthly";
      fixed_costs.push({
        name: (name || "").trim(),
        category_name: cat || "Other",
        amount,
        frequency: frequency as ParsedFixedCost["frequency"],
      });
    } else if (section === "BUDGETS" && cells.length >= 2) {
      const [cat, lim] = cells;
      const monthly_limit = Number(lim);
      if (!isFinite(monthly_limit) || monthly_limit <= 0) continue;
      budgets.push({
        category_name: cat || "Other",
        monthly_limit,
        month,
        year,
      });
    }
  }

  return { month, year, expenses, fixed_costs, budgets };
}

export function dedupeFixedCosts(parsed: ParsedFile[]): ParsedFixedCost[] {
  const seen = new Map<string, ParsedFixedCost>();
  for (const file of parsed) {
    for (const fc of file.fixed_costs) {
      const key = `${fc.name.trim().toLowerCase()}|${fc.amount}|${fc.frequency}`;
      if (!seen.has(key)) seen.set(key, fc);
    }
  }
  return Array.from(seen.values());
}
