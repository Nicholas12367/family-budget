"use client";

import { useState, useTransition } from "react";
import { resolveFeedback } from "@/app/actions/feedback";

export default function FeedbackResolveButtons({
  id,
  status,
}: {
  id: number;
  status: string;
}) {
  const [pending, startTransition] = useTransition();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);

  function go(next: "in_progress" | "resolved" | "wont_fix" | "open") {
    startTransition(async () => {
      try {
        await resolveFeedback({
          id,
          status: next,
          note: note.trim() || undefined,
        });
        window.location.reload();
      } catch (e) {
        alert((e as Error).message);
      }
    });
  }

  return (
    <div className="flex flex-wrap gap-2 pt-1">
      {showNote && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Resolution note (optional)"
          className="flex-1 min-w-[200px] px-2 py-1 rounded ring-1 ring-gray-200 text-xs"
        />
      )}
      {status !== "in_progress" && status !== "resolved" && (
        <button
          onClick={() => go("in_progress")}
          disabled={pending}
          className="px-2 py-1 rounded text-xs bg-sky-100 text-sky-800 hover:bg-sky-200 disabled:opacity-50"
        >
          Mark in progress
        </button>
      )}
      {status !== "resolved" && (
        <button
          onClick={() => {
            if (!showNote) {
              setShowNote(true);
              return;
            }
            go("resolved");
          }}
          disabled={pending}
          className="px-2 py-1 rounded text-xs bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {showNote ? "Confirm resolved" : "Resolve"}
        </button>
      )}
      {status !== "wont_fix" && status !== "resolved" && (
        <button
          onClick={() => go("wont_fix")}
          disabled={pending}
          className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          Won't fix
        </button>
      )}
      {(status === "resolved" || status === "wont_fix") && (
        <button
          onClick={() => go("open")}
          disabled={pending}
          className="px-2 py-1 rounded text-xs bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        >
          Reopen
        </button>
      )}
    </div>
  );
}
