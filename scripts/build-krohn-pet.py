#!/usr/bin/env python3
"""Build the KROHN chibi pet spritesheet from AI-generated MP4 clips.

Usage:
  python scripts/build-krohn-pet.py <chibi_dir> <out_dir>

Requires: ffmpeg on PATH, Pillow.

Dreamina clips carry watermarks (top-left "AI" chip, bottom-right "Dreamina AI").
They are covered with pure-black rectangles before any processing; the border
flood-fill that keys out the background then removes them entirely.
"""
from __future__ import annotations
import json
import subprocess
import sys
import os
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "krohn chibi"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "packaging" / "pets" / "krohn-chibi"
OUT.mkdir(parents=True, exist_ok=True)

FRAME_W, FRAME_H = 192, 208
COLS, ROWS = 8, 9
SHEET_W, SHEET_H = FRAME_W * COLS, FRAME_H * ROWS

# Maps video roles to expected prefixes in the chibi folder (filenames carry
# legacy Spanish bytes; resolve by prefix rather than exact match).
VIDEO_FILES = {
    "breathing": "NEW_chibi_10.mp4",       # idle / jump source (portrait clip)
    "wobble": "Wobbling_animation_with_error_sy",  # failed (portrait clip)
    "work": "work_concentration.mp4",      # concentration (960x960, watermarked)
    "think": "think_lightbulb.mp4",        # thinking (960x960, watermarked)
    "code": "code_typing.mp4",             # code on visor (960x960, watermarked)
    "loading": "loading_spinner.mp4",      # LOADING face (960x960, watermarked)
}

def resolve_video(prefix_or_name: str):
    exact = SRC / prefix_or_name
    if exact.is_file():
        return exact
    for f in SRC.iterdir():
        if f.is_file() and f.name.startswith(prefix_or_name):
            return f
    return None

# Watermark rectangles (960x960 Dreamina clips), painted black before processing.
def cover_watermarks(img: Image.Image) -> Image.Image:
    w, h = img.size
    if w != 960 or h != 960:
        return img
    img = img.convert("RGB")
    px = img.load()
    for x in range(0, 86):
        for y in range(0, 86):
            px[x, y] = (0, 0, 0)
    for x in range(726, w):
        for y in range(862, h):
            px[x, y] = (0, 0, 0)
    return img

def split_frames(src: Path, dest_dir: Path, is_watermarked: bool) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    # 6 equally spread samples; clips are ~5s
    for i in range(6):
        t = (i + 0.5) * (5.0 / 6)
        out = dest_dir / f"{src.stem}_{i}.png"
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-ss", f"{t:.3f}",
            "-i", str(src),
            "-frames:v", "1",
            str(out),
        ]
        subprocess.run(cmd, check=True)
        if is_watermarked:
            img = Image.open(out)
            cover_watermarks(img).save(out)

