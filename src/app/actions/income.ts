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
