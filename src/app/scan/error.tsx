"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function ScanRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[/scan] route error boundary caught:", error);
  }, [error]);

  return (
    <div
      className="max-w-3xl mx-auto px-4 space-y-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
    >
      <h1 className="text-xl font-bold">Scan Receipt</h1>
      <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm space-y-3">
        <p className="font-semibold">
          We couldn&apos;t load the scanner just now.
        </p>
        <p>
          This is usually a quick network blip. Try again, or log the receipt
          by hand from the dashboard.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            onClick={() => reset()}
            className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-sm font-semibold hover:bg-red-700"
          >
            Try again
          </button>
          <Link
            href="/"
            className="px-3 py-1.5 rounded-lg bg-white ring-1 ring-red-200 text-red-700 text-sm font-semibold hover:bg-red-50"
          >
            Go to dashboard
          </Link>
        </div>
        {error.digest && (
          <p className="text-xs text-red-600/70 pt-1">
            Reference: {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
