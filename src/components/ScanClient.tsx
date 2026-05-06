"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { fmt } from "@/lib/money";
import { compressImage } from "@/lib/image";
import type { Category, ScanResult } from "@/lib/types";
import { saveScannedExpenses, scanReceiptAction } from "@/app/actions/scan";
import CategoryPicker from "./CategoryPicker";
import { IconArrowLeft, IconCamera, IconClose } from "./Icon";

type LineDraft = {
  description: string;
  amount: number;
  category_id: number;
  notes: string;
  date: string;
};

export default function ScanClient({
  categories: initialCategories,
}: {
  categories: Category[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [merchant, setMerchant] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

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
      const res = await scanReceiptAction(fd);
      setResult(res);
      setMerchant(res.merchant ?? "");
      setLines(
        res.line_items.map((li) => ({
          description: li.description,
          amount: li.amount,
          category_id: pickCategoryId(li.category_name),
          notes: li.notes,
          date: res.date,
        }))
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!result) return;
    setBusy(true);
    setError(null);
    try {
      await saveScannedExpenses({
        merchant,
        date: result.date,
        total: result.total,
        line_items: lines.filter((l) => l.description && l.amount !== 0),
      });
      router.push("/");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center justify-between">
        <Link
          href="/"
          className="text-emerald-700 text-sm inline-flex items-center gap-1"
        >
          <IconArrowLeft size={16} />
          Back
        </Link>
        <h1 className="text-xl font-bold">Scan Receipt</h1>
        <span />
      </div>

      {error && (
        <p className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </p>
      )}

      {!result && (
        <div className="bg-white rounded-xl shadow-sm p-6 space-y-3">
          <p className="text-sm text-gray-600">
            Snap a photo of your receipt or upload an image. Each item will be
            extracted, categorized, and shown for review before saving. The image
            itself is not stored.
          </p>
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
            <span className="block w-full px-4 py-6 rounded-lg bg-emerald-500 text-white font-semibold cursor-pointer hover:bg-emerald-600">
              <span className="flex items-center justify-center gap-2">
                <IconCamera size={20} strokeWidth={2} />
                <span>{busy ? "Scanning…" : "Take or upload photo"}</span>
              </span>
            </span>
          </label>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl shadow-sm p-4 space-y-2">
            <h2 className="font-semibold">Receipt details</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Merchant">
                <input
                  type="text"
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 mt-1"
                />
              </Field>
              <Field label="Date">
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
                  className="w-full border rounded-lg px-3 py-2 mt-1"
                />
              </Field>
            </div>
            {(() => {
              const sum = lines.reduce(
                (s, l) => s + Number(l.amount || 0),
                0
              );
              const diff = sum - Number(result.total || 0);
              const off = Math.abs(diff) > 0.05;
              return (
                <p
                  className={`text-sm ${
                    off ? "text-amber-700" : "text-gray-500"
                  }`}
                >
                  Receipt total (extracted): {fmt(result.total)}. Line item
                  sum: {fmt(sum)}.
                  {off && (
                    <>
                      {" "}
                      <strong>
                        Off by {fmt(Math.abs(diff))}
                      </strong>
                      {" "}
                      — adjust amounts so they match the printed total.
                    </>
                  )}
                </p>
              );
            })()}
          </div>

          <div className="bg-white rounded-xl shadow-sm divide-y">
            <div className="p-3 font-semibold flex justify-between items-center">
              <span>Line items ({lines.length})</span>
              <button
                onClick={() =>
                  setLines((prev) => [
                    ...prev,
                    {
                      description: "",
                      amount: 0,
                      category_id: pickCategoryId("Other"),
                      notes: "",
                      date: result.date,
                    },
                  ])
                }
                className="text-emerald-700 text-sm font-semibold"
              >
                + Add row
              </button>
            </div>
            {lines.map((l, i) => (
              <div
                key={i}
                className="p-3 grid grid-cols-12 gap-2 items-center"
              >
                <input
                  className="col-span-5 border rounded-lg px-2 py-1 text-sm"
                  value={l.description}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, description: e.target.value } : x
                      )
                    )
                  }
                />
                <input
                  type="number"
                  step="0.01"
                  className="col-span-2 border rounded-lg px-2 py-1 text-sm text-right tabular-nums"
                  value={l.amount}
                  onChange={(e) =>
                    setLines((prev) =>
                      prev.map((x, j) =>
                        j === i ? { ...x, amount: Number(e.target.value) } : x
                      )
                    )
                  }
                />
                <CategoryPicker
                  className="col-span-4"
                  value={l.category_id}
                  categories={categories}
                  onChange={(id) =>
                    setLines((prev) =>
                      prev.map((x, j) => (j === i ? { ...x, category_id: id } : x))
                    )
                  }
                  onCreated={(cat) =>
                    setCategories((prev) => [...prev, cat])
                  }
                />
                <button
                  className="col-span-1 text-red-500 inline-flex justify-center"
                  onClick={() =>
                    setLines((prev) => prev.filter((_, j) => j !== i))
                  }
                  aria-label="Remove row"
                >
                  <IconClose size={16} strokeWidth={2} />
                </button>
              </div>
            ))}
            {lines.length === 0 && (
              <p className="p-4 text-sm text-gray-500 text-center">
                No items extracted. Add rows manually if needed.
              </p>
            )}
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => {
                setResult(null);
                setLines([]);
                setMerchant("");
              }}
              className="px-4 py-2 rounded-lg bg-gray-100 text-sm font-semibold"
              disabled={busy}
            >
              Discard
            </button>
            <button
              onClick={save}
              disabled={busy || lines.length === 0}
              className="ml-auto px-4 py-2 rounded-lg bg-emerald-500 text-white font-semibold hover:bg-emerald-600 disabled:opacity-50"
            >
              {busy ? "Saving…" : `Save ${lines.length} expenses`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}
