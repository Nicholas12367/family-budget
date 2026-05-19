"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminDeleteUser } from "@/app/actions/admin";

// Visible only when the account is in an inactive state (canceled, expired,
// or never-subscribed) AND not grandfathered. Type-the-email gate prevents
// accidents. Server action does its own safety check.
export default function DeleteUserButton({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  const canConfirm =
    typed.trim().toLowerCase() === email.toLowerCase() && !pending;

  function close() {
    setOpen(false);
    setTyped("");
    setErr(null);
  }

  function doDelete() {
    setErr(null);
    startTransition(async () => {
      try {
        await adminDeleteUser(userId, typed.trim());
        router.push("/nicholas-x7k2qz9j");
      } catch (e) {
        setErr((e as Error).message);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
      >
        Delete this account
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3"
            style={{
              paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">Delete account</h3>
              <button
                onClick={close}
                className="text-gray-400 hover:text-gray-600 text-xl"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="bg-rose-50 ring-1 ring-rose-200 rounded-lg p-3 text-sm text-rose-900">
              <p>
                This permanently deletes <strong>{email}</strong> from
                Supabase. All their expenses, categories, budgets, and
                receipts cascade-delete. The Stripe customer record is kept
                so your revenue history stays intact.
              </p>
              <p className="mt-2 font-semibold">
                Active subscribers can't be deleted — cancel in Stripe first.
              </p>
            </div>
            <div>
              <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                Type the email to confirm
              </label>
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={email}
                className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-rose-400 text-sm font-mono"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
            </div>
            {err && (
              <p className="text-sm text-rose-700 bg-rose-50 ring-1 ring-rose-200 rounded p-2">
                {err}
              </p>
            )}
            <div className="flex gap-2 justify-end pt-1">
              <button
                onClick={close}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doDelete}
                disabled={!canConfirm}
                className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700 disabled:opacity-50"
              >
                {pending ? "Deleting…" : "Delete forever"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
