#!/usr/bin/env node
// Supabase migration runner.
//
// Applies every SQL file in supabase/migrations/ that hasn't been applied
// yet, tracked in a `schema_migrations` table. Idempotent: safe to run
// repeatedly. Designed so Claude (or a CI job) can apply DB changes with a
// single command and zero manual dashboard clicks.
//
// Credentials (put ONE of these in .env.local):
//   SUPABASE_ACCESS_TOKEN=sbp_...     ← preferred. A Supabase personal access
//        token (https://supabase.com/dashboard/account/tokens). Runs SQL via
//        the Management API. No extra npm deps, no DB password needed.
//   SUPABASE_DB_URL=postgresql://...  ← fallback. A direct Postgres connection
//        string (Project Settings → Database → Connection string → URI).
//        Requires the `pg` package (npm i pg).
//
// Usage:
//   node scripts/db-migrate.mjs            # apply all pending migrations
//   node scripts/db-migrate.mjs --status   # list applied vs pending, apply nothing
//   node scripts/db-migrate.mjs --file supabase/migrations/x.sql   # one file

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");

// ---- tiny .env.local loader (no dependency) --------------------------------
function loadEnvLocal() {
  const envPath = path.join(ROOT, ".env.local");
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnvLocal();

// ---- args ------------------------------------------------------------------
const args = process.argv.slice(2);
const STATUS_ONLY = args.includes("--status");
const fileIdx = args.indexOf("--file");
const ONE_FILE = fileIdx !== -1 ? args[fileIdx + 1] : null;

// ---- resolve project ref + executor ---------------------------------------
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const refMatch = SUPA_URL.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
const REF = refMatch ? refMatch[1] : null;
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || "";
const DB_URL = process.env.SUPABASE_DB_URL || "";

function fail(msg) {
  console.error("\n✖ " + msg + "\n");
  process.exit(1);
}

async function makeExecutor() {
  // Preferred: Management API with a personal access token.
  if (ACCESS_TOKEN) {
    if (!REF) fail("Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL.");
    const endpoint = `https://api.supabase.com/v1/projects/${REF}/database/query`;
    return {
      kind: "management-api",
      async query(sql) {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query: sql }),
        });
        const text = await res.text();
        if (!res.ok) {
          throw new Error(`Management API ${res.status}: ${text}`);
        }
        try {
          return JSON.parse(text);
        } catch {
          return [];
        }
      },
      async close() {},
    };
  }

  // Fallback: direct Postgres connection.
  if (DB_URL) {
    let pg;
    try {
      pg = await import("pg");
    } catch {
      fail(
        "SUPABASE_DB_URL is set but the `pg` package isn't installed. Run: npm i pg"
      );
    }
    const client = new pg.default.Client({
      connectionString: DB_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    return {
      kind: "postgres",
      async query(sql) {
        const r = await client.query(sql);
        return r.rows ?? [];
      },
      async close() {
        await client.end();
      },
    };
  }

  fail(
    [
      "No database credential found. Add ONE of these to .env.local, then re-run:",
      "",
      "  SUPABASE_ACCESS_TOKEN=sbp_xxx   (recommended — get it at",
      "                                   https://supabase.com/dashboard/account/tokens)",
      "  SUPABASE_DB_URL=postgresql://postgres:PASSWORD@HOST:5432/postgres",
      "                                  (Project Settings → Database → Connection string)",
    ].join("\n")
  );
}

// ---- migration files -------------------------------------------------------
function listMigrations() {
  if (!existsSync(MIGRATIONS_DIR)) fail("No supabase/migrations directory.");
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

async function main() {
  const exec = await makeExecutor();
  console.log(`• Connected via ${exec.kind} (project ${REF ?? "?"})`);

  // Ensure tracking table.
  await exec.query(
    `create table if not exists public.schema_migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     );`
  );

  const appliedRows = await exec.query(
    `select name from public.schema_migrations;`
  );
  const applied = new Set((appliedRows || []).map((r) => r.name));

  let files = listMigrations();
  if (ONE_FILE) {
    const base = path.basename(ONE_FILE);
    files = files.filter((f) => f === base);
    if (files.length === 0) fail(`Migration not found: ${ONE_FILE}`);
  }

  const pending = files.filter((f) => !applied.has(f));

  console.log(`• ${files.length} migration file(s), ${pending.length} pending`);
  for (const f of files) {
    console.log(`   ${applied.has(f) ? "✓ applied " : "… pending "} ${f}`);
  }

  if (STATUS_ONLY) {
    await exec.close();
    return;
  }

  if (pending.length === 0) {
    console.log("\n✔ Database already up to date.");
    await exec.close();
    return;
  }

  for (const f of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, f), "utf8");
    process.stdout.write(`→ applying ${f} … `);
    try {
      await exec.query(sql);
      await exec.query(
        `insert into public.schema_migrations (name) values ($tag$${f}$tag$)
         on conflict (name) do nothing;`
      );
      console.log("done");
    } catch (e) {
      console.log("FAILED");
      console.error(`\n✖ ${f} failed:\n${e.message}\n`);
      await exec.close();
      process.exit(1);
    }
  }

  console.log(`\n✔ Applied ${pending.length} migration(s).`);
  await exec.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
