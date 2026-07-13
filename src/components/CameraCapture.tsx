"use client";

// In-app document camera for receipts.
//
// Why a custom camera instead of a plain <input capture>: the native file
// picker gives us no control over framing, so users photograph the whole
// table and the receipt ends up as a small patch in a big noisy image. Here
// we show a live preview and, like a real document scanner, AUTO-SIZE to the
// actual receipt: a lightweight detector runs a few times a second, finds the
// bright paper region, and the on-screen outline snaps to it. On capture we
// crop to that detected box — so what reaches the scanner is the receipt, not
// the background, and a long/tall receipt is captured at its true size instead
// of being cut off by a fixed frame. Tapping the shutter is the default
// action; a small gallery button in the corner lets people pick an existing
// photo instead.
//
// Detection method (deliberately cheap): each tick we draw the video frame
// downscaled onto a tiny hidden canvas (longest side ~280px), convert to
// grayscale, pick a brightness threshold via Otsu, then use row/column
// projection — the fraction of "bright" pixels per row and per column. The
// receipt is the contiguous band of rows and columns whose bright-fraction
// clears a cutoff, which naturally grows tall for long receipts. If nothing
// clear is found (no bright region, or a degenerate box that's tiny or nearly
// the whole frame), we fall back to a sensible centered default rectangle —
// the classic fixed-frame behavior — and never produce an empty crop.
//
// Falls back gracefully: if getUserMedia isn't available or permission is
// denied, we tell the caller so it can show the classic file-input UI.

import { useCallback, useEffect, useRef, useState } from "react";

// Detected receipt box in NORMALIZED [0..1] coordinates relative to the
// visible (object-fit: cover) video area. Null until/unless we have a
// confident detection; the overlay and capture both fall back to a default
// centered rectangle in that case.
type NormBox = { x: number; y: number; w: number; h: number };

// The classic fixed frame, used as the fallback when detection is uncertain.
// Matches the previous 74% x 80% centered outline.
const DEFAULT_BOX: NormBox = {
  x: (1 - 0.74) / 2,
  y: (1 - 0.8) / 2,
  w: 0.74,
  h: 0.8,
};

type Props = {
  onCapture: (file: File) => void;
  onPickFromGallery: (files: File[]) => void;
  onClose: () => void;
  // Called when the live camera can't be used (no API, denied, no device).
  onUnavailable: (reason: string) => void;
};

