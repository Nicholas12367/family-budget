import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ScanClient from "@/components/ScanClient";
import { listPeople } from "@/app/actions/people";
import type { Category, Person } from "@/lib/types";

export const dynamic = "force-dynamic";
// Receipt OCR can take 20–40s on long receipts; the default 10s server
// action timeout chops it off mid-flight and gives the user a confusing
// generic error.
export const maxDuration = 60;

export default async function ScanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Defensive defaults: a transient Supabase failure here used to bubble
  // up as the generic "An error occurred in the Server Components render"
  // message inside the scan page. The user can still scan with an empty
  // category list (we'll fall back to "Other"), so don't gate the route
  // on these queries succeeding.
  let categories: Category[] = [];
  let people: Person[] = [];
  try {
    const [catRes, peopleRes] = await Promise.all([
      supabase
        .from("categories")
        .select("*")
        .eq("user_id", user.id)
        .order("name"),
      listPeople().catch(() => [] as Person[]),
    ]);
    categories = (catRes.data ?? []) as Category[];
    people = peopleRes;
  } catch (e) {
    console.error("[/scan] data fetch failed, rendering with empty lists:", e);
  }

  return <ScanClient categories={categories} people={people} />;
}
