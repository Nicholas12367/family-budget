"use server";
import { revalidatePath } from "next/cache";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getUserOrThrow } from "./auth";
import { isAdminEmail } from "@/lib/stripe";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin creds missing");
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

async function assertAdmin() {
  const { user } = await getUserOrThrow();
  if (!isAdminEmail(user.email)) {
    throw new Error("Forbidden");
  }
  return user;
}

async function writeAudit(input: {
  actor_email: string;
  target_user_id: string | null;
  target_email: string | null;
  action: string;
  details: Record<string, unknown>;
}) {
  const supa = serviceClient();
  const { error } = await supa.from("admin_audit_log").insert(input);
  if (error) {
    // We log to server but don't fail the action — the action itself is
    // more important than the audit row. Caller already gated by admin.
    console.error("[admin-audit] insert failed:", error);
  }
}

async function targetEmailFor(userId: string): Promise<string | null> {
  const supa = serviceClient();
  const { data } = await supa.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

// Every user id, paginated. Used to drop a broadcast into everyone's in-app
// inbox so it's visible even without notifications.
async function listAllUserIds(): Promise<string[]> {
  const supa = serviceClient();
  const ids: string[] = [];
  let page = 1;
  while (page < 100) {
    const { data, error } = await supa.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) break;
    const users = data?.users ?? [];
    if (!users.length) break;
    for (const u of users) ids.push(u.id);
    if (users.length < 1000) break;
    page++;
  }
  return ids;
}

// Bans the user for ~100 years. Reversible via adminUnsuspendUser.
export async function adminSuspendUser(userId: string, reason: string) {
  const actor = await assertAdmin();
  const targetEmail = await targetEmailFor(userId);

  await writeAudit({
    actor_email: actor.email ?? "",
    target_user_id: userId,
    target_email: targetEmail,
    action: "suspend",
    details: { reason: reason || null },
  });

  const supa = serviceClient();
  // Cast: ban_duration is supported by the Supabase Auth admin API but
  // sometimes missing from the supabase-js TS types depending on version.
  const { error } = await supa.auth.admin.updateUserById(
    userId,
    { ban_duration: "876000h" } as unknown as Parameters<
      typeof supa.auth.admin.updateUserById
    >[1]
  );
  if (error) throw new Error(`Suspend failed: ${error.message}`);

  revalidatePath("/nicholas-x7k2qz9j");
  revalidatePath(`/nicholas-x7k2qz9j/users/${userId}`);
  return { ok: true };
}

// Send a preview broadcast only to the admin's own devices, using the
// same payload validation as the real broadcast. Lets the owner see the
// notification render before firing it at everyone.
export async function testBroadcastToSelf(input: {
  title: string;
  body: string;
  url?: string;
}) {
  const actor = await assertAdmin();
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (!title || !body) throw new Error("Title and body are required.");
  if (title.length > 80) throw new Error("Title must be 80 characters or fewer.");
  if (body.length > 200) throw new Error("Body must be 200 characters or fewer.");
  const url = (input.url ?? "").trim() || "/";

  const { notifyUserById } = await import("@/lib/admin-notify");
  return notifyUserById(actor.id, {
    title,
    body,
    url,
    tag: `broadcast-test-${Date.now()}`,
  });
}

