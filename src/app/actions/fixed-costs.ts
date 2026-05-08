"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";
import { checkBudgetThreshold } from "@/lib/push";
import type { FixedCost } from "@/lib/types";

const FixedInput = z.object({
  category_id: z.coerce.number().int().positive(),
  name: z.string().min(1),
  amount: z.coerce.number().positive(),
  frequency: z.enum(["monthly", "biweekly", "weekly", "yearly"]),
  is_active: z.coerce.boolean(),
  person_id: z
    .preprocess(
      (v) => (v === "" || v === undefined || v === null ? null : v),
      z.union([z.coerce.number().int().positive(), z.null()])
    )
    .optional()
    .default(null),
});

export async function listFixedCosts() {
  const { supabase, user } = await getUserOrThrow();
  const { data, error } = await supabase
    .from("fixed_costs")
    .select("*")
    .eq("user_id", user.id)
    .order("name");
  if (error) throw error;
  return data;
}

export async function createFixedCost(form: FormData): Promise<FixedCost> {
  const { supabase, user } = await getUserOrThrow();
  const data = Object.fromEntries(form);
  const input = FixedInput.parse({ ...data, is_active: data.is_active ?? false });
  const { data: row, error } = await supabase
    .from("fixed_costs")
    .insert({ ...input, user_id: user.id })
    .select("*")
    .single();
  if (error) throw error;
  revalidatePath("/");
  if (input.is_active) {
    try {
      await checkBudgetThreshold(
        user.id,
        input.category_id,
        new Date().toISOString().slice(0, 10)
      );
    } catch {
      // push failures must not block save
    }
  }
  return row as FixedCost;
}

export async function updateFixedCost(
  id: number,
  form: FormData
): Promise<FixedCost> {
  const { supabase, user } = await getUserOrThrow();
  const data = Object.fromEntries(form);
  const input = FixedInput.parse({ ...data, is_active: data.is_active ?? false });
  const { data: row, error } = await supabase
    .from("fixed_costs")
    .update(input)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) throw error;
  revalidatePath("/");
  if (input.is_active) {
    try {
      await checkBudgetThreshold(
        user.id,
        input.category_id,
        new Date().toISOString().slice(0, 10)
      );
    } catch {
      // push failures must not block save
    }
  }
  return row as FixedCost;
}

export async function deleteFixedCost(id: number) {
  const { supabase, user } = await getUserOrThrow();
  const { error } = await supabase
    .from("fixed_costs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
}
