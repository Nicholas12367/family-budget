// Client-side helper: load an image File, downscale it, re-encode as JPEG.
// Real-world phone photos are messy:
//   - iPhones often deliver HEIC/HEIF (sometimes with an empty MIME type).
//   - Long-receipt JPEGs can be 8–12 MB.
//   - Older iOS Safari can't decode HEIC via createImageBitmap, but CAN
//     decode it via an <img> element. We try both before giving up.
// We aim to land under ~3.5 MB so the upload fits inside the Vercel
// Server Action body cap with overhead for FormData boundaries.

const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024;

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

export async function compressImage(
  file: File,
  maxEdge = 1600,
  quality = 0.85
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
  if (!heic && file.size < 700 * 1024) return file;

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

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
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
    q -= 0.1;
    blob = await canvasToBlob(canvas, "image/jpeg", q);
  }
  // Still too big? Shrink the canvas in-place and re-encode at the
  // original quality. This handles ultra-long receipts cleanly.
  if (blob && blob.size > MAX_UPLOAD_BYTES) {
    const smallerEdge = Math.round(Math.max(canvas.width, canvas.height) * 0.7);
    const sx = Math.min(1, smallerEdge / Math.max(canvas.width, canvas.height));
    const nw = Math.max(1, Math.round(canvas.width * sx));
    const nh = Math.max(1, Math.round(canvas.height * sx));
    const c2 = document.createElement("canvas");
    c2.width = nw;
    c2.height = nh;
    const ctx2 = c2.getContext("2d");
    if (ctx2) {
      ctx2.drawImage(canvas, 0, 0, nw, nh);
      blob = await canvasToBlob(c2, "image/jpeg", 0.75);
    }
  }

  if (!blob) {
    throw new ImageProcessingError({
      kind: "encode-failed",
      message: "Browser couldn't encode the compressed image.",
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
