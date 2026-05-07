import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { readSub } from "@/lib/subscription";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const sub = readSub(user);
  if (!sub.customer_id) {
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BUDGET_APP_URL ?? "https://budget.reachscreens.ca"}/billing?error=no_subscription`
    );
  }

  try {
    const session = await stripe().billingPortal.sessions.create({
      customer: sub.customer_id,
      return_url: `${process.env.NEXT_PUBLIC_BUDGET_APP_URL ?? "https://budget.reachscreens.ca"}/`,
    });
    return NextResponse.redirect(session.url);
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message },
      { status: 500 }
    );
  }
}
