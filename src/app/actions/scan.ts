"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";
import { scanReceipt } from "@/lib/ai/vision";
import {
  hashImageBase64,
  isDuplicateScan,
  logScan,
  PER_USER_DAILY_SCAN_CAP,
  scansInLast24h,
  SOFT_DAILY_SCAN_CAP,
  userScansInLast24h,
} from "@/lib/ai/scan-log";
import { checkBudgetThreshold } from "@/lib/push";
import type { ScanResult } from "@/lib/types";

// Server Actions return errors as values rather than throwing. Next.js 15
// masks any thrown Error in production builds with the generic message
// "An error occurred in the Server Components render…" — which surfaces to
// the user as useless noise. By returning a discriminated union the real,
// user-friendly message reaches the client intact.
export type ScanActionResult =
  | { ok: true; result: ScanResult }
  | { ok: false; error: string; code?: string };

export type SaveActionResult =
  | { ok: true; count: number }
  | { ok: false; error: string };

export type SaveIncomeActionResult =
  | { ok: true; amount: number }
  | { ok: false; error: string };

const SaveIncomeInput = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().min(0),
  description: z.string().max(200).optional().default(""),
  source: z.string().max(80).optional().default(""),
});

const SaveInput = z.object({
  merchant: z.string().default(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total: z.coerce.number().default(0),
  person_id: z
    .preprocess(
      (v) => (v === "" || v === undefined || v === null ? null : v),
      z.union([z.coerce.number().int().positive(), z.null()])
    )
    .optional()
    .default(null),
  line_items: z.array(
    z.object({
      description: z.string(),
      amount: z.coerce.number(),
      category_id: z.coerce.number().int().positive(),
      notes: z.string().default(""),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      person_id: z
        .preprocess(
          (v) => (v === "" || v === undefined || v === null ? null : v),
          z.union([z.coerce.number().int().positive(), z.null()])
        )
        .optional()
        .default(null),
    })
  ),
});

function detectMimeType(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const name = file.name.toLowerCase();
  if (/\.(heic)$/.test(name)) return "image/heic";
  if (/\.(heif)$/.test(name)) return "image/heif";
  if (/\.(png)$/.test(name)) return "image/png";
  if (/\.(webp)$/.test(name)) return "image/webp";
  if (/\.(jpe?g)$/.test(name)) return "image/jpeg";
  return "image/jpeg";
}

// Hard ceiling. compressImage targets ~2.5 MB; this is the absolute upload
// cap the action will accept (matches next.config.mjs serverActions limit
// of 8 MB with headroom for FormData overhead).
const MAX_UPLOAD_BYTES = 7 * 1024 * 1024;

export async function scanReceiptAction(
  formData: FormData
): Promise<ScanActionResult> {
  try {
    const { supabase, user } = await getUserOrThrow();
    const file = formData.get("image");
    if (!(file instanceof File)) {
      return {
        ok: false,
        code: "no_file",
        error: "No image was attached. Try picking the photo again.",
      };
    }
    if (file.size === 0) {
      return {
        ok: false,
        code: "empty_file",
        error:
          "That image came through empty. Try picking the photo again — sometimes the camera hands back nothing on the first try.",
      };
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return {
        ok: false,
        code: "too_large",
        error: `That photo is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which is too large to upload. Take a closer/tighter shot of just the receipt and try again.`,
      };
    }

    const mimeType = detectMimeType(file);
    if (!mimeType.startsWith("image/")) {
      return {
        ok: false,
        code: "bad_mime",
        error: "That file isn't an image. Pick a JPEG, PNG, or HEIC photo.",
      };
    }

    let base64: string;
    try {
      const buf = Buffer.from(await file.arrayBuffer());
      base64 = buf.toString("base64");
    } catch (e) {
      console.error("[scanReceiptAction] arrayBuffer/base64 failed:", e);
      return {
        ok: false,
        code: "read_failed",
        error: "Couldn't read the uploaded image. Try picking the photo again.",
      };
    }

    // These pre-checks are independent reads. Running them in parallel (rather
    // than four sequential Supabase round-trips) reclaims a chunk of the 60s
    // function budget for the Gemini call itself — important headroom on big
    // receipts that legitimately take longer to read.
    const requestHash = hashImageBase64(base64);
    const [userRecent, recentScans, duplicate, catsRes] = await Promise.all([
      userScansInLast24h(user.id).catch(() => 0),
      scansInLast24h().catch(() => 0),
      isDuplicateScan(user.id, requestHash).catch(() => false),
      supabase
        .from("categories")
        .select("name")
        .eq("user_id", user.id),
    ]);

    if (userRecent >= PER_USER_DAILY_SCAN_CAP) {
      await logScan({
        userId: user.id,
        status: "blocked_by_user_cap",
        bytesIn: base64.length,
        errorCode: "user_daily_cap",
        errorMessage: `User hit per-user cap at ${userRecent} scans in last 24h.`,
      });
      return {
        ok: false,
        code: "user_daily_cap",
        error: `You've reached your daily limit of ${PER_USER_DAILY_SCAN_CAP} receipt scans. The counter resets in 24 hours from your earliest scan today.`,
      };
    }

    if (recentScans >= SOFT_DAILY_SCAN_CAP) {
      await logScan({
        userId: user.id,
        status: "blocked_by_cap",
        bytesIn: base64.length,
        errorCode: "daily_cap",
        errorMessage: `Soft cap hit at ${recentScans} scans in last 24h.`,
      });
      return {
        ok: false,
        code: "daily_cap",
        error:
          "Receipt scanning is temporarily paused — we've hit today's quota. Try again tomorrow, or contact support.",
      };
    }

    if (duplicate) {
      await logScan({
        userId: user.id,
        status: "duplicate_blocked",
        bytesIn: base64.length,
        errorCode: "duplicate",
        errorMessage: "Same image hash within dedup window.",
        requestHash,
      });
      return {
        ok: false,
        code: "duplicate",
        error:
          "That same scan is already in progress — give it a moment, then try a different photo if it didn't come through.",
      };
    }

    const categoryNames = (catsRes.data ?? []).map((c) => c.name);

    const result = await scanReceipt(
      base64,
      mimeType,
      categoryNames,
      user.id,
      requestHash
    );
    return { ok: true, result };
  } catch (e) {
    // Catch-all: convert any unexpected throw into a user-readable error
    // so production builds don't replace it with the generic RSC mask.
    const err = e as Error;
    console.error("[scanReceiptAction] unexpected error:", err);
    const msg = err?.message || "";
    // Pass through the curated messages from vision.ts; mask everything
    // else with a friendly default.
    const friendly =
      msg && msg.length < 300
        ? msg
        : "Something went wrong scanning that photo. Try again in a moment, or use Add expense to log it by hand.";
    return { ok: false, code: "unexpected", error: friendly };
  }
}

export async function saveScannedExpenses(
  input: z.input<typeof SaveInput>
): Promise<SaveActionResult> {
  try {
    const { supabase, user } = await getUserOrThrow();
    const parsed = SaveInput.parse(input);

    const { data: batch, error: bErr } = await supabase
      .from("receipt_batches")
      .insert({
        user_id: user.id,
        merchant: parsed.merchant || null,
        total_extracted: parsed.total || null,
      })
      .select("id")
      .single();
    if (bErr) {
      console.error("[saveScannedExpenses] batch insert failed:", bErr);
      return {
        ok: false,
        error: "Couldn't save the receipt batch. Try again in a moment.",
      };
    }

    if (parsed.line_items.length > 0) {
      const rows = parsed.line_items.map((li) => ({
        user_id: user.id,
        category_id: li.category_id,
        receipt_batch_id: batch.id,
        amount: li.amount,
        description: li.description,
        notes: li.notes,
        date: li.date,
        person_id: li.person_id ?? parsed.person_id ?? null,
      }));
      const { error } = await supabase.from("expenses").insert(rows);
      if (error) {
        console.error("[saveScannedExpenses] expenses insert failed:", error);
        return {
          ok: false,
          error: "Couldn't save the expenses. Try again in a moment.",
        };
      }
    }

    revalidatePath("/");

    try {
      const seen = new Set<number>();
      for (const li of parsed.line_items) {
        if (seen.has(li.category_id)) continue;
        seen.add(li.category_id);
        await checkBudgetThreshold(user.id, li.category_id, li.date);
      }
    } catch {
      // push failures must not block save
    }

    return { ok: true, count: parsed.line_items.length };
  } catch (e) {
    const err = e as Error;
    console.error("[saveScannedExpenses] unexpected error:", err);
    const msg = err?.message || "";
    return {
      ok: false,
      error:
        msg && msg.length < 300
          ? msg
          : "Couldn't save the receipt. Try again, or use Add expense.",
    };
  }
}

// Record a scanned receipt/pay stub as a single income entry instead of as
// expense line items. Inserts directly into income_entries (mirrors the shape
// used by createIncome in actions/income.ts) so a pay stub or a receipt for
// something the user sold lands on the Income widget.
export async function saveScannedIncome(
  input: z.input<typeof SaveIncomeInput>
): Promise<SaveIncomeActionResult> {
  try {
    const { supabase, user } = await getUserOrThrow();
    const parsed = SaveIncomeInput.parse(input);

    const { error } = await supabase.from("income_entries").insert({
      user_id: user.id,
      date: parsed.date,
      amount: parsed.amount,
      description: parsed.description || null,
      source: parsed.source || "scanned",
    });
    if (error) {
      console.error("[saveScannedIncome] insert failed:", error);
      return {
        ok: false,
        error: "Couldn't save the income entry. Try again in a moment.",
      };
    }

    revalidatePath("/");
    return { ok: true, amount: parsed.amount };
  } catch (e) {
    const err = e as Error;
    console.error("[saveScannedIncome] unexpected error:", err);
    const msg = err?.message || "";
    return {
      ok: false,
      error:
        msg && msg.length < 300
          ? msg
          : "Couldn't save the income entry. Try again, or add it by hand.",
    };
  }
}