// Broadcast a push notification to every user with subscribed devices.
// Used for product updates ("These updates have been applied — check
// them out"). Logged to admin_audit_log so we have a record of every
// broadcast that's gone out.
export async function broadcastNotification(input: {
  title: string;
  body: string;
  url?: string;
}) {
  const actor = await assertAdmin();
  const title = input.title?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (!title || !body) {
    throw new Error("Title and body are required.");
  }
  if (title.length > 80) {
    throw new Error("Title must be 80 characters or fewer.");
  }
  if (body.length > 200) {
    throw new Error("Body must be 200 characters or fewer.");
  }
  const url = (input.url ?? "").trim() || "/";

  // Audit row first, then send. If sending partially fails we still have
  // a record that the broadcast was attempted.
  await writeAudit({
    actor_email: actor.email ?? "",
    target_user_id: null,
    target_email: null,
    action: "broadcast",
    details: { title, body, url },
  });

  // Persist the broadcast into every user's in-app inbox so it's visible even
  // to people without notifications — powers the dashboard update banner and
  // the bell badge. Best-effort: a failure here must not block the push.
  let inApp = 0;
  try {
    const svc = serviceClient();
    const ids = await listAllUserIds();
    if (ids.length) {
      const rows = ids.map((uid) => ({
        user_id: uid,
        sender_email: actor.email ?? null,
        subject: title,
        body,
        url,
        kind: "broadcast",
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await svc
          .from("admin_messages")
          .insert(rows.slice(i, i + 500));
        if (error) throw new Error(error.message);
      }
      inApp = rows.length;
    }
  } catch (e) {
    console.error("[broadcastNotification] in-app persist failed:", e);
  }

  const { broadcastToAllUsers } = await import("@/lib/admin-notify");
  const result = await broadcastToAllUsers({
    title,
    body,
    url,
    tag: `broadcast-${Date.now()}`,
  });

  return { ...result, in_app: inApp };
}

// Hard-delete an inactive account. Gated to non-active states only —
// active subscribers must be canceled in Stripe first. Confirmation
// requires the admin to type the target email exactly (passed in as
// `typedEmail`). Cascade removes the user's Supabase data; the Stripe
// customer record is kept so historical revenue stays intact.
export async function adminDeleteUser(
  userId: string,
  typedEmail: string
) {
  const actor = await assertAdmin();
  const targetEmail = await targetEmailFor(userId);

  if (!targetEmail) {
    throw new Error("User not found.");
  }
  if (typedEmail.trim().toLowerCase() !== targetEmail.toLowerCase()) {
    throw new Error(
      "Email confirmation didn't match. Type the target user's email exactly."
    );
  }

  // Safety check: fetch live status, refuse to delete active/trialing.
  const supa = serviceClient();
  const { data: existing } = await supa.auth.admin.getUserById(userId);
  const meta = existing?.user?.user_metadata as
    | { subscription?: { status?: string; is_grandfathered?: boolean } }
    | undefined;
  const status = meta?.subscription?.status;
  if (status === "active" || status === "trialing" || status === "past_due") {
    throw new Error(
      `Refusing to delete: this account has status '${status}'. Cancel the Stripe subscription first.`
    );
  }
  if (meta?.subscription?.is_grandfathered) {
    throw new Error(
      "Refusing to delete: this account is grandfathered. Un-grandfather first."
    );
  }

  await writeAudit({
    actor_email: actor.email ?? "",
    target_user_id: userId,
    target_email: targetEmail,
    action: "delete_user",
    details: { status, typed_email: typedEmail },
  });

  const { error } = await supa.auth.admin.deleteUser(userId);
  if (error) throw new Error(`Delete failed: ${error.message}`);

  revalidatePath("/nicholas-x7k2qz9j");
  return { ok: true };
}

// Lifts the ban so the user can log in again.
export async function adminUnsuspendUser(userId: string, reason: string) {
  const actor = await assertAdmin();
  const targetEmail = await targetEmailFor(userId);

  await writeAudit({
    actor_email: actor.email ?? "",
    target_user_id: userId,
    target_email: targetEmail,
    action: "unsuspend",
    details: { reason: reason || null },
  });

  const supa = serviceClient();
  const { error } = await supa.auth.admin.updateUserById(
    userId,
    { ban_duration: "none" } as unknown as Parameters<
      typeof supa.auth.admin.updateUserById
    >[1]
  );
  if (error) throw new Error(`Unsuspend failed: ${error.message}`);

  revalidatePath("/nicholas-x7k2qz9j");
  revalidatePath(`/nicholas-x7k2qz9j/users/${userId}`);
  return { ok: true };
}
