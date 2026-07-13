// Client-side push helpers, shared by the settings panel, the on-open
// prompt, and the onboarding tour. Browser-only APIs are guarded so this
// module is safe to import anywhere.

import { subscribeToPush } from "@/app/actions/push";

export type PushState =
  | "unsupported"
  | "needs-install-ios" // iOS Safari tab: push only works once added to Home Screen
  | "denied"
  | "off"
  | "on";

export function detectPlatform(): "ios" | "android" | "desktop" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as Macintosh but is touch-capable.
  const iPadOS =
    /Macintosh/.test(ua) &&
    typeof document !== "undefined" &&
    "ontouchend" in document;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOS) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh|Windows|Linux/.test(ua)) return "desktop";
  return "other";
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function hasPushApis(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Non-destructive status check — never prompts.
export async function getPushState(): Promise<PushState> {
  if (!hasPushApis()) {
    // On an iPhone/iPad in a normal Safari tab the Push APIs are missing until
    // the app is installed to the Home Screen — steer the user there.
    if (detectPlatform() === "ios" && !isStandalone()) return "needs-install-ios";
    return "unsupported";
  }
  if (Notification.permission === "denied") return "denied";
  try {
    const reg =
      (await navigator.serviceWorker.getRegistration("/sw.js")) ??
      (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    return existing ? "on" : "off";
  } catch {
    return "off";
  }
}

// Requests permission (if needed) and registers a push subscription. Safe to
// call repeatedly — upserts the subscription server-side.
export async function enablePush(): Promise<{
  ok: boolean;
  state: PushState;
  message?: string;
}> {
  try {
    if (!hasPushApis()) {
      if (detectPlatform() === "ios" && !isStandalone())
        return { ok: false, state: "needs-install-ios" };
      return { ok: false, state: "unsupported" };
    }
    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      return { ok: false, state: perm === "denied" ? "denied" : "off" };
    }
    const reg =
      (await navigator.serviceWorker.getRegistration("/sw.js")) ??
      (await navigator.serviceWorker.register("/sw.js"));
    await navigator.serviceWorker.ready;
    const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!pub) {
      return { ok: false, state: "off", message: "Push isn't configured." };
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(pub) as BufferSource,
    });
    const json = sub.toJSON();
    await subscribeToPush({
      endpoint: sub.endpoint,
      p256dh: json.keys?.p256dh ?? "",
      auth: json.keys?.auth ?? "",
    });
    return { ok: true, state: "on" };
  } catch (e) {
    return { ok: false, state: "off", message: (e as Error).message };
  }
}
