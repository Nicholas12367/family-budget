"use server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { getUserOrThrow } from "./auth";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createServiceClient(url, key, { auth: { persistSession: false } });
}

export type ScanUploadStep =
  | "change_fired"
  | "change_empty"
  | "compress_start"
  | "compress_done"
  | "compress_error"
  | "upload_start"
  | "upload_ok"
  | "upload_error";

export async function logScanUploadStep(input: {
  step: ScanUploadStep;
  user_agent?: string;
  device_hint?: string;
  file_name?: string;
  file_type?: string;
  file_size_bytes?: number;
  detail?: string;
}) {
  // Don't fail the user's flow if logging breaks. All failures swallowed.
  try {
    const { user } = await getUserOrThrow();
    const svc = serviceClient();
    if (!svc) return { ok: false };
    await svc.from("scan_upload_log").insert({
      user_id: user.id,
      step: input.step,
      user_agent: input.user_agent?.slice(0, 500) ?? null,
      device_hint: input.device_hint?.slice(0, 60) ?? null,
      file_name: input.file_name?.slice(0, 200) ?? null,
      file_type: input.file_type?.slice(0, 80) ?? null,
      file_size_bytes: input.file_size_bytes ?? null,
      detail: input.detail?.slice(0, 1000) ?? null,
    });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
