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
    .or(`user_id.eq.${user.id},user_id.is.null`)
    .order("name");

  return <ScanClient categories={categories ?? []} />;
}
