"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { fmt } from "@/lib/money";
import { compressImage, ImageProcessingError } from "@/lib/image";
import type { Category, Person, ScanResult } from "@/lib/types";
import { isFutureDate, todayLocalISO } from "@/lib/rollover";
import {
  saveScannedExpenses,
  saveScannedIncome,
  scanReceiptAction,
} from "@/app/actions/scan";
import { logScanUploadStep } from "@/app/actions/scan-diag";
import CategoryPicker from "./CategoryPicker";
import PersonSelector from "./PersonSelector";
import CameraCapture from "./CameraCapture";
import { IconArrowLeft, IconCamera } from "./Icon";

// How many times a single photo is retried automatically before we surface an
// error and offer a manual retry. Generous so a flaky network or a slow AI
// call resolves itself, but bounded so a genuinely unreadable photo can't burn
// through the daily scan cap in a loop.
const MAX_AUTO_ATTEMPTS = 5;

// --- Mobile diagnostics helpers ---
// Samsung Internet, older Android WebKit, and various Chrome forks all have
// known quirks where <input type="file" capture> fires `change` with an
// empty FileList, or with a File whose `type` and `name` are blank. We log
// every step to scan_upload_log so we can diagnose silent failures.

function deviceHint() {
  if (typeof navigator === "undefined") return "Other";
  const ua = navigator.userAgent;
  if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
  if (/Pixel/i.test(ua)) return "Pixel";
  if (/SM-/i.test(ua) || /Samsung/i.test(ua)) return "Samsung";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Macintosh/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows";
  return "Other";
}

function userAgent() {
  return typeof navigator !== "undefined" ? navigator.userAgent : "";
}

// Wrapper that logs but never throws.
async function diag(
  step: Parameters<typeof logScanUploadStep>[0]["step"],
  extra?: Partial<Parameters<typeof logScanUploadStep>[0]>
) {
  try {
    await logScanUploadStep({
      step,
      user_agent: userAgent(),
      device_hint: deviceHint(),
      ...extra,
    });
  } catch {
    // ignored
  }
}

type LineDraft = {
  description: string;
  base_amount: number;
  amount: number; // base + share of receipt-level tax
  gst_share: number;
  pst_share: number;
  gst_taxable: boolean;
  pst_taxable: boolean;
  category_id: number;
  notes: string;
  date: string;
  selected: boolean;
};

type ReviewState = {
  result: ScanResult;
  merchant: string;
  date: string;
  thumb: string | null;
  lines: LineDraft[];
};

// Distribute receipt-level tax proportionally by line base, with last
// taxable line absorbing rounding error so the sum exactly equals the
// printed grand total.
function distributeTax(
  lines: { base_amount: number; gst_taxable: boolean; pst_taxable: boolean }[],
  receiptGst: number,
  receiptPst: number
): { gst_share: number; pst_share: number }[] {
  const out = lines.map(() => ({ gst_share: 0, pst_share: 0 }));
  for (const tax of ["gst", "pst"] as const) {
    const total = tax === "gst" ? receiptGst : receiptPst;
    if (!total) continue;
    const taxableTotal = lines.reduce((s, l) => {
      const taxable = tax === "gst" ? l.gst_taxable : l.pst_taxable;
      return s + (taxable ? Math.max(l.base_amount, 0) : 0);
    }, 0);
    if (taxableTotal <= 0) continue;
    let running = 0;
    let lastIdx = -1;
    lines.forEach((l, i) => {
      const taxable = tax === "gst" ? l.gst_taxable : l.pst_taxable;
      if (!taxable || l.base_amount <= 0) return;
      const share =
        Math.round(((l.base_amount / taxableTotal) * total) * 100) / 100;
      if (tax === "gst") out[i].gst_share = share;
      else out[i].pst_share = share;
      running += share;
      lastIdx = i;
    });
    if (lastIdx >= 0) {
      const diff = Math.round((total - running) * 100) / 100;
      if (Math.abs(diff) >= 0.01) {
        if (tax === "gst") out[lastIdx].gst_share += diff;
        else out[lastIdx].pst_share += diff;
        out[lastIdx].gst_share = Math.round(out[lastIdx].gst_share * 100) / 100;
        out[lastIdx].pst_share = Math.round(out[lastIdx].pst_share * 100) / 100;
      }
    }
  }
  return out;
}

