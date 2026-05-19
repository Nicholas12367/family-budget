"use server";
import { z } from "zod";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { notifyOwner } from "@/lib/admin-notify";

const FeedbackInput = z.object({
  subject: z.string().max(200).optional().default(""),
  body: z.string().min(3).max(4000),
  source_url: z.string().max(500).optional().default(""),
  user_agent: z.string().max(500).optional().default(""),
  device_hint: z.string().max(60).optional().default(""),
});

type Category = "bug" | "feature_request" | "question" | "other";

// Tiny rule-based classifier. Free, deterministic, no LLM call needed for
// the obvious cases. Only escalates to Gemini for ambiguous reports.
function classifyHeuristic(subject: string, body: string): Category | null {
  const t = `${subject}\n${body}`.toLowerCase();
  // Strong bug signals
  if (
    /(?:^|\s)(error|bug|broken|crash|crashed|not working|doesn't work|doesnt work|won't|wont load|stuck|frozen|fail|failed|404|500|exception|nothing happens)/.test(
      t
    )
  )
    return "bug";
  // Strong feature request signals
  if (
    /(?:^|\s)(feature request|would be (?:nice|cool|great)|wish|please add|can you add|it would help|suggestion|i'd love|id love|missing|should be able|allow me to|let me)/.test(
      t
    )
  )
    return "feature_request";
  // Strong question signals
  if (
    /(?:^|\s)(how do i|how can i|how to|what does|why does|where is|where do i|is there a way|can i)/.test(
      t
    ) ||
    t.endsWith("?")
  )
    return "question";
  return null;
}

// Optional Gemini fallback — only used when heuristics don't match.
// One short request, ~200 tokens. Skipped silently if the call fails.
async function classifyViaGemini(
  subject: string,
  body: string
): Promise<Category> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return "other";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Classify the following user feedback into exactly ONE of: bug, feature_request, question, other. Reply with just the single word.\n\nSubject: ${subject || "(none)"}\nBody: ${body}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "text/plain",
            temperature: 0,
            maxOutputTokens: 8,
          },
        }),
      }
    );
    if (!res.ok) return "other";
    const data = await res.json();
    const text = (
      (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
        ?.candidates?.[0]?.content?.parts?.[0]?.text ?? ""
    )
      .trim()
      .toLowerCase();
    if (["bug", "feature_request", "question", "other"].includes(text)) {
      return text as Category;
    }
    return "other";
  } catch {
    return "other";
  }
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function submitFeedback(input: z.input<typeof FeedbackInput>) {
  const parsed = FeedbackInput.parse(input);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Classify (heuristic first, Gemini fallback if heuristics don't match).
  let category: Category =
    classifyHeuristic(parsed.subject, parsed.body) ?? "other";
  if (category === "other") {
    category = await classifyViaGemini(parsed.subject, parsed.body);
  }

  const svc = serviceClient();
  if (!svc) throw new Error("Service role missing");
  const { data: row, error } = await svc
    .from("feedback")
    .insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      subject: parsed.subject || null,
      body: parsed.body,
      category,
      source_url: parsed.source_url || null,
      user_agent: parsed.user_agent || null,
      device_hint: parsed.device_hint || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(`Feedback save failed: ${error.message}`);

  // Owner push notification — fire and forget.
  const emoji =
    category === "bug"
      ? "🐛"
      : category === "feature_request"
        ? "💡"
        : category === "question"
          ? "❓"
          : "📝";
  void notifyOwner({
    title: `${emoji} ${category.replace("_", " ")} from ${user?.email ?? "user"}`,
    body: parsed.subject || parsed.body.slice(0, 80),
    url: `/nicholas-x7k2qz9j/feedback`,
    tag: `feedback-${row.id}`,
  });

  return { ok: true, id: row.id, category };
}

// Admin-only: list all feedback (paginated).
export async function listFeedback(filter?: {
  status?: "open" | "in_progress" | "resolved" | "wont_fix";
  category?: Category;
  limit?: number;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Re-import to avoid circular: the admin email check.
  const { isAdminEmail } = await import("@/lib/stripe");
  if (!isAdminEmail(user?.email)) throw new Error("Forbidden");

  const svc = serviceClient();
  if (!svc) throw new Error("Service role missing");
  let q = svc
    .from("feedback")
    .select(
      "id, user_id, user_email, created_at, subject, body, category, source_url, user_agent, device_hint, status, resolution_note, resolved_at, resolved_by"
    )
    .order("created_at", { ascending: false })
    .limit(filter?.limit ?? 100);
  if (filter?.status) q = q.eq("status", filter.status);
  if (filter?.category) q = q.eq("category", filter.category);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Admin-only: change a feedback row's status + add a resolution note.
// When status becomes resolved/wont_fix, ping the original reporter so they
// know we looked at it. Push failure is non-fatal.
export async function resolveFeedback(input: {
  id: number;
  status: "in_progress" | "resolved" | "wont_fix" | "open";
  note?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { isAdminEmail } = await import("@/lib/stripe");
  if (!isAdminEmail(user?.email)) throw new Error("Forbidden");

  const svc = serviceClient();
  if (!svc) throw new Error("Service role missing");

  // Look up the original feedback so we know who to notify.
  const { data: existing } = await svc
    .from("feedback")
    .select("user_id, subject, body, category")
    .eq("id", input.id)
    .maybeSingle();

  const isClosing =
    input.status === "resolved" || input.status === "wont_fix";

  const { error } = await svc
    .from("feedback")
    .update({
      status: input.status,
      resolution_note: input.note ?? null,
      resolved_at: isClosing ? new Date().toISOString() : null,
      resolved_by: user?.email ?? null,
    })
    .eq("id", input.id);
  if (error) throw new Error(error.message);

  // Fire-and-forget push to reporter on close.
  if (isClosing && existing?.user_id) {
    const { notifyUserById } = await import("@/lib/admin-notify");
    const subject = existing.subject || existing.body?.slice(0, 60) || "";
    const title =
      input.status === "resolved"
        ? "✅ Your report has been looked at"
        : "📝 Your feedback has been reviewed";
    const body = input.note?.trim()
      ? input.note
      : subject
        ? `Re: ${subject}`
        : "Thanks for letting us know. The owner has reviewed it.";
    void notifyUserById(existing.user_id, {
      title,
      body: body.slice(0, 200),
      url: "/settings",
      tag: `feedback-resolved-${input.id}`,
    });
  }

  return { ok: true };
}
