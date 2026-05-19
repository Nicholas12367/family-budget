// One-off script: generate orange admin icons from the existing emerald
// budget-app icons. Reads icon-192.png and icon-512.png, hue-rotates the
// non-transparent pixels from emerald (~150°) toward orange (~25°), and
// writes icon-admin-192.png + icon-admin-512.png.

import sharp from "sharp";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicDir = join(__dirname, "..", "public");

async function recolor(srcName, outName) {
  const src = join(publicDir, srcName);
  const out = join(publicDir, outName);

  // Hue rotation: emerald (~150°) → orange (~25°). That's a -125° shift
  // which sharp expresses as a 235° forward rotation, or we can use the
  // recomb matrix to do it explicitly. Easiest path: use modulate with
  // hue parameter (degrees of forward shift).
  // Emerald #10b981 has hue ~158°. Orange #f97316 has hue ~25°.
  // Shift = (25 - 158 + 360) % 360 = 227°.
  await sharp(src)
    .modulate({ hue: 227, saturation: 1.1, brightness: 1.05 })
    .toFile(out);

  console.log(`✓ wrote ${outName}`);
}

await recolor("icon-192.png", "icon-admin-192.png");
await recolor("icon-512.png", "icon-admin-512.png");
await recolor("apple-touch-icon.png", "apple-touch-icon-admin.png");

console.log("done.");
