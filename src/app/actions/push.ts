"use server";
import { z } from "zod";
import { getUserOrThrow } from "./auth";
import { sendToUser } from "@/lib/push";

const SubInput = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
});

export async function subscribeToPush(input: z.input<typeof SubInput>) {
  const { supabase, user } = await getUserOrThrow();
  const sub = SubInput.parse(input);
  const { error } = await supabase.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
    { onConflict: "user_id,endpoint" }
  );
  if (error) throw error;
  return { ok: true };
}

export async function unsubscribeFromPush(endpoint: string) {
  const { supabase, user } = await getUserOrThrow();
  await supabase
    .from("push_subscriptions")
    .delete()
    .eq("user_id", user.id)
    .eq("endpoint", endpoint);
  return { ok: true };
}

export async function sendTestPush() {
  const { user } = await getUserOrThrow();
  return sendToUser(user.id, {
    title: "Budget App",
    body: "Notifications are working — you'll get alerts on big purchases and budget limits.",
    url: "/",
  });
}
