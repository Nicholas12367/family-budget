"use client";

import { useState, useTransition } from "react";
import {
  sendAdminMessage,
  type AdminMessage,
} from "@/app/actions/messages";

const SUBJECT_LIMIT = 80;
const BODY_LIMIT = 1000;

const fmtDate = (iso: string) => new Date(iso).toLocaleString();

export default function AdminMessageForm({
  userId,
  email,
  initialMessages,
}: {
  userId: string;
  email: string;
  initialMessages: AdminMessage[];
}) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [messages, setMessages] = useState<AdminMessage[]>(initialMessages);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const bodyOK = body.trim().length > 0 && body.length <= BODY_LIMIT;
  const subjectOK = subject.length <= SUBJECT_LIMIT;
  const formOK = bodyOK && subjectOK;

  function send() {
    if (!formOK) return;
    setError(null);
    setToast(null);
    startTransition(async () => {
      try {
        const r = await sendAdminMessage({ userId, subject, body, url });
        // Optimistically prepend to the history list.
        const optimistic: AdminMessage = {
          id: r.message_id ?? Math.max(0, ...messages.map((m) => m.id)) + 1,
          user_id: userId,
          sender_email: "you",
          subject: subject.trim() || null,
          body: body.trim(),
          url: url.trim() || "/inbox",
          read_at: null,
          created_at: new Date().toISOString(),
        };
        setMessages([optimistic, ...messages]);
        setToast(
          r.delivered_devices > 0
            ? `Message sent and pushed to ${r.delivered_devices} device${
                r.delivered_devices === 1 ? "" : "s"
              }.`
            : "Message saved to their inbox. (No push devices subscribed — they'll see it in the app.)"
        );
        setSubject("");
        setBody("");
        setUrl("");
        setTimeout(() => setToast(null), 6000);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm ring-1 ring-emerald-200 p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-lg">💬 Message this user</h2>
        <p className="text-xs text-gray-500">
          Sends <strong>{email || "this user"}</strong> a direct message. It
          lands in their in-app inbox and pings their phone if they have
          notifications on.
        </p>
      </div>

      {/* Subject */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Subject (optional)
          </label>
          <span
            className={`text-[11px] tabular-nums ${
              subject.length > SUBJECT_LIMIT ? "text-rose-600" : "text-gray-400"
            }`}
          >
            {subject.length} / {SUBJECT_LIMIT}
          </span>
        </div>
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={SUBJECT_LIMIT + 20}
          placeholder="e.g. About that scan issue you hit"
          className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
        />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Message
          </label>
          <span
            className={`text-[11px] tabular-nums ${
              body.length > BODY_LIMIT ? "text-rose-600" : "text-gray-400"
            }`}
          >
            {body.length} / {BODY_LIMIT}
          </span>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={BODY_LIMIT + 100}
          rows={4}
          placeholder="Hi! I saw the issue you reported and it's fixed now — let me know if anything else comes up."
          className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm resize-y"
        />
      </div>

      {/* Optional link */}
      <div>
        <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Open URL when tapped (optional)
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="/inbox"
          className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm font-mono"
        />
        <p className="text-[11px] text-gray-500 mt-1">
          Defaults to their <code className="font-mono">/inbox</code> so they
          can read the full message.
        </p>
      </div>

      {/* Preview */}
      <div>
        <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-1.5">
          Preview
        </p>
        <div className="bg-gray-900 text-white rounded-2xl p-3 shadow-lg">
          <div className="flex items-start gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold">$</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-semibold text-sm truncate">
                  {subject.trim() || "New message from Budget App"}
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">now</span>
              </div>
              <p className="text-sm text-gray-200 mt-0.5 whitespace-pre-wrap break-words">
                {body.trim() || "Your message will appear here."}
              </p>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-rose-50 ring-1 ring-rose-200 text-rose-800 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}
      {toast && (
        <div className="bg-emerald-50 ring-1 ring-emerald-200 text-emerald-900 rounded-lg p-3 text-sm">
          {toast}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={send}
          disabled={!formOK || pending}
          className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
        >
          {pending ? "Sending…" : "Send message"}
        </button>
      </div>

      {/* History */}
      <div className="pt-2 border-t border-gray-100 space-y-2">
        <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
          Sent history
        </h3>
        {messages.length === 0 ? (
          <p className="text-sm text-gray-500">No messages sent yet.</p>
        ) : (
          <ul className="space-y-2">
            {messages.map((m) => (
              <li
                key={m.id}
                className="rounded-xl ring-1 ring-gray-100 p-3 space-y-1"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-gray-900 truncate">
                    {m.subject || "(no subject)"}
                  </span>
                  <span
                    className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${
                      m.read_at
                        ? "bg-emerald-100 text-emerald-800 ring-emerald-200"
                        : "bg-amber-100 text-amber-900 ring-amber-300"
                    }`}
                  >
                    {m.read_at ? "Read" : "Unread"}
                  </span>
                </div>
                <p className="text-sm text-gray-700 whitespace-pre-wrap break-words">
                  {m.body}
                </p>
                <p className="text-[11px] text-gray-400 tabular-nums">
                  {fmtDate(m.created_at)}
                  {m.read_at ? ` · read ${fmtDate(m.read_at)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
