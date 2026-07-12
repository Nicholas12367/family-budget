"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getUserOrThrow } from "./auth";
import { isAdminEmail } from "@/lib/stripe";

export type AdminMessage = {
  id: number;
  user_id: string;
  sender_email: string | null;
  subject: string | null;
  body: string;
  url: string | null;
  read_at: string | null;
  created_at: string;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin creds missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

async function assertAdmin() {
  const { user } = await getUserOrThrow();
  if (!isAdminEmail(user.email)) throw new Error("Forbidden");
  return user;
}

// Best-effort audit row. Mirrors the pattern in actions/admin.ts; never
// throws (the message itself matters more than the audit trail).
async function writeAudit(input: {
  actor_email: string;
  target_user_id: string | null;
  target_email: string | null;
  action: string;
  details: Record<string, unknown>;
}) {
  try {
    const { error } = await serviceClient()
      .from("admin_audit_log")
      .insert(input);
    if (error) console.error("[messages-audit] insert failed:", error);
  } catch (e) {
    console.error("[messages-audit] threw:", e);
  }
}

const SendInput = z.object({
  userId: z.string().uuid(),
  subject: z.string().max(80).optional().default(""),
  body: z.string().min(1).max(1000),
  url: z.string().max(300).optional().default(""),
});

// Admin → single user. Persists the message (in-app inbox) and fires a web
// push to every device that user has subscribed. Safe to call even if the
// user has no push subscription — the inbox row is still written.
export async function sendAdminMessage(input: z.input<typeof SendInput>) {
  const actor = await assertAdmin();
  const parsed = SendInput.parse(input);
  const subject = parsed.subject.trim();
  const body = parsed.body.trim();
  if (!body) throw new Error("Message body is required.");

  const svc = serviceClient();

  // Resolve the recipient's email for the audit trail / return value.
  const { data: target } = await svc.auth.admin.getUserById(parsed.userId);
  const targetEmail = target?.user?.email ?? null;
  if (!targetEmail && !target?.user) {
    throw new Error("Recipient not found.");
  }

  // Tapping the push should land the user on their inbox unless the admin
  // pointed it somewhere specific.
  const url = parsed.url.trim() || "/inbox";

  const { data: inserted, error } = await svc
    .from("admin_messages")
    .insert({
      user_id: parsed.userId,
      sender_email: actor.email ?? null,
      subject: subject || null,
      body,
      url,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not save message: ${error.message}`);

  await writeAudit({
    actor_email: actor.email ?? "",
    target_user_id: parsed.userId,
    target_email: targetEmail,
    action: "direct_message",
    details: {
      message_id: inserted?.id ?? null,
      subject: subject || null,
      body_preview: body.slice(0, 120),
    },
  });

  // Deliver the push. Failure here must not undo the saved message — the
  // user will still see it in their inbox next time they open the app.
  let push = { sent: 0, removed: 0 };
  try {
    const { notifyUserById } = await import("@/lib/admin-notify");
    push = await notifyUserById(parsed.userId, {
      title: subject || "New message from Budget App",
      body,
      url,
      tag: `admin-msg-${inserted?.id ?? Date.now()}`,
    });
  } catch (e) {
    console.error("[sendAdminMessage] push failed:", e);
  }

  revalidatePath(`/nicholas-x7k2qz9j/users/${parsed.userId}`);
  return {
    ok: true,
    message_id: inserted?.id ?? null,
    delivered_devices: push.sent,
    recipient_email: targetEmail,
  };
}

// Admin: full message history sent to one user (for the admin UI).
export async function listMessagesForUser(
  userId: string
): Promise<AdminMessage[]> {
  await assertAdmin();
  const { data, error } = await serviceClient()
    .from("admin_messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as AdminMessage[];
}

// -------------------------------------------------------------------
// Client (recipient) side — RLS scopes everything to the current user.
// -------------------------------------------------------------------

export async function listMyMessages(): Promise<AdminMessage[]> {
  const { supabase, user } = await getUserOrThrow();
  const { data, error } = await supabase
    .from("admin_messages")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data ?? []) as AdminMessage[];
}

export async function getUnreadMessageCount(): Promise<number> {
  const { supabase, user } = await getUserOrThrow();
  const { count, error } = await supabase
    .from("admin_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) return 0;
  return count ?? 0;
}

export async function markMessageRead(id: number) {
  const { supabase, user } = await getUserOrThrow();
  const { error } = await supabase
    .from("admin_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/inbox");
  revalidatePath("/");
  return { ok: true };
}

export async function markAllMessagesRead() {
  const { supabase, user } = await getUserOrThrow();
  const { error } = await supabase
    .from("admin_messages")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) throw new Error(error.message);
  revalidatePath("/inbox");
  revalidatePath("/");
  return { ok: true };
}
