"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { markOnboarded } from "@/app/actions/onboarding";

// Interactive guided tour. Each step highlights a real UI element via a
// spotlight overlay (cut-out around the target). "Next" advances; "Show me"
// performs the next demo action so the user can see exactly what happens.
//
// Coordination: the tour fires `data-tour-action` events the main app
// listens for (e.g. switch tab, open dialog) — see useTourBridge in
// BudgetApp. This lets the tour drive the actual app state.

type Stage = "install" | "tour" | "done";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function detectPlatform(): "ios" | "android" | "desktop" | "other" {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  if (/Macintosh|Windows|Linux/.test(ua)) return "desktop";
  return "other";
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

// Each step targets a DOM element via a CSS selector and has an optional
// "show me" action that the host app handles via the custom event bridge.
type TourStep = {
  title: string;
  body: string;
  selector?: string; // element to spotlight
  showMe?: { event: string; detail?: unknown; label: string };
  preNav?: { event: string; detail?: unknown }; // fire before the spotlight renders to set app state
};

const STEPS: TourStep[] = [
  {
    title: "Welcome 👋",
    body: "Track every dollar without the spreadsheet. Snap a receipt, set a budget, see where your money goes — done.",
  },
  {
    title: "Add an expense",
    body: "Tap the green + button at the bottom whenever you spend. It opens a quick menu: expense, fixed cost, budget, or scan a receipt.",
    selector: "[data-tour-id='bottom-add']",
    preNav: { event: "tour:goto-tab", detail: "dashboard" },
    showMe: { event: "tour:open-add-sheet", label: "Show me the menu" },
  },
  {
    title: "Scan a receipt",
    body: "Tap the round green camera button — the AI reads the whole receipt, pulls every line item, and lets you tweak before saving.",
    selector: "[data-tour-id='bottom-scan']",
  },
  {
    title: "Set a budget",
    body: "Pick a category and a monthly cap. We ping you at 50%, 80%, and 100% so you don't blow past it.",
    selector: "[data-tour-id='budgets-tab']",
    preNav: { event: "tour:goto-tab", detail: "budgets" },
    showMe: { event: "tour:goto-tab", detail: "budgets", label: "Take me there" },
  },
  {
    title: "Fixed costs",
    body: "Rent, subscriptions, insurance — anything that hits regularly. Add them once and they auto-roll into your budget.",
    selector: "[data-tour-id='fixed-tab']",
    preNav: { event: "tour:goto-tab", detail: "fixed" },
    showMe: { event: "tour:goto-tab", detail: "fixed", label: "Take me there" },
  },
  {
    title: "Income & savings",
    body: "Below the 4 stat cards there's an Income widget. Log paychecks as they come — it shows what you Made, Spent, and Saved each month.",
    selector: "[data-tour-id='income-widget']",
    preNav: { event: "tour:goto-tab", detail: "dashboard" },
  },
  {
    title: "Edit your home screen",
    body: "Press-and-hold any widget to remove it, or drag to reorder. Recover hidden widgets anytime from Settings → Home screen widgets.",
    selector: "[data-tour-id='widgets-grid']",
    preNav: { event: "tour:goto-tab", detail: "dashboard" },
  },
  {
    title: "Need help?",
    body: "Tap More at the bottom → Help & FAQ to search the docs, or Send feedback to ping the owner directly. You'll get a notification back when a bug is fixed.",
    selector: "[data-tour-id='bottom-more']",
  },
];

export default function OnboardingFlow({ userId }: { userId: string }) {
  void userId;
  const [stage, setStage] = useState<Stage>("install");
  const [slide, setSlide] = useState(0);
  const [installEvent, setInstallEvent] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [platform, setPlatform] = useState<
    "ios" | "android" | "desktop" | "other"
  >("other");
  const [rect, setRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());
    if (isStandalone()) setStage("tour");
    function onBefore(e: Event) {
      e.preventDefault();
      setInstallEvent(e as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setInstalled(true);
    }
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  // Find the current step's target element and measure it. Re-measure when
  // the step changes, on scroll, and on resize.
  const step = stage === "tour" ? STEPS[slide] : null;
  const selector = step?.selector;
  const preNav = step?.preNav;

  useEffect(() => {
    if (!preNav) return;
    window.dispatchEvent(
      new CustomEvent(preNav.event, { detail: preNav.detail })
    );
  }, [preNav]);

  const measure = useCallback(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    // Wait a tick for any tab-switch to render.
    requestAnimationFrame(() => {
      const el = document.querySelector(selector);
      if (el) setRect(el.getBoundingClientRect());
      else setRect(null);
    });
  }, [selector]);

  useEffect(() => {
    if (stage !== "tour") return;
    measure();
    const handler = () => measure();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    const t = setTimeout(measure, 250);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
      clearTimeout(t);
    };
  }, [stage, slide, measure]);

  async function finish() {
    setStage("done");
    try {
      await markOnboarded();
    } catch {
      // non-fatal
    }
  }

  async function triggerInstall() {
    if (!installEvent) return;
    try {
      await installEvent.prompt();
      const r = await installEvent.userChoice;
      if (r.outcome === "accepted") setInstalled(true);
    } catch {
      // ignored
    } finally {
      setInstallEvent(null);
    }
  }

  function next() {
    if (slide < STEPS.length - 1) setSlide(slide + 1);
    else finish();
  }
  function prev() {
    if (slide > 0) setSlide(slide - 1);
  }
  function showMe() {
    if (step?.showMe) {
      window.dispatchEvent(
        new CustomEvent(step.showMe.event, { detail: step.showMe.detail })
      );
    }
  }

  if (stage === "done") return null;

  return (
    <>
      {/* Spotlight overlay (tour stage only). When no target rect, show
          a generic centered modal. */}
      {stage === "tour" && rect && (
        <SpotlightOverlay rect={rect} />
      )}

      <div
        className={`fixed z-[70] ${
          stage === "tour" && rect
            ? "left-4 right-4 bottom-4"
            : "inset-0 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60"
        }`}
        role="dialog"
        aria-modal="true"
      >
        <div
          className={`bg-white shadow-2xl p-6 space-y-4 ${
            stage === "tour" && rect
              ? "rounded-2xl mx-auto max-w-md"
              : "w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl"
          }`}
          style={{
            paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
          }}
        >
          {stage === "install" && (
            <InstallStep
              platform={platform}
              installed={installed}
              canInstall={!!installEvent}
              onInstall={triggerInstall}
              onSkip={() => setStage("tour")}
              onContinue={() => setStage("tour")}
            />
          )}
          {stage === "tour" && step && (
            <TourStepView
              step={step}
              index={slide}
              total={STEPS.length}
              onNext={next}
              onPrev={prev}
              onSkip={finish}
              onShowMe={showMe}
            />
          )}
        </div>
      </div>
    </>
  );
}

