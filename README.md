# Family Budget

A private, multi-user family budget tracker with receipt scanning. Self-hosted on Vercel with Supabase + Google Gemini Flash.

- **Frontend**: Next.js 15 App Router + Tailwind
- **Auth + DB**: Supabase (Postgres + Row Level Security)
- **Receipt OCR**: Google Gemini 2.0 Flash (free tier)
- **Hosting**: Vercel

Each user signs up with email/password and gets a fully isolated budget. RLS at the database layer enforces that no user can read or write another user's data.

## Local development

```bash
# 1. Install deps
npm install

# 2. Copy env template, fill in from your Supabase project + Google AI Studio
cp .env.local.example .env.local

# 3. Run the SQL schema in your Supabase SQL editor (one-time)
#    File: supabase/schema.sql

# 4. Start the dev server
npm run dev
```

Then visit http://localhost:3000, sign up, and you're in.

## Required env vars

Set these in `.env.local` for dev and in Vercel project settings for prod:

| Var | Where it comes from |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project → Settings → API → `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project → Settings → API → `service_role` key (server-only, never expose) |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey |

## First run for a new user

1. Sign up (email + password). Supabase emails a confirmation link — click it.
2. Log in.
3. Settings → Upload CSV → drop in any `family-budget-YYYY-MM.csv` exports from the old Manus app to seed your history.
4. Start tracking. Use the **📷 Scan** button to extract line items from a receipt photo.

## Deploying to Vercel

```bash
vercel link
vercel env pull   # pull existing or set them in the dashboard
vercel --prod
```

Add the env vars in the Vercel dashboard (Settings → Environment Variables) before the first prod build.

## How sharing with family works

Same URL for everyone. Each family member signs up with their own email; their data is isolated by `auth.uid()` in every RLS policy. Tell them:

> "Go to https://&lt;your-domain&gt;, click Sign Up, use your own email and password, check your inbox for a confirmation link. Your budget is private."

## Receipt scan — how it works

1. User uploads / snaps a receipt photo.
2. Image is POSTed to a Server Action with the user's category list.
3. Server calls Gemini 2.0 Flash with a structured prompt asking for one JSON object per line item.
4. Image is discarded (never persisted).
5. UI shows the extracted line items for review/edit.
6. On save: a `receipt_batches` row + N `expenses` rows are inserted in one transaction, all under `auth.uid()`.

If Gemini's free tier ever changes, swap providers by editing `src/lib/ai/vision.ts` only.

## Schema

See `supabase/schema.sql`. Six tables:

- `profiles` — 1:1 with `auth.users`
- `categories` — defaults (user_id null) + per-user clones
- `receipt_batches` — one row per scan, no image stored
- `expenses` — line items, optionally linked to a `receipt_batch`
- `fixed_costs` — recurring items
- `budgets` — per-month per-category limits

RLS is enabled on every table.

## License

Private use.
