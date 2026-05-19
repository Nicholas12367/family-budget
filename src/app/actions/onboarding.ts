"use server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getUserOrThrow } from "./auth";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service role missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

// Marks the user as onboarded so the walkthrough doesn't show again.
// Called by the OnboardingFlow component when the user finishes or skips.
export async function markOnboarded() {
  const { user } = await getUserOrThrow();
  const svc = serviceClient();
  // Use upsert so the row exists even for users created before profiles was wired.
  const { error } = await svc
    .from("profiles")
    .upsert(
      { id: user.id, onboarded_at: new Date().toISOString() },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
  return { ok: true };
}

// Resets the onboarded flag so the user can replay the tour.
export async function resetOnboarded() {
  const { user } = await getUserOrThrow();
  const svc = serviceClient();
  const { error } = await svc
    .from("profiles")
    .upsert(
      { id: user.id, onboarded_at: null },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
  return { ok: true };
}

// Toggles the income widget visibility on the home screen.
export async function setIncomeWidgetVisible(visible: boolean) {
  const { user } = await getUserOrThrow();
  const svc = serviceClient();
  const { error } = await svc
    .from("profiles")
    .upsert(
      { id: user.id, show_income_widget: visible },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
  return { ok: true };
}
