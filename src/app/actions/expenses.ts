"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";
import { checkBudgetThreshold, sendToUser } from "@/lib/push";

const ExpenseInput = z.object({
  category_id: z.coerce.number().int().positive(),
  amount: z.coerce.number(),
  description: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const LARGE_PURCHASE_THRESHOLD = 100;
const fmt = (n: number) =>
  "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

export async function listExpenses() {
  const { supabase, user } = await getUserOrThrow();
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .eq("user_id", user.id)
    .order("date", { ascending: false })
    .order("id", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createExpense(form: FormData) {
  const { supabase, user } = await getUserOrThrow();
  const input = ExpenseInput.parse(Object.fromEntries(form));
  const { error } = await supabase.from("expenses").insert({
    ...input,
    user_id: user.id,
  });
  if (error) throw error;
  revalidatePath("/");

  try {
    if (input.amount >= LARGE_PURCHASE_THRESHOLD) {
      await sendToUser(user.id, {
        title: "Purchase logged",
        body: `${fmt(input.amount)} • ${input.description || "expense"}`,
        url: "/",
      });
    }
    await checkBudgetThreshold(user.id, input.category_id, input.date);
  } catch {
    // push failures must not block the expense save
  }
}

export async function updateExpense(id: number, form: FormData) {
  const { supabase, user } = await getUserOrThrow();
  const input = ExpenseInput.parse(Object.fromEntries(form));
  const { error } = await supabase
    .from("expenses")
    .update(input)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
}

export async function deleteExpense(id: number) {
  const { supabase, user } = await getUserOrThrow();
  const { error } = await supabase
    .from("expenses")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
}
