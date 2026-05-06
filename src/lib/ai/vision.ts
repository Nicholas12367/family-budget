import { z } from "zod";
import type { ScanResult } from "@/lib/types";

const ScanSchema = z.object({
  merchant: z.string().default(""),
  date: z.string().default(""),
  total: z.number().default(0),
  line_items: z
    .array(
      z.object({
        description: z.string(),
        amount: z.number(),
        category_name: z.string(),
        notes: z.string().default(""),
      })
    )
    .default([]),
});

export type Provider = "gemini";

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const PROMPT = (categoryNames: string[]) => `You are extracting line items from a retail receipt photo. Be precise — the user pays GST/PST so taxes must NOT be skipped.

For each item physically printed on the receipt, return a JSON object with:
- description: the product name as printed
- amount: the FINAL amount the customer paid for that line, INCLUDING any per-item or proportional GST/PST/HST that applies. If the receipt prints subtotals + a tax block at the end, distribute the tax proportionally across the taxable items so each item's "amount" reflects what was actually charged. Use a negative number ONLY for discount/refund lines.
- category_name: pick the BEST match from this exact list: ${JSON.stringify(categoryNames)}. If nothing fits, use "Other".
- notes: short note. ALWAYS append the tax breakdown if any tax was charged on the line, in the format "(incl. GST $X.XX)" or "(incl. GST $X.XX + PST $Y.YY)". Use "" only if the line is truly tax-free.

Also extract:
- merchant: store name (e.g. "Costco Wholesale")
- date: the PURCHASE date that is printed on the receipt, in strict YYYY-MM-DD format.
  CRITICAL date rules:
   - Find the date that the transaction occurred — usually printed near the top or bottom of the receipt, often labelled "Date", "Trans Date", "Date/Heure", or just appearing alongside a time stamp.
   - Receipts often print dates in formats like "MM/DD/YYYY", "DD/MM/YYYY", "DD-MMM-YYYY", "YYYY-MM-DD", or "Mar 14 2026". Convert to YYYY-MM-DD.
   - If the year is shown as 2 digits (e.g. "03/14/26"), assume 20YY.
   - If both DD/MM and MM/DD are ambiguous, prefer the interpretation where the day ≤ 31 and the month ≤ 12. For Canadian receipts, prefer DD/MM/YYYY when both are valid.
   - DO NOT use today's date as a guess. Only fall back to today's date if NO date is printed on the receipt at all.
   - DO NOT use the loyalty/points expiry date or "valid until" date. Use the actual purchase date.
- total: the receipt grand total — the final number the customer paid, taxes included.

Sanity check: the sum of line item amounts should be close to the grand total (off by at most a few cents from rounding). If they aren't, redistribute tax until they do.

Output ONLY valid JSON in this exact shape:
{
  "merchant": "string",
  "date": "YYYY-MM-DD",
  "total": number,
  "line_items": [
    { "description": "string", "amount": number, "category_name": "string", "notes": "string" }
  ]
}

No markdown, no commentary, no \`\`\` fences. Just the JSON.`;

export async function scanReceipt(
  imageBase64: string,
  mimeType: string,
  categoryNames: string[]
): Promise<ScanResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: PROMPT(categoryNames) },
          { inlineData: { mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  };

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini did not return JSON");
    parsed = JSON.parse(match[0]);
  }

  const result = ScanSchema.parse(parsed);
  if (!result.date || !/^\d{4}-\d{2}-\d{2}$/.test(result.date)) {
    result.date = new Date().toISOString().slice(0, 10);
  }
  return result;
}
