import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Reject anything that could redirect off-origin after login. Only accept
// same-origin paths (a single leading "/", not "//" or "/\") — falls back
// to "/" if the caller passed anything else. Without this, a crafted
// email-confirmation link like ?next=//attacker.com would bounce the user
// to an attacker-controlled site immediately after auth.
function safeRedirectPath(candidate: string): string {
  if (!candidate.startsWith("/")) return "/";
  if (candidate.startsWith("//") || candidate.startsWith("/\\")) return "/";
  return candidate;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safeRedirectPath(searchParams.get("next") ?? "/");

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=Could+not+verify+session`);
}
