import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listMyMessages } from "@/app/actions/messages";
import InboxClient from "@/components/InboxClient";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const messages = await listMyMessages().catch(() => []);

  return <InboxClient initialMessages={messages} />;
}