// Detect the receipt's bounding box from a small grayscale sample of the
// frame. Returns a NORMALIZED box in [0..1] relative to the sampled region
// (which is the visible, cover-cropped video area), or null if nothing
// confident was found. Pure/synchronous and cheap; caller guards it in
// try/catch and provides the tiny ImageData.
function detectReceiptBox(
  data: Uint8ClampedArray,
  w: number,
  h: number
): NormBox | null {
  if (w < 8 || h < 8) return null;
  const n = w * h;

  // Grayscale + 256-bin histogram in one pass.
  const gray = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    // Rec. 601 luma, integer-ish.
    const g = (data[p] * 77 + data[p + 1] * 150 + data[p + 2] * 29) >> 8;
    gray[i] = g;
    hist[g]++;
  }

  // Otsu threshold: maximize between-class variance.
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0;
  let wB = 0;
  let maxVar = -1;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = n - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) {
      maxVar = between;
      threshold = t;
    }
  }
  // Nudge up slightly so faint background doesn't count as "paper".
  const bright = threshold + 6;

  // Row and column projections: fraction of bright pixels.
  const rowFrac = new Float32Array(h);
  const colFrac = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    let count = 0;
    const base = y * w;
    for (let x = 0; x < w; x++) {
      if (gray[base + x] > bright) {
        count++;
        colFrac[x] += 1;
      }
    }
    rowFrac[y] = count / w;
  }
  for (let x = 0; x < w; x++) colFrac[x] /= h;

  // If almost nothing is bright, there's no paper to find.
  let brightTotal = 0;
  for (let y = 0; y < h; y++) brightTotal += rowFrac[y] * w;
  const brightRatio = brightTotal / n;
  if (brightRatio < 0.02) return null;

  // Contiguous band whose bright-fraction clears a cutoff. Use a cutoff
  // relative to the peak projection so it adapts to lighting.
  const rowPeak = Math.max(...rowFrac);
  const colPeak = Math.max(...colFrac);
  const rowCut = Math.max(0.15, rowPeak * 0.35);
  const colCut = Math.max(0.15, colPeak * 0.35);

  const band = (frac: Float32Array, len: number, cut: number) => {
    // Find the longest contiguous run over the cutoff; tolerate small gaps.
    let bestStart = -1;
    let bestEnd = -1;
    let curStart = -1;
    let gap = 0;
    const maxGap = Math.max(1, Math.round(len * 0.04));
    for (let i = 0; i < len; i++) {
      if (frac[i] >= cut) {
        if (curStart < 0) curStart = i;
        gap = 0;
        if (bestStart < 0 || i - curStart > bestEnd - bestStart) {
          bestStart = curStart;
          bestEnd = i;
        }
      } else if (curStart >= 0) {
        gap++;
        if (gap > maxGap) {
          curStart = -1;
          gap = 0;
        }
      }
    }
    if (bestStart < 0) return null;
    return { start: bestStart, end: bestEnd };
  };

  const rows = band(rowFrac, h, rowCut);
  const cols = band(colFrac, w, colCut);
  if (!rows || !cols) return null;

  let x0 = cols.start;
  let x1 = cols.end + 1;
  let y0 = rows.start;
  let y1 = rows.end + 1;

  const bw = x1 - x0;
  const bh = y1 - y0;
  // Reject degenerate boxes: too small, or basically the whole frame.
  const areaFrac = (bw * bh) / n;
  if (bw < w * 0.12 || bh < h * 0.12) return null;
  if (areaFrac > 0.985) return null;
  if (bw >= w * 0.99 && bh >= h * 0.99) return null;

  // Trim a small margin off each edge so the outline hugs the paper.
  const mx = bw * 0.02;
  const my = bh * 0.02;
  x0 += mx;
  x1 -= mx;
  y0 += my;
  y1 -= my;

  return {
    x: x0 / w,
    y: y0 / h,
    w: (x1 - x0) / w,
    h: (y1 - y0) / h,
  };
}

