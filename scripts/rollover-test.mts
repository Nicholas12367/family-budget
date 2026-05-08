import { calculateRollover } from "../src/lib/rollover";

const baseBudget = {
  id: 1,
  user_id: "u",
  category_id: 99,
  monthly_limit: 100,
  rolls_over: true,
  is_personal: false,
  person_name: null,
  created_at: "2026-01-01T00:00:00Z",
};

console.log("=== empty months: $100 budget, no spending, anchor Jan 2026 ===");
for (let m = 0; m <= 12; m++) {
  const y = m === 12 ? 2027 : 2026;
  const mm = m === 12 ? 0 : m;
  const r = calculateRollover(baseBudget, y, mm, [], []);
  console.log(`  viewing ${mm}/${y}: rollover=$${r.toFixed(2)}, effective=$${(100 + r).toFixed(2)}`);
}

console.log("\n=== mixed: $80 Jan, $120 Feb, $0 Mar ===");
const expenses: any[] = [
  { id: 1, user_id: "u", category_id: 99, receipt_batch_id: null, amount: 80, description: "", notes: "", date: "2026-01-15" },
  { id: 2, user_id: "u", category_id: 99, receipt_batch_id: null, amount: 120, description: "", notes: "", date: "2026-02-10" },
];
for (let m = 0; m <= 4; m++) {
  const r = calculateRollover(baseBudget, 2026, m, expenses, []);
  console.log(`  viewing ${m}/2026: rollover=$${r.toFixed(2)}, effective=$${(100 + r).toFixed(2)}`);
}

console.log("\n=== 24 empty months should give 24x base ($2400) ===");
const r2y = calculateRollover(baseBudget, 2028, 0, [], []);
console.log(`  viewing Jan 2028 (24 months later): rollover=$${r2y.toFixed(2)}, effective=$${(100 + r2y).toFixed(2)}`);
