// Diagnostic: pull recent scan-log data and break it down by status,
// error_code, and device hint so we can see what's actually failing.
// Run with: node scripts/scan-failure-report.mjs
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const svc = createClient(url, key, { auth: { persistSession: false } });

function pct(n, d) {
  if (!d) return "0%";
  return ((n / d) * 100).toFixed(1) + "%";
}

function tally(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = r[key] ?? "(null)";
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return [...out.entries()].sort((a, b) => b[1] - a[1]);
}

async function report(windowDays, label) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data: logs, error: logErr } = await svc
    .from("gemini_scan_log")
    .select("status, http_status, error_code, error_message, duration_ms, bytes_in, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (logErr) {
    console.error("gemini_scan_log query failed:", logErr.message);
    return;
  }
  const rows = logs ?? [];
  const total = rows.length;
  const ok = rows.filter((r) => r.status === "ok").length;
  const failed = total - ok;

  console.log("\n==================== " + label + " (" + windowDays + "d) ====================");
  console.log("Total scan attempts: " + total);
  console.log("OK:                  " + ok + "  (" + pct(ok, total) + ")");
  console.log("FAILED:              " + failed + "  (" + pct(failed, total) + ")");

  console.log("\nBy status:");
  for (const [k, v] of tally(rows, "status")) {
    console.log("  " + String(k).padEnd(22) + " " + String(v).padStart(5) + "  " + pct(v, total));
  }

  console.log("\nBy error_code (failures only):");
  const fails = rows.filter((r) => r.status !== "ok");
  for (const [k, v] of tally(fails, "error_code")) {
    console.log("  " + String(k).padEnd(22) + " " + String(v).padStart(5) + "  " + pct(v, failed));
  }

  console.log("\nBy http_status (where set):");
  for (const [k, v] of tally(rows.filter((r) => r.http_status != null), "http_status")) {
    console.log("  " + String(k).padEnd(22) + " " + String(v).padStart(5));
  }

  // Sample 10 most recent failure messages, grouped by code.
  console.log("\nRecent failure samples:");
  const seenCode = new Set();
  for (const r of fails.slice(0, 80)) {
    if (seenCode.has(r.error_code)) continue;
    seenCode.add(r.error_code);
    const msg = (r.error_message ?? "").slice(0, 180).replace(/\s+/g, " ");
    console.log("  [" + (r.error_code ?? "?") + "] " + msg);
    if (seenCode.size >= 8) break;
  }

  // Latency / size distribution for OK scans.
  const okRows = rows.filter((r) => r.status === "ok" && r.duration_ms);
  if (okRows.length) {
    const ds = okRows.map((r) => r.duration_ms).sort((a, b) => a - b);
    const p = (q) => ds[Math.min(ds.length - 1, Math.floor(ds.length * q))];
    console.log("\nLatency (OK scans, ms): p50=" + p(0.5) + "  p90=" + p(0.9) + "  p99=" + p(0.99));
  }
}

async function uploadDiag(windowDays, label) {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows, error } = await svc
    .from("scan_upload_log")
    .select("step, device_hint, file_type, file_size_bytes, detail, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) {
    console.log("\n(scan_upload_log not available: " + error.message + ")");
    return;
  }
  const all = rows ?? [];
  console.log("\n-------- Upload-side diagnostics " + label + " (" + windowDays + "d) --------");
  console.log("Total client-side upload events: " + all.length);

  console.log("\nBy device_hint:");
  for (const [k, v] of tally(all, "device_hint")) {
    console.log("  " + String(k).padEnd(22) + " " + String(v).padStart(5));
  }

  const errors = all.filter((r) => r.step === "upload_error" || r.step === "compress_error" || r.step === "change_empty");
  console.log("\nClient-side error steps (" + errors.length + " events):");
  for (const [k, v] of tally(errors, "step")) {
    console.log("  " + String(k).padEnd(22) + " " + String(v).padStart(5));
  }

  console.log("\nDevice × error breakdown:");
  const dxe = new Map();
  for (const r of errors) {
    const k = (r.device_hint ?? "?") + " | " + r.step;
    dxe.set(k, (dxe.get(k) ?? 0) + 1);
  }
  for (const [k, v] of [...dxe.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20)) {
    console.log("  " + String(k).padEnd(40) + " " + String(v).padStart(4));
  }

  console.log("\nRecent error details:");
  for (const r of errors.slice(0, 8)) {
    console.log("  [" + r.device_hint + " " + r.step + "] " + (r.detail ?? "").slice(0, 200));
  }
}

await report(7, "Last 7 days");
await report(30, "Last 30 days");
await uploadDiag(7, "Last 7 days");
await uploadDiag(30, "Last 30 days");
