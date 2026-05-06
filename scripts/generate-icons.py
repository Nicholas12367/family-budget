"""Generate Budget App PWA icons.

Produces three PNGs in public/:
  - icon-512.png  (Android / Chrome)
  - icon-192.png  (Android / Chrome)
  - apple-touch-icon.png  (180x180 for iOS home screen)

Design: rounded-square gradient (emerald → teal) with a clean, bold white
dollar mark and a subtle bar-chart accent at the bottom — reads as "Budget".
"""

import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Arial Black.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
]


def load_font(px: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if os.path.exists(path):
            return ImageFont.truetype(path, px)
    return ImageFont.load_default()


def render_icon(size: int, *, ios: bool = False) -> Image.Image:
    s = size * 4  # supersample for crisp edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    # --- Gradient background ----------------------------------------------
    grad = Image.new("RGBA", (1, s))
    top = (52, 211, 153)  # emerald-400
    bot = (4, 120, 87)  # emerald-700
    for y in range(s):
        t = y / (s - 1)
        r = int(top[0] * (1 - t) + bot[0] * t)
        g = int(top[1] * (1 - t) + bot[1] * t)
        b = int(top[2] * (1 - t) + bot[2] * t)
        grad.putpixel((0, y), (r, g, b, 255))
    grad = grad.resize((s, s))

    # Rounded mask (skip rounding for iOS — it applies its own).
    mask = Image.new("L", (s, s), 0)
    md = ImageDraw.Draw(mask)
    if ios:
        md.rectangle((0, 0, s, s), fill=255)
    else:
        md.rounded_rectangle((0, 0, s, s), radius=int(s * 0.22), fill=255)

    bg = Image.composite(grad, Image.new("RGBA", (s, s), (0, 0, 0, 0)), mask)

    # Soft top highlight
    glow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-s * 0.2, -s * 0.7, s * 1.2, s * 0.5), fill=(255, 255, 255, 50))
    glow = glow.filter(ImageFilter.GaussianBlur(radius=s * 0.05))
    glow = Image.composite(glow, Image.new("RGBA", (s, s)), mask)
    bg = Image.alpha_composite(bg, glow)

    # --- Bar-chart accent at the bottom (subtle "budget" hint) ------------
    bars_layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    bd = ImageDraw.Draw(bars_layer)
    base_y = s * 0.78
    bar_w = s * 0.07
    gap = s * 0.04
    # 4 ascending bars centered horizontally
    heights = [s * 0.10, s * 0.14, s * 0.18, s * 0.22]
    total_w = bar_w * 4 + gap * 3
    start_x = (s - total_w) / 2
    for i, h in enumerate(heights):
        x0 = start_x + i * (bar_w + gap)
        bd.rounded_rectangle(
            (x0, base_y - h, x0 + bar_w, base_y),
            radius=bar_w * 0.3,
            fill=(255, 255, 255, 70),
        )
    bars_layer = Image.composite(bars_layer, Image.new("RGBA", (s, s)), mask)
    bg = Image.alpha_composite(bg, bars_layer)

    # --- Big bold dollar sign rendered from font for crisp curves --------
    fg = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(fg)
    font_px = int(s * 0.62)
    font = load_font(font_px)
    text = "$"
    bbox = d.textbbox((0, 0), text, font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    tx = (s - tw) / 2 - bbox[0]
    ty = (s - th) / 2 - bbox[1] - s * 0.06
    # subtle drop shadow for depth
    shadow = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    sd = ImageDraw.Draw(shadow)
    sd.text((tx + s * 0.005, ty + s * 0.012), text, font=font, fill=(0, 0, 0, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=s * 0.012))
    bg = Image.alpha_composite(bg, shadow)
    d.text((tx, ty), text, font=font, fill=(255, 255, 255, 255))

    bg = Image.alpha_composite(bg, fg)

    return bg.resize((size, size), Image.LANCZOS)


def save(img: Image.Image, path: str, ios: bool = False):
    if ios:
        # iOS prefers no alpha for the home-screen icon.
        flat = Image.new("RGB", img.size, (4, 120, 87))
        flat.paste(img, mask=img.split()[3] if img.mode == "RGBA" else None)
        flat.save(path, "PNG", optimize=True)
    else:
        img.save(path, "PNG", optimize=True)


if __name__ == "__main__":
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else "public"
    save(render_icon(512), f"{out}/icon-512.png")
    save(render_icon(192), f"{out}/icon-192.png")
    save(render_icon(180, ios=True), f"{out}/apple-touch-icon.png", ios=True)
    print(f"wrote icons to {out}/")
