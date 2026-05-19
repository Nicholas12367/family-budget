import "server-only";
import Stripe from "stripe";

let _client: Stripe | null = null;

export function stripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY missing");
  // Pin to the API version we set up the webhook against. The SDK
  // accepts any version string at runtime; cast through unknown so the
  // wider TS literal-union check doesn't reject the older version.
  const opts = {
    apiVersion: "2024-12-18.acacia",
    typescript: true,
  } as unknown as ConstructorParameters<typeof Stripe>[1];
  _client = new Stripe(key, opts);
  return _client;
}

export const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID ?? "";
export const STRIPE_PAYMENT_LINK_URL = process.env.STRIPE_PAYMENT_LINK_URL ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

// Active subscription statuses that should grant app access.
export const ACTIVE_STATUSES = new Set<string>(["active", "trialing"]);

// Grandfathered emails — these accounts skip billing entirely.
// All three are the owner's personal accounts so any of them logs in free.
export const GRANDFATHERED_EMAILS = new Set<string>([
  "nicholas_connelly@icloud.com",
  "info@reachscreens.ca",
  "nconnelly272@gmail.com",
]);

// Owner email — full admin access (the owner-only dashboard).
// Locked to the iCloud account on purpose. Sign in as nicholas_connelly@icloud.com
// to see the dashboard; any other email (even the grandfathered ones) gets a 404.
export const ADMIN_EMAILS = new Set<string>([
  "nicholas_connelly@icloud.com",
]);

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && ADMIN_EMAILS.has(email.toLowerCase());
}
