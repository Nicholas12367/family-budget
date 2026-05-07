"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";
import type { Person } from "@/lib/types";

const PersonInput = z.object({
  name: z.string().trim().min(1).max(60),
  color: z.string().regex(/^#?[0-9a-fA-F]{6}$/).default("#10b981"),
  is_shared: z
    .union([z.boolean(), z.string()])
    .transform((v) => v === true || v === "true" || v === "on")
    .default(false),
});

export async function listPeople(): Promise<Person[]> {
  const { supabase, user } = await getUserOrThrow();
  const { data, error } = await supabase
    .from("people")
    .select("*")
    .eq("user_id", user.id)
    .order("sort_order")
    .order("id");
  if (error) {
    if ((error as { code?: string }).code === "42P01") return [];
    throw error;
  }
  return (data ?? []) as Person[];
}

export async function createPerson(form: FormData): Promise<Person> {
  const { supabase, user } = await getUserOrThrow();
  const input = PersonInput.parse(Object.fromEntries(form));
  const color = input.color.startsWith("#") ? input.color : `#${input.color}`;
  const { data, error } = await supabase
    .from("people")
    .insert({
      user_id: user.id,
      name: input.name,
      color,
      is_shared: input.is_shared,
    })
    .select("*")
    .single();
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/settings");
  return data as Person;
}

export async function updatePerson(id: number, form: FormData) {
  const { supabase, user } = await getUserOrThrow();
  const input = PersonInput.parse(Object.fromEntries(form));
  const color = input.color.startsWith("#") ? input.color : `#${input.color}`;
  const { error } = await supabase
    .from("people")
    .update({
      name: input.name,
      color,
      is_shared: input.is_shared,
    })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/settings");
}

export async function deletePerson(id: number) {
  const { supabase, user } = await getUserOrThrow();
  const { error } = await supabase
    .from("people")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) throw error;
  revalidatePath("/");
  revalidatePath("/settings");
}