export default function ScanClient({
  categories: initialCategories,
  people,
}: {
  categories: Category[];
  people: Person[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null
  );
  const [reviews, setReviews] = useState<ReviewState[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [personId, setPersonId] = useState<number | null>(null);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkPicked, setBulkPicked] = useState<Set<number>>(new Set());
  const [bulkEditing, setBulkEditing] = useState(false);
  // Set when the current scan has been recorded as INCOME rather than expenses.
  // Shows a success card with a "Back to dashboard" action.
  const [incomeSaved, setIncomeSaved] = useState<number | null>(null);

  const cameraRef = useRef<HTMLInputElement | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  // Bumping these counters re-mounts the file input so Samsung doesn't
  // get stuck on a stale element after a failed/empty pick.
  const [cameraInputKey, setCameraInputKey] = useState(0);
  const [galleryInputKey, setGalleryInputKey] = useState(0);
  const [busyHint, setBusyHint] = useState<string | null>(null);
  // Shown inside the progress card while a photo is being auto-retried.
  const [attemptNote, setAttemptNote] = useState<string | null>(null);
  const [showManualEntryFallback, setShowManualEntryFallback] = useState(false);
  // Live in-app camera. Opens automatically so tapping "Scan" jumps straight
  // to taking a photo. If the device/browser can't do getUserMedia we fall
  // back to the classic file-input buttons.
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraUsable, setCameraUsable] = useState(true);

  const review = reviews[activeIdx] ?? null;
  const hasReceipts = reviews.length > 0;

  // Auto-launch the camera on first load when there's nothing to review yet.
  useEffect(() => {
    if (
      cameraUsable &&
      reviews.length === 0 &&
      !busy &&
      typeof navigator !== "undefined" &&
      typeof navigator.mediaDevices?.getUserMedia === "function"
    ) {
      setCameraOpen(true);
    }
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function pickCategoryId(name: string): number {
    const lower = name.trim().toLowerCase();
    const found = categories.find((c) => c.name.trim().toLowerCase() === lower);
    if (found) return found.id;
    const other = categories.find((c) => c.name.toLowerCase() === "other");
    return other?.id ?? categories[0]?.id ?? 0;
  }

  function buildLines(res: ScanResult): LineDraft[] {
    const baseLines = res.line_items.map((li) => ({
      base_amount: li.base_amount,
      gst_taxable: li.gst_taxable,
      pst_taxable: li.pst_taxable,
    }));
    const shares = distributeTax(baseLines, res.gst_total, res.pst_total);
    return res.line_items.map((li, i) => {
      const gstShare = shares[i].gst_share;
      const pstShare = shares[i].pst_share;
      return {
        description: li.description,
        base_amount: li.base_amount,
        amount:
          Math.round(
            (li.base_amount + gstShare + pstShare) * 100
          ) / 100,
        gst_share: gstShare,
        pst_share: pstShare,
        gst_taxable: li.gst_taxable,
        pst_taxable: li.pst_taxable,
        category_id: pickCategoryId(li.category_name),
        notes: li.notes,
        // Every line uses TODAY in the user's local timezone — receipts
        // are logged on the day they're scanned, not the day they were
        // purchased. Editable from the review header.
        date: todayLocalISO(),
        selected: true,
      };
    });
  }

  // Single upload attempt for an already-compressed file.
  async function scanOnce(compressed: File): Promise<ScanResult> {
    void diag("upload_start", {
      file_name: compressed.name,
      file_size_bytes: compressed.size,
    });
    const fd = new FormData();
    fd.append("image", compressed);
    const res = await scanReceiptAction(fd);
    // Server Action returns a discriminated union so production builds
    // don't mask the message. Throw here so existing retry/error
    // handling can react to it the same way it would a network throw.
    if (!res.ok) {
      const err = new Error(res.error) as Error & { code?: string };
      err.code = res.code;
      throw err;
    }
    void diag("upload_ok", { file_name: compressed.name });
    return res.result;
  }

  // Errors that mean "this photo/effort can't succeed no matter how many times
  // we retry" — retrying just wastes the user's daily scan quota. Everything
  // else (network blips, timeouts, AI hiccups, unreadable-this-time results)
  // is retried automatically up to MAX_AUTO_ATTEMPTS.
  function isPermanent(err: Error & { code?: string }): boolean {
    const code = err.code ?? "";
    if (
      [
        "too_large",
        "bad_mime",
        "no_file",
        "empty_file",
        "user_daily_cap",
        "daily_cap",
        "duplicate",
      ].includes(code)
    ) {
      return true;
    }
    // ImageProcessingError (decode/encode/too-large) is a client-side dead end.
    if (err instanceof ImageProcessingError) return true;
    return false;
  }

  // Keep retrying a photo until it scans, with backoff and a visible attempt
  // counter. The merged server fixes already retry the Gemini call within the
  // request; this outer loop rides out anything that survives that.
  async function scanWithRetry(compressed: File): Promise<ScanResult> {
    let lastErr: (Error & { code?: string }) | null = null;
    for (let attempt = 1; attempt <= MAX_AUTO_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        setAttemptNote(
          `That didn't come through — retrying (attempt ${attempt} of ${MAX_AUTO_ATTEMPTS})…`
        );
      }
      try {
        return await scanOnce(compressed);
      } catch (e) {
        lastErr = e as Error & { code?: string };
        if (isPermanent(lastErr)) throw lastErr;
        if (attempt < MAX_AUTO_ATTEMPTS) {
          // Backoff: 0.8s, 1.6s, 2.4s, 3.2s (capped).
          await new Promise((r) =>
            setTimeout(r, Math.min(800 * attempt, 3200))
          );
        }
      }
    }
    throw lastErr ?? new Error("Scan failed after retries");
  }

  async function processFiles(files: File[]) {
    if (!files.length) return;
    setError(null);
    setShowManualEntryFallback(false);
    setAttemptNote(null);
    setBusy(true);
    setProgress({ done: 0, total: files.length });
    const next: ReviewState[] = [];
    const failures: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const label = file.name || `Photo ${i + 1}`;
      try {
        // Compress once, then reuse the same file for both the scan upload and
        // the on-screen thumbnail (it used to be compressed twice per photo).
        void diag("compress_start", {
          file_name: file.name,
          file_type: file.type,
          file_size_bytes: file.size,
        });
        const compressed = await compressImage(file);
        void diag("compress_done", {
          file_name: compressed.name,
          file_type: compressed.type,
          file_size_bytes: compressed.size,
        });
        const res = await scanWithRetry(compressed);
        const reader = await new Promise<string>((resolve) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.readAsDataURL(compressed);
        });
        next.push({
          result: res,
          merchant: res.merchant ?? "",
          // Always default to today (user's local tz). The user can edit
          // this in the review header if they're logging an older receipt.
          date: todayLocalISO(),
          thumb: reader,
          lines: buildLines(res),
        });
      } catch (e) {
        const err = e as Error;
        const msg =
          err instanceof ImageProcessingError
            ? err.message
            : err?.message ||
              "Something went wrong scanning that photo. Try again.";
        void diag("upload_error", {
          file_name: label,
          detail: msg,
        });
        failures.push(`${label}: ${msg}`);
      } finally {
        setAttemptNote(null);
        setProgress({ done: i + 1, total: files.length });
      }
    }
    if (next.length) {
      setReviews((prev) => [...prev, ...next]);
      setActiveIdx((prev) => (prev === 0 && reviews.length === 0 ? 0 : prev));
    }
    if (failures.length) {
      setError(
        files.length === 1
          ? failures[0].replace(/^[^:]+:\s*/, "")
          : `${failures.length} of ${files.length} photo${
              files.length === 1 ? "" : "s"
            } couldn't be scanned:\n• ${failures.join("\n• ")}`
      );
      // Always offer the manual-entry fallback after a failure.
      setShowManualEntryFallback(true);
    }
    setBusy(false);
    setBusyHint(null);
    setAttemptNote(null);
    setProgress(null);
  }

  function onCameraPick(files: FileList | null) {
    void diag("change_fired", {
      detail: `camera input — files=${files?.length ?? 0}`,
    });
    if (!files || files.length === 0) {
      // Samsung Internet sometimes fires `change` with empty FileList
      // after a successful camera capture. Re-mount the input and warn.
      void diag("change_empty", {
        detail: "camera change event arrived with empty files list",
      });
      setCameraInputKey((k) => k + 1);
      setError(
        "Your camera didn't return the photo to the app. This happens sometimes on Samsung phones. Try again — if it keeps failing, tap 'Upload from gallery' instead."
      );
      setShowManualEntryFallback(true);
      return;
    }
    setBusyHint("Got the photo — uploading…");
    processFiles(Array.from(files));
    if (cameraRef.current) cameraRef.current.value = "";
    setCameraInputKey((k) => k + 1);
  }

  function onGalleryPick(fileList: FileList | null) {
    void diag("change_fired", {
      detail: `gallery input — files=${fileList?.length ?? 0}`,
    });
    if (!fileList || !fileList.length) {
      void diag("change_empty", { detail: "gallery change empty" });
      setGalleryInputKey((k) => k + 1);
      return;
    }
    setBusyHint(
      `Got ${fileList.length} photo${fileList.length === 1 ? "" : "s"} — uploading…`
    );
    processFiles(Array.from(fileList));
    if (galleryRef.current) galleryRef.current.value = "";
    setGalleryInputKey((k) => k + 1);
  }

  // --- In-app camera handlers ---
  function onCameraCapture(file: File) {
    setCameraOpen(false);
    setBusyHint("Got the photo — scanning…");
    void diag("change_fired", { detail: "in-app camera capture" });
    processFiles([file]);
  }

  function onCameraGallery(files: File[]) {
    setCameraOpen(false);
    setBusyHint(
      `Got ${files.length} photo${files.length === 1 ? "" : "s"} — scanning…`
    );
    processFiles(files);
  }

  function onCameraUnavailable(reason: string) {
    void diag("change_empty", { detail: `camera unavailable: ${reason}` });
    setCameraUsable(false);
    setCameraOpen(false);
  }

  const selectedLines = useMemo(
    () => (review ? review.lines.filter((l) => l.selected) : []),
    [review]
  );
  const selectedTotal = selectedLines.reduce(
    (s, l) => s + Number(l.amount || 0),
    0
  );

  async function saveCurrent() {
    if (!review) return;
    if (isFutureDate(review.date)) {
      if (
        !confirm(
          `You're setting a date in the future (${review.date}). The receipt will be filed for that date — save anyway?`
        )
      )
        return;
    }
    setBusy(true);
    setError(null);
    try {
      const toSave = review.lines.filter(
        (l) => l.selected && l.description && l.amount !== 0
      );
      // Last-item correction so the saved sum matches the printed total.
      const target = review.result.grand_total || review.result.total;
      if (target > 0 && toSave.length) {
        const sum =
          Math.round(toSave.reduce((s, l) => s + Number(l.amount), 0) * 100) /
          100;
        const diff = Math.round((target - sum) * 100) / 100;
        if (Math.abs(diff) >= 0.01) {
          const last = toSave[toSave.length - 1];
          last.amount = Math.round((Number(last.amount) + diff) * 100) / 100;
        }
      }
      const saveRes = await saveScannedExpenses({
        merchant: review.merchant,
        date: review.date,
        total: review.result.grand_total || review.result.total,
        person_id: personId,
        line_items: toSave.map((l) => ({
          description: l.description,
          amount: l.amount,
          category_id: l.category_id,
          notes: l.notes,
          date: review.date,
          person_id: personId,
        })),
      });
      if (!saveRes.ok) {
        setError(saveRes.error);
        setBusy(false);
        return;
      }
      // Move to next receipt or home
      const nextReviews = reviews.filter((_, i) => i !== activeIdx);
      if (nextReviews.length === 0) {
        router.push("/");
        router.refresh();
      } else {
        setReviews(nextReviews);
        setActiveIdx(Math.min(activeIdx, nextReviews.length - 1));
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Record the current scan as a single INCOME entry (e.g. a pay stub or a
  // receipt for something the user sold) instead of expense line items.
  async function saveCurrentAsIncome() {
    if (!review) return;
    const amount = review.result.grand_total || review.result.total;
    if (!amount || amount <= 0) {
      setError(
        "This scan has no total to record as income. Add a total or use Add income by hand."
      );
      return;
    }
    if (isFutureDate(review.date)) {
      if (
        !confirm(
          `You're setting a date in the future (${review.date}). The income will be filed for that date — save anyway?`
        )
      )
        return;
    }
    setBusy(true);
    setError(null);
    try {
      const saveRes = await saveScannedIncome({
        date: review.date,
        amount,
        description: review.merchant.trim() || "Scanned income",
        source: "scanned",
      });
      if (!saveRes.ok) {
        setError(saveRes.error);
        setBusy(false);
        return;
      }
      // Drop this receipt from the review stack and show the success state.
      const nextReviews = reviews.filter((_, i) => i !== activeIdx);
      setReviews(nextReviews);
      setActiveIdx(Math.min(activeIdx, Math.max(0, nextReviews.length - 1)));
      setIncomeSaved(saveRes.amount);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function discardCurrent() {
    if (!review) return;
    if (
      review.lines.length > 0 &&
      !confirm("Discard this receipt? Items won't be saved.")
    )
      return;
    const nextReviews = reviews.filter((_, i) => i !== activeIdx);
    setReviews(nextReviews);
    setActiveIdx(Math.min(activeIdx, Math.max(0, nextReviews.length - 1)));
  }

  function goBackHome() {
    if (hasReceipts) {
      const ok = confirm(
        `Leave without saving? ${reviews.length} receipt${
          reviews.length === 1 ? "" : "s"
        } will be discarded.`
      );
      if (!ok) return;
    }
    router.push("/");
  }

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setReviews((prev) =>
      prev.map((r, ri) => {
        if (ri !== activeIdx) return r;
        return {
          ...r,
          lines: r.lines.map((x, j) => {
            if (j !== i) return x;
            const next = { ...x, ...patch };
            const gstActive = next.gst_taxable ? Number(next.gst_share) || 0 : 0;
            const pstActive = next.pst_taxable ? Number(next.pst_share) || 0 : 0;
            next.amount =
              Math.round(
                (Number(next.base_amount) + gstActive + pstActive) * 100
              ) / 100;
            return next;
          }),
        };
      })
    );
  }

  function updateActiveReceipt(patch: Partial<ReviewState>) {
    setReviews((prev) =>
      prev.map((r, ri) => (ri === activeIdx ? { ...r, ...patch } : r))
    );
  }

  function exitBulk() {
    setBulkMode(false);
    setBulkPicked(new Set());
  }

  function applyBulkPatch(patch: {
    category_id?: number;
    date?: string;
    gst_taxable?: boolean;
    pst_taxable?: boolean;
  }) {
    setReviews((prev) =>
      prev.map((r, ri) => {
        if (ri !== activeIdx) return r;
        return {
          ...r,
          lines: r.lines.map((l, j) => {
            if (!bulkPicked.has(j)) return l;
            const next = { ...l, ...patch };
            const gstActive = next.gst_taxable
              ? Number(next.gst_share) || 0
              : 0;
            const pstActive = next.pst_taxable
              ? Number(next.pst_share) || 0
              : 0;
            next.amount =
              Math.round(
                (Number(next.base_amount) + gstActive + pstActive) * 100
              ) / 100;
            return next;
          }),
        };
      })
    );
    exitBulk();
  }

  // Derived per-receipt totals from the line items (for display when
  // user has toggled GST/PST off on some rows).
  const liveTotals = useMemo(() => {
    if (!review) return null;
    const sub = review.lines
      .filter((l) => l.selected)
      .reduce((s, l) => s + Number(l.base_amount || 0), 0);
    const gst = review.lines
      .filter((l) => l.selected && l.gst_taxable)
      .reduce((s, l) => s + Number(l.gst_share || 0), 0);
    const pst = review.lines
      .filter((l) => l.selected && l.pst_taxable)
      .reduce((s, l) => s + Number(l.pst_share || 0), 0);
    return { sub, gst, pst };
  }, [review]);

  return (
    <div
      className="max-w-3xl mx-auto px-4 pb-32 space-y-4"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.25rem)" }}
    >
      {cameraOpen && (
        <CameraCapture
          onCapture={onCameraCapture}
          onPickFromGallery={onCameraGallery}
          onClose={() => setCameraOpen(false)}
          onUnavailable={onCameraUnavailable}
        />
      )}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={goBackHome}
          className="inline-flex items-center gap-1.5 text-emerald-700 text-sm font-semibold px-3 py-1.5 rounded-lg bg-white ring-1 ring-emerald-100 hover:bg-emerald-50"
        >
          <IconArrowLeft size={18} />
          Back
        </button>
        <h1 className="text-xl font-bold ml-1">Scan Receipt</h1>
        {reviews.length > 1 && (
          <span className="ml-auto text-xs font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
            Receipt {activeIdx + 1} of {reviews.length}
          </span>
        )}
      </div>

      {incomeSaved !== null && (
        <div className="bg-emerald-50 ring-1 ring-emerald-200 text-emerald-900 rounded-2xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-emerald-500 text-white inline-flex items-center justify-center shrink-0">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12l5 5L20 7" />
              </svg>
            </span>
            <div>
              <p className="font-bold">Saved as income</p>
              <p className="text-sm text-emerald-800/90 tabular-nums">
                {fmt(incomeSaved)} added to your income.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/"
              className="inline-flex px-4 py-2 rounded-xl bg-emerald-500 text-white text-sm font-semibold hover:bg-emerald-600"
            >
              Back to dashboard
            </Link>
            <button
              type="button"
              onClick={() => setIncomeSaved(null)}
              className="inline-flex px-4 py-2 rounded-xl bg-white text-emerald-700 text-sm font-semibold ring-1 ring-emerald-200 hover:bg-emerald-50"
            >
              Scan another
            </button>
          </div>
        </div>
      )}

      {busyHint && !progress && (
        <div className="bg-emerald-50 ring-1 ring-emerald-100 text-emerald-900 rounded-lg p-3 text-sm flex items-center gap-2">
          <span className="inline-block w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <span>{busyHint}</span>
        </div>
      )}

      {showManualEntryFallback && error && (
        <div className="bg-amber-50 ring-1 ring-amber-200 text-amber-900 rounded-lg p-3 text-sm space-y-2">
          <p>
            <strong>Stuck?</strong> If the scanner won&apos;t cooperate, you
            can enter the receipt by hand instead.
          </p>
          <Link
            href="/"
            className="inline-block px-3 py-1.5 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700"
          >
            Go to dashboard → tap + → Add expense
          </Link>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm flex items-start gap-2"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 mt-0.5 text-red-600"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <p className="flex-1 whitespace-pre-line">{error}</p>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss"
            className="shrink-0 text-red-600/80 hover:text-red-700"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {progress && (
        <div className="bg-white rounded-2xl ring-1 ring-emerald-100 p-4 space-y-2">
          <p className="text-sm font-semibold text-gray-800">
            Scanning receipt {progress.done} of {progress.total}…
          </p>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-[width]"
              style={{
                width: `${(progress.done / progress.total) * 100}%`,
              }}
            />
          </div>
          {attemptNote && (
            <p className="text-xs text-amber-700 flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              {attemptNote}
            </p>
          )}
        </div>
      )}

      {!review && !progress && (
        <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4 ring-1 ring-gray-100">
          <div>
            <h2 className="text-2xl font-bold">Scan Receipt</h2>
            <p className="text-sm text-gray-500 mt-1">
              Take a new photo or pick one or more from your gallery.
            </p>
          </div>

          {/* Camera input — `capture="environment"` asks the OS to open
              the back-facing camera directly. Removing it (older Samsung
              workaround) made the "Take a photo" button just open a
              generic file picker on every other browser. Samsung
              Internet's empty-FileList quirk is handled by onCameraPick. */}
          <input
            key={`cam-${cameraInputKey}`}
            ref={cameraRef}
            type="file"
            accept="image/*,.heic,.heif"
            capture="environment"
            className="hidden"
            disabled={busy}
            onChange={(e) => onCameraPick(e.target.files)}
          />
          <input
            key={`gal-${galleryInputKey}`}
            ref={galleryRef}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            className="hidden"
            disabled={busy}
            onChange={(e) => onGalleryPick(e.target.files)}
          />

          <div className="grid gap-3">
            <button
              type="button"
              onClick={() => {
                if (cameraUsable) setCameraOpen(true);
                else cameraRef.current?.click();
              }}
              disabled={busy}
              className="px-4 py-5 rounded-2xl bg-emerald-500 text-white font-semibold cursor-pointer hover:bg-emerald-600 active:scale-[0.99] transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <IconCamera size={22} strokeWidth={2} />
              Take a photo
            </button>
            <button
              type="button"
              onClick={() => galleryRef.current?.click()}
              disabled={busy}
              className="px-4 py-5 rounded-2xl bg-white text-emerald-700 font-semibold cursor-pointer hover:bg-emerald-50 ring-2 ring-emerald-200 active:scale-[0.99] transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="9" cy="9" r="2" />
                <path d="M21 15l-5-5L5 21" />
              </svg>
              Upload from gallery
              <span className="text-xs font-normal text-emerald-600/80 ml-1">
                (one or many)
              </span>
            </button>
          </div>
        </div>
      )}

      {review && (
        <div className="space-y-4">
          {/* Receipt thumbnail with New Scan button overlay */}
          <div className="bg-white rounded-2xl shadow-sm p-4 ring-1 ring-gray-100 space-y-3">
            <div>
              <h2 className="text-2xl font-bold">Scan Receipt</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Review and edit before saving.
              </p>
            </div>
            {review.thumb && (
              <div className="relative">
                <img
                  src={review.thumb}
                  alt="Receipt"
                  className="w-full h-44 object-cover rounded-xl ring-1 ring-gray-200"
                />
                <button
                  onClick={discardCurrent}
                  className="absolute top-2 right-2 inline-flex items-center gap-1.5 bg-white/95 backdrop-blur text-emerald-700 px-3 py-1.5 rounded-xl text-sm font-semibold shadow-sm ring-1 ring-gray-200"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 12a9 9 0 0 1 15.5-6.3L21 8" />
                    <path d="M21 3v5h-5" />
                  </svg>
                  New Scan
                </button>
              </div>
            )}
          </div>

          {/* Receipt totals — these are the printed totals from the receipt */}
          <div className="bg-emerald-50/70 rounded-2xl p-5 ring-1 ring-emerald-100 space-y-4">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={review.merchant}
                  onChange={(e) =>
                    updateActiveReceipt({ merchant: e.target.value })
                  }
                  placeholder="Merchant"
                  className="w-full bg-transparent text-xl font-extrabold tracking-tight text-gray-900 outline-none truncate"
                />
                <div className="mt-2 inline-flex items-center gap-2 bg-white ring-1 ring-emerald-200 rounded-lg pl-3 pr-2 py-1.5">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-emerald-700"
                    aria-hidden="true"
                  >
                    <rect x="3" y="4" width="18" height="18" rx="2" />
                    <path d="M16 2v4M8 2v4M3 10h18" />
                  </svg>
                  <label className="text-xs font-semibold text-emerald-800 uppercase tracking-wide cursor-pointer">
                    Date
                  </label>
                  <input
                    type="date"
                    value={review.date}
                    onChange={(e) => {
                      const newDate = e.target.value;
                      updateActiveReceipt({
                        date: newDate,
                        lines: review.lines.map((l) => ({
                          ...l,
                          date: newDate,
                        })),
                      });
                    }}
                    className="text-sm font-semibold text-gray-900 bg-transparent outline-none cursor-pointer"
                    aria-label="Edit receipt date"
                  />
                  <span className="text-[11px] text-emerald-700/80 ml-1">
                    tap to edit
                  </span>
                </div>
                {review.date !== todayLocalISO() && (
                  <p className="text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded px-2 py-1 mt-1.5 inline-block">
                    Not today's date —{" "}
                    <button
                      type="button"
                      onClick={() => {
                        const t = todayLocalISO();
                        updateActiveReceipt({
                          date: t,
                          lines: review.lines.map((l) => ({ ...l, date: t })),
                        });
                      }}
                      className="underline font-semibold"
                    >
                      reset to today
                    </button>
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                  Receipt Total
                </p>
                <p className="text-3xl font-extrabold text-emerald-600 tabular-nums mt-0.5">
                  {fmt(review.result.grand_total || review.result.total)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-emerald-200/60">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  Subtotal
                </p>
                <p className="text-base font-bold text-gray-900 tabular-nums">
                  {fmt(review.result.subtotal)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  GST
                </p>
                <p className="text-base font-bold text-amber-600 tabular-nums">
                  {fmt(review.result.gst_total)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  PST
                </p>
                <p className="text-base font-bold text-amber-600 tabular-nums">
                  {fmt(review.result.pst_total)}
                </p>
              </div>
            </div>
            {liveTotals &&
              Math.abs(
                liveTotals.sub +
                  liveTotals.gst +
                  liveTotals.pst -
                  (review.result.grand_total || review.result.total)
              ) > 0.05 && (
                <p className="text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-lg p-2">
                  Heads up: your edits don&apos;t match the printed total. The
                  saved expenses will be auto-corrected by{" "}
                  <b>
                    {fmt(
                      Math.abs(
                        liveTotals.sub +
                          liveTotals.gst +
                          liveTotals.pst -
                          (review.result.grand_total || review.result.total)
                      )
                    )}
                  </b>{" "}
                  on the last item so they sum to{" "}
                  {fmt(review.result.grand_total || review.result.total)}.
                </p>
              )}
          </div>

          {people.length > 0 && (
            <div className="bg-white rounded-2xl shadow-sm p-4 ring-1 ring-gray-100">
              <PersonSelector
                people={people}
                value={personId}
                onChange={setPersonId}
              />
            </div>
          )}

          <div className="flex items-end justify-between pt-2">
            <div>
              <h3 className="text-lg font-bold">
                Items Found ({review.lines.length})
              </h3>
              <p className="text-xs text-gray-500 mt-0.5 max-w-[260px]">
                Tap the category icon to change it. Toggle GST/PST per item if
                the receipt didn&apos;t show tax for that item.
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">
                Selected:{" "}
                <b className="tabular-nums">{fmt(selectedTotal)}</b>
              </p>
            </div>
          </div>

          {review.lines.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-sm">
              {!bulkMode ? (
                <button
                  type="button"
                  onClick={() => setBulkMode(true)}
                  className="px-3 py-1.5 rounded-lg font-semibold bg-white ring-1 ring-gray-200 text-gray-700 hover:bg-gray-50"
                >
                  Bulk edit
                </button>
              ) : (
                <>
                  <span className="font-semibold tabular-nums">
                    {bulkPicked.size} picked
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setBulkPicked(
                        bulkPicked.size === review.lines.length
                          ? new Set()
                          : new Set(review.lines.map((_, i) => i))
                      )
                    }
                    className="text-xs underline text-gray-700"
                  >
                    {bulkPicked.size === review.lines.length
                      ? "Clear all"
                      : "Pick all"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBulkEditing(true)}
                    disabled={bulkPicked.size === 0}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white disabled:opacity-50"
                  >
                    Edit fields
                  </button>
                  <button
                    type="button"
                    onClick={exitBulk}
                    className="ml-auto text-xs underline text-gray-500"
                  >
                    Done
                  </button>
                </>
              )}
            </div>
          )}

          <div className="space-y-2">
            {review.lines.map((l, i) => {
              const taxOn =
                (l.gst_taxable && l.gst_share > 0) ||
                (l.pst_taxable && l.pst_share > 0);
              const taxTotal =
                (l.gst_taxable ? Number(l.gst_share || 0) : 0) +
                (l.pst_taxable ? Number(l.pst_share || 0) : 0);
              const bulkChecked = bulkPicked.has(i);
              return (
                <div
                  key={i}
                  className={`relative bg-white rounded-2xl ring-1 transition shadow-sm ${
                    bulkMode && bulkChecked
                      ? "ring-violet-300 ring-2"
                      : l.selected
                        ? "ring-emerald-100"
                        : "ring-gray-200 opacity-70"
                  }`}
                >
                  <div className="p-3 flex items-start gap-3">
                    {bulkMode && (
                      <button
                        type="button"
                        onClick={() =>
                          setBulkPicked((prev) => {
                            const next = new Set(prev);
                            if (next.has(i)) next.delete(i);
                            else next.add(i);
                            return next;
                          })
                        }
                        aria-label={bulkChecked ? "Unpick" : "Pick"}
                        className={`shrink-0 mt-1 w-7 h-7 rounded-md inline-flex items-center justify-center transition ${
                          bulkChecked
                            ? "bg-violet-600 text-white"
                            : "bg-white ring-2 ring-violet-300 text-violet-300"
                        }`}
                      >
                        {bulkChecked && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M5 12l5 5L20 7" />
                          </svg>
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => updateLine(i, { selected: !l.selected })}
                      aria-label={l.selected ? "Deselect" : "Select"}
                      className={`shrink-0 mt-1 w-7 h-7 rounded-full inline-flex items-center justify-center transition ${
                        l.selected
                          ? "bg-emerald-500 text-white shadow-sm"
                          : "bg-white ring-2 ring-gray-300 text-gray-300"
                      }`}
                    >
                      {l.selected && (
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      )}
                    </button>

                    <div className="shrink-0 mt-0.5">
                      <CategoryIconButton
                        category={categories.find(
                          (c) => c.id === l.category_id
                        )}
                      />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      <input
                        className="w-full font-bold text-[15px] text-gray-900 bg-transparent outline-none truncate"
                        value={l.description}
                        onChange={(e) =>
                          updateLine(i, { description: e.target.value })
                        }
                        placeholder="Item description"
                      />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CategoryPicker
                          className="!inline-block"
                          value={l.category_id}
                          categories={categories}
                          onChange={(id) =>
                            updateLine(i, { category_id: id })
                          }
                          onCreated={(cat) =>
                            setCategories((prev) => [...prev, cat])
                          }
                        />
                        {taxOn && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 ring-1 ring-amber-200">
                            +{fmt(taxTotal)} tax
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <p className="text-base font-extrabold text-gray-900 tabular-nums">
                        {fmt(l.amount)}
                      </p>
                      {(taxOn || l.base_amount !== l.amount) && (
                        <p className="text-[11px] text-gray-500 tabular-nums">
                          {fmt(l.base_amount)} {taxOn ? "+ tax" : ""}
                        </p>
                      )}
                    </div>
                  </div>

                  {(l.gst_taxable || l.pst_taxable) && (
                    <div className="px-3 pb-3 pt-1 flex flex-wrap gap-1.5">
                      {l.gst_taxable && (
                        <button
                          type="button"
                          onClick={() =>
                            updateLine(i, { gst_taxable: !l.gst_taxable })
                          }
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 transition bg-amber-50 text-amber-800 ring-amber-300`}
                        >
                          <span
                            className={
                              "w-3.5 h-3.5 rounded-full inline-flex items-center justify-center bg-amber-500 text-white"
                            }
                          >
                            <svg
                              width="9"
                              height="9"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="4"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5 12l5 5L20 7" />
                            </svg>
                          </span>
                          GST {fmt(l.gst_share)}
                        </button>
                      )}
                      {l.pst_taxable && (
                        <button
                          type="button"
                          onClick={() =>
                            updateLine(i, { pst_taxable: !l.pst_taxable })
                          }
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 bg-amber-50 text-amber-800 ring-amber-300"
                        >
                          <span className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center bg-amber-500 text-white">
                            ✓
                          </span>
                          PST {fmt(l.pst_share)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={() =>
                setReviews((prev) =>
                  prev.map((r, ri) =>
                    ri === activeIdx
                      ? {
                          ...r,
                          lines: [
                            ...r.lines,
                            {
                              description: "",
                              base_amount: 0,
                              amount: 0,
                              gst_share: 0,
                              pst_share: 0,
                              gst_taxable: false,
                              pst_taxable: false,
                              category_id: pickCategoryId("Other"),
                              notes: "",
                              date: r.date,
                              selected: true,
                            },
                          ],
                        }
                      : r
                  )
                )
              }
              className="w-full px-4 py-3 rounded-2xl text-sm font-semibold text-emerald-700 bg-white ring-1 ring-emerald-100 hover:bg-emerald-50"
            >
              + Add row manually
            </button>
            {review.lines.length === 0 && (
              <p className="p-4 text-sm text-gray-500 text-center">
                No items extracted. Add rows manually if needed.
              </p>
            )}
          </div>
        </div>
      )}

      {bulkEditing && review && (
        <ScanLineBulkEditDialog
          count={bulkPicked.size}
          categories={categories}
          defaultDate={review.date}
          onClose={() => setBulkEditing(false)}
          onApply={(patch) => {
            applyBulkPatch(patch);
            setBulkEditing(false);
          }}
          onCategoryCreated={(c) => setCategories((prev) => [...prev, c])}
        />
      )}

      {review && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 bg-gradient-to-t from-white via-white/95 to-transparent"
        >
          <div className="max-w-3xl mx-auto">
            <button
              onClick={saveCurrent}
              disabled={busy || selectedLines.length === 0}
              className="w-full px-4 py-4 rounded-2xl bg-emerald-500 text-white font-bold text-base hover:bg-emerald-600 disabled:opacity-50 shadow-lg shadow-emerald-500/30 active:scale-[0.99] transition inline-flex items-center justify-center gap-2"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M5 12l5 5L20 7" />
              </svg>
              {busy
                ? "Saving…"
                : `Save ${selectedLines.length} Item${
                    selectedLines.length === 1 ? "" : "s"
                  } (${fmt(
                    review.result.grand_total || review.result.total
                  )})`}
            </button>
            <button
              type="button"
              onClick={saveCurrentAsIncome}
              disabled={busy}
              className="w-full mt-2 px-4 py-3 rounded-2xl bg-white text-emerald-700 font-semibold text-sm ring-2 ring-emerald-200 hover:bg-emerald-50 disabled:opacity-50 active:scale-[0.99] transition inline-flex items-center justify-center gap-2"
            >
              💰 Save as income instead (
              {fmt(review.result.grand_total || review.result.total)})
            </button>
            {reviews.length > 1 && (
              <p className="text-center text-xs text-gray-500 mt-2">
                {activeIdx + 1} of {reviews.length} • saving moves to next
                receipt automatically
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScanLineBulkEditDialog({
  count,
  categories,
  defaultDate,
  onClose,
  onApply,
  onCategoryCreated,
}: {
  count: number;
  categories: Category[];
  defaultDate: string;
  onClose: () => void;
  onApply: (patch: {
    category_id?: number;
    date?: string;
    gst_taxable?: boolean;
    pst_taxable?: boolean;
  }) => void;
  onCategoryCreated?: (c: Category) => void;
}) {
  const [applyCat, setApplyCat] = useState(false);
  const [applyDate, setApplyDate] = useState(false);
  const [applyTax, setApplyTax] = useState(false);
  const [categoryId, setCategoryId] = useState<number>(categories[0]?.id ?? 0);
  const [date, setDate] = useState(defaultDate || todayLocalISO());
  const [gst, setGst] = useState(true);
  const [pst, setPst] = useState(true);
  const nothingToDo = !applyCat && !applyDate && !applyTax;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-xl p-5 w-full max-w-md space-y-3">
        <h3 className="text-lg font-bold">
          Edit {count} item{count === 1 ? "" : "s"}
        </h3>
        <p className="text-sm text-gray-600">
          Tick the field you want to apply to all picked rows.
        </p>
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (nothingToDo) {
              onClose();
              return;
            }
            if (applyDate && isFutureDate(date)) {
              if (
                !confirm(
                  "You're setting a date in the future. Apply this date to picked items?"
                )
              )
                return;
            }
            const patch: {
              category_id?: number;
              date?: string;
              gst_taxable?: boolean;
              pst_taxable?: boolean;
            } = {};
            if (applyCat) patch.category_id = categoryId;
            if (applyDate) patch.date = date;
            if (applyTax) {
              patch.gst_taxable = gst;
              patch.pst_taxable = pst;
            }
            onApply(patch);
          }}
          className="space-y-3"
        >
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={applyCat}
              onChange={(e) => setApplyCat(e.target.checked)}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="text-sm font-medium block">Category</span>
              {applyCat && (
                <CategoryPicker
                  value={categoryId}
                  categories={categories}
                  onChange={setCategoryId}
                  onCreated={(c) => {
                    onCategoryCreated?.(c);
                    setCategoryId(c.id);
                  }}
                  className="mt-1"
                />
              )}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={applyDate}
              onChange={(e) => setApplyDate(e.target.checked)}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="text-sm font-medium block">Date</span>
              {applyDate && (
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 mt-1"
                  required
                />
              )}
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={applyTax}
              onChange={(e) => setApplyTax(e.target.checked)}
              className="mt-1"
            />
            <span className="flex-1">
              <span className="text-sm font-medium block">Tax flags</span>
              {applyTax && (
                <div className="flex gap-3 mt-1 text-sm">
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={gst}
                      onChange={(e) => setGst(e.target.checked)}
                    />
                    GST
                  </label>
                  <label className="inline-flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={pst}
                      onChange={(e) => setPst(e.target.checked)}
                    />
                    PST
                  </label>
                </div>
              )}
            </span>
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-gray-100 text-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={nothingToDo}
              className="px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50"
            >
              Apply to {count}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CategoryIconButton({ category }: { category?: Category }) {
  return (
    <span
      className="w-9 h-9 rounded-full inline-flex items-center justify-center relative"
      style={{ background: `${category?.color ?? "#10b981"}22` }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke={category?.color ?? "#10b981"}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="9" cy="20" r="1.5" />
        <circle cx="17" cy="20" r="1.5" />
        <path d="M3 4h2l2.5 11h11l2-7H6" />
      </svg>
      <span
        className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-white ring-1 ring-gray-200 inline-flex items-center justify-center"
        aria-hidden="true"
      >
        <svg
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6b7280"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </span>
    </span>
  );
}
