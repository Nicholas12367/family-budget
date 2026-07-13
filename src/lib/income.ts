// Shared income types + constants. Kept in a plain module (NOT the
// "use server" actions file, which may only export async functions) so both
// client components and server code can import the runtime constants.

export type GoalPeriod = "monthly" | "yearly";

export type SavingsGoal = {
  target: number;
  period: GoalPeriod;
};

// Income source categories — stored in income_entries.source (free-text key).
export const INCOME_SOURCES = [
  { key: "paycheck", label: "Paycheck", emoji: "💼" },
  { key: "side_gig", label: "Side gig", emoji: "🛠️" },
  { key: "sale", label: "Sold item", emoji: "🏷️" },
  { key: "investment", label: "Investment", emoji: "📈" },
  { key: "rental", label: "Rental", emoji: "🏠" },
  { key: "benefits", label: "Benefits", emoji: "🏛️" },
  { key: "gift", label: "Gift", emoji: "🎁" },
  { key: "refund", label: "Refund", emoji: "🧾" },
  { key: "scanned", label: "Scanned", emoji: "📸" },
  { key: "other", label: "Other", emoji: "💵" },
] as const;

export type IncomeSourceKey = (typeof INCOME_SOURCES)[number]["key"];
