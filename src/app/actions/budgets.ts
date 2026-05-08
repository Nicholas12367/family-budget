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

type SetBudgetInput = {
  category_id: number;
  monthly_limit: number;
  rolls_over?: boolean;
  is_personal?: boolean;
  person_name?: string | null;
};

// Errors that mean "the rollover/personal columns aren't on this DB yet".
// We retry without them so the app keeps working before the migration runs.
function isMissingColumnError(err: unknown): boolean {
  const msg =
    typeof err === "object" && err && "message" in err
      ? String((err as { message: unknown }).message)
      : "";
  // Postgres error 42703 = undefined_column
  return /column .* does not exist|42703/i.test(msg);
}

export async function setBudget(input: SetBudgetInput) {
  const { supabase, user } = await getUserOrThrow();
  if (!input.monthly_limit || input.monthly_limit <= 0) {
    const { error } = await supabase
      .from("budgets")
      .delete()
      .eq("user_id", user.id)
      .eq("category_id", input.category_id);
    if (error) throw error;
    revalidatePath("/");
    return;
  }

  const now = new Date();
  const baseRow = {
    user_id: user.id,
    category_id: input.category_id,
    monthly_limit: input.monthly_limit,
    month: now.getMonth(),
    year: now.getFullYear(),
  };
  const fullRow = {
    ...baseRow,
    rolls_over: input.rolls_over ?? false,
    is_personal: input.is_personal ?? false,
    person_name: input.is_personal ? (input.person_name ?? null) : null,
  };

  const { error } = await supabase
    .from("budgets")
    .upsert(fullRow, { onConflict: "user_id,category_id" });
  if (error) {
    if (isMissingColumnError(error)) {
      // Migration hasn't been run — fall back to legacy schema.
      const { error: legacyErr } = await supabase
        .from("budgets")
        .upsert(baseRow, { onConflict: "user_id,category_id" });
      if (legacyErr) throw legacyErr;
    } else {
      throw error;
    }
  }

  revalidatePath("/");
}
