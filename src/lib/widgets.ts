// Widget layout types + utilities. Shared between server components,
// client components, and the "use server" actions file. Must NOT be
// imported with a "use server" directive — these are sync helpers.

export const WIDGET_IDS = [
  "spent",
  "variable",
  "fixed",
  "remaining",
  "income",
] as const;
export type WidgetId = (typeof WIDGET_IDS)[number];

export type WidgetLayout = {
  order: WidgetId[];
  hidden: WidgetId[];
};

export const DEFAULT_LAYOUT: WidgetLayout = {
  order: ["spent", "variable", "fixed", "remaining", "income"],
  hidden: [],
};

// Repair a possibly-stale layout JSON into a clean shape.
export function normalizeLayout(raw: unknown): WidgetLayout {
  const out: WidgetLayout = {
    order: [...DEFAULT_LAYOUT.order],
    hidden: [],
  };
  if (!raw || typeof raw !== "object") return out;
  const r = raw as { order?: unknown; hidden?: unknown };
  if (Array.isArray(r.order)) {
    const valid = r.order.filter(
      (id): id is WidgetId =>
        typeof id === "string" &&
        (WIDGET_IDS as readonly string[]).includes(id)
    );
    for (const id of DEFAULT_LAYOUT.order) {
      if (!valid.includes(id)) valid.push(id);
    }
    out.order = valid;
  }
  if (Array.isArray(r.hidden)) {
    out.hidden = r.hidden.filter(
      (id): id is WidgetId =>
        typeof id === "string" &&
        (WIDGET_IDS as readonly string[]).includes(id)
    );
  }
  return out;
}
