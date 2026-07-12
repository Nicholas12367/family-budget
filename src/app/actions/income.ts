"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";

const IncomeInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().min(0),
  description: z.string().max(200).optional().default(""),
  source: z.string().max(80).optional().default(""),
});

export type IncomeEntry = {
  id: number;
  user_id: string;
  date: string;
  amount: number;
  description: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
};

export async function listIncome(): Promise<IncomeEntry[]> {
  const { supabase, user } = await getUserOrThrow();
  const { data, error } = await supabase
    .from("income_entries")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .order("id", { ascending: false });
  if (error) {
    // Table may not exist if migration hasn't run — return empty.
    return [];
  }
  return (data ?? []) as IncomeEntry[];
}

export async function createIncome(input: z.input<typeof IncomeInput>) {
  const { supabase, user } = await getUserOrThrow();
  const parsed = IncomeInput.parse(input);
  const { error } = await supabase.from("income_entries").insert({
    user_id: user.id,
    date: parsed.date,
    amount: parsed.amount,
    description: parsed.description || null,
    source: parsed.source || null,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { ok: true };
}

export async function updateIncome(input: {
  id: number;
  date: string;
  amount: number;
  description?: string;
  source?: string;
}) {
  const { supabase, user } = await getUserOrThrow();
  const parsed = IncomeInput.parse(input);
  const { error } = await supabase
    .from("income_entries")
    .update({
      date: parsed.date,
      amount: parsed.amount,
      description: parsed.description || null,
      source: parsed.source || null,
    })
    .eq("id", input.id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { ok: true };
}

export async function deleteIncome(id: number) {
  const { supabase, user } = await getUserOrThrow();
  const { error } = await supabase
    .from("income_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { ok: true };
}

// -------------------------------------------------------------------
// Savings goals — one annual target per user. Powers the progress bar
// on the Income widget. Reads degrade to null if the migration hasn't
// been applied yet, matching listIncome()'s fault tolerance.
// -------------------------------------------------------------------

const SavingsGoalInput = z.object({
  year: z.coerce.number().int().min(2000).max(3000),
  target_amount: z.coerce.number().min(0),
});

export async function getSavingsGoal(year: number): Promise<number | null> {
  const { supabase, user } = await getUserOrThrow();
  const { data, error } = await supabase
    .from("savings_goals")
    .select("target_amount")
    .eq("user_id", user.id)
    .eq("year", year)
    .maybeSingle();
  if (error || !data) return null;
  return Number(data.target_amount);
}

export async function setSavingsGoal(input: z.input<typeof SavingsGoalInput>) {
  const { supabase, user } = await getUserOrThrow();
  const parsed = SavingsGoalInput.parse(input);
  const { error } = await supabase
    .from("savings_goals")
    .upsert(
      {
        user_id: user.id,
        year: parsed.year,
        target_amount: parsed.target_amount,
      },
      { onConflict: "user_id,year" }
    );
  if (error) throw new Error(error.message);
  revalidatePath("/");
  return { ok: true };
}
