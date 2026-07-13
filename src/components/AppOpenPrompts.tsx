"use client";

import { useEffect, useState } from "react";
import {
  enablePush,
  getPushState,
  type PushState,
} from "@/lib/push-client";
import { markAllMessagesRead, type AdminMessage } from "@/app/actions/messages";

// Shown right after the app opens (a fresh session). Two things, in order:
//   1. If there are unread messages from the team, force them into view so the
//      user can't miss an update. Dismissing marks them read.
//   2. If notifications aren't on yet, prompt to turn them on (or, on an
//      un-installed iPhone, prompt to add the app to the Home Screen first).
//
// A short snooze keeps the notification prompt from nagging every single open.

const SNOOZE_KEY = "notif-prompt-snooze-until";
const SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString();

export default function AppOpenPrompts({
  unreadMessages,
}: {
  unreadMessages: AdminMessage[];
}) {
  const [showMessages, setShowMessages] = useState(unreadMessages.length > 0);
  const [showNotif, setShowNotif] = useState(false);
  const [pushState, setPushState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // Once the messages modal is out of the way, decide whether to prompt for
  // notifications.
  useEffect(() => {
    if (showMessages) return;
    let cancelled = false;
    (async () => {
      try {
        const until = Number(localStorage.getItem(SNOOZE_KEY) || "0");
        if (Date.now() < until) return;
      } catch {
        /* ignore storage errors */
      }
      const st = await getPushState();
      if (cancelled) return;
      setPushState(st);
      // Only prompt when there's something the user can act on.
      if (st === "off" || st === "needs-install-ios") setShowNotif(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [showMessages]);

  function dismissMessages() {
    setShowMessages(false);
    void markAllMessagesRead().catch(() => {});
  }

  function snoozeNotif() {
    try {
      localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      /* ignore */
    }
    setShowNotif(false);
  }

  async function onEnable() {
    setBusy(true);
    setNote(null);
    const r = await enablePush();
    setBusy(false);
    setPushState(r.state);
    if (r.ok) {
      setNote("✅ Notifications on!");
      setTimeout(() => setShowNotif(false), 900);
    } else if (r.state === "denied") {
      setNote(
        "Notifications are blocked. Turn them on in your browser/site settings, then reopen."
      );
    } else if (r.state === "needs-install-ios") {
      setNote(null); // the modal already shows the iOS install steps
    } else {
      setNote(r.message || "Couldn't enable notifications — try again.");
    }
  }

  // ---- Messages modal (highest priority) ----
  if (showMessages) {
    return (
      <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div
          className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-5 space-y-3 max-h-[85vh] overflow-y-auto"
          style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}
        >
          <div className="text-center space-y-1">
            <div className="text-4xl">📣</div>
            <h2 className="text-xl font-extrabold">
              {unreadMessages.length > 1 ? "Latest updates" : "A quick update"}
            </h2>
            <p className="text-xs text-gray-500">From the Budget App team</p>
          </div>
          <ul className="space-y-2">
            {unreadMessages.map((m) => (
              <li
                key={m.id}
                className="rounded-xl bg-emerald-50 ring-1 ring-emerald-100 p-3"
              >
                <p className="font-semibold text-gray-900">
                  {m.subject || "Update"}
                </p>
                <p className="text-sm text-gray-700 mt-0.5 whitespace-pre-wrap break-words">
                  {m.body}
                </p>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {fmtDate(m.created_at)}
                </p>
              </li>
            ))}
          </ul>
          <button
            onClick={dismissMessages}
            className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
          >
            Got it
          </button>
          <p className="text-center text-[11px] text-gray-400">
            You can reread this anytime from the 🔔 bell.
          </p>
        </div>
      </div>
    );
  }

  // ---- Notification prompt ----
  if (showNotif) {
    const iosInstall = pushState === "needs-install-ios";
    return (
      <div className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4">
        <div
          className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-2xl p-6 space-y-4"
          style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
        >
          <div className="text-center space-y-1">
            <div className="text-5xl">🔔</div>
            <h2 className="text-2xl font-extrabold">
              {iosInstall ? "Add to your Home Screen" : "Turn on notifications"}
            </h2>
            <p className="text-sm text-gray-600">
              {iosInstall
                ? "iPhones only allow notifications once the app is on your Home Screen. It takes 10 seconds:"
                : "Get a heads-up on budget limits, big purchases, and updates from us — even when the app is closed."}
            </p>
          </div>

          {iosInstall ? (
            <ol className="space-y-2.5 text-sm">
              <li className="flex gap-3 items-start">
                <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">
                  1
                </span>
                <span>
                  Tap the <strong>Share</strong> icon (square with an up arrow)
                  in Safari's toolbar.
                </span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">
                  2
                </span>
                <span>
                  Choose <strong>Add to Home Screen</strong>, then{" "}
                  <strong>Add</strong>.
                </span>
              </li>
              <li className="flex gap-3 items-start">
                <span className="shrink-0 w-6 h-6 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center">
                  3
                </span>
                <span>
                  Open the app from its new icon — you'll be asked to allow
                  notifications.
                </span>
              </li>
            </ol>
          ) : (
            <button
              onClick={onEnable}
              disabled={busy}
              className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
            >
              {busy ? "Enabling…" : "Allow notifications"}
            </button>
          )}

          {note && <p className="text-center text-xs text-gray-600">{note}</p>}

          <button
            onClick={snoozeNotif}
            className="w-full text-sm text-gray-500 hover:text-gray-700"
          >
            {iosInstall ? "Maybe later" : "Not now"}
          </button>
        </div>
      </div>
    );
  }

  return null;
}
