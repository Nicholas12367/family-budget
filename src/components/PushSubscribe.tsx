"use client";

import { useEffect, useState } from "react";
import {
  subscribeToPush,
  unsubscribeFromPush,
  sendTestPush,
} from "@/app/actions/push";
import { IconBell } from "./Icon";

type State = "loading" | "unsupported" | "denied" | "off" | "on";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export default function PushSubscribe() {
  const [state, setState] = useState<State>("loading");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        setState("denied");
        return;
      }
      try {
        const reg =
          (await navigator.serviceWorker.getRegistration("/sw.js")) ??
          (await navigator.serviceWorker.register("/sw.js"));
        await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        setState(existing ? "on" : "off");
      } catch {
        setState("off");
      }
    })();
  }, []);

  async function enable() {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState("denied");
        return;
      }
      const reg =
        (await navigator.serviceWorker.getRegistration("/sw.js")) ??
        (await navigator.serviceWorker.register("/sw.js"));
      await navigator.serviceWorker.ready;
      const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!pub) {
        setMsg("Server is missing VAPID key — push not configured.");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pub),
      });
      const json = sub.toJSON();
      await subscribeToPush({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      setState("on");
      setMsg("Notifications enabled.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMsg(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await unsubscribeFromPush(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
      setMsg("Notifications disabled.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await sendTestPush();
      setMsg(
        r.sent ? `Test sent to ${r.sent} device(s).` : "No subscribed devices."
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <h2 className="font-semibold flex items-center gap-2">
        <IconBell size={18} className="text-emerald-700" />
        <span>Notifications</span>
      </h2>
      {state === "loading" && (
        <p className="text-sm text-gray-500">Checking…</p>
      )}
      {state === "unsupported" && (
        <p className="text-sm text-gray-600">
          This browser doesn't support push notifications. On iPhone, add the
          app to your home screen first, then open it from there.
        </p>
      )}
      {state === "denied" && (
        <p className="text-sm text-gray-600">
          Notifications are blocked. Enable them in your browser/site settings,
          then reload.
        </p>
      )}
      {state === "off" && (
        <>
          <p className="text-sm text-gray-600">
            Get an alert when you cross a budget limit (50% / 80% / 100%) or
            when a big purchase is logged.
          </p>
          <button
            onClick={enable}
            disabled={busy}
            className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600 disabled:opacity-50"
          >
            {busy ? "Enabling…" : "Enable notifications"}
          </button>
        </>
      )}
      {state === "on" && (
        <>
          <p className="text-sm text-emerald-700">
            Notifications are enabled on this device.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={test}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-sm font-semibold hover:bg-emerald-100 ring-1 ring-emerald-100 disabled:opacity-50"
            >
              Send test
            </button>
            <button
              onClick={disable}
              disabled={busy}
              className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
            >
              Disable on this device
            </button>
          </div>
        </>
      )}
      {msg && <p className="text-xs text-gray-500">{msg}</p>}
    </section>
  );
}
