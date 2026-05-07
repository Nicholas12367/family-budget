"use client";

import type { Person } from "@/lib/types";

type Props = {
  people: Person[];
  value: number | null;
  onChange: (personId: number | null) => void;
  className?: string;
  showLabel?: boolean;
};

function shade(hex: string): { bg: string; ring: string; text: string } {
  // Tint the person's color into a soft pastel pill: 12% background,
  // bolder text and a thin ring at full color.
  return {
    bg: `${hex}22`,
    ring: `${hex}66`,
    text: hex,
  };
}

export default function PersonSelector({
  people,
  value,
  onChange,
  className = "",
  showLabel = true,
}: Props) {
  if (!people.length) return null;

  return (
    <div className={className}>
      {showLabel && (
        <p className="text-sm font-semibold text-gray-800 mb-2">
          Who bought this?
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {people.map((p) => {
          const selected = value === p.id;
          const c = shade(p.color);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onChange(selected ? null : p.id)}
              className={`px-3.5 py-2 rounded-2xl text-sm font-semibold transition border-2 ${
                selected
                  ? "text-white shadow-sm"
                  : "bg-white"
              }`}
              style={
                selected
                  ? { background: p.color, borderColor: p.color }
                  : { background: c.bg, color: c.text, borderColor: c.ring }
              }
            >
              <span className="inline-flex items-center gap-1.5">
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
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
