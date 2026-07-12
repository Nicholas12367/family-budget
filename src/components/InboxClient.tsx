"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  markAllMessagesRead,
  type AdminMessage,
} from "@/app/actions/messages";

const fmtDate = (iso: string) => new Date(iso).toLocaleString();

export default function InboxClient({
  initialMessages,
}: {
  initialMessages: AdminMessage[];
}) {
  // Snapshot which were unread when the page opened, so the "new" highlight
  // stays visible for this view even after we mark them read.
  const [messages] = useState<AdminMessage[]>(initialMessages);
  const didMark = useRef(false);

  useEffect(() => {
    if (didMark.current) return;
    didMark.current = true;
    if (initialMessages.some((m) => !m.read_at)) {
      // Opening the inbox counts as reading — clear the badge in the
      // background. Failure is non-fatal (they stay unread, retried next open).
      void markAllMessagesRead().catch(() => {});
    }
  }, [initialMessages]);

  return (
    <div
      className="max-w-2xl mx-auto px-4 pb-16 space-y-5"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
    >
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white ring-1 ring-gray-200 text-emerald-700 text-sm font-semibold hover:bg-gray-50"
        >
          ← Home
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold tracking-tight">Messages</h1>
          <p className="text-xs text-gray-500">
            Notes and updates from the Budget App team.
          </p>
        </div>
      </div>

      {messages.length === 0 ? (
        <div className="bg-white rounded-2xl ring-1 ring-gray-100 shadow-sm p-8 text-center">
          <p className="text-4xl mb-2">📭</p>
          <p className="text-sm text-gray-500">
            No messages yet. When we reach out, it'll show up here.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {messages.map((m) => {
            const wasUnread = !m.read_at;
            const inner = (
              <div
                className={`rounded-2xl p-4 shadow-sm ring-1 transition ${
                  wasUnread
                    ? "bg-emerald-50 ring-emerald-200"
                    : "bg-white ring-gray-100"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold text-gray-900">
                    {m.subject || "Message from Budget App"}
                  </h2>
                  {wasUnread && (
                    <span className="shrink-0 mt-0.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600 text-white">
                      NEW
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-700 mt-1.5 whitespace-pre-wrap break-words">
                  {m.body}
                </p>
                <p className="text-[11px] text-gray-400 mt-2 tabular-nums">
                  {fmtDate(m.created_at)}
                </p>
              </div>
            );
            // If the message points somewhere in-app, make the whole card a
            // link there; otherwise it's just a static card.
            return (
              <li key={m.id}>
                {m.url && m.url !== "/inbox" ? (
                  <Link href={m.url} className="block">
                    {inner}
                  </Link>
                ) : (
                  inner
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
