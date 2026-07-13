"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { saveWidgetLayout } from "@/app/actions/widgets";
import type { WidgetId, WidgetLayout } from "@/lib/widgets";
import IncomeWidget from "./IncomeWidget";
import type { IncomeEntry } from "@/app/actions/income";
import type { SavingsGoal } from "@/lib/income";

type Totals = {
  totalSpent: number;
  totalBudget: number;
  totalFixed: number;
  remaining: number;
};

type DrillKind = "total" | "variable" | "fixed" | "remaining";

const fmtMoney = (n: number) =>
  "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// UX:
//   • By default the widgets are LOCKED — tapping only drills / opens the
//     editor, and an accidental scroll never moves them.
//   • Tap "Edit" to unlock. While unlocked you can drag to reorder and each
//     card shows a × to remove it. Tap "Done" to lock again.
//   • Drag activates on 8px mouse move / 150ms touch hold, but only when the
//     drag handle listeners are attached — which only happens in edit mode.
//
// We render the widget contents as a non-button div with role="button" so
// the native browser button gesture doesn't fight dnd-kit's pointer/touch
// sensors. Click and drag both work cleanly.

const LABELS: Record<WidgetId, string> = {
  spent: "Total",
  variable: "Variable",
  fixed: "Fixed costs",
  remaining: "Remaining",
  income: "Income",
};

export default function SortableWidgets({
  layout: initialLayout,
  totals,
  onDrill,
  incomeEntries,
  onIncomeChange,
  showIncomeWidget,
  year,
  month,
  savedThisYear,
  savingsGoal,
  goalYear,
  onGoalChange,
}: {
  layout: WidgetLayout;
  totals: Totals;
  onDrill?: (kind: DrillKind) => void;
  incomeEntries: IncomeEntry[];
  onIncomeChange: (next: IncomeEntry[]) => void;
  showIncomeWidget: boolean;
  year: number;
  month: number;
  savedThisYear: number;
  savingsGoal: SavingsGoal | null;
  goalYear: number;
  onGoalChange: (goal: SavingsGoal | null) => void;
}) {
  const [layout, setLayout] = useState<WidgetLayout>(initialLayout);
  const [dragging, setDragging] = useState(false);
  const [activeId, setActiveId] = useState<WidgetId | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState<WidgetId | null>(
    null
  );

  useEffect(() => setLayout(initialLayout), [initialLayout]);

  // While editing, lock touch scrolling so dragging a tile never scrolls the
  // page out from under your finger. Touch only — desktop wheel scrolling is
  // unaffected. Cleared as soon as you tap Done.
  useEffect(() => {
    if (!editing) return;
    const prevent = (e: TouchEvent) => e.preventDefault();
    document.addEventListener("touchmove", prevent, { passive: false });
    return () => document.removeEventListener("touchmove", prevent);
  }, [editing]);

  const visible = useMemo(() => {
    const hidden = new Set(layout.hidden);
    return layout.order.filter((id) => {
      if (hidden.has(id)) return false;
      if (id === "income" && !showIncomeWidget) return false;
      return true;
    });
  }, [layout, showIncomeWidget]);

  const sensors = useSensors(
    // Desktop: 8px distance threshold — a normal click won't trigger drag.
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    // Mobile: press-and-hold ~180ms to pick a tile up; a generous tolerance
    // means a slightly shaky thumb during the hold won't cancel it. Only
    // reachable in edit mode since the drag listeners aren't attached
    // otherwise.
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 10 },
    })
  );

  const persist = useCallback((next: WidgetLayout) => {
    void saveWidgetLayout(next).catch((e) => {
      console.error("[widgets] save failed:", e);
    });
  }, []);

  function handleDragEnd(e: DragEndEvent) {
    setDragging(false);
    setActiveId(null);
    if (!e.over || e.over.id === e.active.id) return;
    const oldIndex = layout.order.indexOf(e.active.id as WidgetId);
    const newIndex = layout.order.indexOf(e.over.id as WidgetId);
    if (oldIndex < 0 || newIndex < 0) return;
    const nextOrder = arrayMove(layout.order, oldIndex, newIndex);
    const next: WidgetLayout = { ...layout, order: nextOrder };
    setLayout(next);
    persist(next);
  }

  function actuallyRemove(id: WidgetId) {
    const hiddenSet = new Set(layout.hidden);
    hiddenSet.add(id);
    const next: WidgetLayout = {
      ...layout,
      hidden: Array.from(hiddenSet),
    };
    setLayout(next);
    setConfirmingRemove(null);
    persist(next);
  }

  return (
    <>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
          {editing ? "Drag to rearrange · × to remove" : "Overview"}
        </p>
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          data-tour-id="widgets-edit-toggle"
          className={`text-xs font-semibold rounded-full px-3 py-1 transition ${
            editing
              ? "bg-emerald-600 text-white hover:bg-emerald-700"
              : "bg-gray-100 text-gray-600 hover:bg-gray-200"
          }`}
        >
          {editing ? "Done" : "Edit"}
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        autoScroll={false}
        onDragStart={(e: DragStartEvent) => {
          setDragging(true);
          setActiveId(e.active.id as WidgetId);
        }}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setDragging(false);
          setActiveId(null);
        }}
      >
        <SortableContext items={visible} strategy={rectSortingStrategy}>
          <div
            data-tour-id="widgets-grid"
            className={`grid grid-cols-2 md:grid-cols-4 gap-3 ${
              dragging ? "select-none" : ""
            }`}
          >
            {visible.map((id) => (
              <SortableWidget
                key={id}
                id={id}
                totals={totals}
                onDrill={onDrill}
                incomeEntries={incomeEntries}
                onIncomeChange={onIncomeChange}
                editing={editing}
                dragging={dragging}
                year={year}
                month={month}
                savedThisYear={savedThisYear}
                savingsGoal={savingsGoal}
                goalYear={goalYear}
                onGoalChange={onGoalChange}
                onRequestRemove={() => setConfirmingRemove(id)}
              />
            ))}
          </div>
        </SortableContext>
        {/* The dragged tile is rendered here and follows the finger 1:1 (no
            layout constraints, no transition lag), while the original stays as
            a dimmed placeholder. This is what makes dragging feel smooth. */}
        <DragOverlay adjustScale={false} zIndex={60}>
          {activeId ? (
            <div
              className={`rounded-2xl shadow-2xl ring-2 ring-emerald-400 cursor-grabbing ${
                activeId === "income" ? "" : ""
              }`}
            >
              <WidgetBody
                id={activeId}
                totals={totals}
                incomeEntries={incomeEntries}
                onIncomeChange={onIncomeChange}
                isDragging
                year={year}
                month={month}
                savedThisYear={savedThisYear}
                savingsGoal={savingsGoal}
                goalYear={goalYear}
                onGoalChange={onGoalChange}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {confirmingRemove && (
        <RemoveConfirmSheet
          label={LABELS[confirmingRemove]}
          onCancel={() => setConfirmingRemove(null)}
          onConfirm={() => actuallyRemove(confirmingRemove)}
        />
      )}
    </>
  );
}

