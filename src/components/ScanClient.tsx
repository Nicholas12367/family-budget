"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { fmt } from "@/lib/money";
import { compressImage } from "@/lib/image";
import type { Category, Person, ScanResult } from "@/lib/types";
import { saveScannedExpenses, scanReceiptAction } from "@/app/actions/scan";
import CategoryPicker from "./CategoryPicker";
import PersonSelector from "./PersonSelector";
import { IconArrowLeft, IconCamera } from "./Icon";

type LineDraft = {
  description: string;
  amount: number;
  base_amount: number;
  gst: number;
  pst: number;
  gst_on: boolean;
  pst_on: boolean;
  category_id: number;
  notes: string;
  date: string;
  selected: boolean;
};

function parseTaxFromNotes(notes: string): { gst: number; pst: number } {
  // Notes from Gemini look like "(incl. GST $X.XX)" or
  // "(incl. GST $X.XX + PST $Y.YY)". Pull both out.
  const gstMatch = notes.match(/GST\s*\$([\d.]+)/i);
  const pstMatch = notes.match(/PST\s*\$([\d.]+)/i);
  return {
    gst: gstMatch ? Number(gstMatch[1]) : 0,
    pst: pstMatch ? Number(pstMatch[1]) : 0,
  };
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
  const [result, setResult] = useState<ScanResult | null>(null);
  const [merchant, setMerchant] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [personId, setPersonId] = useState<number | null>(null);
  const [receiptThumb, setReceiptThumb] = useState<string | null>(null);

  function pickCategoryId(name: string): number {
    const lower = name.trim().toLowerCase();
    const found = categories.find((c) => c.name.trim().toLowerCase() === lower);
    if (found) return found.id;
    const other = categories.find((c) => c.name.toLowerCase() === "other");
    return other?.id ?? categories[0]?.id ?? 0;
  }

  async function onPick(file: File) {
    setError(null);
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      const fd = new FormData();
      fd.append("image", compressed);
      const reader = new FileReader();
      reader.onload = () => setReceiptThumb(reader.result as string);
      reader.readAsDataURL(compressed);
      const res = await scanReceiptAction(fd);
      setResult(res);
      setMerchant(res.merchant ?? "");
      setLines(
        res.line_items.map((li) => {
          const tax = parseTaxFromNotes(li.notes ?? "");
          const baseAmount =
            Math.round((li.amount - tax.gst - tax.pst) * 100) / 100;
          return {
            description: li.description,
            amount: li.amount,
            base_amount: baseAmount > 0 ? baseAmount : li.amount,
            gst: tax.gst,
            pst: tax.pst,
            gst_on: tax.gst > 0,
            pst_on: tax.pst > 0,
            category_id: pickCategoryId(li.category_name),
            notes: li.notes ?? "",
            date: res.date,
            selected: true,
          };
        })
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const selectedLines = useMemo(
    () => lines.filter((l) => l.selected && l.description && l.amount !== 0),
    [lines]
  );
  const selectedTotal = selectedLines.reduce(
    (s, l) => s + Number(l.amount || 0),
    0
  );
  const selectedTax = selectedLines.reduce(
    (s, l) =>
      s + (l.gst_on ? Number(l.gst || 0) : 0) + (l.pst_on ? Number(l.pst || 0) : 0),
    0
  );

  async function save() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await saveScannedExpenses({
        merchant,
        date: result.date,
        total: result.total,
        person_id: personId,
        line_items: selectedLines.map((l) => ({
          description: l.description,
          amount: l.amount,
          category_id: l.category_id,
          notes: l.notes,
          date: l.date,
          person_id: personId,
        })),
      });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) =>
      prev.map((x, j) => {
        if (j !== i) return x;
        const next = { ...x, ...patch };
        const gstActive = next.gst_on ? Number(next.gst) || 0 : 0;
        const pstActive = next.pst_on ? Number(next.pst) || 0 : 0;
        next.amount =
          Math.round((Number(next.base_amount) + gstActive + pstActive) * 100) /
          100;
        return next;
      })
    );
  }

  // Receipt totals reconstructed from line items so the user sees them
  // change as they toggle GST/PST per row.
  const allSubtotal = lines
    .filter((l) => l.selected)
    .reduce((s, l) => s + Number(l.base_amount || 0), 0);
  const allGst = lines
    .filter((l) => l.selected && l.gst_on)
    .reduce((s, l) => s + Number(l.gst || 0), 0);
  const allPst = lines
    .filter((l) => l.selected && l.pst_on)
    .reduce((s, l) => s + Number(l.pst || 0), 0);

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 pb-32 space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-emerald-700 text-sm font-semibold"
        >
          <IconArrowLeft size={18} />
          Back
        </Link>
        <div className="flex items-center gap-2 ml-1">
          <span className="text-emerald-600">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M5 11c.5-2.5 3-5 6-5s5 1 6 3.5c1.4-.5 3 .5 3 2 0 1.4-1 2.5-2.4 2.5H6.5C4.5 14 3 12.5 3 11.5 3 10.5 4 10 5 11z" />
              <path d="M9 17v3M15 17v3" />
              <circle cx="14" cy="10.5" r="0.6" fill="currentColor" />
            </svg>
          </span>
          <h1 className="text-xl font-bold">Scan Receipt</h1>
        </div>
      </div>

      {error && (
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </p>
      )}

      {!result && (
        <div className="bg-white rounded-2xl shadow-sm p-6 space-y-4 ring-1 ring-gray-100">
          <div>
            <h2 className="text-2xl font-bold">Scan Receipt</h2>
            <p className="text-sm text-gray-500 mt-1">
              Take a photo or pick from your gallery
            </p>
          </div>
          <label className="block w-full">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
              }}
            />
            <span className="block w-full px-4 py-6 rounded-2xl bg-emerald-500 text-white font-semibold cursor-pointer hover:bg-emerald-600 active:scale-[0.99] transition">
              <span className="flex items-center justify-center gap-2">
                <IconCamera size={22} strokeWidth={2} />
                <span>{busy ? "Scanning…" : "Take or upload photo"}</span>
              </span>
            </span>
          </label>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {/* Header card with receipt thumbnail + new-scan button */}
          <div className="bg-white rounded-2xl shadow-sm p-4 ring-1 ring-gray-100 space-y-3">
            <div>
              <h2 className="text-2xl font-bold">Scan Receipt</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                Take a photo or pick from your gallery
              </p>
            </div>
            {receiptThumb && (
              <div className="relative">
                <img
                  src={receiptThumb}
                  alt="Receipt"
                  className="w-full h-44 object-cover rounded-xl ring-1 ring-gray-200"
                />
                <button
                  onClick={() => {
                    setResult(null);
                    setLines([]);
                    setMerchant("");
                    setReceiptThumb(null);
                    setPersonId(null);
                  }}
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

          {/* Receipt summary card (merchant, date, totals) */}
          <div className="bg-emerald-50/70 rounded-2xl p-5 ring-1 ring-emerald-100 space-y-4">
            <div className="flex justify-between items-start gap-3">
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="Merchant"
                  className="w-full bg-transparent text-xl font-extrabold tracking-tight text-gray-900 outline-none truncate"
                />
                <input
                  type="date"
                  value={result.date}
                  onChange={(e) => {
                    const newDate = e.target.value;
                    setResult({ ...result, date: newDate });
                    setLines((prev) =>
                      prev.map((l) => ({ ...l, date: newDate }))
                    );
                  }}
                  className="text-sm text-gray-500 bg-transparent outline-none mt-1"
                />
              </div>
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-gray-500 font-semibold">
                  Receipt Total
                </p>
                <p className="text-3xl font-extrabold text-emerald-600 tabular-nums mt-0.5">
                  {fmt(result.total)}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3 pt-3 border-t border-emerald-200/60">
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  Subtotal
                </p>
                <p className="text-base font-bold text-gray-900 tabular-nums">
                  {fmt(allSubtotal)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  GST
                </p>
                <p className="text-base font-bold text-amber-600 tabular-nums">
                  {fmt(allGst)}
                </p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wide text-gray-500 font-semibold">
                  PST
                </p>
                <p className="text-base font-bold text-amber-600 tabular-nums">
                  {fmt(allPst)}
                </p>
              </div>
            </div>
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

          {/* Items found header */}
          <div className="flex items-end justify-between pt-2">
            <div>
              <h3 className="text-lg font-bold">Items Found ({lines.length})</h3>
              <p className="text-xs text-gray-500 mt-0.5 max-w-[260px]">
                Tap the category icon to change it. Toggle GST/PST per item if
                the receipt didn&apos;t show tax for that item.
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-gray-500">Selected: <b className="tabular-nums">{fmt(selectedTotal)}</b></p>
              {selectedTax > 0 && (
                <p className="text-[11px] text-amber-600">
                  incl. {fmt(selectedTax)} tax
                </p>
              )}
            </div>
          </div>

          {/* Line item cards */}
          <div className="space-y-2">
            {lines.map((l, i) => {
              const taxOn = l.gst_on || l.pst_on;
              const taxTotal =
                (l.gst_on ? Number(l.gst || 0) : 0) +
                (l.pst_on ? Number(l.pst || 0) : 0);
              return (
                <div
                  key={i}
                  className={`bg-white rounded-2xl ring-1 transition shadow-sm overflow-hidden ${
                    l.selected
                      ? "ring-emerald-100"
                      : "ring-gray-200 opacity-70"
                  }`}
                >
                  <div className="p-3 flex items-start gap-3">
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

                  {(l.gst > 0 || l.pst > 0) && (
                    <div className="px-3 pb-3 pt-1 flex flex-wrap gap-1.5">
                      {l.gst > 0 && (
                        <button
                          type="button"
                          onClick={() => updateLine(i, { gst_on: !l.gst_on })}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 transition ${
                            l.gst_on
                              ? "bg-amber-50 text-amber-800 ring-amber-300"
                              : "bg-gray-50 text-gray-500 ring-gray-200 line-through"
                          }`}
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded-full inline-flex items-center justify-center ${
                              l.gst_on
                                ? "bg-amber-500 text-white"
                                : "bg-gray-300 text-white"
                            }`}
                          >
                            {l.gst_on ? (
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
                            ) : (
                              <svg
                                width="9"
                                height="9"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="4"
                                strokeLinecap="round"
                              >
                                <path d="M6 6l12 12M18 6L6 18" />
                              </svg>
                            )}
                          </span>
                          GST {fmt(l.gst)}
                        </button>
                      )}
                      {l.pst > 0 && (
                        <button
                          type="button"
                          onClick={() => updateLine(i, { pst_on: !l.pst_on })}
                          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ring-1 transition ${
                            l.pst_on
                              ? "bg-amber-50 text-amber-800 ring-amber-300"
                              : "bg-gray-50 text-gray-500 ring-gray-200 line-through"
                          }`}
                        >
                          <span
                            className={`w-3.5 h-3.5 rounded-full inline-flex items-center justify-center ${
                              l.pst_on
                                ? "bg-amber-500 text-white"
                                : "bg-gray-300 text-white"
                            }`}
                          >
                            {l.pst_on ? "✓" : "×"}
                          </span>
                          PST {fmt(l.pst)}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <button
              onClick={() =>
                setLines((prev) => [
                  ...prev,
                  {
                    description: "",
                    amount: 0,
                    base_amount: 0,
                    gst: 0,
                    pst: 0,
                    gst_on: false,
                    pst_on: false,
                    category_id: pickCategoryId("Other"),
                    notes: "",
                    date: result.date,
                    selected: true,
                  },
                ])
              }
              className="w-full px-4 py-3 rounded-2xl text-sm font-semibold text-emerald-700 bg-white ring-1 ring-emerald-100 hover:bg-emerald-50"
            >
              + Add row manually
            </button>
            {lines.length === 0 && (
              <p className="p-4 text-sm text-gray-500 text-center">
                No items extracted. Add rows manually if needed.
              </p>
            )}
          </div>
        </div>
      )}

      {result && (
        <div
          className="fixed inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] pt-3 bg-gradient-to-t from-white via-white/95 to-transparent"
        >
          <div className="max-w-3xl mx-auto">
            <button
              onClick={save}
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
                  } (${fmt(selectedTotal)})`}
            </button>
          </div>
        </div>
      )}
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
