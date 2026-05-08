"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";
import { checkBudgetThreshold, sendToUser } from "@/lib/push";
import type { Expense } from "@/lib/types";

const ExpenseInput = z.object({
  category_id: z.coerce.number().int().positive(),
  amount: z.coerce.number(),
  description: z.string().optional().default(""),
  notes: z.string().optional().default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  person_id: z
    .preprocess(
      (v) => (v === "" || v === undefined || v === null ? null : v),
      z.union([z.coerce.number().int().positive(), z.null()])
    )
    .optional()
    .default(null),
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

export async function createExpense(form: FormData): Promise<Expense> {
  const { supabase, user } = await getUserOrThrow();
  const input = ExpenseInput.parse(Object.fromEntries(form));
  const { data, error } = await supabase
    .from("expenses")
    .insert({ ...input, user_id: user.id })
    .select("*")
    .single();
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

  return data as Expense;
}

export async function updateExpense(
  id: number,
  form: FormData
): Promise<Expense> {
  const { supabase, user } = await getUserOrThrow();
  const input = ExpenseInput.parse(Object.fromEntries(form));
  const { data, error } = await supabase
    .from("expenses")
    .update(input)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) throw error;
  revalidatePath("/");
  return data as Expense;
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

const BulkPatch = z.object({
  ids: z.array(z.coerce.number().int().positive()).min(1),
  category_id: z.coerce.number().int().positive().optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  person_id: z
    .preprocess(
      (v) => (v === "" || v === undefined ? undefined : v),
      z.union([z.coerce.number().int().positive(), z.null()])
    )
    .optional(),
  notes: z.string().optional(),
});

export async function bulkUpdateExpenses(input: z.input<typeof BulkPatch>) {
  const { supabase, user } = await getUserOrThrow();
  const parsed = BulkPatch.parse(input);
  const { ids, ...patch } = parsed;
  if (Object.keys(patch).length === 0) return { ok: true, updated: 0 };
  const { error } = await supabase
    .from("expenses")
    .update(patch)
    .in("id", ids)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
  return { ok: true, updated: ids.length };
}

export async function bulkDeleteExpenses(ids: number[]) {
  const { supabase, user } = await getUserOrThrow();
  const cleaned = ids
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (cleaned.length === 0) return { ok: true, deleted: 0 };
  const { error } = await supabase
    .from("expenses")
    .delete()
    .in("id", cleaned)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
  return { ok: true, deleted: cleaned.length };
}
