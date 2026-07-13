// Production scan health check.
//
// Queries the gemini_scan_log table for the recent window and decides whether
// REAL users are failing to scan right now — as opposed to expected,
// non-actionable outcomes (hitting a daily cap, duplicate double-taps). If a
// genuine spike is detected it writes a human-readable report to
// scan-health-report.md and emits `alert=true` on GitHub Actions outputs, so
// the workflow can open an issue that pings a human/agent to fix it.
//
// Run locally:  node scripts/scan-health-check.mjs
// In CI:        env SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/scan-health-check.mjs
//
// Tunables (all optional env vars):
//   SCAN_HEALTH_WINDOW_MIN   default 30   — minutes of history to inspect
//   SCAN_HEALTH_MIN_ATTEMPTS default 8    — don't alert on tiny samples
//   SCAN_HEALTH_RATE         default 0.25 — failure-rate alert threshold
//   SCAN_HEALTH_MIN_FAILS    default 5    — absolute failure count that alerts
//                                            regardless of rate
import { writeFileSync, appendFileSync } from "node:fs";

// Best-effort load of .env.local for local runs; harmless/no-op in CI.
try {
  const { config } = await import("dotenv");
  config({ path: ".env.local" });
} catch {
  // dotenv not installed (prod) — rely on real env vars.
}

const url =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "Missing SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY."
  );
  process.exit(1);
}

const WINDOW_MIN = Number(process.env.SCAN_HEALTH_WINDOW_MIN || 30);
const MIN_ATTEMPTS = Number(process.env.SCAN_HEALTH_MIN_ATTEMPTS || 8);
const RATE = Number(process.env.SCAN_HEALTH_RATE || 0.25);
const MIN_FAILS = Number(process.env.SCAN_HEALTH_MIN_FAILS || 5);

// Statuses that actually reached the scanner (Gemini). Capped/duplicate
// attempts never ran, so they belong in neither numerator nor denominator.
const REACHED = new Set(["ok", "error", "timeout", "rate_limited"]);
// Of those, the ones a code fix can plausibly address.
const ACTIONABLE_FAIL = new Set(["error", "timeout"]);

const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000).toISOString();

// Query PostgREST directly with fetch instead of the supabase-js client:
// supabase-js eagerly initializes a realtime client that needs a native
// WebSocket, which Node < 22 lacks — that crashed this job on the CI runner.
// A plain REST GET has no such dependency and works on any Node version.
const restBase = url.replace(/\/$/, "");
const params = new URLSearchParams({
  select: "status,http_status,error_code,error_message,duration_ms,created_at",
  created_at: `gte.${since}`,
  order: "created_at.desc",
  limit: "5000",
});
const res = await fetch(`${restBase}/rest/v1/gemini_scan_log?${params}`, {
  headers: { apikey: key, Authorization: `Bearer ${key}` },
});
if (!res.ok) {
  console.error(
    `gemini_scan_log query failed: HTTP ${res.status} — ${await res.text()}`
  );
  process.exit(1);
}

const rows = (await res.json()) ?? [];
const reached = rows.filter((r) => REACHED.has(r.status));
const fails = reached.filter((r) => ACTIONABLE_FAIL.has(r.status));
const denom = reached.length;
const failCount = fails.length;
const failRate = denom ? failCount / denom : 0;

function tally(list, k) {
  const m = new Map();
  for (const r of list) m.set(r[k] ?? "(null)", (m.get(r[k] ?? "(null)") ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const byCode = tally(fails, "error_code");
const byHttp = tally(fails.filter((r) => r.http_status != null), "http_status");

const alert =
  denom >= MIN_ATTEMPTS && (failRate >= RATE || failCount >= MIN_FAILS);

const pct = (n, d) => (d ? ((n / d) * 100).toFixed(1) : "0.0") + "%";

// Console summary (shows up in the Actions log either way).
console.log(`Window: last ${WINDOW_MIN}m  |  reached scanner: ${denom}`);
console.log(`Actionable failures: ${failCount} (${pct(failCount, denom)})`);
console.log(`By error_code: ${byCode.map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`);
console.log(`ALERT: ${alert}`);

// Build a report a fixer can act on directly.
const lines = [];
lines.push(`## 🚨 Receipt scan failures detected`);
lines.push("");
lines.push(`Real users are failing to scan receipts right now.`);
lines.push("");
lines.push(`- **Window:** last ${WINDOW_MIN} minutes`);
lines.push(`- **Scans that reached the scanner:** ${denom}`);
lines.push(`- **Actionable failures:** ${failCount} (${pct(failCount, denom)})`);
lines.push(`- **Thresholds:** rate ≥ ${(RATE * 100).toFixed(0)}% or ≥ ${MIN_FAILS} failures, min ${MIN_ATTEMPTS} attempts`);
lines.push("");
lines.push(`### Failures by error_code`);
lines.push("");
lines.push("| error_code | count | share of failures |");
lines.push("| --- | ---: | ---: |");
for (const [k, v] of byCode) lines.push(`| \`${k}\` | ${v} | ${pct(v, failCount)} |`);
if (byHttp.length) {
  lines.push("");
  lines.push(`### Failures by HTTP status`);
  lines.push("");
  for (const [k, v] of byHttp) lines.push(`- \`${k}\`: ${v}`);
}
lines.push("");
lines.push(`### Sample failure messages`);
lines.push("");
const seen = new Set();
for (const r of fails) {
  if (seen.has(r.error_code)) continue;
  seen.add(r.error_code);
  const msg = (r.error_message ?? "").slice(0, 200).replace(/\s+/g, " ");
  lines.push(`- **\`${r.error_code ?? "?"}\`** — ${msg || "(no message)"}`);
  if (seen.size >= 8) break;
}
lines.push("");
lines.push(`### Where to look`);
lines.push("");
lines.push(`- \`src/lib/ai/vision.ts\` — Gemini call, timeouts, JSON parsing/repair`);
lines.push(`- \`src/app/actions/scan.ts\` — upload limits, pre-checks, error mapping`);
lines.push(`- \`src/lib/image.ts\` — client-side compression`);
lines.push(`- Re-run \`node scripts/scan-failure-report.mjs\` for the full 7/30-day picture.`);
lines.push("");
lines.push(`_Generated by scan-health-check.mjs at ${new Date().toISOString()}._`);

const report = lines.join("\n");
writeFileSync("scan-health-report.md", report);

// Emit outputs for the workflow.
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `alert=${alert}\n`);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `summary=${failCount} scan failures (${pct(failCount, denom)}) in last ${WINDOW_MIN}m\n`
  );
}

// Always exit 0 — a detected spike is a normal, expected outcome the workflow
// branches on via the `alert` output, not a script error.
process.exit(0);
