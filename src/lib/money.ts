export function fmt(n: number | string | null | undefined): string {
  const num = Number(n) || 0;
  return (
    "$" +
    num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

export function fixedMonthlyEquivalent(fc: {
  amount: number;
  frequency: string;
  is_active: boolean;
}): number {
  if (!fc.is_active) return 0;
  const a = Number(fc.amount) || 0;
  switch (fc.frequency) {
    case "monthly":
      return a;
    case "biweekly":
      return (a * 26) / 12;
    case "weekly":
      return (a * 52) / 12;
    case "yearly":
      return a / 12;
    default:
      return a;
  }
}
