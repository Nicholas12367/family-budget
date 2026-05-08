import type { Budget, Expense, FixedCost } from "./types";
import { fixedMonthlyEquivalent } from "./money";

// Sum of (base - spent) across every month from the budget's anchor up
// through (but not including) the viewed month. Empty months still
// count — they add a full base limit each, which is what makes the
// rollover compound indefinitely even when nothing was spent.
export function calculateRollover(
  budget: Budget,
  viewYear: number,
  viewMonth: number,
  allExpenses: Expense[],
  activeFixedCosts: FixedCost[]
): number {
  const baseLimit = Number(budget.monthly_limit) || 0;
  if (!baseLimit) return 0;

  const anchor = rolloverAnchor(budget, allExpenses);
  if (!anchor) return 0;

  // Don't roll forward into the future.
  if (
    anchor.y > viewYear ||
    (anchor.y === viewYear && anchor.m >= viewMonth)
  ) {
    return 0;
  }

  const fixedPerMonth = activeFixedCosts
    .filter((f) => f.category_id === budget.category_id)
    .reduce((s, f) => s + fixedMonthlyEquivalent(f), 0);

  const spentByMonth = new Map<string, number>();
  for (const e of allExpenses) {
    if (e.category_id !== budget.category_id) continue;
    const d = new Date(e.date);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    spentByMonth.set(key, (spentByMonth.get(key) ?? 0) + Number(e.amount));
  }

  let totalRollover = 0;
  let y = anchor.y;
  let m = anchor.m;
  // Hard cap at 240 iterations (20 years) so a misconfigured anchor can
  // never spin forever.
  for (let guard = 0; guard < 240; guard++) {
    if (y > viewYear || (y === viewYear && m >= viewMonth)) break;
    const variableSpent = spentByMonth.get(`${y}-${m}`) ?? 0;
    const spent = variableSpent + fixedPerMonth;
    totalRollover += baseLimit - spent;
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return Math.round(totalRollover * 100) / 100;
}

// The earliest month the rollover should start counting from. We use the
// budget's `created_at` (so rollover compounds even with no expenses).
// If `created_at` isn't available (e.g. legacy row before the DB had
// it), fall back to the `month`/`year` columns or the earliest expense
// in this category.
export function rolloverAnchor(
  budget: Budget,
  allExpenses: Expense[]
): { y: number; m: number } | null {
  if (budget.created_at) {
    const d = new Date(budget.created_at);
    if (!isNaN(d.getTime())) {
      return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
    }
  }
  if (
    typeof budget.year === "number" &&
    typeof budget.month === "number"
  ) {
    return { y: budget.year, m: budget.month };
  }
  let earliest: { y: number; m: number } | null = null;
  for (const e of allExpenses) {
    if (e.category_id !== budget.category_id) continue;
    const d = new Date(e.date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    if (!earliest || y < earliest.y || (y === earliest.y && m < earliest.m)) {
      earliest = { y, m };
    }
  }
  return earliest;
}

export type EffectiveLimit = {
  base: number;
  rollover: number;
  effective: number;
  rollsOver: boolean;
  isPersonal: boolean;
  personName: string | null;
};

export function buildEffectiveLimitMap(
  budgets: Budget[],
  viewYear: number,
  viewMonth: number,
  allExpenses: Expense[],
  activeFixedCosts: FixedCost[]
): Map<number, EffectiveLimit> {
  const out = new Map<number, EffectiveLimit>();
  for (const b of budgets) {
    const base = Number(b.monthly_limit) || 0;
    const rollsOver = !!b.rolls_over;
    const rollover = rollsOver
      ? calculateRollover(b, viewYear, viewMonth, allExpenses, activeFixedCosts)
      : 0;
    out.set(b.category_id, {
      base,
      rollover,
      effective: Math.round((base + rollover) * 100) / 100,
      rollsOver,
      isPersonal: !!b.is_personal,
      personName: b.person_name ?? null,
    });
  }
  return out;
}

// "YYYY-MM-DD" for the current local date. Date strings compare lexically
// so we can use plain string comparisons against expense dates.
export function todayLocalISO(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isFutureDate(dateStr: string): boolean {
  if (!dateStr) return false;
  return dateStr > todayLocalISO();
}
