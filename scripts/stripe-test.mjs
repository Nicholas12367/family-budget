// Quick smoke test for Stripe wiring. Exercises:
//   1. Webhook signature verification (rejects bad sig, accepts good sig)
//   2. checkout-redirect URL construction (passes user_id + email)
//   3. Live Stripe API connectivity (fetches our Payment Link)
//
// Run from project root:  node scripts/stripe-test.mjs

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, "..", ".env.local"), "utf8")
    .split("\n")
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) {
    console.log(`  PASS  ${label}`);
    pass++;
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    fail++;
  }
}

// 1. webhook signature
console.log("Webhook signature verification");
const Stripe = (await import("stripe")).default;
const stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: "2024-12-18.acacia" });
const payload = JSON.stringify({ id: "evt_test", object: "event", type: "ping" });
const ts = Math.floor(Date.now() / 1000);
const signedPayload = `${ts}.${payload}`;
const goodSig = createHmac("sha256", env.STRIPE_WEBHOOK_SECRET)
  .update(signedPayload, "utf8")
  .digest("hex");
const goodHeader = `t=${ts},v1=${goodSig}`;
try {
  stripe.webhooks.constructEvent(payload, goodHeader, env.STRIPE_WEBHOOK_SECRET);
  check("accepts a correctly-signed payload", true);
} catch (e) {
  check("accepts a correctly-signed payload", false, e.message);
}
try {
  stripe.webhooks.constructEvent(
    payload,
    `t=${ts},v1=deadbeef`,
    env.STRIPE_WEBHOOK_SECRET
  );
  check("rejects a bad signature", false, "constructEvent didn't throw");
} catch {
  check("rejects a bad signature", true);
}

// 2. checkout-redirect URL construction
console.log("\nCheckout redirect URL");
const url = new URL(env.STRIPE_PAYMENT_LINK_URL);
url.searchParams.set("client_reference_id", "user_abc_123");
url.searchParams.set("prefilled_email", "test@example.com");
const finalUrl = url.toString();
check(
  "client_reference_id is appended",
  finalUrl.includes("client_reference_id=user_abc_123")
);
check(
  "prefilled_email is appended",
  finalUrl.includes("prefilled_email=test%40example.com")
);
check(
  "buy.stripe.com hostname preserved",
  finalUrl.startsWith("https://buy.stripe.com/")
);

// 3. live Stripe API connectivity
console.log("\nLive Stripe API");
try {
  const link = await stripe.paymentLinks.retrieve("plink_1TUVeWGjioL4n5aM9TSgmdIC");
  check("Payment Link retrievable", !!link.id);
  check(
    "Payment Link has 7-day trial",
    link.subscription_data?.trial_period_days === 7
  );
  check("Payment Link allows promo codes", link.allow_promotion_codes === true);
  check(
    "Payment Link redirects after completion",
    link.after_completion?.type === "redirect"
  );
} catch (e) {
  check("Stripe API call", false, e.message);
}

try {
  const promos = await stripe.promotionCodes.list({ code: "FAMILY", limit: 1 });
  check("FAMILY promo code exists & active", !!promos.data[0]?.active);
} catch (e) {
  check("Promo code lookup", false, e.message);
}

try {
  const portal = await stripe.billingPortal.configurations.list({ limit: 5 });
  const def = portal.data.find((c) => c.is_default);
  check("Customer Portal default config exists", !!def);
  check(
    "Portal: payment method updates enabled",
    !!def?.features?.payment_method_update?.enabled
  );
  check(
    "Portal: subscription cancel enabled",
    !!def?.features?.subscription_cancel?.enabled
  );
} catch (e) {
  check("Portal config lookup", false, e.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
