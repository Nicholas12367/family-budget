"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";
import type { Category } from "@/lib/types";

const CategoryInput = z.object({
  name: z.string().min(1),
  icon: z.string().min(1).max(8).default("🏷️"),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#6366f1"),
});

export async function listCategories() {
  const { supabase, user } = await getUserOrThrow();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", user.id)
    .order("name");
  if (error) throw error;
  return data;
}

export async function createCategory(form: FormData): Promise<Category> {
  const { supabase, user } = await getUserOrThrow();
  const input = CategoryInput.parse(Object.fromEntries(form));
  const { data, error } = await supabase
    .from("categories")
    .insert({ ...input, user_id: user.id, is_default: false })
    .select("*")
    .single();
  if (error) throw error;
  revalidatePath("/");
  return data as Category;
}

export async function updateCategory(
  id: number,
  form: FormData
): Promise<Category> {
  const { supabase, user } = await getUserOrThrow();
  const input = CategoryInput.parse(Object.fromEntries(form));
  const { data, error } = await supabase
    .from("categories")
    .update(input)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("*")
    .single();
  if (error) throw error;
  revalidatePath("/");
  return data as Category;
}

export async function deleteCategory(id: number) {
  const { supabase, user } = await getUserOrThrow();
  const { count: expCount } = await supabase
    .from("expenses")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("category_id", id);
  const { count: fcCount } = await supabase
    .from("fixed_costs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("category_id", id);
  if ((expCount ?? 0) > 0 || (fcCount ?? 0) > 0) {
    throw new Error(
      "Can't delete: this category is in use. Reassign those items first."
    );
  }
  const { error } = await supabase
    .from("categories")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
}
