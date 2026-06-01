import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { ACTIVE_STATUSES, GRANDFATHERED_EMAILS } from "@/lib/stripe";

const PUBLIC_PATHS = [
  "/login",
  "/signup",
  "/forgot",
  "/reset",
  "/auth/callback",
  "/auth/signout",
];

// Authenticated routes that don't require an active subscription
// (the subscription gate sends users to /billing, so /billing itself
// must always be reachable, plus the Stripe redirect/portal routes
// and the owner-only admin dashboard).
const SUBSCRIPTION_BYPASS_PATHS = [
  "/billing",
  "/nicholas-x7k2qz9j",
  "/api/stripe/webhook",
  "/api/stripe/portal",
  "/api/stripe/checkout-redirect",
];

type CookieToSet = { name: string; value: string; options?: CookieOptions };

// Explicit cookie options for the auth session. Supabase ssr defaults to
// maxAge=400d / sameSite=lax / path=/, but it does NOT set `secure`. On
// Android, when the app is installed to the home screen as a PWA (WebAPK),
// modern Chromium treats cookies without the Secure flag more aggressively
// — including evicting them when the WebAPK process is killed. iOS PWAs
// have a sandboxed cookie jar that survives, which is why iPhone users
// don't see this. Setting Secure + lax for prod keeps the refresh token
// alive across PWA cold-starts.
const AUTH_COOKIE_OPTIONS = {
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: AUTH_COOKIE_OPTIONS,
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }: CookieToSet) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }: CookieToSet) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPublic = PUBLIC_PATHS.some((p) => path === p || path.startsWith(p + "/"));
  const bypassesSubGate = SUBSCRIPTION_BYPASS_PATHS.some(
    (p) => path === p || path.startsWith(p + "/")
  );

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && (path === "/login" || path === "/signup")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Subscription gate — only run for authed users on non-bypass paths.
  if (user && !isPublic && !bypassesSubGate) {
    const email = user.email?.toLowerCase();
    if (email && GRANDFATHERED_EMAILS.has(email)) {
      // Owner / grandfathered — let through.
      return response;
    }
    const sub = (user.user_metadata as { subscription?: { status?: string; is_grandfathered?: boolean } })
      ?.subscription;
    if (sub?.is_grandfathered) return response;
    if (sub?.status && ACTIVE_STATUSES.has(sub.status)) return response;
    // No active subscription → bounce to billing.
    const url = request.nextUrl.clone();
    url.pathname = "/billing";
    return NextResponse.redirect(url);
  }

  return response;
}
