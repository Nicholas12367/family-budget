"use client";

import { useState, useTransition } from "react";
import type { Person } from "@/lib/types";
import {
  createPerson,
  deletePerson,
  updatePerson,
} from "@/app/actions/people";

const SUGGESTED_COLORS = [
  "#ec4899", // pink
  "#3b82f6", // blue
  "#10b981", // emerald
  "#f59e0b", // amber
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#ef4444", // red
  "#14b8a6", // teal
];

export default function PeopleManager({
  initial,
}: {
  initial: Person[];
}) {
  const [people, setPeople] = useState<Person[]>(initial);
  const [editing, setEditing] = useState<Person | "new" | null>(null);
  const [, startTransition] = useTransition();

  return (
    <section className="bg-white rounded-xl shadow-sm p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">Who buys what</h2>
        <button
          onClick={() => setEditing("new")}
          className="text-sm font-semibold text-emerald-700 hover:text-emerald-800"
        >
          + Add person
        </button>
      </div>
      <p className="text-sm text-gray-600">
        Add yourself, your partner, kids, or a &quot;Shared&quot; tag — then on
        every expense or scan you can tap to mark <em>who bought this</em>.
      </p>
      {people.length === 0 ? (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-lg p-3">
          No people yet. Add one to start tracking who bought each expense.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => setEditing(p)}
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-2xl text-sm font-semibold ring-2"
              style={{
                background: `${p.color}22`,
                color: p.color,
                borderColor: `${p.color}66`,
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.418 3.582-8 8-8s8 3.582 8 8" />
              </svg>
              {p.name}
            </button>
          ))}
        </div>
      )}

      {editing !== null && (
        <PersonDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={(saved, isNew) => {
            startTransition(() => {
              setPeople((prev) =>
                isNew
                  ? [...prev, saved]
                  : prev.map((p) => (p.id === saved.id ? saved : p))
              );
            });
          }}
          onDelete={(id) => {
            startTransition(() => {
              setPeople((prev) => prev.filter((p) => p.id !== id));
            });
          }}
        />
      )}
    </section>
  );
}

function PersonDialog({
  initial,
  onClose,
  onSave,
  onDelete,
}: {
  initial: Person | "new";
  onClose: () => void;
  onSave: (p: Person, isNew: boolean) => void;
  onDelete: (id: number) => void;
}) {
  const isNew = initial === "new";
  const p = isNew ? null : initial;
  const [name, setName] = useState(p?.name ?? "");
  const [color, setColor] = useState(p?.color ?? SUGGESTED_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("name", name);
      fd.append("color", color);
      if (isNew) {
        const created = await createPerson(fd);
        onSave(created, true);
      } else if (p) {
        await updatePerson(p.id, fd);
        onSave({ ...p, name, color }, false);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl p-5 w-full max-w-sm space-y-3">
        <h3 className="text-lg font-bold">
          {isNew ? "Add person" : "Edit person"}
        </h3>
        {error && (
          <p className="text-sm text-red-600 bg-red-50 rounded p-2">{error}</p>
        )}
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="text-sm font-medium">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={60}
              autoFocus
              placeholder="e.g. Kate, Nick, Shared"
              className="w-full border rounded-lg px-3 py-2 mt-1"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Color</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {SUGGESTED_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition ${
                    color.toLowerCase() === c.toLowerCase()
                      ? "ring-2 ring-offset-2 ring-gray-900"
                      : ""
                  }`}
                  style={{ background: c }}
                  aria-label={c}
                />
              ))}
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-8 h-8 rounded-full border"
                aria-label="Custom color"
              />
            </div>
          </div>
          <div className="flex justify-between pt-2">
            {!isNew && p ? (
              <button
                type="button"
                onClick={async () => {
                  if (!confirm(`Delete "${p.name}"?`)) return;
                  setBusy(true);
                  try {
                    await deletePerson(p.id);
                    onDelete(p.id);
                    onClose();
                  } finally {
                    setBusy(false);
                  }
                }}
                className="text-red-600 text-sm font-semibold"
              >
                Delete
              </button>
            ) : (
              <span />
            )}
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-2 rounded-lg bg-gray-100 text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
              >
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
