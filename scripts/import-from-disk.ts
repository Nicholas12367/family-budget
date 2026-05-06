// One-off import: parse the 3 monthly CSVs from ~/Downloads and insert them
// into Supabase under the user's auth.users id. Uses SUPABASE_SERVICE_ROLE_KEY
// to bypass RLS for the seed.
//
// Run with: npx tsx scripts/import-from-disk.ts <user-email>

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { parseCsv, dedupeFixedCosts } from "../src/lib/csv-import";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const targetEmail = process.argv[2];
if (!targetEmail) {
  console.error("Usage: tsx scripts/import-from-disk.ts <user-email>");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

const CSV_PATHS = [
  join(homedir(), "Downloads", "family-budget-2026-03.csv"),
  join(homedir(), "Downloads", "family-budget-2026-04 (1).csv"),
  join(homedir(), "Downloads", "family-budget-2026-05.csv"),
];

const DEFAULT_COLOR = "#6366f1";
const DEFAULT_ICON = "🏷️";

async function main() {
  // Find the user
  const { data: users } = await admin.auth.admin.listUsers();
  const user = users?.users.find((u) => u.email?.toLowerCase() === targetEmail.toLowerCase());
  if (!user) throw new Error(`No user with email ${targetEmail}`);
  console.log(`Target user: ${user.email} (${user.id})`);

  // Parse files
  const parsed = CSV_PATHS.map((p) => {
    const text = readFileSync(p, "utf8");
    const f = parseCsv(text);
    console.log(
      `  ${p.split("/").pop()}: ${f.expenses.length} expenses, ${f.fixed_costs.length} fixed, ${f.budgets.length} budgets`
    );
    return f;
  });

  // Existing categories (user's + globals)
  const { data: existing } = await admin
    .from("categories")
    .select("id, name, user_id")
    .or(`user_id.eq.${user.id},user_id.is.null`);
  const byName = new Map<string, number>();
  // Prefer user-owned rows over globals (so writes target user's clones)
  (existing ?? [])
    .sort((a, b) => (a.user_id ? -1 : 1))
    .forEach((c) => {
      const k = c.name.trim().toLowerCase();
      if (!byName.has(k)) byName.set(k, c.id);
    });

  // Seen names in CSVs
  const seenNames = new Set<string>();
  parsed.forEach((f) => {
    f.expenses.forEach((e) => seenNames.add(e.category_name.trim()));
    f.fixed_costs.forEach((fc) => seenNames.add(fc.category_name.trim()));
    f.budgets.forEach((b) => seenNames.add(b.category_name.trim()));
  });

  // Create missing categories
  for (const name of seenNames) {
    if (!byName.has(name.toLowerCase())) {
      const { data, error } = await admin
        .from("categories")
        .insert({
          user_id: user.id,
          name,
          icon: DEFAULT_ICON,
          color: DEFAULT_COLOR,
          is_default: false,
        })
        .select("id")
        .single();
      if (error) throw error;
      byName.set(name.toLowerCase(), data.id);
      console.log(`  + created category: ${name} (${data.id})`);
    }
  }

  const catId = (n: string): number => {
    const id = byName.get(n.trim().toLowerCase());
    if (!id) throw new Error(`No category for: ${n}`);
    return id;
  };

  // Expenses
  const expenseRows = parsed.flatMap((f) =>
    f.expenses.map((e) => ({
      user_id: user.id,
      category_id: catId(e.category_name),
      amount: e.amount,
      description: e.description,
      notes: e.notes,
      date: e.date,
    }))
  );
  if (expenseRows.length) {
    const { error } = await admin.from("expenses").insert(expenseRows);
    if (error) throw error;
    console.log(`  + inserted ${expenseRows.length} expenses`);
  }

  // Fixed costs (deduped)
  const fcRows = dedupeFixedCosts(parsed).map((fc) => ({
    user_id: user.id,
    category_id: catId(fc.category_name),
    name: fc.name,
    amount: fc.amount,
    frequency: fc.frequency,
    is_active: true,
  }));
  if (fcRows.length) {
    const { error } = await admin.from("fixed_costs").insert(fcRows);
    if (error) throw error;
    console.log(`  + inserted ${fcRows.length} fixed costs`);
  }

  // Budgets
  const budgetRows = parsed.flatMap((f) =>
    f.budgets.map((b) => ({
      user_id: user.id,
      category_id: catId(b.category_name),
      monthly_limit: b.monthly_limit,
      month: b.month,
      year: b.year,
    }))
  );
  if (budgetRows.length) {
    const { error } = await admin
      .from("budgets")
      .upsert(budgetRows, { onConflict: "user_id,category_id,month,year" });
    if (error) throw error;
    console.log(`  + inserted ${budgetRows.length} budgets`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
