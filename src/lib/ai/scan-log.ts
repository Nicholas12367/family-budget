import "server-only";
import { createHash } from "node:crypto";
import { createClient as createServiceClient } from "@supabase/supabase-js";

export type ScanLogStatus =
  | "ok"
  | "error"
  | "rate_limited"
  | "timeout"
  | "blocked_by_cap"
  | "blocked_by_user_cap"
  | "duplicate_blocked";

// Per-user daily scan cap. Protects the shared Gemini quota from a single
// runaway user and caps cost exposure. At ~$0.001/scan, 100/day = $3/mo
// worst case per heavy user vs $4 sub revenue (still healthy margin).
export const PER_USER_DAILY_SCAN_CAP = 100;

// Window in seconds during which an identical image hash is treated as a
// duplicate retry. Catches accidental double-tap submits.
export const DUPLICATE_WINDOW_SECONDS = 60;

export function hashImageBase64(base64: string): string {
  // First 16 bytes of SHA-256, hex-encoded — 32 hex chars. Plenty for
  // collision avoidance within a 60-second window per user.
  return createHash("sha256").update(base64).digest("hex").slice(0, 32);
}

export type ScanLogInput = {
  userId: string | null;
  status: ScanLogStatus;
  httpStatus?: number | null;
  durationMs?: number | null;
  bytesIn?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  requestHash?: string | null;
};

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export async function logScan(row: ScanLogInput): Promise<void> {
  const client = serviceClient();
  if (!client) return;
  try {
    await client.from("gemini_scan_log").insert({
      user_id: row.userId,
      status: row.status,
      http_status: row.httpStatus ?? null,
      duration_ms: row.durationMs ?? null,
      bytes_in: row.bytesIn ?? null,
      error_code: row.errorCode ?? null,
      error_message: row.errorMessage
        ? row.errorMessage.slice(0, 500)
        : null,
      request_hash: row.requestHash ?? null,
    });
  } catch (e) {
    // Never let logging break a scan. Surface to server logs only.
    console.error("[scan-log] insert failed:", e);
  }
}

// Counts scans in the last 24h. Used by the soft daily cap.
export async function scansInLast24h(): Promise<number> {
  const client = serviceClient();
  if (!client) return 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await client
    .from("gemini_scan_log")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since)
    // Only count attempts that actually hit Gemini — blocked attempts
    // shouldn't keep blocking us once they're logged.
    .in("status", ["ok", "error", "rate_limited", "timeout"]);
  return count ?? 0;
}

// Counts scans in the last 24h for ONE user. Used by the per-user cap.
export async function userScansInLast24h(userId: string): Promise<number> {
  const client = serviceClient();
  if (!client || !userId) return 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await client
    .from("gemini_scan_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", since)
    .in("status", ["ok", "error", "rate_limited", "timeout"]);
  return count ?? 0;
}

// True if THIS user has submitted the same image hash within the dedup
// window. Returns false if the table or column doesn't exist yet (so the
// migration not having run can't break scanning).
export async function isDuplicateScan(
  userId: string,
  requestHash: string
): Promise<boolean> {
  const client = serviceClient();
  if (!client || !userId || !requestHash) return false;
  const since = new Date(
    Date.now() - DUPLICATE_WINDOW_SECONDS * 1000
  ).toISOString();
  const { data, error } = await client
    .from("gemini_scan_log")
    .select("id")
    .eq("user_id", userId)
    .eq("request_hash", requestHash)
    .gte("created_at", since)
    .limit(1);
  if (error) return false;
  return (data?.length ?? 0) > 0;
}

// Soft cap. Google's free tier is 1500/day per project. We block at 1400 to
// leave headroom for retries and concurrent requests we haven't accounted for.
export const SOFT_DAILY_SCAN_CAP = 1400;