function SortableWidget({
  id,
  totals,
  onDrill,
  incomeEntries,
  onIncomeChange,
  editing,
  dragging,
  year,
  month,
  savedThisYear,
  savingsGoal,
  goalYear,
  onGoalChange,
  onRequestRemove,
}: {
  id: WidgetId;
  totals: Totals;
  onDrill?: (kind: DrillKind) => void;
  incomeEntries: IncomeEntry[];
  onIncomeChange: (next: IncomeEntry[]) => void;
  editing: boolean;
  dragging: boolean;
  year: number;
  month: number;
  savedThisYear: number;
  savingsGoal: SavingsGoal | null;
  goalYear: number;
  onGoalChange: (goal: SavingsGoal | null) => void;
  onRequestRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !editing });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    // Use dnd-kit's own transition (smoothly shifts neighbors to make room;
    // it's null on the item actually being dragged). Do NOT add a blanket
    // transform transition — that made the dragged tile lag behind the finger.
    transition,
    // The dragged tile lives in the DragOverlay; leave a faint placeholder.
    opacity: isDragging ? 0.35 : 1,
    // Only claim the touch gesture while editing; otherwise let the page
    // scroll normally so the cards feel pinned in place.
    touchAction: editing ? "none" : "manipulation",
    cursor: editing ? (isDragging ? "grabbing" : "grab") : undefined,
  };

  // The × button stops both pointerdown and click propagation so dnd-kit
  // never sees the gesture as the start of a drag, and the inner widget
  // never sees it as a body click either.
  function handleRemoveTap(e: React.MouseEvent | React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    onRequestRemove();
  }

  const fullSpan = id === "income";

  // Drag handle props only attach in edit mode. Without them a scroll or tap
  // can never start a drag, which is what keeps the widgets "sticky".
  const dragProps = editing ? { ...attributes, ...listeners } : {};

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...dragProps}
      className={`relative ${fullSpan ? "col-span-2 md:col-span-4" : ""} ${
        isDragging
          ? "rounded-2xl outline-dashed outline-2 outline-emerald-300"
          : ""
      } ${
        editing && !dragging
          ? "animate-[wiggle_0.4s_ease-in-out_infinite]"
          : ""
      }`}
    >
      <WidgetBody
        id={id}
        totals={totals}
        onDrill={onDrill}
        incomeEntries={incomeEntries}
        onIncomeChange={onIncomeChange}
        isDragging={isDragging}
        year={year}
        month={month}
        savedThisYear={savedThisYear}
        savingsGoal={savingsGoal}
        goalYear={goalYear}
        onGoalChange={onGoalChange}
      />

      {/* × appears only in edit mode. Click → confirm sheet. */}
      {editing && (
        <button
          type="button"
          onClick={handleRemoveTap}
          onPointerDown={(e) => {
            // Stop the pointerdown from bubbling so dnd-kit never starts a
            // drag on a tap meant for ×.
            e.stopPropagation();
          }}
          aria-label="Remove from home screen"
          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-rose-600 text-white flex items-center justify-center text-base leading-none ring-2 ring-white shadow-md z-10"
        >
          ×
        </button>
      )}
    </div>
  );
}

