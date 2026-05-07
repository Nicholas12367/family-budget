import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  return <LoginForm sp={searchParams} />;
}

async function LoginForm({
  sp,
}: {
  sp: Promise<{ error?: string; message?: string }>;
}) {
  const params = await sp;

  async function login(formData: FormData) {
    "use server";
    const supabase = await createClient();
    const email = String(formData.get("email") ?? "");
    const password = String(formData.get("password") ?? "");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      redirect(`/login?error=${encodeURIComponent(error.message)}`);
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
          <h1 className="font-bold text-lg">Family Budget</h1>
        </div>
        <h2 className="text-xl font-semibold mb-4">Log in</h2>
        {params.error && (
          <p className="text-sm text-red-600 mb-3">{params.error}</p>
        )}
        {params.message && (
          <p className="text-sm text-emerald-700 mb-3">{params.message}</p>
        )}
        <form action={login} className="space-y-3">
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
              className="w-full border rounded-lg px-3 py-2 mt-1"
            />
          </div>
          <button
            type="submit"
            className="w-full px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600"
          >
            Log in
          </button>
        </form>
        <p className="text-sm text-gray-600 mt-3 text-center">
          <Link href="/forgot" className="text-gray-500 hover:text-emerald-700">
            Forgot your password?
          </Link>
        </p>
        <p className="text-sm text-gray-600 mt-2 text-center">
          New here?{" "}
          <Link href="/signup" className="text-emerald-600 font-medium">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
