import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ScanClient from "@/components/ScanClient";
import { listPeople } from "@/app/actions/people";

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

  const [{ data: categories = [] }, people] = await Promise.all([
    supabase
      .from("categories")
      .select("*")
      .eq("user_id", user.id)
      .order("name"),
    listPeople().catch(() => []),
  ]);

  return <ScanClient categories={categories ?? []} people={people} />;
}
