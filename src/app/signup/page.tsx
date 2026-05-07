import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  return <SignupForm sp={searchParams} />;
}

async function SignupForm({
  sp,
}: {
  sp: Promise<{ error?: string; message?: string }>;
}) {
  const params = await sp;

  async function signup(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const h = await headers();
    const origin = h.get("origin") ?? "";
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");

    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${origin}/auth/callback` },
    });

    if (error) {
      redirect(`/signup?error=${encodeURIComponent(error.message)}`);
    }

    // If a session is returned, the project has email confirmation OFF —
    // hand the new user off to Stripe Checkout for their 7-day free trial.
    if (data.session) {
      redirect("/api/stripe/checkout-redirect");
    }

    redirect(
      `/login?message=${encodeURIComponent("Check your email for a confirmation link, then log in.")}`
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-white font-bold">
            $
          </div>
          <h1 className="font-bold text-lg">Family Budget</h1>
        </div>
        <h2 className="text-xl font-semibold mb-2">Create your account</h2>
        <p className="text-sm text-gray-600 mb-1">
          7 days free, then $4/month CAD. Cancel anytime — card required for
          the trial.
        </p>
        <p className="text-xs text-gray-500 mb-4">
          Your budget is private. Nobody else who signs up can see your numbers.
        </p>
        {params.error && (
          <p className="text-sm text-red-600 mb-3">{params.error}</p>
        )}
        <form action={signup} className="space-y-3">
          <div>
            <label className="text-sm font-medium">Email</label>
            <input
              name="email"
              type="email"
              required
              className="w-full border rounded-lg px-3 py-2 mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Password</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              className="w-full border rounded-lg px-3 py-2 mt-1"
            />
            <p className="text-xs text-gray-500 mt-1">At least 8 characters.</p>
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600"
          >
            Sign up
          </button>
        </form>
        <p className="text-sm text-gray-600 mt-4 text-center">
          Already have an account?{" "}
          <Link href="/login" className="text-emerald-600 font-medium">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
