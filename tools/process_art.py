#!/usr/bin/env python3
"""Turn chosen raw portraits (art/picks.json: set -> key -> raw file) into alpha masks img/pieces/<set>/<key>.webp.
Raw files of the classic set are in art/raw, of other sets in art/raw/<set>. The mask is tinted per army in CSS (mask-image).
Usage: process_art.py [set ...]  (default: all sets)"""
import json, os, sys
from PIL import Image, ImageFilter, ImageOps

ROOT = os.path.join(os.path.dirname(__file__), "..")
picks = json.load(open(os.path.join(ROOT, "art", "picks.json")))
SIZE = 256

for set_name, key, spec in [(s, k, v) for s in (sys.argv[1:] or picks) for k, v in picks[s].items()]:
    raw = os.path.join(ROOT, "art", "raw", *([] if set_name == "classic" else [set_name]))
    OUT = os.path.join(ROOT, "img", "pieces", set_name)
    os.makedirs(OUT, exist_ok=True)
    name, crop = (spec, None) if isinstance(spec, str) else (spec["file"], spec.get("crop"))
    im = Image.open(os.path.join(raw, name)).convert("L")
    if crop:  # [left, top, right, bottom] as fractions
        w, h = im.size
        im = im.crop((int(crop[0] * w), int(crop[1] * h), int(crop[2] * w), int(crop[3] * h)))
    # Bounding box of the ink, padded to a square.
    ink = im.point(lambda v: 255 if v < 170 else 0)
    bbox = ink.getbbox() or (0, 0, *im.size)
    l, t, r, b = bbox
    side = int(max(r - l, b - t) * 1.04)
    cx, cy = (l + r) // 2, (t + b) // 2
    pad = ImageOps.expand(im, border=side, fill=255)  # crop beyond the edge stays white
    sq = pad.crop((cx - side // 2 + side, cy - side // 2 + side, cx + side // 2 + side, cy + side // 2 + side))
    sq = sq.resize((SIZE, SIZE), Image.LANCZOS)
    sq = sq.filter(ImageFilter.UnsharpMask(radius=1.2, percent=80, threshold=2))
    lo, hi = 50, 225
    alpha = sq.point(lambda v: 255 if v <= lo else 0 if v >= hi else int((hi - v) / (hi - lo) * 255))
    out = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    out.putalpha(alpha)
    path = os.path.join(OUT, f"{key}.webp")
    out.save(path, "WEBP", quality=88, method=6)
    print(set_name, key, name, os.path.getsize(path), "bytes")
