"use server";
import { revalidatePath } from "next/cache";
import { getUserOrThrow } from "./auth";

export async function listBudgets() {
  const { supabase, user } = await getUserOrThrow();
  const { data, error } = await supabase
    .from("budgets")
    .select("*")
    .eq("user_id", user.id);
  if (error) throw error;
  return data;
}

export async function setBudget(input: {
  category_id: number;
  monthly_limit: number;
}) {
  const { supabase, user } = await getUserOrThrow();
  if (!input.monthly_limit || input.monthly_limit <= 0) {
    const { error } = await supabase
      .from("budgets")
      .delete()
      .eq("user_id", user.id)
      .eq("category_id", input.category_id);
    if (error) throw error;
  } else {
    const now = new Date();
    const { error } = await supabase
      .from("budgets")
      .upsert(
        {
          user_id: user.id,
          category_id: input.category_id,
          monthly_limit: input.monthly_limit,
          month: now.getMonth(),
          year: now.getFullYear(),
        },
        { onConflict: "user_id,category_id" }
      );
    if (error) throw error;
  }
  revalidatePath("/");
}
