import { z } from "zod";
import type { ScanResult } from "@/lib/types";
import { logScan, type ScanLogStatus } from "./scan-log";

const ScanSchema = z.object({
  merchant: z.string().default(""),
  date: z.string().default(""),
  subtotal: z.number().default(0),
  gst_total: z.number().default(0),
  pst_total: z.number().default(0),
  grand_total: z.number().default(0),
  // legacy field — Gemini may still return this; we'll fall back to it.
  total: z.number().default(0),
  line_items: z
    .array(
      z.object({
        description: z.string(),
        base_amount: z.number().default(0),
        gst_taxable: z.boolean().default(false),
        pst_taxable: z.boolean().default(false),
        category_name: z.string(),
        notes: z.string().default(""),
        // legacy: tax-inclusive amount Gemini used to return.
        amount: z.number().optional(),
      })
    )
    .default([]),
});

export type Provider = "gemini";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROMPT = (categoryNames: string[]) => `You are extracting line items from a retail receipt photo. Be precise — totals must match what's printed on the receipt EXACTLY.

CRITICAL ACCURACY RULES:
- The receipt prints a subtotal, tax, and grand total. Your job is to faithfully transcribe those numbers AS PRINTED. Do not recompute them.
- For each line item, return the pre-tax base price as printed on the receipt (NOT a tax-inclusive figure). Example: if the receipt shows "MILK 4L  $4.79", base_amount is 4.79 — never add the tax yourself.
- Do not "distribute" tax across line items. We handle that later. Just identify, per item, whether tax applies (gst_taxable / pst_taxable booleans).
- Walmart-style receipts often print a tax flag suffix on each line: "J", "T", "G", "Y", "TJ" → that line is GST-taxable. "P", "PST", "S" → PST-taxable. If you see a tax flag, set the corresponding boolean to true. If a line has NO tax flag and the receipt's total tax is $0 for that category, set false.
- If the receipt has subtotal + tax block at the end, all of base_amount × (gst_taxable items) should sum (approximately) to the printed taxable subtotal — use that to verify yourself before responding.

For each item physically printed on the receipt, return a JSON object:
- description: the product name as printed
- base_amount: pre-tax price as printed on this line. Use a negative number ONLY for discount/refund lines.
- gst_taxable: true if this line is subject to GST/HST
- pst_taxable: true if this line is subject to PST
- category_name: pick the BEST match from this exact list: ${JSON.stringify(categoryNames)}. If nothing fits, use "Other".
- notes: short note. Empty string if nothing notable.

Also extract receipt-level numbers exactly as printed:
- merchant: store name (e.g. "Walmart", "Costco Wholesale")
- date: receipt date in strict YYYY-MM-DD.
  CRITICAL date rules:
   - Find the date that the transaction occurred — usually printed near the top or bottom of the receipt, often labelled "Date", "Trans Date", "Date/Heure", or just appearing alongside a time stamp.
   - Receipts often print dates as "MM/DD/YYYY", "DD/MM/YYYY", "DD-MMM-YYYY", "YYYY-MM-DD", or "May 22 2024". Convert to YYYY-MM-DD.
   - If the year is 2 digits ("05/22/24"), assume 20YY.
   - For Canadian receipts, prefer DD/MM/YYYY when ambiguous.
   - DO NOT use today's date as a guess. Only fall back to today if NO date is printed at all.
   - DO NOT use a "valid until" or loyalty expiry date.
- subtotal: the printed subtotal (sum of pre-tax amounts as shown on receipt)
- gst_total: the printed GST/HST total (e.g. "GST 5.000% $3.42")
- pst_total: the printed PST/QST total (0 if not shown)
- grand_total: the receipt's printed grand total — the final number the customer paid

Output ONLY valid JSON in this exact shape:
{
  "merchant": "string",
  "date": "YYYY-MM-DD",
  "subtotal": number,
  "gst_total": number,
  "pst_total": number,
  "grand_total": number,
  "line_items": [
    {
      "description": "string",
      "base_amount": number,
      "gst_taxable": boolean,
      "pst_taxable": boolean,
      "category_name": "string",
      "notes": "string"
    }
  ]
}

No markdown, no commentary, no \`\`\` fences. Just the JSON.`;

// Gemini accepts these inline image formats. Other types (TIFF, BMP, GIF)
// must be re-encoded client-side before they reach this function.
const SUPPORTED_GEMINI_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const TIMEOUT_MS = 55_000;

