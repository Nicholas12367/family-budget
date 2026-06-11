// Client-side helper: load an image File, downscale it, re-encode as JPEG.
// Real-world phone photos are messy:
//   - iPhones often deliver HEIC/HEIF (sometimes with an empty MIME type).
//   - Long-receipt JPEGs can be 8–12 MB.
//   - Older iOS Safari can't decode HEIC via createImageBitmap, but CAN
//     decode it via an <img> element. We try both before giving up.
// We aim to land under ~2 MB so the upload fits inside the Vercel
// Server Action body cap with plenty of headroom for FormData boundaries,
// base64 expansion in the action, and slow mobile uploads.

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

export type CompressFailure = {
  kind: "decode-failed" | "encode-failed" | "too-large";
  message: string;
};

export class ImageProcessingError extends Error {
  kind: CompressFailure["kind"];
  constructor(failure: CompressFailure) {
    super(failure.message);
    this.kind = failure.kind;
    this.name = "ImageProcessingError";
  }
}

function isHeic(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === "image/heic" ||
    file.type === "image/heif" ||
    /\.(heic|heif)$/.test(name)
  );
}

function looksLikeImage(file: File): boolean {
  if (file.type.startsWith("image/")) return true;
  // iOS sometimes hands back HEIC with an empty MIME type.
  return /\.(heic|heif|jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name);
}

async function decodeViaBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

async function decodeViaImgTag(file: File): Promise<ImageBitmap | null> {
  // Safari can decode HEIC through an <img> element even when
  // createImageBitmap rejects it. Decode the <img>, then turn it back
  // into an ImageBitmap so the caller has one consistent shape.
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = async () => {
      try {
        const bitmap = await createImageBitmap(img);
        resolve(bitmap);
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// Defaults tuned for receipt OCR + Vercel/Supabase free tiers.
//
// We cap WIDTH, not the longest edge. Receipts are tall and narrow; what
// matters for legibility is horizontal resolution (enough pixels across each
// line of text), while height scales with how many items are on the receipt.
// The old "longest-edge = 1100px" rule crushed a long receipt's height down
// to 1100px, squeezing dozens of rows into a few hundred pixels and rendering
// the text unreadable — which made the scanner misread or stall on exactly the
// big receipts it most needed to handle. Capping width at 1000px keeps text
// crisp while letting tall receipts stay tall (up to maxHeight).
//
// quality 0.78 cuts upload bytes ~35% vs 0.85 with no observable accuracy loss.
export async function compressImage(
  file: File,
  maxWidth = 1000,
  quality = 0.78,
  maxHeight = 3500
): Promise<File> {
  if (!looksLikeImage(file)) {
    throw new ImageProcessingError({
      kind: "decode-failed",
      message:
        "That file doesn't look like an image. Pick a JPEG, PNG, HEIC, or WEBP photo.",
    });
  }

  const heic = isHeic(file);

  // Tiny non-HEIC files are already small enough; skip the round-trip.
  if (!heic && file.size < 500 * 1024) return file;

  let bitmap = await decodeViaBitmap(file);
  if (!bitmap) bitmap = await decodeViaImgTag(file);

  if (!bitmap) {
    if (heic) {
      throw new ImageProcessingError({
        kind: "decode-failed",
        message:
          "Your browser can't decode this HEIC photo. Easiest fix: on iPhone, open Settings → Camera → Formats and switch to 'Most Compatible' (JPEG). Existing HEIC photos can be saved as JPEG via Files, or screenshotted as a workaround.",
      });
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new ImageProcessingError({
        kind: "too-large",
        message:
          "Couldn't downscale this image and it's too large to upload as-is. Try saving the photo as JPEG and re-uploading.",
      });
    }
    return file;
  }

  // Cap width for legibility; cap height only as a safety ceiling so an
  // extremely long receipt can't balloon the upload. Whichever constraint
  // bites harder wins, preserving aspect ratio.
  const scale = Math.min(
    1,
    maxWidth / bitmap.width,
    maxHeight / bitmap.height
  );
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close?.();
    throw new ImageProcessingError({
      kind: "encode-failed",
      message:
        "Your browser couldn't allocate a canvas to compress the photo. Try closing tabs and retrying.",
    });
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  // Iterate quality + edge size down until we land under MAX_UPLOAD_BYTES.
  let q = quality;
  let blob = await canvasToBlob(canvas, "image/jpeg", q);
  while (blob && blob.size > MAX_UPLOAD_BYTES && q > 0.4) {
    q -= 0.08;
    blob = await canvasToBlob(canvas, "image/jpeg", q);
  }
  // Still too big? Iteratively shrink the canvas until under target.
  // Caps at 4 passes so ultra-long receipts terminate even if every pass
  // saves less than expected.
  let curCanvas = canvas;
  for (let pass = 0; pass < 4 && blob && blob.size > MAX_UPLOAD_BYTES; pass++) {
    const scaleDown = 0.7;
    const nw = Math.max(1, Math.round(curCanvas.width * scaleDown));
    const nh = Math.max(1, Math.round(curCanvas.height * scaleDown));
    const c2 = document.createElement("canvas");
    c2.width = nw;
    c2.height = nh;
    const ctx2 = c2.getContext("2d");
    if (!ctx2) break;
    ctx2.drawImage(curCanvas, 0, 0, nw, nh);
    curCanvas = c2;
    blob = await canvasToBlob(curCanvas, "image/jpeg", 0.72);
  }

  if (!blob) {
    throw new ImageProcessingError({
      kind: "encode-failed",
      message: "Browser couldn't encode the compressed image.",
    });
  }

  // Final safety net: if after all passes we're still over the cap, the
  // server will reject this. Surface a clear error rather than letting
  // it bubble up as a masked Server Action error.
  if (blob.size > MAX_UPLOAD_BYTES) {
    throw new ImageProcessingError({
      kind: "too-large",
      message:
        "Couldn't shrink this photo small enough to upload. Try retaking the photo with the receipt filling more of the frame.",
    });
  }

  // If the encoded JPEG is somehow larger than the original AND the
  // original is already a small JPEG/PNG, return the original.
  if (!heic && blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