def alpha_standalone(img: Image.Image) -> Image.Image:
    import collections
    src = img.convert("RGB")
    w, h = src.size
    px = src.load()
    lum = [[(px[x, y][0] * 299 + px[x, y][1] * 587 + px[x, y][2] * 114) // 1000 for x in range(w)] for y in range(h)]
    is_bg = [[v < 16 for v in row] for row in lum]
    visited = [[False] * w for _ in range(h)]
    dq = collections.deque()
    for x in range(w):
        if is_bg[0][x]:
            dq.append((x, 0)); visited[0][x] = True
        if is_bg[h - 1][x]:
            dq.append((x, h - 1)); visited[h - 1][x] = True
    for y in range(h):
        if is_bg[y][0]:
            dq.append((0, y)); visited[y][0] = True
        if is_bg[y][w - 1]:
            dq.append((w - 1, y)); visited[y][w - 1] = True
    while dq:
        x, y = dq.popleft()
        for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx] and is_bg[ny][nx]:
                visited[ny][nx] = True
                dq.append((nx, ny))
    out = src.convert("RGBA")
    alpha = Image.new("L", (w, h), 255)
    a_px = alpha.load()
    for y in range(h):
        for x in range(w):
            if visited[y][x]:
                a_px[x, y] = 0
    out.putalpha(alpha)
    return out

def cell_from_frame(frame_path: Path) -> Image.Image:
    img = Image.open(frame_path)
    ap = alpha_standalone(img)
    bbox = ap.getbbox()
    if bbox is None:
        raise ValueError(f"empty frame {frame_path}")
    crop = ap.crop(bbox)
    scale = min((FRAME_W - 12) / crop.width, (FRAME_H - 12) / crop.height)
    nw, nh = max(1, int(crop.width * scale)), max(1, int(crop.height * scale))
    crop = crop.resize((nw, nh), Image.LANCZOS)
    cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    cell.paste(crop, ((FRAME_W - nw) // 2, (FRAME_H - nh) // 2), crop)
    return cell

def build_row(frames: list[Image.Image]) -> Image.Image:
    row = Image.new("RGBA", (FRAME_W * COLS, FRAME_H), (0, 0, 0, 0))
    for i in range(COLS):
        fr = frames[i % len(frames)]
        row.paste(fr, (i * FRAME_W, 0), fr)
    return row

paths = {}
for role, needle in VIDEO_FILES.items():
    resolved = resolve_video(needle)
    if resolved is None:
        raise FileNotFoundError(f"missing clip for {role}: {needle}*")
    paths[role] = resolved

src_breath = paths["breathing"]
src_wobble = paths["wobble"]
src_work = paths["work"]
src_think = paths["think"]
src_code = paths["code"]
src_loading = paths["loading"]

print("videos:")
for name, src in [("breathing", src_breath), ("wobble", src_wobble), ("work", src_work), ("think", src_think), ("code", src_code), ("loading", src_loading)]:
    print(" ", name, src.name)

work = OUT / "_frames"
work.mkdir(parents=True, exist_ok=True)
for key, src in [("breathing", src_breath), ("wobble", src_wobble), ("work", src_work), ("think", src_think), ("code", src_code), ("loading", src_loading)]:
    # the four Dreamina 960x960 clips carry the watermark (TL "AI" chip, BR "Dreamina AI")
    watermarked = src.stem in {"work_concentration", "think_lightbulb", "code_typing", "loading_spinner"}
    split_frames(src, work / key, watermarked)

def load_cells(name: str) -> list[Image.Image]:
    cells = sorted((work / name).glob("*.png"), key=lambda p: int(p.stem.rsplit("_", 1)[1]))
    return [cell_from_frame(p) for p in cells]

idle_cells = load_cells("breathing")
wobble_cells = load_cells("wobble")
work_cells = load_cells("work")
think_cells = load_cells("think")
code_cells = load_cells("code")
loading_cells = load_cells("loading")

run_left = [c.transpose(Image.FLIP_LEFT_RIGHT) for c in work_cells]

jump_cells = [Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0)) for _ in range(6)]
offsets = [0, -8, -16, -16, -8, 0]
for i, off in enumerate(offsets):
    src = idle_cells[i % len(idle_cells)]
    jc = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    jc.paste(src, (0, off), src)
    jump_cells[i] = jc

# Codex 9-row taxonomy order: idle, running-right, running-left, waving, jumping, failed, waiting, running, review
rows = []
rows.extend([
    build_row(idle_cells),          # 0 idle
    build_row(work_cells),          # 1 running-right
    build_row(run_left),            # 2 running-left
    build_row(think_cells),         # 3 waving
    build_row(jump_cells),          # 4 jumping
    build_row(wobble_cells),        # 5 failed
    build_row(loading_cells),       # 6 waiting
    build_row(code_cells),          # 7 running (typing on the visor)
    build_row(think_cells),         # 8 review (thinking, full pulse)
])

sheet = Image.new("RGBA", (SHEET_W, SHEET_H), (0, 0, 0, 0))
y = 0
for row in rows:
    sheet.paste(row, (0, y))
    y += FRAME_H
sheet.save(OUT / "spritesheet.png", optimize=True)

pet_json = {
    "id": "krohn-chibi",
    "displayName": "KROHN Chibi",
    "description": "Pixel-art chibi KROHN chibi mark for pet overlay + terminal. Built from AI-generated animated clips (Dreamina + KROHN); 9-row x 8-col sheet, 192x208 cells.",
    "spritesheetPath": "spritesheet.png",
    "framework": "krohn-chibi",
    "license": "MIT",
    "author": "Cesar D. Ciprian"
}
(OUT / "pet.json").write_text(json.dumps(pet_json, indent=2), encoding="utf-8")
print("wrote", OUT / "spritesheet.png")
