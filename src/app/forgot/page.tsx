import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export default function ForgotPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; sent?: string }>;
}) {
  return <ForgotForm sp={searchParams} />;
}

async function ForgotForm({
  sp,
}: {
  sp: Promise<{ error?: string; sent?: string }>;
}) {
  const params = await sp;

  async function send(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const h = await headers();
    const origin = h.get("origin") ?? "https://budget.reachscreens.ca";
    const email = String(formData.get("email") ?? "").trim();
    if (!email) {
      redirect(`/forgot?error=${encodeURIComponent("Email is required")}`);
    }
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset`,
    });
    if (error) {
      redirect(`/forgot?error=${encodeURIComponent(error.message)}`);
    }
    redirect("/forgot?sent=1");
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm p-6">
        <div className="flex items-center gap-2 mb-6">
          <div className="w-9 h-9 rounded-xl bg-emerald-500 flex items-center justify-center text-white font-bold">
            $
          </div>
          <h1 className="font-bold text-lg">Budget App</h1>
        </div>
        <h2 className="text-xl font-semibold mb-2">Reset your password</h2>
        <p className="text-sm text-gray-600 mb-4">
          Enter your account email. We&apos;ll send you a one-time link that
          lets you set a new password.
        </p>
        {params.error && (
          <p className="text-sm text-red-600 mb-3">{params.error}</p>
        )}
        {params.sent && (
          <p className="text-sm text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-lg p-3 mb-3">
            Email sent. Check your inbox (and spam folder) for a link from
            Supabase. Click it to set a new password.
          </p>
        )}
        {!params.sent && (
          <form action={send} className="space-y-3">
            <div>
              <label className="text-sm font-medium">Email</label>
              <input
                name="email"
                type="email"
                required
                className="w-full border rounded-lg px-3 py-2 mt-1"
              />
            </div>
            <button
              type="submit"
              className="w-full px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600"
            >
              Send reset link
            </button>
          </form>
        )}
        <p className="text-sm text-gray-600 mt-4 text-center">
          Remembered it?{" "}
          <Link href="/login" className="text-emerald-600 font-medium">
            Log in
          </Link>
        </p>
      </div>
    </div>
  );
}
