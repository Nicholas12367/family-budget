"use client";

import { useState } from "react";
import Link from "next/link";
import { markMessageRead, type AdminMessage } from "@/app/actions/messages";

// A dismissible banner at the top of the dashboard that surfaces unread
// broadcast updates for EVERYONE — including users who never turned on
// notifications. Tapping opens the full update in the inbox; the × marks it
// read (which also clears the bell badge). Shows the most recent update, with
// a count if there are several.
export default function UpdateBanner({
  updates,
}: {
  updates: AdminMessage[];
}) {
  const [items, setItems] = useState<AdminMessage[]>(updates);
  const [open, setOpen] = useState(false);

  if (items.length === 0) return null;
  const latest = items[0];
  const extra = items.length - 1;

  function dismiss() {
    const ids = items.map((i) => i.id);
    setItems([]);
    for (const id of ids) void markMessageRead(id).catch(() => {});
  }

  return (
    <div className="mb-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-sm ring-1 ring-emerald-600/20">
      <div className="flex items-start gap-3 p-3.5">
        <span className="text-xl leading-none mt-0.5">📣</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex-1 min-w-0 text-left"
        >
          <p className="text-sm font-bold truncate">
            {latest.subject || "What's new"}
            {extra > 0 && (
              <span className="font-semibold opacity-90">
                {" "}
                +{extra} more
              </span>
            )}
          </p>
          <p
            className={`text-xs text-white/90 mt-0.5 ${
              open ? "whitespace-pre-wrap" : "truncate"
            }`}
          >
            {latest.body}
          </p>
          {!open && (
            <span className="text-[11px] font-semibold underline underline-offset-2 opacity-95">
              Read more
            </span>
          )}
        </button>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss update"
            className="w-7 h-7 -mt-1 -mr-1 rounded-full hover:bg-white/20 flex items-center justify-center text-lg leading-none"
          >
            ×
          </button>
          <Link
            href="/inbox"
            className="text-[11px] font-semibold bg-white/20 hover:bg-white/30 rounded-full px-2.5 py-1"
          >
            Inbox
          </Link>
        </div>
      </div>
    </div>
  );
}
