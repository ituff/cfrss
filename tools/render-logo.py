"""Render the CFRss logo SVG into the PNG icon set. Run from the repo root."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "icons" / "logo.svg"
OUT = ROOT / "public" / "icons"

try:
    import cairosvg
except ImportError:
    print("MISSING cairosvg")
    sys.exit(2)

sizes = [16, 32, 48, 96, 180, 192, 256, 512]
for s in sizes:
    png = OUT / f"icon-{s}x{s}.png"
    cairosvg.svg2png(url=str(SRC), write_to=str(png),
                     output_width=s, output_height=s)
    print(f"{png.name:24} {png.stat().st_size:>7} bytes")

# favicon.ico embeds several sizes for legacy/bookmark-bar use
import io
from PIL import Image
ico_sizes = [16, 32, 48]
imgs = []
for s in ico_sizes:
    buf = io.BytesIO()
    cairosvg.svg2png(url=str(SRC), write_to=buf, output_width=s, output_height=s)
    buf.seek(0)
    imgs.append(Image.open(buf).convert("RGBA"))
ico = OUT / "favicon.ico"
imgs[0].save(ico, format="ICO", sizes=[(s, s) for s in ico_sizes])
print(f"{ico.name:24} {ico.stat().st_size:>7} bytes")

# NOTE: no separate logo.png is emitted. It used to be a byte-identical copy of
# icon-512x512.png and was referenced by nothing; use icon-512x512.png (or
# logo.svg for vectors) instead.
