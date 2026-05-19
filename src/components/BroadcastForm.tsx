"use client";

import { useState, useTransition } from "react";
import {
  broadcastNotification,
  testBroadcastToSelf,
} from "@/app/actions/admin";

const TITLE_LIMIT = 80;
const BODY_LIMIT = 200;

type Result = {
  sent: number;
  removed: number;
  users_reached: number;
};

export default function BroadcastForm() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("/");
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testToast, setTestToast] = useState<string | null>(null);

  const titleOK =
    title.trim().length > 0 && title.length <= TITLE_LIMIT;
  const bodyOK = body.trim().length > 0 && body.length <= BODY_LIMIT;
  const formOK = titleOK && bodyOK;

  function reset() {
    setTitle("");
    setBody("");
    setUrl("/");
    setResult(null);
    setError(null);
  }

  function testSend() {
    if (!formOK) return;
    setError(null);
    setTestToast(null);
    startTransition(async () => {
      try {
        const r = await testBroadcastToSelf({ title, body, url });
        setTestToast(
          r.sent > 0
            ? `Test sent to ${r.sent} of your device${r.sent === 1 ? "" : "s"}.`
            : "No subscribed devices on your account — enable notifications on your phone first."
        );
        setTimeout(() => setTestToast(null), 5000);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  function broadcast() {
    if (!formOK) return;
    setError(null);
    startTransition(async () => {
      try {
        const r = await broadcastNotification({ title, body, url });
        setResult(r);
        setConfirming(false);
      } catch (e) {
        setError((e as Error).message);
        setConfirming(false);
      }
    });
  }

  return (
    <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-5 space-y-4">
      <div>
        <h2 className="font-semibold text-lg">Compose</h2>
        <p className="text-xs text-gray-500">
          Title shows in bold, body underneath. Tapping the notification opens
          the URL you specify.
        </p>
      </div>

      {/* Title */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Title
          </label>
          <span
            className={`text-[11px] tabular-nums ${
              title.length > TITLE_LIMIT
                ? "text-rose-600"
                : "text-gray-400"
            }`}
          >
            {title.length} / {TITLE_LIMIT}
          </span>
        </div>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={TITLE_LIMIT + 20}
          placeholder="e.g. ✨ New update — receipt grouping is live"
          className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
        />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Body
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
          maxLength={BODY_LIMIT + 50}
          rows={3}
          placeholder="Receipts now show grouped under merchants in your history. Tap to try it."
          className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm resize-y"
        />
      </div>

      {/* URL */}
      <div>
        <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
          Open URL when tapped
        </label>
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="/"
          className="mt-1 w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm font-mono"
        />
        <p className="text-[11px] text-gray-500 mt-1">
          Defaults to <code className="font-mono">/</code> (the dashboard).
          Examples: <code className="font-mono">/settings/help</code>,{" "}
          <code className="font-mono">/scan</code>.
        </p>
      </div>

      {/* Live preview */}
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
                  {title.trim() || "Budget App"}
                </p>
                <span className="text-[10px] text-gray-400 shrink-0">
                  now
                </span>
              </div>
              <p className="text-sm text-gray-200 mt-0.5 whitespace-pre-wrap break-words">
                {body.trim() || "Your notification body will appear here."}
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

      {result && (
        <div className="bg-emerald-50 ring-1 ring-emerald-200 text-emerald-900 rounded-lg p-3 text-sm space-y-1">
          <p className="font-semibold">📡 Broadcast sent</p>
          <ul className="text-xs space-y-0.5">
            <li>
              Reached <strong>{result.users_reached}</strong>{" "}
              user{result.users_reached === 1 ? "" : "s"}
            </li>
            <li>
              Delivered to <strong>{result.sent}</strong> device
              {result.sent === 1 ? "" : "s"}
            </li>
            {result.removed > 0 && (
              <li>
                Cleaned up <strong>{result.removed}</strong> stale
                subscription{result.removed === 1 ? "" : "s"}
              </li>
            )}
          </ul>
          <button
            type="button"
            onClick={reset}
            className="text-xs underline mt-1"
          >
            Send another
          </button>
        </div>
      )}

      {testToast && !result && (
        <div className="bg-sky-50 ring-1 ring-sky-200 text-sky-900 rounded-lg p-3 text-sm">
          {testToast}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={testSend}
          disabled={!formOK || pending}
          className="px-4 py-2 rounded-lg bg-sky-50 text-sky-700 ring-1 ring-sky-200 text-sm font-semibold hover:bg-sky-100 disabled:opacity-50"
        >
          🧪 Test send to me first
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!formOK || pending}
          className="ml-auto px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
        >
          📡 Send to everyone
        </button>
      </div>

      {confirming && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirming(false);
          }}
        >
          <div
            className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3"
            style={{
              paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
            }}
          >
            <h3 className="font-bold text-lg">Broadcast to all users?</h3>
            <p className="text-sm text-gray-600">
              Every user with notifications enabled will get this push.
              They can't be recalled once sent.
            </p>
            <div className="bg-gray-900 text-white rounded-xl p-3 text-sm">
              <p className="font-semibold">{title.trim()}</p>
              <p className="text-gray-200 mt-0.5 text-xs whitespace-pre-wrap">
                {body.trim()}
              </p>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={broadcast}
                disabled={pending}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                {pending ? "Sending…" : "Yes, send to everyone"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