function WidgetBody({
  id,
  totals,
  onDrill,
  incomeEntries,
  onIncomeChange,
  isDragging,
  year,
  month,
  savedThisYear,
  savingsGoal,
  goalYear,
  onGoalChange,
}: {
  id: WidgetId;
  totals: Totals;
  onDrill?: (kind: DrillKind) => void;
  incomeEntries: IncomeEntry[];
  onIncomeChange: (next: IncomeEntry[]) => void;
  isDragging: boolean;
  year: number;
  month: number;
  savedThisYear: number;
  savingsGoal: SavingsGoal | null;
  goalYear: number;
  onGoalChange: (goal: SavingsGoal | null) => void;
}) {
  // While actively dragging, suppress the inner widget's click so it
  // doesn't fire when the user releases.
  function onActivate(action?: () => void) {
    if (isDragging) return;
    action?.();
  }

  switch (id) {
    case "spent":
      return (
        <StatCard
          label="Total"
          sublabel="Variable + Fixed"
          value={fmtMoney(totals.totalSpent + totals.totalFixed)}
          accent="emerald"
          onActivate={() => onActivate(() => onDrill?.("total"))}
        />
      );
    case "variable":
      return (
        <StatCard
          label="Variable"
          sublabel="This month"
          value={fmtMoney(totals.totalSpent)}
          accent="sky"
          onActivate={() => onActivate(() => onDrill?.("variable"))}
        />
      );
    case "fixed":
      return (
        <StatCard
          label="Fixed costs"
          sublabel="This month's total"
          value={fmtMoney(totals.totalFixed)}
          accent="violet"
          onActivate={() => onActivate(() => onDrill?.("fixed"))}
        />
      );
    case "remaining":
      return (
        <StatCard
          label="Remaining"
          sublabel="Across all budgets"
          value={fmtMoney(totals.remaining)}
          accent={totals.remaining < 0 ? "rose" : "emerald"}
          onActivate={() => onActivate(() => onDrill?.("remaining"))}
        />
      );
    case "income":
      return (
        <div data-tour-id="income-widget">
          <IncomeWidget
            entries={incomeEntries}
            onEntriesChange={onIncomeChange}
            year={year}
            month={month}
            totalSpent={totals.totalSpent}
            totalFixed={totals.totalFixed}
            savedThisYear={savedThisYear}
            savingsGoal={savingsGoal}
            goalYear={goalYear}
            onGoalChange={onGoalChange}
          />
        </div>
      );
    default:
      return null;
  }
}

// StatCard rendered as a div with role="button" so the native <button>
// gesture handling doesn't fight dnd-kit. We use onClick for keyboard +
// mouse activation, and onPointerUp to handle the tap-to-activate path
// without interfering with hold-to-drag.
function StatCard({
  label,
  sublabel,
  value,
  accent,
  onActivate,
}: {
  label: string;
  sublabel?: string;
  value: string;
  accent: "emerald" | "sky" | "violet" | "rose";
  onActivate?: () => void;
}) {
  const tones = {
    emerald: "bg-emerald-50 ring-emerald-100 text-emerald-700",
    sky: "bg-sky-50 ring-sky-100 text-sky-700",
    violet: "bg-violet-50 ring-violet-100 text-violet-700",
    rose: "bg-rose-50 ring-rose-100 text-rose-700",
  } as const;

  const [pressing, setPressing] = useState(false);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onActivate}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onActivate?.();
        }
      }}
      onPointerDown={() => setPressing(true)}
      onPointerUp={() => setPressing(false)}
      onPointerCancel={() => setPressing(false)}
      onPointerLeave={() => setPressing(false)}
      className={`${tones[accent]} block w-full text-left rounded-2xl ring-1 p-4 pr-9 shadow-sm hover:shadow ${
        pressing ? "scale-[0.99]" : ""
      } transition select-none`}
    >
      <p className="text-[11px] uppercase tracking-wide font-semibold opacity-90">
        {label}
      </p>
      <p className="text-2xl font-extrabold tabular-nums mt-0.5 text-gray-900">
        {value}
      </p>
      {sublabel && <p className="text-[11px] opacity-80 mt-0.5">{sublabel}</p>}
    </div>
  );
}

function RemoveConfirmSheet({
  label,
  onCancel,
  onConfirm,
}: {
  label: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl p-5 space-y-3"
        style={{
          paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))",
        }}
      >
        <h3 className="font-bold text-lg">
          Remove "{label}" from the home screen?
        </h3>
        <p className="text-sm text-gray-600">
          You can add it back anytime from Settings → Home screen widgets.
        </p>
        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-rose-600 text-white text-sm font-semibold hover:bg-rose-700"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
