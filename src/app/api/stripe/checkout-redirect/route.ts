import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { STRIPE_PAYMENT_LINK_URL } from "@/lib/stripe";
import { isAllowed } from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sends a freshly-signed-up user (or a returning unsubscribed user) to
// the Stripe Payment Link with their Supabase user_id and email so the
// resulting Stripe customer is linked back to their account on the
// webhook side.
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BUDGET_APP_URL ?? "https://budget.reachscreens.ca"}/login`
    );
  }

  // Already paying or grandfathered? Skip checkout, go home.
  if (isAllowed(user)) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BUDGET_APP_URL ?? "https://budget.reachscreens.ca"}/`
    );
  }

  if (!STRIPE_PAYMENT_LINK_URL) {
    return NextResponse.json(
      { error: "STRIPE_PAYMENT_LINK_URL missing" },
      { status: 500 }
    );
  }

  const url = new URL(STRIPE_PAYMENT_LINK_URL);
  url.searchParams.set("client_reference_id", user.id);
  if (user.email) url.searchParams.set("prefilled_email", user.email);
  return NextResponse.redirect(url.toString());
}
