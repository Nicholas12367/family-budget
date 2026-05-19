import "server-only";
import webpush from "web-push";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { ADMIN_EMAILS } from "./stripe";

// Notify the owner via web push. Used from contexts that have NO user
// session (Stripe webhooks, signup completion, feedback submissions).
// Service role only — bypasses RLS to read push_subscriptions for the owner.

let configured = false;
function configurePush() {
  if (configured) return;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:admin@example.com";
  if (!pub || !priv) {
    throw new Error("VAPID keys missing — push notifications disabled");
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

// Resolves owner user IDs — the union of every email in ADMIN_EMAILS that
// currently has a Supabase auth.users row. Cached per process for the
// lifetime of the function (small set, rarely changes).
let cachedOwnerIds: string[] | null = null;
async function resolveOwnerUserIds(): Promise<string[]> {
  if (cachedOwnerIds) return cachedOwnerIds;
  const client = serviceClient();
  if (!client) return [];
  const ids: string[] = [];
  let page = 1;
  while (page < 50) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 1000,
    });
    if (error) break;
    const users = data?.users ?? [];
    if (!users.length) break;
    for (const u of users) {
      const email = (u.email ?? "").toLowerCase();
      if (email && ADMIN_EMAILS.has(email)) ids.push(u.id);
    }
    if (users.length < 1000) break;
    page++;
  }
  cachedOwnerIds = ids;
  return ids;
}

export type OwnerNotification = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

// Broadcast a push notification to every user with at least one
// subscription. Used by the admin broadcast page. Returns counts so the
// UI can show "Sent to X devices across Y users."
export async function broadcastToAllUsers(
  payload: OwnerNotification
): Promise<{ sent: number; removed: number; users_reached: number }> {
  try {
    configurePush();
    const client = serviceClient();
    if (!client) return { sent: 0, removed: 0, users_reached: 0 };

    const { data: subs, error } = await client
      .from("push_subscriptions")
      .select("id, user_id, endpoint, p256dh, auth");
    if (error || !subs?.length) {
      return { sent: 0, removed: 0, users_reached: 0 };
    }

    const usersWithSends = new Set<string>();
    let sent = 0;
    const dead: number[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            JSON.stringify(payload)
          );
          sent++;
          if (s.user_id) usersWithSends.add(s.user_id);
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
        }
      })
    );

    if (dead.length) {
      await client.from("push_subscriptions").delete().in("id", dead);
    }

    return {
      sent,
      removed: dead.length,
      users_reached: usersWithSends.size,
    };
  } catch (e) {
    console.error("[broadcastToAllUsers] failed:", e);
    return { sent: 0, removed: 0, users_reached: 0 };
  }
}

// Sends a push notification to a specific user by id, using service-role
// (so it works from admin contexts where the actor isn't the recipient).
// Used to notify a bug reporter when their feedback gets resolved.
export async function notifyUserById(
  userId: string,
  payload: OwnerNotification
): Promise<{ sent: number; removed: number }> {
  try {
    configurePush();
    const client = serviceClient();
    if (!client) return { sent: 0, removed: 0 };
    const { data: subs, error } = await client
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", userId);
    if (error || !subs?.length) return { sent: 0, removed: 0 };

    let sent = 0;
    const dead: number[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            JSON.stringify(payload)
          );
          sent++;
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
        }
      })
    );
    if (dead.length) {
      await client.from("push_subscriptions").delete().in("id", dead);
    }
    return { sent, removed: dead.length };
  } catch (e) {
    console.error("[notifyUserById] failed:", e);
    return { sent: 0, removed: 0 };
  }
}

// Sends a push notification to every owner device. Failures are swallowed
// (caller should not let a notification failure break a webhook handler).
export async function notifyOwner(payload: OwnerNotification): Promise<{
  sent: number;
  removed: number;
}> {
  try {
    configurePush();
    const client = serviceClient();
    if (!client) return { sent: 0, removed: 0 };

    const ownerIds = await resolveOwnerUserIds();
    if (!ownerIds.length) return { sent: 0, removed: 0 };

    const { data: subs, error } = await client
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .in("user_id", ownerIds);
    if (error || !subs?.length) return { sent: 0, removed: 0 };

    let sent = 0;
    const dead: number[] = [];
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: s.endpoint,
              keys: { p256dh: s.p256dh, auth: s.auth },
            },
            JSON.stringify(payload)
          );
          sent++;
        } catch (err: unknown) {
          const status = (err as { statusCode?: number })?.statusCode;
          if (status === 404 || status === 410) dead.push(s.id);
        }
      })
    );

    if (dead.length) {
      await client.from("push_subscriptions").delete().in("id", dead);
    }
    return { sent, removed: dead.length };
  } catch (e) {
    console.error("[notifyOwner] failed:", e);
    return { sent: 0, removed: 0 };
  }
}
