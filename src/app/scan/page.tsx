import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import ScanClient from "@/components/ScanClient";

export const dynamic = "force-dynamic";

export default async function ScanPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: categories = [] } = await supabase
    .from("categories")
    .select("*")
    .eq("user_id", user.id)
    .order("name");

  return <ScanClient categories={categories ?? []} />;
}
