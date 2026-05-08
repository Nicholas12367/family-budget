"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getUserOrThrow } from "./auth";
import { scanReceipt } from "@/lib/ai/vision";
import { checkBudgetThreshold, sendToUser } from "@/lib/push";
import type { ScanResult } from "@/lib/types";

const fmt = (n: number) =>
  "$" + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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

// Sniff a sensible MIME type. Phones (especially iOS) sometimes hand
// back files with an empty `type`, so we fall back to the extension.
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

// Step 1 — extract line items from a receipt image. No DB writes.
export async function scanReceiptAction(formData: FormData): Promise<ScanResult> {
  const { supabase, user } = await getUserOrThrow();
  const file = formData.get("image");
  if (!(file instanceof File)) {
    throw new Error("No image was attached. Try picking the photo again.");
  }
  if (file.size === 0) {
    throw new Error("That image came through empty. Try picking the photo again.");
  }
  if (file.size > 8 * 1024 * 1024) {
    throw new Error(
      `That photo is ${(file.size / (1024 * 1024)).toFixed(1)} MB, which is too large to upload. Try retaking the photo (we auto-shrink, but the original was over the 8 MB limit).`
    );
  }

  const mimeType = detectMimeType(file);
  if (!mimeType.startsWith("image/")) {
    throw new Error("That file isn't an image. Pick a JPEG, PNG, or HEIC photo.");
  }

  let base64: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    base64 = buf.toString("base64");
  } catch {
    throw new Error("Couldn't read the uploaded image. Try picking the photo again.");
  }

  const { data: cats } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", user.id);
  const categoryNames = (cats ?? []).map((c) => c.name);

  return scanReceipt(base64, mimeType, categoryNames);
}

// Step 2 — save reviewed line items into expenses + a receipt_batch.
export async function saveScannedExpenses(input: z.input<typeof SaveInput>) {
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
  if (bErr) throw bErr;

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
    if (error) throw error;
  }

  revalidatePath("/");

  try {
    const total = parsed.line_items.reduce((s, li) => s + li.amount, 0);
    await sendToUser(user.id, {
      title: parsed.merchant
        ? `Receipt saved: ${parsed.merchant}`
        : "Receipt saved",
      body: `${parsed.line_items.length} item${
        parsed.line_items.length === 1 ? "" : "s"
      } • ${fmt(total)}`,
      url: "/",
    });
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
}