export default function CameraCapture({
  onCapture,
  onPickFromGallery,
  onClose,
  onUnavailable,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const galleryRef = useRef<HTMLInputElement | null>(null);
  const [ready, setReady] = useState(false);
  const [flash, setFlash] = useState(false);

  // The current detected box (normalized, relative to the visible video area).
  // Drives both the on-screen outline and the capture crop. Lives in a ref so
  // the detection interval can update it without re-render churn; a mirrored
  // piece of state animates the overlay. Null => use DEFAULT_BOX fallback.
  const boxRef = useRef<NormBox | null>(null);
  const [box, setBox] = useState<NormBox | null>(null);
  const [locked, setLocked] = useState(false);
  // Tiny offscreen canvas reused across ticks for the downscaled sample.
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const stop = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        onUnavailable("no_getusermedia");
        return;
      }
      try {
        // Prefer the rear camera at a high resolution so small receipt text
        // survives the crop.
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 2560 },
            height: { ideal: 1440 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const t of stream.getTracks()) t.stop();
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {});
          setReady(true);
        }
      } catch (e) {
        const name = (e as { name?: string })?.name || "error";
        onUnavailable(name);
      }
    }

    start();
    return () => {
      cancelled = true;
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live detection loop. Runs a few times a second while the camera is ready.
  // Everything is guarded: if anything throws we stop the loop and leave the
  // static default frame in place. Smoothing (exponential toward the new box)
  // keeps the outline from jittering.
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    // Exponential smoothing state, in normalized coords.
    const smooth = (prev: NormBox | null, next: NormBox): NormBox => {
      if (!prev) return next;
      const a = 0.35; // how fast the outline chases the detection
      return {
        x: prev.x + (next.x - prev.x) * a,
        y: prev.y + (next.y - prev.y) * a,
        w: prev.w + (next.w - prev.w) * a,
        h: prev.h + (next.h - prev.h) * a,
      };
    };

    const tick = () => {
      if (stopped) return;
      const video = videoRef.current;
      if (!video) return;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return;
      try {
        // Downscale so the longest side is ~280px. We sample the SAME visible
        // region the user sees (object-fit: cover center-crop), so the
        // normalized box maps straight onto the overlay and the crop.
        const rect = video.getBoundingClientRect();
        const dw = rect.width;
        const dh = rect.height;
        if (!dw || !dh) return;
        const coverScale = Math.max(dw / vw, dh / vh);
        const shownW = vw * coverScale;
        const shownH = vh * coverScale;
        // Visible source rect in video pixels.
        const srcW = dw / coverScale;
        const srcH = dh / coverScale;
        const srcX = (shownW - dw) / 2 / coverScale;
        const srcY = (shownH - dh) / 2 / coverScale;

        const longest = 280;
        const s = Math.min(1, longest / Math.max(srcW, srcH));
        const cw = Math.max(8, Math.round(srcW * s));
        const ch = Math.max(8, Math.round(srcH * s));

        let canvas = sampleCanvasRef.current;
        if (!canvas) {
          canvas = document.createElement("canvas");
          sampleCanvasRef.current = canvas;
        }
        if (canvas.width !== cw) canvas.width = cw;
        if (canvas.height !== ch) canvas.height = ch;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(video, srcX, srcY, srcW, srcH, 0, 0, cw, ch);
        const img = ctx.getImageData(0, 0, cw, ch);

        const found = detectReceiptBox(img.data, cw, ch);
        if (found) {
          const next = smooth(boxRef.current, found);
          boxRef.current = next;
          setBox(next);
          setLocked(true);
        } else {
          // No confident detection this tick: relax back toward null so the
          // overlay returns to the default frame rather than sticking on a
          // stale box.
          if (boxRef.current) {
            boxRef.current = null;
            setBox(null);
          }
          setLocked(false);
        }
      } catch {
        // Detection is best-effort. On any failure, stop the loop and keep the
        // static default frame; capture still works via the fallback path.
        stopped = true;
        if (timer) clearInterval(timer);
        boxRef.current = null;
        setBox(null);
        setLocked(false);
      }
    };

    // ~5 fps: cheap and responsive enough for a "snap to receipt" feel.
    timer = setInterval(tick, 200);
    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
  }, [ready]);

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // Map the visible (object-fit: cover) region into video pixel space, then
    // place the crop box inside it. The detection box is normalized relative
    // to exactly this visible region, so the same mapping applies whether we
    // use the detected box or the default fallback.
    const videoRect = video.getBoundingClientRect();
    const dw = videoRect.width;
    const dh = videoRect.height;
    const scale = Math.max(dw / vw, dh / vh); // px per video-px
    const shownW = vw * scale;
    const shownH = vh * scale;
    // The visible source rectangle in video pixels (what the user sees).
    const visW = dw / scale;
    const visH = dh / scale;
    const visX = (shownW - dw) / 2 / scale;
    const visY = (shownH - dh) / 2 / scale;

    // Prefer the detected box; fall back to the default centered rectangle if
    // detection is uncertain or produced nothing this session.
    let nb = boxRef.current ?? DEFAULT_BOX;
    // Guard against any degenerate/invalid box slipping through.
    if (
      !nb ||
      !isFinite(nb.x) ||
      !isFinite(nb.y) ||
      !isFinite(nb.w) ||
      !isFinite(nb.h) ||
      nb.w <= 0.02 ||
      nb.h <= 0.02
    ) {
      nb = DEFAULT_BOX;
    }

    // Add a small margin around the detected box so we don't shave the edges.
    const margin = 0.03;
    let nx = nb.x - nb.w * margin;
    let ny = nb.y - nb.h * margin;
    let nw = nb.w * (1 + margin * 2);
    let nh = nb.h * (1 + margin * 2);
    // Keep within the visible region [0..1].
    nx = Math.max(0, nx);
    ny = Math.max(0, ny);
    nw = Math.min(1 - nx, nw);
    nh = Math.min(1 - ny, nh);

    let sx = visX + nx * visW;
    let sy = visY + ny * visH;
    let sWidth = nw * visW;
    let sHeight = nh * visH;

    // Clamp to the source bounds.
    sx = Math.max(0, Math.min(sx, vw));
    sy = Math.max(0, Math.min(sy, vh));
    sWidth = Math.max(1, Math.min(sWidth, vw - sx));
    sHeight = Math.max(1, Math.min(sHeight, vh - sy));

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sWidth);
    canvas.height = Math.round(sHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(
      video,
      sx,
      sy,
      sWidth,
      sHeight,
      0,
      0,
      canvas.width,
      canvas.height
    );

    setFlash(true);
    setTimeout(() => setFlash(false), 180);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `receipt-${Date.now()}.jpg`, {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
        stop();
        onCapture(file);
      },
      "image/jpeg",
      0.92
    );
  }, [onCapture, stop]);

  return (
    <div className="fixed inset-0 z-50 bg-black">
      {/* Live preview */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="absolute inset-0 w-full h-full object-cover"
      />

      {/* Dim mask with a clear receipt-shaped cutout + bright outline. The
          frame is absolutely positioned from the (normalized) detected box so
          it visibly snaps to the receipt; when detection is uncertain it sits
          at the default centered rectangle. The huge box-shadow dims
          everything outside the outline. */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          ref={frameRef}
          className="absolute transition-all duration-150 ease-out"
          style={{
            left: `${(box ?? DEFAULT_BOX).x * 100}%`,
            top: `${(box ?? DEFAULT_BOX).y * 100}%`,
            width: `${(box ?? DEFAULT_BOX).w * 100}%`,
            height: `${(box ?? DEFAULT_BOX).h * 100}%`,
          }}
        >
          {/* Outline — brightens once we've locked onto a receipt. */}
          <div
            className={`absolute inset-0 rounded-2xl ring-2 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] transition-colors ${
              locked ? "ring-emerald-400" : "ring-emerald-400/70"
            }`}
          />
          {/* Corner ticks for a scanner feel */}
          {[
            "top-0 left-0 border-t-4 border-l-4 rounded-tl-2xl",
            "top-0 right-0 border-t-4 border-r-4 rounded-tr-2xl",
            "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-2xl",
            "bottom-0 right-0 border-b-4 border-r-4 rounded-br-2xl",
          ].map((c) => (
            <span
              key={c}
              className={`absolute w-7 h-7 border-emerald-300 ${c}`}
            />
          ))}
        </div>
      </div>

      {/* Shutter flash */}
      {flash && <div className="absolute inset-0 bg-white animate-pulse" />}

      {/* Top bar */}
      <div
        className="absolute top-0 inset-x-0 flex items-center justify-between px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <button
          type="button"
          onClick={() => {
            stop();
            onClose();
          }}
          aria-label="Close camera"
          className="w-10 h-10 rounded-full bg-black/40 text-white inline-flex items-center justify-center backdrop-blur"
        >
          <svg
            width="20"
            height="20"
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
        <span className="text-white/90 text-sm font-medium bg-black/35 px-3 py-1.5 rounded-full backdrop-blur">
          {locked ? "Receipt detected — tap to capture" : "Point at the receipt — we'll size to it"}
        </span>
        <span className="w-10" />
      </div>

      {/* Bottom controls: gallery (corner) + shutter (center) */}
      <div
        className="absolute bottom-0 inset-x-0 flex items-center justify-center px-8"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1.75rem)" }}
      >
        {/* Gallery button, bottom-left corner */}
        <input
          ref={galleryRef}
          type="file"
          accept="image/*,.heic,.heif"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length) {
              stop();
              onPickFromGallery(Array.from(files));
            }
            if (galleryRef.current) galleryRef.current.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          aria-label="Choose from gallery"
          className="absolute left-8 w-12 h-12 rounded-2xl bg-white/15 text-white inline-flex items-center justify-center backdrop-blur ring-1 ring-white/30"
        >
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="9" cy="9" r="2" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        </button>

        {/* Shutter */}
        <button
          type="button"
          onClick={capture}
          disabled={!ready}
          aria-label="Take photo"
          className="w-[74px] h-[74px] rounded-full bg-white ring-4 ring-white/40 disabled:opacity-40 active:scale-95 transition inline-flex items-center justify-center"
        >
          <span className="w-[60px] h-[60px] rounded-full bg-white ring-2 ring-black/10" />
        </button>
      </div>
    </div>
  );
}
