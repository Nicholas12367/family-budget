// Authoritative RLS audit — uses the Supabase Management API (pg-meta)
// to list every table in the public schema, whether RLS is enabled, and
// how many policies each has. Also runs any SQL you paste in.
// Run: node scripts/rls-audit.mjs
// Or:  node scripts/rls-audit.mjs "select 1"
import { config } from "dotenv";

config({ path: ".env.local" });

const projectRef = "pgsrwzqflfjweewdcdsq";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("Missing SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(1);
}

async function runSql(query) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL API ${res.status}: ${text}`);
  return JSON.parse(text);
}

const arg = process.argv[2];
if (arg) {
  console.log(JSON.stringify(await runSql(arg), null, 2));
  process.exit(0);
}

const tables = await runSql(`
  select
    c.relname                        as table_name,
    c.relrowsecurity                 as rls_enabled,
    c.relforcerowsecurity            as rls_forced,
    coalesce(p.n_policies, 0)        as policy_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join (
    select schemaname, tablename, count(*) as n_policies
    from pg_policies
    group by 1, 2
  ) p on p.schemaname = n.nspname and p.tablename = c.relname
  where n.nspname = 'public' and c.relkind = 'r'
  order by rls_enabled asc, policy_count asc, table_name;
`);

console.log("\n== Public schema RLS status ==\n");
console.log("RLS  Policies  Table");
console.log("---  --------  -----");
const broken = [];
for (const row of tables) {
  const rls = row.rls_enabled ? " ✓ " : " ✗ ";
  const pols = String(row.policy_count).padStart(4);
  console.log(`${rls}     ${pols}    ${row.table_name}`);
  if (!row.rls_enabled) broken.push(row.table_name);
  else if (row.policy_count === 0) broken.push(`${row.table_name} (RLS on but 0 policies)`);
}

console.log("\nTables needing attention: " + (broken.length ? broken.join(", ") : "none"));
