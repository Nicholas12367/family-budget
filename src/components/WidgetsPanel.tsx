"use client";

import { useState, useTransition } from "react";
import { saveWidgetLayout } from "@/app/actions/widgets";
import { WIDGET_IDS, type WidgetId, type WidgetLayout } from "@/lib/widgets";

const LABELS: Record<WidgetId, string> = {
  spent: "Total (Variable + Fixed)",
  variable: "Variable spending",
  fixed: "Fixed costs",
  remaining: "Remaining",
  income: "Income / Saved",
};

// Settings panel for the home-screen widgets. Toggle visibility, reorder
// via arrows (keyboard + tap friendly). The home-screen itself uses drag-
// and-drop, but a tap-only path lives here so people can always recover.
export default function WidgetsPanel({
  initial,
}: {
  initial: WidgetLayout;
}) {
  const [layout, setLayout] = useState<WidgetLayout>(initial);
  const [pending, startTransition] = useTransition();
  const [savedToast, setSavedToast] = useState<string | null>(null);

  function persist(next: WidgetLayout) {
    setLayout(next);
    startTransition(async () => {
      try {
        await saveWidgetLayout(next);
        setSavedToast("Saved.");
        setTimeout(() => setSavedToast(null), 1500);
      } catch (e) {
        setSavedToast((e as Error).message);
      }
    });
  }

  function toggleHidden(id: WidgetId) {
    const isHidden = layout.hidden.includes(id);
    const next: WidgetLayout = {
      ...layout,
      hidden: isHidden
        ? layout.hidden.filter((x) => x !== id)
        : [...layout.hidden, id],
    };
    persist(next);
  }

  function move(id: WidgetId, dir: -1 | 1) {
    const i = layout.order.indexOf(id);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= layout.order.length) return;
    const nextOrder = [...layout.order];
    [nextOrder[i], nextOrder[j]] = [nextOrder[j], nextOrder[i]];
    persist({ ...layout, order: nextOrder });
  }

  function reset() {
    persist({
      order: [...WIDGET_IDS] as WidgetId[],
      hidden: [],
    });
  }

  return (
    <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold">Home screen widgets</h2>
          <p className="text-xs text-gray-500">
            Toggle widgets on/off, or tap the arrows to reorder. On the home
            screen itself, press-and-hold to remove or drag to rearrange.
          </p>
        </div>
        <button
          type="button"
          onClick={reset}
          className="text-xs text-emerald-700 underline hover:text-emerald-900 shrink-0"
        >
          Reset
        </button>
      </div>

      <ul className="space-y-2">
        {layout.order.map((id, idx) => {
          const hidden = layout.hidden.includes(id);
          return (
            <li
              key={id}
              className={`flex items-center gap-2 rounded-lg p-2 ${
                hidden
                  ? "bg-gray-50 ring-1 ring-gray-100"
                  : "bg-emerald-50/50 ring-1 ring-emerald-100"
              }`}
            >
              <button
                type="button"
                onClick={() => toggleHidden(id)}
                disabled={pending}
                className={`shrink-0 w-10 h-6 rounded-full relative transition ${
                  hidden ? "bg-gray-300" : "bg-emerald-500"
                }`}
                aria-label={hidden ? "Show widget" : "Hide widget"}
              >
                <span
                  className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition ${
                    hidden ? "left-0.5" : "left-[18px]"
                  }`}
                />
              </button>
              <span
                className={`flex-1 text-sm ${
                  hidden ? "text-gray-500" : "text-gray-900 font-medium"
                }`}
              >
                {LABELS[id]}
              </span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={() => move(id, -1)}
                  disabled={idx === 0 || pending}
                  className="w-7 h-7 rounded-md bg-white ring-1 ring-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                  aria-label="Move up"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(id, 1)}
                  disabled={idx === layout.order.length - 1 || pending}
                  className="w-7 h-7 rounded-md bg-white ring-1 ring-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-30"
                  aria-label="Move down"
                >
                  ↓
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {savedToast && (
        <p className="text-xs text-emerald-700">{savedToast}</p>
      )}
    </section>
  );
}
