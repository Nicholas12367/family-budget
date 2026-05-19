"use client";

import { useMemo, useState, useTransition } from "react";
import { askAi } from "@/app/actions/help";

type FaqEntry = {
  question: string;
  answer: string;
  keywords: string[];
};

// Help page client. Local FAQ first; AI fallback only surfaces when local
// returns zero matches AND the query is substantive (≥ 4 chars).
export default function HelpClient({ faq }: { faq: FaqEntry[] }) {
  const [query, setQuery] = useState("");
  const [aiAnswer, setAiAnswer] = useState<string | null>(null);
  const [aiUsage, setAiUsage] = useState<{
    askedToday: number;
    maxPerDay: number;
  } | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return faq;
    const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
    if (tokens.length === 0) return faq;
    const scored = faq
      .map((entry) => {
        const haystack =
          `${entry.question} ${entry.answer} ${entry.keywords.join(" ")}`.toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (haystack.includes(t)) score += 1;
          if (entry.keywords.some((k) => k.toLowerCase() === t)) score += 2;
        }
        return { entry, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return scored.length > 0 ? scored.map((x) => x.entry) : [];
  }, [query, faq]);

  const hasActiveQuery = query.trim().length >= 4;
  const noMatches = hasActiveQuery && matches.length === 0;

  function ask() {
    setAiAnswer(null);
    setAiError(null);
    startTransition(async () => {
      try {
        const r = await askAi(query);
        setAiAnswer(r.answer);
        setAiUsage({ askedToday: r.askedToday, maxPerDay: r.maxPerDay });
      } catch (e) {
        setAiError((e as Error).message);
      }
    });
  }

  return (
    <div className="space-y-4">
      <section className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4 space-y-3">
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setAiAnswer(null);
            setAiError(null);
          }}
          placeholder="Search the FAQ… (e.g. 'how do I scan a receipt')"
          className="w-full px-3 py-2 rounded-lg ring-1 ring-gray-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
        />
      </section>

      {/* AI fallback — only surfaces when local has no matches. */}
      {noMatches && (
        <section className="bg-amber-50 rounded-2xl ring-1 ring-amber-200 p-4 space-y-3">
          <p className="text-sm text-amber-900">
            <strong>No FAQ matches</strong> — but the AI can take a swing at
            it.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={ask}
              disabled={pending}
              className="px-3 py-2 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              <span>🤖</span>
              {pending ? "Thinking…" : "Ask the AI"}
            </button>
            <span className="text-xs text-amber-700">
              5/day per user
              {aiUsage && ` (${aiUsage.askedToday}/${aiUsage.maxPerDay} used)`}
            </span>
          </div>
          {aiAnswer && (
            <div className="bg-white rounded-lg p-3 text-sm text-gray-800 whitespace-pre-wrap ring-1 ring-amber-100">
              {aiAnswer}
            </div>
          )}
          {aiError && (
            <div className="bg-rose-50 rounded-lg p-3 text-sm text-rose-800 ring-1 ring-rose-200">
              {aiError}
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide">
          {query.trim()
            ? matches.length > 0
              ? `Matches (${matches.length})`
              : "No matches"
            : "All topics"}
        </h2>
        {matches.length === 0 && !query.trim() ? (
          <p className="text-sm text-gray-500">No FAQ entries.</p>
        ) : matches.length === 0 ? null : (
          <ul className="space-y-2">
            {matches.map((entry, i) => (
              <li
                key={i}
                className="bg-white rounded-2xl shadow-sm ring-1 ring-gray-100 p-4"
              >
                <details>
                  <summary className="font-semibold cursor-pointer text-gray-900">
                    {entry.question}
                  </summary>
                  <p className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">
                    {entry.answer}
                  </p>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
