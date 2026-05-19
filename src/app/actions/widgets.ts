"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getUserOrThrow } from "./auth";
import { WIDGET_IDS, type WidgetLayout } from "@/lib/widgets";

const LayoutInput = z.object({
  order: z.array(z.enum(WIDGET_IDS)),
  hidden: z.array(z.enum(WIDGET_IDS)),
});

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Service role missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function saveWidgetLayout(input: WidgetLayout) {
  const { user } = await getUserOrThrow();
  const parsed = LayoutInput.parse(input);
  const svc = serviceClient();
  const { error } = await svc
    .from("profiles")
    .upsert(
      { id: user.id, home_widgets: parsed },
      { onConflict: "id" }
    );
  if (error) throw new Error(error.message);
  revalidatePath("/");
  revalidatePath("/settings");
  return { ok: true };
}
