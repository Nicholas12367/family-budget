// Client-side helper: load an image File, downscale it, re-encode as JPEG.
// Receipts photos from a phone are 4-12 MB; Vercel's Server Action body cap is
// configured at 8 MB, but we want to stay well under and also reduce upload
// time. ~1600 px on the long edge at quality 0.85 is enough resolution for
// Gemini to read most receipts cleanly while landing under 1 MB.

export async function compressImage(
  file: File,
  maxEdge = 1600,
  quality = 0.85
): Promise<File> {
  // Skip compression for already-small files
  if (file.size < 700 * 1024) return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
  if (!blob) return file;

  // If compression somehow made it bigger, return original
  if (blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", {
    type: "image/jpeg",
    lastModified: Date.now(),
  });
}
