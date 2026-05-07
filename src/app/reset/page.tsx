import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ResetPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?error=Reset+link+expired,+request+a+new+one");
  }
  const params = await searchParams;

  async function update(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const password = String(formData.get("password") ?? "");
    if (password.length < 8) {
      redirect(
        `/reset?error=${encodeURIComponent("Password must be at least 8 characters")}`
      );
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      redirect(`/reset?error=${encodeURIComponent(error.message)}`);
    }
    redirect("/");
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
        <h2 className="text-xl font-semibold mb-2">Set a new password</h2>
        <p className="text-sm text-gray-600 mb-4">
          You&apos;re signed in as <b>{user.email}</b>. Pick a new password
          below — you&apos;ll be taken to the dashboard once it&apos;s saved.
        </p>
        {params.error && (
          <p className="text-sm text-red-600 mb-3">{params.error}</p>
        )}
        <form action={update} className="space-y-3">
          <div>
            <label className="text-sm font-medium">New password</label>
            <input
              name="password"
              type="password"
              required
              minLength={8}
              autoFocus
              className="w-full border rounded-lg px-3 py-2 mt-1"
            />
            <p className="text-xs text-gray-500 mt-1">At least 8 characters.</p>
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600"
          >
            Save new password
          </button>
        </form>
        <p className="text-sm text-gray-600 mt-4 text-center">
          <Link href="/" className="text-emerald-600 font-medium">
            Back to dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
