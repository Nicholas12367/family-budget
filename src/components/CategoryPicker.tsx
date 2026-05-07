"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Category } from "@/lib/types";
import { createCategory } from "@/app/actions/categories";

type Props = {
  value: number;
  categories: Category[];
  onChange: (id: number) => void;
  onCreated?: (cat: Category) => void;
  className?: string;
};

// A compact category picker with inline fuzzy search and a "+ Add new"
// option. Use anywhere we need to assign a category to an expense or
// receipt line item without leaving the flow.
export default function CategoryPicker({
  value,
  categories,
  onChange,
  onCreated,
  className = "",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  const selected = categories.find((c) => c.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return categories;
    return categories
      .map((c) => ({ c, score: scoreMatch(c.name, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.c);
  }, [categories, query]);

  const exactExists = useMemo(
    () =>
      !!query.trim() &&
      categories.some(
        (c) => c.name.trim().toLowerCase() === query.trim().toLowerCase()
      ),
    [categories, query]
  );

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function addNew() {
    const name = query.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const color = randomColor(name);
      const fd = new FormData();
      fd.append("name", name);
      fd.append("icon", "🏷️");
      fd.append("color", color);
      const created = await createCategory(fd);
      onCreated?.(created as Category);
      onChange((created as Category).id);
      setQuery("");
      setOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left border rounded-lg px-2 py-1 text-sm flex items-center gap-2 bg-white hover:bg-gray-50"
      >
        {selected ? (
          <>
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ background: selected.color }}
            />
            <span className="truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-gray-400">Choose category</span>
        )}
        <span className="ml-auto text-gray-400 text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-64 bg-white border rounded-lg shadow-xl max-h-80 overflow-auto">
          <div className="p-2 sticky top-0 bg-white border-b">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search or add new…"
              className="w-full border rounded-md px-2 py-1 text-sm"
            />
          </div>
          {filtered.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.id);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-emerald-50 flex items-center gap-2 ${
                c.id === value ? "bg-emerald-50/60" : ""
              }`}
            >
              <span
                className="inline-block w-2 h-2 rounded-full shrink-0"
                style={{ background: c.color }}
              />
              <span className="truncate">{c.name}</span>
            </button>
          ))}
          {query && !exactExists && (
            <button
              type="button"
              onClick={addNew}
              disabled={busy}
              className="w-full text-left px-3 py-2 text-sm border-t text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
            >
              {busy ? "Adding…" : `+ Add “${query.trim()}”`}
            </button>
          )}
          {!filtered.length && !query && (
            <p className="p-3 text-xs text-gray-500">
              No categories yet — type a name to add one.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Tiny scorer: prefers prefix matches, then substring matches.
function scoreMatch(name: string, q: string): number {
  const n = name.toLowerCase();
  if (n === q) return 100;
  if (n.startsWith(q)) return 80;
  if (n.includes(q)) return 50;
  // word-prefix match (e.g. "ki" matches "Baby & Kids")
  const words = n.split(/\s+/);
  if (words.some((w) => w.startsWith(q))) return 30;
  return 0;
}

const COLORS = [
  "#22c55e",
  "#3b82f6",
  "#ec4899",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#14b8a6",
  "#f97316",
  "#dc2626",
  "#a855f7",
  "#6366f1",
  "#0ea5e9",
];

function randomColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}
