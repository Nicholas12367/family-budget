"use client";

import { useState } from "react";
import { submitFeedback } from "@/app/actions/feedback";

// Button + modal for reporting bugs / sending feedback. Two visual variants:
// - "subtle" (default) — small underlined link, fits inline
// - "prominent" — full pill button for cards / hero placements
export default function BugReportButton({
  variant = "subtle",
}: {
  variant?: "subtle" | "prominent";
} = {}) {
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<null | { category: string }>(null);
  const [err, setErr] = useState<string | null>(null);

  function deviceHint() {
    if (typeof navigator === "undefined") return "";
    const ua = navigator.userAgent;
    if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
    if (/Pixel/i.test(ua)) return "Pixel";
    if (/SM-/i.test(ua) || /Samsung/i.test(ua)) return "Samsung";
    if (/iPhone/i.test(ua)) return "iPhone";
    if (/iPad/i.test(ua)) return "iPad";
    if (/Android/i.test(ua)) return "Android";
    if (/Macintosh/i.test(ua)) return "Mac";
    if (/Windows/i.test(ua)) return "Windows";
    return "Other";
  }

  async function send() {
    if (!body.trim()) {
      setErr("Tell us what happened.");
      return;
    }
    setSubmitting(true);
    setErr(null);
    try {
      const result = await submitFeedback({
        subject: subject.trim(),
        body: body.trim(),
        source_url:
          typeof window !== "undefined" ? window.location.href : "",
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent : "",
        device_hint: deviceHint(),
      });
      setDone({ category: result.category });
      setSubject("");
      setBody("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function close() {
    setOpen(false);
    setTimeout(() => {
      setDone(null);
      setErr(null);
    }, 200);
  }

  const triggerClass =
    variant === "prominent"
      ? "inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 shadow-sm"
      : "text-xs text-gray-500 underline hover:text-emerald-700";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={triggerClass}
      >
        {variant === "prominent" ? (
          <>
            <span>🐛</span>
            Report a bug or send feedback
          </>
        ) : (
          "Report a bug or send feedback"
        )}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3"
            style={{
              paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
            }}
          >
            {!done ? (
              <>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-lg">Tell us what's up</h3>
                  <button
                    onClick={close}
                    className="text-gray-400 hover:text-gray-600 text-xl"
                    aria-label="Close"
                  >
                    ×
                  </button>
                </div>
                <p className="text-xs text-gray-500">
                  Bug, feature idea, question — all welcome. The owner gets a
                  notification right away. We'll auto-detect what kind of
                  feedback this is.
                </p>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Short summary (optional)"
                  className="w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                  maxLength={200}
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="What happened? Steps to reproduce if it's a bug. Be specific — what you tapped, what you expected, what you got instead."
                  rows={6}
                  className="w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm resize-y"
                  maxLength={4000}
                />
                {err && <p className="text-sm text-red-600">{err}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button
                    onClick={close}
                    className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={send}
                    disabled={submitting || !body.trim()}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {submitting ? "Sending…" : "Send to owner"}
                  </button>
                </div>
                <p className="text-[11px] text-gray-400">
                  Your device info is included automatically so we can
                  reproduce mobile issues. No personal data beyond your email.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-bold text-lg">Got it — thanks!</h3>
                <p className="text-sm text-gray-700">
                  Logged as a <strong>{done.category.replace("_", " ")}</strong>.
                  The owner has been pinged.
                  {done.category === "bug" &&
                    " You'll get a reply once it's looked at."}
                </p>
                <div className="flex justify-end pt-2">
                  <button
                    onClick={close}
                    className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
                  >
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