function SpotlightOverlay({ rect }: { rect: DOMRect }) {
  // Build a "spotlight" using a fixed dim layer with a cut-out via CSS
  // box-shadow trick: render a transparent box at the target's position
  // with a massive box-shadow covering the rest of the screen.
  const pad = 8;
  const style: React.CSSProperties = {
    position: "fixed",
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
    boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
    borderRadius: 16,
    pointerEvents: "none",
    transition: "all 220ms ease",
    border: "2px solid rgba(16,185,129,0.9)",
    zIndex: 65,
  };
  return <div style={style} aria-hidden="true" />;
}

function InstallStep({
  platform,
  installed,
  canInstall,
  onInstall,
  onSkip,
  onContinue,
}: {
  platform: "ios" | "android" | "desktop" | "other";
  installed: boolean;
  canInstall: boolean;
  onInstall: () => void;
  onSkip: () => void;
  onContinue: () => void;
}) {
  if (installed) {
    return (
      <>
        <div className="text-center space-y-1">
          <div className="text-5xl">🎉</div>
          <h2 className="text-2xl font-extrabold">App installed</h2>
          <p className="text-sm text-gray-600">
            Open it from your home screen anytime.
          </p>
        </div>
        <button
          onClick={onContinue}
          className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700"
        >
          Show me around
        </button>
      </>
    );
  }

  if (platform === "android" && canInstall) {
    return (
      <>
        <div className="text-center space-y-1">
          <div className="text-5xl">📲</div>
          <h2 className="text-2xl font-extrabold">Install on your phone</h2>
          <p className="text-sm text-gray-600">
            One tap, app on your home screen. No app store.
          </p>
        </div>
        <button
          onClick={onInstall}
          className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700"
        >
          Install app
        </button>
        <button
          onClick={onSkip}
          className="w-full text-sm text-gray-500 hover:text-gray-700"
        >
          I'll do this later
        </button>
      </>
    );
  }

  if (platform === "ios") {
    return (
      <>
        <div className="text-center space-y-1">
          <div className="text-5xl">📲</div>
          <h2 className="text-2xl font-extrabold">Add to your home screen</h2>
          <p className="text-sm text-gray-600">
            iPhones don't have a one-tap install. Three quick steps:
          </p>
        </div>
        <ol className="space-y-3 text-sm">
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center">
              1
            </span>
            <span>
              Tap the <strong>Share</strong> button (square with an arrow
              pointing up) at the bottom of Safari.
            </span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center">
              2
            </span>
            <span>
              Scroll the list and tap <strong>Add to Home Screen</strong>.
            </span>
          </li>
          <li className="flex gap-3 items-start">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-600 text-white font-bold flex items-center justify-center">
              3
            </span>
            <span>
              Tap <strong>Add</strong> in the top right. Done — new icon on
              your home screen.
            </span>
          </li>
        </ol>
        <button
          onClick={onSkip}
          className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700"
        >
          Got it — show me around
        </button>
      </>
    );
  }

  return (
    <>
      <div className="text-center space-y-1">
        <div className="text-5xl">📲</div>
        <h2 className="text-2xl font-extrabold">Add to your home screen</h2>
        <p className="text-sm text-gray-600">
          {platform === "android"
            ? "Open your browser menu and tap 'Install app' or 'Add to Home Screen'."
            : "On mobile, use your browser's 'Add to Home Screen' option to keep this one tap away."}
        </p>
      </div>
      <button
        onClick={onSkip}
        className="w-full px-4 py-3 rounded-xl bg-emerald-600 text-white font-semibold hover:bg-emerald-700"
      >
        Got it — show me around
      </button>
    </>
  );
}

function TourStepView({
  step,
  index,
  total,
  onNext,
  onPrev,
  onSkip,
  onShowMe,
}: {
  step: TourStep;
  index: number;
  total: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  onShowMe: () => void;
}) {
  const isLast = index === total - 1;
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-bold flex-1">{step.title}</h2>
        <button
          onClick={onSkip}
          className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
        >
          Skip tour
        </button>
      </div>
      <p className="text-sm text-gray-700">{step.body}</p>

      {/* Slide pips */}
      <div className="flex justify-center gap-1.5 pt-1">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 rounded-full transition-all ${
              i === index ? "w-6 bg-emerald-600" : "w-1.5 bg-gray-300"
            }`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {index > 0 && (
          <button
            onClick={onPrev}
            className="px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
          >
            Back
          </button>
        )}
        {step.showMe && (
          <button
            onClick={onShowMe}
            className="px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100 text-sm font-semibold hover:bg-emerald-100"
          >
            {step.showMe.label}
          </button>
        )}
        <button
          onClick={onNext}
          className="ml-auto px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700"
        >
          {isLast ? "Let's go" : "Next →"}
        </button>
      </div>
    </>
  );
}
