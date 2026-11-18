#!/usr/bin/env python3
"""Build the KROHN Ultron-chibi pet spritesheet from AI-generated MP4 clips.

Usage:
  python scripts/build-ultron-pet.py <chibi_dir> <out_dir>

Requires: ffmpeg on PATH, Pillow.
"""
from __future__ import annotations
import subprocess
import sys
import os
from pathlib import Path
from PIL import Image

SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / "krohn chibi"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).resolve().parents[1] / "packaging" / "pets" / "krohn-ultron-chibi"
OUT.mkdir(parents=True, exist_ok=True)

FRAME_W, FRAME_H = 192, 208
COLS, ROWS = 8, 9
SHEET_W, SHEET_H = FRAME_W * COLS, FRAME_H * ROWS

# Maps video roles to the actual files present in the chibi folder.
VIDEO_FILES = {
    "breathing": "NEW_chibi_10.mp4",
    "movement": "NEW_chibi_0.mp4",
    "thinking": "NEW_chibi_1.mp4",
    "code": "NEW_chibi_9.mp4",
    "loading": "NEW_chibi_11.mp4",
    "error": "NEW_chibi_12.mp4",
}


def find_video(_: list[str]) -> Path | None:
    raise NotImplementedError("replaced by VIDEO_FILES")

def split_frames(src: Path, dest_dir: Path) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    # 6 equally-spaced samples from a 4s @ 24fps clip
    for i in range(6):
        t = (i + 0.5) * (4.0 / 6)
        out = dest_dir / f"{src.stem}_{i}.png"
        cmd = [
            "ffmpeg", "-y", "-v", "error",
            "-ss", f"{t:.3f}",
            "-i", str(src),
            "-frames:v", "1",
            str(out),
        ]
        subprocess.run(cmd, check=True)

def alpha_standalone(img: Image.Image) -> Image.Image:
    import collections
    src = img.convert("RGB")
    w, h = src.size
    px = src.load()
    # near-black seeds
    lum = [[(px[x, y][0] * 299 + px[x, y][1] * 587 + px[x, y][2] * 114) // 1000 for x in range(w)] for y in range(h)]
    is_bg = [[v < 48 for v in row] for row in lum]
    visited = [[False] * w for _ in range(h)]
    dq = collections.deque()
    # seed from border
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
    img = Image.open(frame_path).convert("RGBA")
    ap = alpha_standalone(img)
    # compute bounding box of non-transparent pixels
    bbox = ap.getbbox()
    if bbox is None:
        raise ValueError(f"empty frame {frame_path}")
    crop = ap.crop(bbox)
    # scale to fit inside 192x208 with margin
    scale = min((FRAME_W - 10) / crop.width, (FRAME_H - 10) / crop.height)
    nw, nh = max(1, int(crop.width * scale)), max(1, int(crop.height * scale))
    crop = crop.resize((nw, nh), Image.NEAREST)
    cell = Image.new("RGBA", (FRAME_W, FRAME_H), (0, 0, 0, 0))
    cell.paste(crop, ((FRAME_W - nw) // 2, (FRAME_H - nh) // 2), crop)
    return cell

def build_row(frames: list[Image.Image]) -> Image.Image:
    row = Image.new("RGBA", (FRAME_W * COLS, FRAME_H), (0, 0, 0, 0))
    for i in range(COLS):
        # reuse frames if fewer than 8
        fr = frames[i % len(frames)]
        row.paste(fr, (i * FRAME_W, 0), fr)
    return row

ROWS = []
# 0 idle <- breathing idle
REQUIRED = ["breathing", "movement", "thinking", "code", "loading", "error"]
for role in REQUIRED:
    f = SRC / VIDEO_FILES[role]
    if not f.is_file():
        # try case-insensitive fallback
        cand = list(SRC.glob("*.mp4"))
        raise FileNotFoundError(f"missing {role}: {f}; available: {[c.name for c in cand]}")

src_breath = SRC / VIDEO_FILES["breathing"]
src_move = SRC / VIDEO_FILES["movement"]
src_think = SRC / VIDEO_FILES["thinking"]
src_code = SRC / VIDEO_FILES["code"]
src_load = SRC / VIDEO_FILES["loading"]
src_err = SRC / VIDEO_FILES["error"]

print("videos:")
for name, src in [("breathing", src_breath), ("movement", src_move), ("thinking", src_think), ("code", src_code), ("loading", src_load), ("error", src_err)]:
    print(" ", name, src.name if src else "MISSING")

work = OUT / "_frames"
work.mkdir(parents=True, exist_ok=True)
for key, src in [("breathing", src_breath), ("movement", src_move), ("thinking", src_think), ("code", src_code), ("loading", src_load), ("error", src_err)]:
    if src:
        split_frames(src, work / key)

def load_cells(name: str) -> list[Image.Image]:
    cells = sorted((work / name).glob("*.png"), key=lambda p: int(p.stem.rsplit("_", 1)[1]))
    return [cell_from_frame(p) for p in cells]

idle_cells = load_cells("breathing") if src_breath else load_cells("breathing")
move_cells = load_cells("movement")
think_cells = load_cells("thinking")
code_cells = load_cells("code")
load_cells_ = load_cells("loading")
err_cells = load_cells("error")

# mirror movement for running-left
run_left = [c.transpose(Image.FLIP_LEFT_RIGHT) for c in move_cells]

# jumping: reuse breathing with vertical offsets
jump_cells = [Image.new("RGBA", (FRAME_W, FRAME_H), (0,0,0,0)) for _ in range(6)]
offsets = [0, -8, -16, -16, -8, 0]
for i, off in enumerate(offsets):
    src = idle_cells[i % len(idle_cells)]
    jc = Image.new("RGBA", (FRAME_W, FRAME_H), (0,0,0,0))
    jc.paste(src, (0, off), src)
    jump_cells[i] = jc

ROWS.extend([build_row(idle_cells), build_row(move_cells), build_row(run_left), build_row(think_cells), build_row(jump_cells), build_row(err_cells), build_row(load_cells_), build_row(code_cells), build_row(list(reversed(think_cells)))])

sheet = Image.new("RGBA", (SHEET_W, SHEET_H), (0, 0, 0, 0))
y = 0
for row in ROWS:
    sheet.paste(row, (0, y))
    y += FRAME_H
sheet.save(OUT / "spritesheet.png", optimize=True)

# pet.json
import json
pet_json = {
    "id": "krohn-ultron-chibi",
    "displayName": "KROHN Ultron Chibi",
    "description": "Pixel-art chibi KROHN Ultron mark for pet overlay + terminal. Generated from AI-animated source clips; 9-row x 8-col sheet, 192x208 cells.",
    "spritesheetPath": "spritesheet.png",
    "framework": "krohn-ultron",
    "license": "MIT",
    "author": "KROHN"
}
(OUT / "pet.json").write_text(json.dumps(pet_json, indent=2), encoding="utf-8")
print("wrote", OUT / "spritesheet.png")
