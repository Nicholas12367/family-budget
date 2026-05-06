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
  line_items: z.array(
    z.object({
      description: z.string(),
      amount: z.coerce.number(),
      category_id: z.coerce.number().int().positive(),
      notes: z.string().default(""),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
  ),
});

// Step 1 — extract line items from a receipt image. No DB writes.
export async function scanReceiptAction(formData: FormData): Promise<ScanResult> {
  const { supabase, user } = await getUserOrThrow();
  const file = formData.get("image");
  if (!(file instanceof File)) throw new Error("No image uploaded");
  if (file.size > 10 * 1024 * 1024) throw new Error("Image too large (max 10MB)");

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

  const { data: cats } = await supabase
    .from("categories")
    .select("name")
    .eq("user_id", user.id);
  const categoryNames = (cats ?? []).map((c) => c.name);

  return scanReceipt(base64, file.type || "image/jpeg", categoryNames);
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
