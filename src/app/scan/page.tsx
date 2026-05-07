import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ScanClient from "@/components/ScanClient";
import { listPeople } from "@/app/actions/people";

export const dynamic = "force-dynamic";

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
