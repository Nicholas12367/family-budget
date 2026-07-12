"use client";

// In-app document camera for receipts.
//
// Why a custom camera instead of a plain <input capture>: the native file
// picker gives us no control over framing, so users photograph the whole
// table and the receipt ends up as a small patch in a big noisy image. Here
// we show a live preview with a receipt-shaped outline, and on capture we crop
// to exactly that outline — so what reaches the scanner is the receipt, not
// the background. Tapping the shutter is the default action; a small gallery
// button in the corner lets people pick an existing photo instead.
//
// Falls back gracefully: if getUserMedia isn't available or permission is
// denied, we tell the caller so it can show the classic file-input UI.

import { useCallback, useEffect, useRef, useState } from "react";

type Props = {
  onCapture: (file: File) => void;
  onPickFromGallery: (files: File[]) => void;
  onClose: () => void;
  // Called when the live camera can't be used (no API, denied, no device).
  onUnavailable: (reason: string) => void;
};

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

  const capture = useCallback(() => {
    const video = videoRef.current;
    const frame = frameRef.current;
    if (!video || !frame) return;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return;

    // Map the on-screen outline rectangle into the video's pixel space,
    // accounting for object-fit: cover (the video is scaled up and center-
    // cropped to fill the container).
    const videoRect = video.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect();
    const dw = videoRect.width;
    const dh = videoRect.height;
    const scale = Math.max(dw / vw, dh / vh); // px per video-px
    const shownW = vw * scale;
    const shownH = vh * scale;
    const offsetX = (shownW - dw) / 2; // cropped-off amount each side
    const offsetY = (shownH - dh) / 2;

    const gx = frameRect.left - videoRect.left;
    const gy = frameRect.top - videoRect.top;

    let sx = (gx + offsetX) / scale;
    let sy = (gy + offsetY) / scale;
    let sWidth = frameRect.width / scale;
    let sHeight = frameRect.height / scale;

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
          cutout is drawn by stacking four dim panels around the frame so the
          area inside the outline stays fully clear. */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 flex items-center justify-center">
          <div
            ref={frameRef}
            className="relative"
            style={{ width: "74%", height: "80%", maxWidth: 460 }}
          >
            {/* Outline */}
            <div className="absolute inset-0 rounded-2xl ring-2 ring-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" />
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
          Fit the receipt inside the frame
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
