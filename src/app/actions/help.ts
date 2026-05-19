"use server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getUserOrThrow } from "./auth";
import { FAQ_ENTRIES } from "@/lib/faq";

// Server-side fuzzy match. Returns up to N FAQ entries that mention any of
// the question's keywords. Falls back to highest substring overlap.
export async function searchFaq(query: string, limit = 5) {
  const q = (query ?? "").trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return [];
  const scored = FAQ_ENTRIES.map((entry) => {
    const haystack = `${entry.question} ${entry.answer} ${entry.keywords.join(" ")}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (haystack.includes(t)) score += 1;
      if (entry.keywords.some((k) => k.toLowerCase() === t)) score += 2;
    }
    return { entry, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return scored.map((x) => x.entry);
}

const MAX_AI_QUESTIONS_PER_DAY = 5;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

async function userAiQuestionsToday(userId: string): Promise<number> {
  const svc = serviceClient();
  if (!svc) return 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await svc
    .from("ai_question_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since)
    .in("status", ["ok", "error"]);
  return count ?? 0;
}

// Free-form Gemini question with the FAQ corpus as context.
// Rate-limited per user to MAX_AI_QUESTIONS_PER_DAY to protect the shared quota.
export async function askAi(question: string) {
  const { user } = await getUserOrThrow();
  const q = (question ?? "").trim();
  if (!q) throw new Error("Empty question.");
  if (q.length > 500) throw new Error("Question too long (max 500 chars).");

  const used = await userAiQuestionsToday(user.id);
  if (used >= MAX_AI_QUESTIONS_PER_DAY) {
    const svc = serviceClient();
    if (svc) {
      void svc.from("ai_question_log").insert({
        user_id: user.id,
        question: q,
        status: "blocked_by_cap",
      });
    }
    throw new Error(
      `You've used your ${MAX_AI_QUESTIONS_PER_DAY} free AI questions for today. Try the search above for a quicker answer, or come back tomorrow.`
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("AI assistant isn't configured on the server.");
  }

  const startedAt = Date.now();
  const corpus = FAQ_ENTRIES.map(
    (e, i) => `[${i + 1}] Q: ${e.question}\n    A: ${e.answer}`
  ).join("\n\n");
  const prompt = `You are a friendly help assistant for a personal budgeting app. Answer the user's question using ONLY the documented behavior below. If the question can't be answered from the docs, say so plainly and suggest they tap the bug-report button in Settings to ask the team. Keep answers under 80 words. No markdown, no preamble.

DOCUMENTED BEHAVIOR:
${corpus}

USER QUESTION: ${q}

ANSWER:`;

  let answer = "";
  let status: "ok" | "error" = "ok";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: "text/plain",
            temperature: 0.2,
            maxOutputTokens: 200,
          },
        }),
      }
    );
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    answer = (
      (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        ?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    ).trim();
    if (!answer) throw new Error("Empty response from AI.");
  } catch (e) {
    status = "error";
    answer = "Sorry — the AI assistant is having trouble right now. Try the search above, or tap the bug-report button in Settings.";
    console.error("[askAi] failed:", e);
  }

  const svc = serviceClient();
  if (svc) {
    void svc.from("ai_question_log").insert({
      user_id: user.id,
      question: q.slice(0, 500),
      answer: answer.slice(0, 1000),
      duration_ms: Date.now() - startedAt,
      status,
    });
  }

  return {
    answer,
    askedToday: used + 1,
    maxPerDay: MAX_AI_QUESTIONS_PER_DAY,
  };
}
