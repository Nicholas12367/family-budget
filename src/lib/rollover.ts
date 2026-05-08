import type { Category, Expense, FixedCost, Person } from "./types";
import { fixedMonthlyEquivalent } from "./money";

// A "personal" budget is one where the category name matches a non-shared
// person's name (case-insensitive). Those budgets carry surplus or deficit
// forward each month; everything else resets to its base limit.
export function getPersonalCategoryIds(
  categories: Pick<Category, "id" | "name">[],
  people: Person[]
): Set<number> {
  const personNames = new Set(
    people
      .filter((p) => !p.is_shared)
      .map((p) => p.name.trim().toLowerCase())
  );
  const ids = new Set<number>();
  for (const c of categories) {
    if (personNames.has(c.name.trim().toLowerCase())) ids.add(c.id);
  }
  return ids;
}

// Sum of (base - spent) across every month before the viewed one for a
// single category. Surplus months add, overspend months subtract — this
// matches the user-described compounding rollover.
export function calculateRollover(
  categoryId: number,
  baseLimit: number,
  viewYear: number,
  viewMonth: number,
  allExpenses: Expense[],
  activeFixedCosts: FixedCost[]
): number {
  if (!baseLimit || baseLimit <= 0) return 0;

  let earliest: { y: number; m: number } | null = null;
  for (const e of allExpenses) {
    if (e.category_id !== categoryId) continue;
    const d = new Date(e.date);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    if (!earliest || y < earliest.y || (y === earliest.y && m < earliest.m)) {
      earliest = { y, m };
    }
  }
  if (!earliest) return 0;

  const fixedPerMonth = activeFixedCosts
    .filter((f) => f.category_id === categoryId)
    .reduce((s, f) => s + fixedMonthlyEquivalent(f), 0);

  let totalRollover = 0;
  let y = earliest.y;
  let m = earliest.m;
  while (y < viewYear || (y === viewYear && m < viewMonth)) {
    const variableSpent = allExpenses
      .filter((e) => {
        if (e.category_id !== categoryId) return false;
        const d = new Date(e.date);
        return d.getUTCFullYear() === y && d.getUTCMonth() === m;
      })
      .reduce((s, e) => s + Number(e.amount), 0);
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

export type EffectiveLimit = {
  base: number;
  rollover: number;
  effective: number;
  isPersonal: boolean;
};

export function buildEffectiveLimitMap(
  budgets: { category_id: number; monthly_limit: number }[],
  personalCatIds: Set<number>,
  viewYear: number,
  viewMonth: number,
  allExpenses: Expense[],
  activeFixedCosts: FixedCost[]
): Map<number, EffectiveLimit> {
  const out = new Map<number, EffectiveLimit>();
  for (const b of budgets) {
    const base = Number(b.monthly_limit) || 0;
    const isPersonal = personalCatIds.has(b.category_id);
    const rollover = isPersonal
      ? calculateRollover(
          b.category_id,
          base,
          viewYear,
          viewMonth,
          allExpenses,
          activeFixedCosts
        )
      : 0;
    out.set(b.category_id, {
      base,
      rollover,
      effective: Math.round((base + rollover) * 100) / 100,
      isPersonal,
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
