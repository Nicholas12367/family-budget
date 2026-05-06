"use server";
import { revalidatePath } from "next/cache";
import { getUserOrThrow } from "./auth";
import { parseCsv, dedupeFixedCosts, type ParsedFile } from "@/lib/csv-import";

const DEFAULT_COLOR = "#6366f1";
const DEFAULT_ICON = "🏷️";

export async function importCsvFiles(formData: FormData) {
  const { supabase, user } = await getUserOrThrow();
  const files = formData.getAll("csv");
  if (!files.length) throw new Error("No CSV files uploaded");

  const parsed: ParsedFile[] = [];
  for (const f of files) {
    if (!(f instanceof File)) continue;
    const text = await f.text();
    parsed.push(parseCsv(text));
  }

  // ---- Categories: ensure every category name seen has a row for this user.
  const { data: existing } = await supabase
    .from("categories")
    .select("id, name")
    .or(`user_id.eq.${user.id},user_id.is.null`);
  const byName = new Map<string, number>();
  (existing ?? []).forEach((c) => {
    if (!byName.has(c.name.trim().toLowerCase())) {
      byName.set(c.name.trim().toLowerCase(), c.id);
    }
  });

  const seenNames = new Set<string>();
  for (const file of parsed) {
    file.expenses.forEach((e) => seenNames.add(e.category_name.trim()));
    file.fixed_costs.forEach((f) => seenNames.add(f.category_name.trim()));
    file.budgets.forEach((b) => seenNames.add(b.category_name.trim()));
  }

  for (const name of seenNames) {
    if (!byName.has(name.toLowerCase())) {
      const { data, error } = await supabase
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
    }
  }

  const catId = (name: string): number => {
    const id = byName.get(name.trim().toLowerCase());
    if (!id) throw new Error(`Missing category mapping: ${name}`);
    return id;
  };

  // ---- Expenses
  const expenseRows = parsed.flatMap((file) =>
    file.expenses.map((e) => ({
      user_id: user.id,
      category_id: catId(e.category_name),
      amount: e.amount,
      description: e.description,
      notes: e.notes,
      date: e.date,
    }))
  );
  if (expenseRows.length > 0) {
    const { error } = await supabase.from("expenses").insert(expenseRows);
    if (error) throw error;
  }

  // ---- Fixed costs (dedupe across months)
  const fcRows = dedupeFixedCosts(parsed).map((f) => ({
    user_id: user.id,
    category_id: catId(f.category_name),
    name: f.name,
    amount: f.amount,
    frequency: f.frequency,
    is_active: true,
  }));
  if (fcRows.length > 0) {
    const { error } = await supabase.from("fixed_costs").insert(fcRows);
    if (error) throw error;
  }

  // ---- Budgets (per-month)
  const budgetRows = parsed.flatMap((file) =>
    file.budgets.map((b) => ({
      user_id: user.id,
      category_id: catId(b.category_name),
      monthly_limit: b.monthly_limit,
      month: b.month,
      year: b.year,
    }))
  );
  if (budgetRows.length > 0) {
    const { error } = await supabase
      .from("budgets")
      .upsert(budgetRows, { onConflict: "user_id,category_id,month,year" });
    if (error) throw error;
  }

  revalidatePath("/");
  return {
    expenses: expenseRows.length,
    fixed_costs: fcRows.length,
    budgets: budgetRows.length,
    categories_created: seenNames.size,
  };
}
