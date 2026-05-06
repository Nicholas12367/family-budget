"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";

const FixedInput = z.object({
  category_id: z.coerce.number().int().positive(),
  name: z.string().min(1),
  amount: z.coerce.number().positive(),
  frequency: z.enum(["monthly", "biweekly", "weekly", "yearly"]),
  is_active: z.coerce.boolean(),
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

export async function createFixedCost(form: FormData) {
  const { supabase, user } = await getUserOrThrow();
  const data = Object.fromEntries(form);
  const input = FixedInput.parse({ ...data, is_active: data.is_active ?? false });
  const { error } = await supabase
    .from("fixed_costs")
    .insert({ ...input, user_id: user.id });
  if (error) throw error;
  revalidatePath("/");
}

export async function updateFixedCost(id: number, form: FormData) {
  const { supabase, user } = await getUserOrThrow();
  const data = Object.fromEntries(form);
  const input = FixedInput.parse({ ...data, is_active: data.is_active ?? false });
  const { error } = await supabase
    .from("fixed_costs")
    .update(input)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
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