export async function scanReceipt(
  imageBase64: string,
  mimeType: string,
  categoryNames: string[],
  userId: string | null = null,
  requestHash: string | null = null
): Promise<ScanResult> {
  const startedAt = Date.now();
  const bytesIn = imageBase64.length;
  let httpStatus: number | null = null;
  let logStatus: ScanLogStatus = "ok";
  let logErrorCode: string | null = null;
  let logErrorMessage: string | null = null;

  const finishLog = () => {
    void logScan({
      userId,
      status: logStatus,
      httpStatus,
      durationMs: Date.now() - startedAt,
      bytesIn,
      errorCode: logErrorCode,
      errorMessage: logErrorMessage,
      requestHash,
    });
  };

  const fail = (message: string, status: ScanLogStatus = "error"): never => {
    logStatus = status;
    logErrorMessage = message;
    finishLog();
    throw new Error(message);
  };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    logErrorCode = "no_api_key";
    fail(
      "Receipt scanning isn't configured on the server (GEMINI_API_KEY missing). Contact support."
    );
  }

  const safeMime = SUPPORTED_GEMINI_MIME.has(mimeType) ? mimeType : "image/jpeg";

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT(categoryNames) },
          { inlineData: { mimeType: safeMime, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (e) {
    if ((e as { name?: string }).name === "AbortError") {
      logErrorCode = "timeout";
      fail(
        "The receipt scan took too long (over 55 seconds). The photo may be very large or the AI service is slow — try again, or use a clearer/cropped photo.",
        "timeout"
      );
    }
    logErrorCode = "fetch_failed";
    fail(
      "Couldn't reach the receipt scanning service. Check your connection and try again."
    );
    // unreachable — fail throws
    return undefined as never;
  } finally {
    clearTimeout(timeoutId);
  }

  httpStatus = res.status;

  if (!res.ok) {
    let detail = "";
    try {
      const errBody = await res.json();
      // Gemini's error shape: { error: { code, message, status } }
      detail = errBody?.error?.message || JSON.stringify(errBody);
    } catch {
      try {
        detail = await res.text();
      } catch {
        detail = "";
      }
    }
    logErrorMessage = detail;
    logErrorCode = `http_${res.status}`;
    if (res.status === 400 && /image|inline|mime|format/i.test(detail)) {
      fail(
        "The AI couldn't read this image format. Try a JPEG or PNG photo of the receipt."
      );
    }
    if (res.status === 413) {
      fail(
        "The receipt photo is too large for the AI. Take a tighter shot of just the receipt."
      );
    }
    if (res.status === 429) {
      fail(
        "Receipt scanning is rate-limited right now. Wait a minute and try again.",
        "rate_limited"
      );
    }
    if (res.status >= 500) {
      fail("The AI service is temporarily unavailable. Try again in a moment.");
    }
    fail(
      `Receipt scan failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`
    );
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    logErrorCode = "bad_json";
    fail("The AI returned a malformed response. Try retaking the photo.");
  }
  const text = (data as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    logErrorCode = "empty_response";
    fail(
      "The AI couldn't extract any items from this photo. Make sure the receipt is in focus, well-lit, and not cut off."
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text!);
  } catch {
    const match = text!.match(/\{[\s\S]*\}/);
    if (!match) {
      logErrorCode = "no_json_in_text";
      fail(
        "The AI didn't return structured data for this receipt. Try a clearer photo."
      );
    }
    try {
      parsed = JSON.parse(match![0]);
    } catch {
      logErrorCode = "parse_failed";
      fail(
        "Couldn't parse the receipt data. Try a clearer photo or retake."
      );
    }
  }

  let result;
  try {
    result = ScanSchema.parse(parsed);
  } catch {
    logErrorCode = "schema_mismatch";
    fail(
      "The AI's response didn't match the expected receipt format. Try a clearer photo of the full receipt."
    );
  }
  // Receipt date policy: ALWAYS use today (the scan day), never the date
  // printed on the receipt. Gemini misreads dates often enough (faint
  // ink, ambiguous formats like 5/26/13, locale differences) that
  // trusting the printed date causes more pain than it's worth. The
  // scan-review UI shows a big, obvious "Edit date" control so the user
  // can override per-receipt if they're logging an older purchase.
  // The client overrides this again with the user's local-tz date so
  // a server in UTC doesn't push midnight scans into the next day.
  result!.date = new Date().toISOString().slice(0, 10);

  // Back-compat: if Gemini returned `total` but not `grand_total`, copy it.
  if (!result!.grand_total && result!.total) {
    result!.grand_total = result!.total;
  }
  if (!result!.total && result!.grand_total) {
    result!.total = result!.grand_total;
  }

  // Back-compat for line items: if base_amount is 0 but legacy `amount`
  // was returned, treat that as the line amount and zero out tax flags
  // (we won't be able to distinguish, but at least sums work).
  result!.line_items = result!.line_items.map((li) => ({
    ...li,
    base_amount:
      li.base_amount > 0 || li.base_amount < 0
        ? li.base_amount
        : li.amount ?? 0,
  }));

  finishLog();
  return result!;
}
